"use strict";

const port = Number(process.argv[2] || 10448);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

async function command(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true }
    })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message || message.result.exceptionDetails.text));
        return;
      }
      resolve(message.result.result.value);
    });
    socket.addEventListener("error", reject);
  });
}

(async () => {
  const tour = (await targets()).find((target) => target.url.endsWith("/src/onboarding.html"));
  const snapshot = () => command(tour, `({
    step: state.step,
    title: document.querySelector("#tourContent h1")?.textContent || "",
    layouts: document.querySelectorAll("[data-layout]").length
  })`);
  console.log("before", await snapshot());
  await command(tour, "document.querySelector('#nextButton').click(); true");
  for (const delay of [0, 50, 250, 750, 1500]) {
    await sleep(delay);
    console.log(delay, await snapshot());
  }
  await command(tour, "document.querySelector('[data-layout=\"classic\"]').click(); true");
  for (const delay of [0, 50, 250, 750]) {
    await sleep(delay);
    console.log(`classic-${delay}`, await snapshot());
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
