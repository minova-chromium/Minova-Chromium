"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = 10261;
const endpoint = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "feedback-service.mjs")], {
  env: {
    ...process.env,
    NODE_ENV: "test",
    MINOVA_FEEDBACK_DRY_RUN: "1",
    PORT: String(port)
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Feedback service did not start.\n${output}`);
}

async function post(body, headers = {}) {
  const response = await fetch(`${endpoint}/v1/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  try {
    await waitForServer();
    const payload = {
      type: "bug",
      email: "release-test@example.com",
      subject: "Bug Report",
      description: "A complete deterministic feedback service test description."
    };
    const invalid = await post({ ...payload, email: "invalid" });
    assert.equal(invalid.status, 400);

    const anonymousPayload = { ...payload, email: "" };
    const accepted = await post(anonymousPayload);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ok, true);

    const duplicate = await post(anonymousPayload);
    assert.equal(duplicate.status, 409);

    const forbiddenOrigin = await post(
      { ...payload, description: `${payload.description} Different.` },
      { origin: "https://untrusted.example" }
    );
    assert.equal(forbiddenOrigin.status, 403);

    console.log(JSON.stringify({
      passed: true,
      invalid: invalid.status,
      accepted: accepted.status,
      duplicate: duplicate.status,
      forbiddenOrigin: forbiddenOrigin.status
    }, null, 2));
  } finally {
    server.kill();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
