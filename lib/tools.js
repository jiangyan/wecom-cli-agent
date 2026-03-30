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

// Resolve wecom-cli binary (native .exe preferred over .cmd shim)
const WECOM_CLI_EXE = join(__dirname, "..", "node_modules", "@wecom", "cli-win32-x64", "bin", "wecom-cli.exe");
const WECOM_CLI_FALLBACK = join(__dirname, "..", "node_modules", ".bin", "wecom-cli");
const WECOM_CLI = existsSync(WECOM_CLI_EXE) ? WECOM_CLI_EXE : WECOM_CLI_FALLBACK;
const USE_SHELL = !existsSync(WECOM_CLI_EXE);

// One tool definition — Claude uses skill docs to decide category/method/args
export const toolDefinitions = [
  {
    name: "wecom_cli",
    description: "Execute a wecom-cli command. Use the skill documentation in the system prompt to determine the correct category, method, and JSON arguments.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "CLI category: contact, doc, meeting, msg, schedule, todo",
        },
        method: {
          type: "string",
          description: "Method name within the category, e.g. create_meeting, get_userlist",
        },
        args: {
          type: "object",
          description: "JSON arguments as documented in the skill",
        },
      },
      required: ["category", "method", "args"],
    },
  },
];

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
