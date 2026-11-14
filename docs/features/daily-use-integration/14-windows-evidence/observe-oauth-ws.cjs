const { channel } = require("node:diagnostics_channel");
const { appendFileSync } = require("node:fs");

function record(value) {
  if (process.env.QA_WS_OBSERVATION) {
    appendFileSync(process.env.QA_WS_OBSERVATION, JSON.stringify({
      at: new Date().toISOString(), pid: process.pid, ...value,
    }) + "\n");
  }
}

record({ event: "observer-start", node: process.versions.node });
channel("http.client.request.start").subscribe(({ request }) => {
  if (request.path !== "/backend-api/codex/responses" ||
      request.getHeader("host") !== "chatgpt.com" ||
      request.getHeader("upgrade")?.toLowerCase() !== "websocket") return;
  const started = performance.now();
  request.once("upgrade", (response, socket) => record({
    event: "websocket-upgrade",
    endpoint: "chatgpt.com/backend-api/codex/responses",
    status: response.statusCode,
    throughAgent: request.agent !== require("node:https").globalAgent,
    ms: Math.round(performance.now() - started),
    tls: socket.authorized,
  }));
});
