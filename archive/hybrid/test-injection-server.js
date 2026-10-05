const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.argv[2] || 18457);
const reportPath = path.join(__dirname, "test-injection-report.json");
const report = { port, startedAt: new Date().toISOString(), injected: false };

function save() {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.writeHead(204);
  response.end();
  if (!request.url.startsWith("/injected")) return;

  report.injected = true;
  report.requestUrl = request.url;
  report.completedAt = new Date().toISOString();
  save();
  setTimeout(() => server.close(() => process.exit(0)), 100);
});

server.listen(port, "127.0.0.1", () => {
  save();
  process.stdout.write(`Minova Hybrid injection probe listening on ${port}\n`);
});

setTimeout(() => {
  report.error = "The Minova Hybrid extension did not report an injected interface within 30 seconds.";
  report.completedAt = new Date().toISOString();
  save();
  server.close(() => process.exit(1));
}, 30000).unref();
