const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 10069);
const reportPath = path.join(__dirname, "artifacts", `steamdb-${port}.json`);
const report = { port, startedAt: new Date().toISOString() };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function command(target, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const details = message.result?.exceptionDetails;
        reject(new Error(
          message.error?.message
          || details?.exception?.description
          || details?.text
          || "CDP command failed."
        ));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(target, expression) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result.result.value;
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function findTarget(predicate, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {
      // The debugging endpoint may not be ready yet.
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  save();
  const shell = await findTarget((target) => target.url.includes("/src/index.html"));
  assert(shell, "Minova shell target was not found.");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)")) break;
    await sleep(250);
  }
  assert(
    await evaluate(shell, "typeof state !== 'undefined' && Boolean(state.settings && state.tabs.length)"),
    "Minova did not finish initializing."
  );

  const extension = await evaluate(shell, `window.minova.listExtensions().then((items) => items.find((item) => item.name === "SteamDB"))`);
  assert(extension?.id, "SteamDB did not load into Minova's browser session.");
  report.extension = { ...extension, icon: Boolean(extension.icon) };

  await evaluate(shell, `openTab("https://store.steampowered.com/app/620/Portal_2/").id`);
  const steam = await findTarget((target) => target.url.startsWith("https://store.steampowered.com/app/620/"));
  assert(steam, "The Steam Store test page did not open.");

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(500);
    report.page = await evaluate(steam, `({
      title: document.title,
      readyState: document.readyState,
      apiProbe: document.documentElement?.dataset.minovaSteamDbApi || "",
      scriptError: document.documentElement?.dataset.minovaSteamDbError || "",
      steamDbElements: document.querySelectorAll('[class*="steamdb"], [id*="steamdb"]').length,
      steamDbLinks: [...document.querySelectorAll('a[href*="steamdb.info"]')].slice(0, 8).map((link) => ({
        text: link.textContent.trim(),
        href: link.href,
        className: link.className
      }))
    })`);
    if (report.page.steamDbElements > 0 || report.page.steamDbLinks.length > 0) break;
  }

  assert(
    report.page.steamDbElements > 0 || report.page.steamDbLinks.length > 0,
    "SteamDB loaded but its content scripts did not modify the Steam Store page."
  );

  await evaluate(shell, `(() => {
    state.pinnedExtensions = [${JSON.stringify(extension.id)}];
    persistPinnedExtensions();
    renderPinnedExtensions();
    return true;
  })()`);
  await evaluate(shell, `document.querySelector("#pinnedExtensions .pinned-extension-button")?.click(); true`);
  const popup = await findTarget((target) => target.url === `chrome-extension://${extension.id}/options/popup.html`, 30);
  assert(popup, "SteamDB's pinned toolbar action did not open its popup.");
  await sleep(500);
  report.popup = await evaluate(popup, `({
    title: document.title,
    chartLabel: document.querySelector('[data-msg="popup_charts"]')?.textContent.trim() || "",
    optionsLabel: document.querySelector('[data-msg="options"]')?.textContent.trim() || "",
    bodyText: document.body.innerText.slice(0, 300)
  })`);
  assert(report.popup.chartLabel && report.popup.optionsLabel, "SteamDB's popup scripts did not initialize.");
  report.passed = true;
  report.finishedAt = new Date().toISOString();
  save();
  await evaluate(shell, "window.minova.closeWindow(); true").catch(() => {});
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  report.passed = false;
  report.error = error.stack || error.message;
  report.finishedAt = new Date().toISOString();
  save();
  console.error(error);
  process.exitCode = 1;
});
