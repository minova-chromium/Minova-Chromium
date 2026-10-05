import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.HOST || "127.0.0.1");
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "");
const DRY_RUN = process.env.NODE_ENV === "test" && process.env.MINOVA_FEEDBACK_DRY_RUN === "1";
const FEEDBACK_FROM = String(process.env.MINOVA_FEEDBACK_FROM || "Minova Feedback <feedback@example.com>");
const FEEDBACK_RECIPIENT = "minova.chromium@gmail.com";
const TRUST_PROXY = process.env.MINOVA_FEEDBACK_TRUST_PROXY === "1";
const ALLOWED_ORIGINS = new Set(
  String(process.env.MINOVA_FEEDBACK_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 5;
const DUPLICATE_WINDOW = 10 * 60 * 1000;
const buckets = new Map();
const recentSubmissions = new Map();

function sendJson(response, status, body, origin = "") {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(origin && ALLOWED_ORIGINS.has(origin)
      ? { "access-control-allow-origin": origin, vary: "origin" }
      : {})
  });
  response.end(JSON.stringify(body));
}

function clientAddress(request) {
  const forwarded = TRUST_PROXY
    ? String(request.headers["x-forwarded-for"] || "").split(",")[0].trim()
    : "";
  return forwarded || request.socket.remoteAddress || "unknown";
}

function rateLimitKey(address, email) {
  return crypto.createHash("sha256").update(`${address}\n${email}`).digest("hex");
}

function consumeRateLimit(address, email, now = Date.now()) {
  const key = rateLimitKey(address, email);
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_REQUESTS) return false;
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10000) {
    for (const [bucketKey, timestamps] of buckets) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW)) buckets.delete(bucketKey);
    }
  }
  return true;
}

function reserveSubmission(feedback, now = Date.now()) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${feedback.type}\n${feedback.email}\n${feedback.subject}\n${feedback.description}`)
    .digest("hex");
  for (const [key, timestamp] of recentSubmissions) {
    if (now - timestamp >= DUPLICATE_WINDOW) recentSubmissions.delete(key);
  }
  if (recentSubmissions.has(fingerprint)) return null;
  recentSubmissions.set(fingerprint, now);
  return fingerprint;
}

function validateFeedback(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid request.");
  }
  if (String(payload.website || "").trim()) throw new Error("Invalid request.");
  const type = payload.type === "feature" ? "feature" : payload.type === "bug" ? "bug" : "";
  const email = String(payload.email || "").trim().toLowerCase();
  const subject = String(payload.subject || "").trim();
  const description = String(payload.description || "").trim();
  if (!type) throw new Error("Invalid feedback type.");
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email) || email.length > 254)) {
    throw new Error("Invalid email address.");
  }
  if (subject.length < 3 || subject.length > 120) throw new Error("Invalid subject.");
  if (description.length < 20 || description.length > 5000) throw new Error("Invalid description.");
  return {
    type,
    email,
    subject,
    description,
    appVersion: String(payload.appVersion || "").slice(0, 40),
    chromiumVersion: String(payload.chromiumVersion || "").slice(0, 40),
    platform: String(payload.platform || "").slice(0, 30),
    architecture: String(payload.architecture || "").slice(0, 30)
  };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Malformed JSON.");
    error.status = 400;
    throw error;
  }
}

async function deliverFeedback(feedback) {
  if (DRY_RUN) return;
  if (!RESEND_API_KEY) {
    const error = new Error("Feedback delivery is not configured.");
    error.status = 503;
    throw error;
  }
  const category = feedback.type === "feature" ? "Feature request" : "Bug report";
  const body = [
    category,
    "",
    `From: ${feedback.email || "Not provided"}`,
    `Subject: ${feedback.subject}`,
    `Minova: ${feedback.appVersion || "unknown"}`,
    `Chromium: ${feedback.chromiumVersion || "unknown"}`,
    `Platform: ${feedback.platform || "unknown"} ${feedback.architecture || ""}`.trim(),
    "",
    feedback.description
  ].join("\n");
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [FEEDBACK_RECIPIENT],
        ...(feedback.email ? { reply_to: feedback.email } : {}),
        subject: `[Minova ${category}] ${feedback.subject}`,
        text: body
      }),
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    const error = new Error("Feedback delivery failed.");
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const providerRequestId = response.headers.get("x-request-id") || "unavailable";
    console.error(`Feedback provider failed with HTTP ${response.status}; request ${providerRequestId}`);
    const error = new Error("Feedback delivery failed.");
    error.status = 502;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  if (request.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      sendJson(response, 403, { ok: false, message: "Origin not allowed." });
      return;
    }
    response.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "origin"
    });
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/feedback") {
    sendJson(response, 404, { ok: false, message: "Not found." }, origin);
    return;
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    sendJson(response, 403, { ok: false, message: "Origin not allowed." });
    return;
  }

  try {
    const feedback = validateFeedback(await readJsonBody(request));
    if (!consumeRateLimit(clientAddress(request), feedback.email)) {
      sendJson(response, 429, { ok: false, message: "Too many submissions. Try again later." }, origin);
      return;
    }
    const reservation = reserveSubmission(feedback);
    if (!reservation) {
      sendJson(response, 409, { ok: false, message: "This feedback was already submitted recently." }, origin);
      return;
    }
    try {
      await deliverFeedback(feedback);
    } catch (error) {
      recentSubmissions.delete(reservation);
      throw error;
    }
    sendJson(response, 200, { ok: true, message: "Feedback sent." }, origin);
  } catch (error) {
    const status = Number(error.status) || 400;
    if (status >= 500) console.error("Feedback request failed:", error.message);
    sendJson(response, status, {
      ok: false,
      message: status >= 500 ? "Feedback service is temporarily unavailable." : error.message
    }, origin);
  }
});

server.headersTimeout = 15000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => {
  console.log(`Minova feedback service listening on http://${HOST}:${PORT}`);
});
