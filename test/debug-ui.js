#!/usr/bin/env node
// test/debug-ui.js — 브라우저 디버그 하네스 (CLI)
//
// One-shot:  node test/debug-ui.js "Proposals 탭 레이아웃 확인"
// Interactive: node test/debug-ui.js
// External:  node test/debug-ui.js --url http://localhost:3000 "check layout"
// Provider:  node test/debug-ui.js --provider codex "check layout"

const readline = require("readline");
const { TestEnvironment } = require("./helpers/test-infra.js");
const { browserAgent } = require("../lib/core/browser-agent");

function parseArgs() {
  const args = process.argv.slice(2);
  let url = null;
  let provider = null;
  let prompt = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === "--provider" && args[i + 1]) {
      provider = args[++i];
    } else if (!prompt) {
      prompt = args.slice(i).join(" ");
      break;
    }
  }

  return { url, provider, prompt };
}

async function main() {
  const { url: externalUrl, provider, prompt } = parseArgs();

  let env = null;
  let url = externalUrl;

  // Ctrl+C cleanup
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    if (env) await env.cleanup();
    process.exit(0);
  });

  try {
    if (!externalUrl) {
      env = new TestEnvironment("ucm-debug-ui");
      console.log("Starting daemon + UI server...");
      await env.startAll();
      url = env.url;
      console.log(`UI ready at ${url}\n`);
    } else {
      console.log(`Using external UI: ${url}\n`);
    }

    if (prompt) {
      // one-shot
      console.log(`> ${prompt}\n`);
      const result = await browserAgent(url, prompt, {
        provider,
        onLog: (msg) => process.stderr.write(msg + "\n"),
      });
      console.log(result.text);
      console.log(`\n(${(result.durationMs / 1000).toFixed(1)}s)`);
    } else {
      // interactive
      console.log("Interactive debug mode. Type instruction and press Enter.");
      console.log("Type 'exit' or Ctrl+C to quit.\n");

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "debug> ",
      });

      rl.prompt();

      for await (const line of rl) {
        const input = line.trim();
        if (!input) { rl.prompt(); continue; }
        if (input === "exit" || input === "quit") break;

        const result = await browserAgent(url, input, {
          provider,
          onLog: (msg) => process.stderr.write(msg + "\n"),
        });
        console.log(`\n${result.text}`);
        console.log(`\n(${(result.durationMs / 1000).toFixed(1)}s)\n`);
        rl.prompt();
      }
    }
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    if (env) await env.cleanup();
  }
}

main();
