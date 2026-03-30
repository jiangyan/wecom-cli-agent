/**
 * AI-powered auto-answer using Anthropic SDK + wecom-cli skills.
 * Skills (SKILL.md files) are loaded as system prompt context.
 * A single `wecom_cli` tool lets Claude call any CLI command.
 * The SDK handles the API calls; we run a simple agentic loop.
 */
import Anthropic from "@anthropic-ai/sdk";
import { executeTool, loadSkills } from "./tools.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SKILLS_DIR = process.env.SKILLS_DIR || join(PROJECT_ROOT, "skills");

const { AI_MODEL = "claude-sonnet-4-6" } = process.env;

const client = new Anthropic();

const skills = loadSkills(SKILLS_DIR);
console.log(`[ai] Loaded ${skills.length} skills from ${SKILLS_DIR}`);

const SYSTEM_PROMPT = `You are a helpful WeCom enterprise assistant.
Reply concisely in the user's language. Use the wecom_cli tool to fulfill requests.
To find a user's userid, call wecom_cli with category "contact", method "get_userlist", args {}.

## Available wecom-cli skills

${skills.join("\n\n---\n\n")}`;

/** @type {Anthropic.Tool[]} */
const tools = [
  {
    name: "wecom_cli",
    description:
      "Execute a wecom-cli command. Use the skill docs in the system prompt for correct category, method, and args.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "contact, doc, meeting, msg, schedule, todo" },
        method: { type: "string", description: "Method name, e.g. create_meeting, get_userlist" },
        args: { type: "object", description: "JSON arguments per skill docs" },
      },
      required: ["category", "method", "args"],
    },
  },
];

const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || "999", 10);

export async function generateReply(userMessage) {
  const systemPrompt = `${SYSTEM_PROMPT}\nToday's date is ${new Date().toISOString().split("T")[0]}.`;

  /** @type {Anthropic.MessageParam[]} */
  const messages = [{ role: "user", content: userMessage }];
  let meetingCard = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "Done.";
      return { text, meetingCard };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "Done.";
      return { text, meetingCard };
    }

    messages.push({ role: "assistant", content: response.content });

    /** @type {Anthropic.ToolResultBlockParam[]} */
    const toolResults = [];
    for (const toolUse of toolUses) {
      const input = toolUse.input;
      console.log(`[ai-tool] ${input.category} ${input.method}`, JSON.stringify(input.args));
      const result = await executeTool(toolUse.name, input);
      console.log(`[ai-tool] errcode=${result.errcode}`);

      if (input.method === "create_meeting" && result.errcode === 0) {
        meetingCard = { ...input.args, ...result };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { text: "I ran out of steps. Please try a simpler question.", meetingCard };
}
