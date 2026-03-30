#!/usr/bin/env node
/**
 * Interactive ChatGPT OAuth login.
 * Opens a browser for ChatGPT sign-in, stores tokens locally.
 *
 * Usage: npm run login
 */
import { login } from "../lib/auth-chatgpt.js";
import { exec } from "node:child_process";
import { platform } from "node:os";

function openBrowser(url) {
  const os = platform();
  const cmd = os === "win32" ? `start "" "${url}"`
    : os === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.log("[auth] Could not auto-open browser. Please open the URL manually.");
  });
}

console.log("╔══════════════════════════════════════════╗");
console.log("║   ChatGPT OAuth Login for WeCom Bot      ║");
console.log("║                                          ║");
console.log("║   Sign in with your ChatGPT account      ║");
console.log("║   to use Codex/GPT models via OAuth.     ║");
console.log("╚══════════════════════════════════════════╝\n");

try {
  const tokens = await login({
    onAuthUrl(url) {
      console.log(`\n  Opening browser for ChatGPT login...\n`);
      console.log(`  If the browser doesn't open, visit:\n  → ${url}\n`);
      openBrowser(url);
    },
  });

  console.log("\n✓ Login successful!");
  console.log(`  Account: ${tokens.email}`);
  console.log(`  Tokens saved to: ~/.wecom-bot/auth.json`);
  console.log(`\n  Set these in your .env:`);
  console.log(`    AI_MODEL=gpt-5.4`);
  console.log(`    OPENAI_AUTH_MODE=chatgpt`);
  console.log(`\n  Then run: npm start`);
} catch (err) {
  console.error(`\n✗ Login failed: ${err.message}`);
  process.exit(1);
}
