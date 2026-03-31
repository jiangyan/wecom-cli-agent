/**
 * Single generic wecom-cli tool for Claude API.
 * Skills are loaded as system prompt context — Claude reads them
 * and knows how to construct the right CLI commands.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Bot WebSocket sender — registered by index.js at startup
let botSender = null;
export function setBotSender(fn) { botSender = fn; }

// Resolve wecom-cli binary (native .exe preferred over .cmd shim)
const WECOM_CLI_EXE = join(__dirname, "..", "node_modules", "@wecom", "cli-win32-x64", "bin", "wecom-cli.exe");
const WECOM_CLI_FALLBACK = join(__dirname, "..", "node_modules", ".bin", "wecom-cli");
const WECOM_CLI = existsSync(WECOM_CLI_EXE) ? WECOM_CLI_EXE : WECOM_CLI_FALLBACK;
const USE_SHELL = !existsSync(WECOM_CLI_EXE);

// Load all SKILL.md files from the skills directory
export function loadSkills(skillsDir) {
  const skills = [];
  if (!existsSync(skillsDir)) return skills;

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (existsSync(skillFile)) {
      skills.push(readFileSync(skillFile, "utf8"));
    }
  }
  return skills;
}

export async function executeTool(name, input) {
  // Send message AS the bot via WebSocket (aibot_send_msg)
  if (name === "bot_send_message") {
    if (!botSender) return { errcode: -1, errmsg: "Bot sender not initialized" };
    try {
      const { chatid, chat_type, content } = input;
      if (!chatid || !content) return { errcode: -1, errmsg: "chatid and content are required" };
      botSender(chatid, content, { chatType: chat_type || 1 });
      return { errcode: 0, errmsg: "ok" };
    } catch (err) {
      return { errcode: -1, errmsg: err.message };
    }
  }

  if (name !== "wecom_cli") {
    return { errcode: -1, errmsg: `Unknown tool: ${name}` };
  }

  try {
    // Support both nested args ({category, method, args: {...}}) and flat format
    // ({category, method, chat_type, chatid, ...})
    const { category, method, args: explicitArgs, ...flatArgs } = input;
    const args = explicitArgs || (Object.keys(flatArgs).length > 0 ? flatArgs : {});
    const { stdout } = await execFileAsync(
      WECOM_CLI,
      [category, method, JSON.stringify(args)],
      { timeout: 30_000, shell: USE_SHELL }
    );
    const raw = JSON.parse(stdout);
    if (raw.isError) return { errcode: -1, errmsg: raw.content?.[0]?.text || "Unknown error" };
    if (!raw.content?.[0]?.text) return raw;
    try { return JSON.parse(raw.content[0].text); } catch { return raw; }
  } catch (err) {
    return { errcode: -1, errmsg: err.message };
  }
}
