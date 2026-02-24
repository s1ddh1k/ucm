#!/usr/bin/env node
"use strict";

const { startDaemon, gracefulShutdown, setEmbeddedMode } = require("./ucmd.js");
const { startUiServer } = require("./ucm-ui-server.js");

let uiShutdown = null;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (uiShutdown) uiShutdown();
  } catch {}

  try {
    await gracefulShutdown();
  } catch {}

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("uncaughtException", (error) => {
  console.error(`[FATAL] uncaughtException: ${error.stack || error.message}`);
  if (process.send) process.send({ type: "error", message: error.message });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(
    `[ERROR] unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`,
  );
});

async function main() {
  setEmbeddedMode(true);

  await startDaemon(true, false, { embedded: true });

  const port = Number(process.env.UCM_UI_PORT) || 17173;
  const ui = await startUiServer({ port, embedded: true });
  uiShutdown = ui.shutdown;

  if (process.send) process.send({ type: "ready", port });
}

main().catch((error) => {
  console.error(error.message);
  if (process.send) process.send({ type: "error", message: error.message });
  process.exit(1);
});
