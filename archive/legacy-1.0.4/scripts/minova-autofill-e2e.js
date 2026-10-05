const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const debugPort = Number(process.argv[2] || 10040);
const sitePort = Number(process.argv[3] || 10100);
const reportPath = path.join(__dirname, "artifacts", `autofill-${debugPort}.json`);
const report = { startedAt: new Date().toISOString(), debugPort, sitePort };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function saveReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cdp(target, method, params = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function withCdpSession(target, callback) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) {
      request.reject(new Error(message.error?.message || message.result.exceptionDetails.text));
    } else {
      request.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    return await callback(send);
  } finally {
    socket.close();
  }
}

async function evaluate(target, expression) {
  const result = await cdp(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result.result.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const shadow of node.shadowRoots || []) {
    const match = findNode(shadow, predicate);
    if (match) return match;
  }
  for (const child of node.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

async function main() {
  saveReport();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body>
      <form id="login"><label>Email <input id="email" name="email" type="email" autocomplete="username"></label>
      <label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
      <button type="submit">Sign in</button></form>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(sitePort, "127.0.0.1", resolve));

  let shell;
  let credentialId;
  let tabId;
  try {
    shell = (await targets()).find((target) => target.url.includes("/src/index.html"));
    assert(shell, "Minova shell was not found");
    const saved = await evaluate(shell, `window.minova.savePassword({
      site: ${JSON.stringify(`http://127.0.0.1:${sitePort}`)},
      username: "autofill@minova.test",
      password: "Minova-Test-Password-42"
    })`);
    credentialId = saved.find((entry) => entry.username === "autofill@minova.test")?.id;
    assert(credentialId, "Temporary test credential was not saved");

    tabId = await evaluate(shell, `openTab(${JSON.stringify(`http://127.0.0.1:${sitePort}/login`)}).id`);
    await sleep(1200);
    const page = (await targets()).find((target) => target.url.startsWith(`http://127.0.0.1:${sitePort}/`));
    assert(page, "Local login page did not load");
    await evaluate(page, `document.querySelector("#email").focus(); true`);
    await sleep(500);

    const clickDetails = await withCdpSession(page, async (send) => {
      const documentTree = await send("DOM.getDocument", { depth: -1, pierce: true });
      const suggestionButton = findNode(documentTree.root, (node) => (
        node.nodeName === "BUTTON" && Array.isArray(node.attributes) && node.attributes.includes("credential")
      ));
      assert(suggestionButton?.backendNodeId, "Credential suggestion did not appear after focusing the email field");
      const box = await send("DOM.getBoxModel", { backendNodeId: suggestionButton.backendNodeId });
      const resolved = await send("DOM.resolveNode", { backendNodeId: suggestionButton.backendNodeId });
      await send("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration: "function () { this.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })); }",
        awaitPromise: true
      });
      return { attributes: suggestionButton.attributes, box: box.model.border };
    });
    await sleep(500);

    const values = await evaluate(page, `({
      email: document.querySelector("#email").value,
      password: document.querySelector("#password").value
    })`);
    report.suggestion = clickDetails;
    report.observedValues = { email: values.email, passwordLength: values.password.length };
    saveReport();
    assert(values.email === "autofill@minova.test", "Email was not autofilled");
    assert(values.password === "Minova-Test-Password-42", "Password was not autofilled");
    report.values = { email: values.email, passwordLength: values.password.length };
    report.passed = true;
  } finally {
    if (shell && credentialId) {
      try {
        await evaluate(shell, `window.minova.removePassword(${JSON.stringify(credentialId)})`);
      } catch {
        // Preserve the original test result.
      }
    }
    if (shell && tabId) {
      try {
        await evaluate(shell, `closeTab(${JSON.stringify(tabId)}); true`);
      } catch {
        // The browser may already be closing.
      }
    }
    await new Promise((resolve) => server.close(resolve));
  }
  report.finishedAt = new Date().toISOString();
  saveReport();
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  saveReport();
  console.error(error);
  process.exitCode = 1;
});
