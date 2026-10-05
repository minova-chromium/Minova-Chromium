"use strict";

const port = Number(process.argv[2] || 10441);
const mode = process.argv[3] || "maximize";
const layout = process.argv[4] === "workspaces" ? "workspaces" : process.argv[4] === "preserve" ? "preserve" : "classic";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function waitForShell() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const shell = (await listTargets()).find((target) => target.url.includes("/src/index.html"));
      if (shell) return shell;
    } catch {}
    await sleep(100);
  }
  throw new Error("Minova shell target was not found.");
}

async function command(target, method, params = {}, timeoutMilliseconds = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${method} timed out.`));
    }, timeoutMilliseconds);
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

async function evaluate(target, expression) {
  const result = await command(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result.result.value;
}

async function click(target, point) {
  await command(target, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
  await command(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1
  });
}

async function waitForMaximized(target, expected) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(target, "window.minova.isWindowMaximized()") === expected) return true;
    await sleep(50);
  }
  return false;
}

(async () => {
  const shell = await waitForShell();
  if (layout !== "preserve") {
    await evaluate(shell, `(async () => {
      state.settings = await window.minova.setSettings({ tabLayout: ${JSON.stringify(layout)} });
      applyInterfaceLayout();
      return true;
    })()`);
  }
  await sleep(300);

  const before = await evaluate(shell, `(() => {
    const center = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const hit = (point) => {
      const element = document.elementFromPoint(point.x, point.y);
      return { id: element?.id || "", className: String(element?.className || ""), parentId: element?.parentElement?.id || "" };
    };
    const tabs = [...document.querySelectorAll("#tabStrip .tab")];
    const lastTab = tabs.at(-1)?.getBoundingClientRect();
    const addButton = document.querySelector("#newTabButton");
    const addRect = addButton.getBoundingClientRect();
    const controls = Object.fromEntries(["minimizeWindowButton", "maximizeWindowButton", "closeWindowButton"].map((id) => {
      const button = document.getElementById(id);
      const point = center(button);
      return [id, { point, hit: hit(point), nativeAction: button.dataset.nativeWindowControl || "" }];
    }));
    return {
      appClassName: document.querySelector(".app-shell")?.className || "",
      location: location.href,
      visibilityState: document.visibilityState,
      screen: { x: window.screenX, y: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
      styleSheets: [...document.styleSheets].map((sheet) => sheet.href || "inline"),
      controls,
      tabCount: tabs.length,
      lastTabRight: lastTab?.right ?? null,
      addLeft: addRect.left,
      addGap: lastTab ? addRect.left - lastTab.right : null,
      addHit: hit(center(addButton)),
      addPoint: center(addButton)
    };
  })()`);

  if (mode === "inspect") {
    console.log(JSON.stringify({ before }, null, 2));
    return;
  }

  if (mode === "close") {
    await click(shell, before.controls.closeWindowButton.point);
    let closed = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        closed = !(await listTargets()).some((target) => target.url.includes("/src/index.html"));
      } catch {
        closed = true;
      }
      if (closed) break;
      await sleep(50);
    }
    console.log(JSON.stringify({ before, closed }, null, 2));
    return;
  }

  if (mode === "minimize") {
    await click(shell, before.controls.minimizeWindowButton.point);
    await sleep(400);
    const visibilityState = await evaluate(shell, "document.visibilityState");
    console.log(JSON.stringify({ before, visibilityState }, null, 2));
    return;
  }

  const wasMaximized = await evaluate(shell, "window.minova.isWindowMaximized()");
  await click(shell, before.controls.maximizeWindowButton.point);
  const maximizeChanged = await waitForMaximized(shell, !wasMaximized);
  if (maximizeChanged) {
    const nextPoint = await evaluate(shell, `(() => {
      const rect = document.querySelector("#maximizeWindowButton").getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await click(shell, nextPoint);
    await waitForMaximized(shell, wasMaximized);
  }

  console.log(JSON.stringify({ before, wasMaximized, maximizeChanged }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
