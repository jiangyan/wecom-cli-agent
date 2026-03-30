/**
 * AI-powered auto-answer — supports Anthropic and OpenAI providers.
 * Provider is auto-detected from AI_MODEL:
 *   - gpt-*, o3*, o4*, codex* → OpenAI (Responses API)
 *   - Everything else → Anthropic (Messages API)
 *
 * OpenAI auth modes (OPENAI_AUTH_MODE):
 *   - "api_key" (default) → uses OPENAI_API_KEY, hits api.openai.com
 *   - "chatgpt" → uses ChatGPT OAuth tokens, hits chatgpt.com/backend-api/codex
 *     Run `npm run login` first to authenticate via browser.
 *
 * Skills (SKILL.md files) are loaded as system prompt context.
 * A single `wecom_cli` tool lets the model call any CLI command.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { executeTool, loadSkills } from "./tools.js";
import { loadTokens, refreshTokens, startAutoRefresh } from "./auth-chatgpt.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SKILLS_DIR = process.env.SKILLS_DIR || join(PROJECT_ROOT, "skills");

const { AI_MODEL = "claude-sonnet-4-6", OPENAI_AUTH_MODE = "api_key" } = process.env;
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "16384", 10);
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || "999", 10);

const isOpenAI = /^(gpt-|o[34]|codex)/.test(AI_MODEL);
const isChatGPTAuth = isOpenAI && OPENAI_AUTH_MODE === "chatgpt";

const skills = loadSkills(SKILLS_DIR);
console.log(`[ai] Loaded ${skills.length} skills from ${SKILLS_DIR}`);
console.log(`[ai] Provider: ${isOpenAI ? "OpenAI" : "Anthropic"} | Model: ${AI_MODEL}${isChatGPTAuth ? " | Auth: ChatGPT OAuth" : ""}`);

// Initialize ChatGPT OAuth tokens if needed
let chatgptTokens = null;
if (isChatGPTAuth) {
  chatgptTokens = loadTokens();
  if (!chatgptTokens) {
    console.error("[auth] No ChatGPT OAuth tokens found. Run `npm run login` first.");
    process.exit(1);
  }
  // Refresh immediately if stale (>8 min since last refresh)
  const lastRefresh = new Date(chatgptTokens.last_refresh).getTime();
  if (Date.now() - lastRefresh > 8 * 60 * 1000) {
    try {
      chatgptTokens = await refreshTokens(chatgptTokens);
    } catch (err) {
      console.error(`[auth] Token refresh failed: ${err.message}`);
      console.error("[auth] Run `npm run login` to re-authenticate.");
      process.exit(1);
    }
  }
  startAutoRefresh(chatgptTokens);
  console.log(`[auth] Authenticated as ${chatgptTokens.email}`);
}

const SKILLS_TEXT = `You are a helpful WeCom enterprise assistant.
Reply concisely in the user's language. Use the wecom_cli tool to fulfill requests.
Execute tool calls immediately — never ask for confirmation before calling a tool.
To find a user's userid, call wecom_cli with category "contact", method "get_userlist", args {}.
To send a DM, use msg send_message with chat_type=1 and chatid=userid (e.g. chatid="JiangYan").

## Available wecom-cli skills

${skills.join("\n\n---\n\n")}`;

// For OpenAI — plain string (no caching API)
function buildSystemPrompt() {
  return `${SKILLS_TEXT}\nToday's date is ${new Date().toISOString().split("T")[0]}.`;
}

// For Anthropic — array format with cache breakpoints.
// Prefix order: tools → system → messages.
// The large skills block is cached (90% cost reduction on cache hits).
// The date is a separate uncached block so it doesn't bust the cache.
function buildAnthropicSystem() {
  return [
    {
      type: "text",
      text: SKILLS_TEXT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `Today's date is ${new Date().toISOString().split("T")[0]}.`,
    },
  ];
}

// ─── Anthropic (Messages API) ────────────────────────────────────────────────

/** @type {Anthropic.Tool[]} */
const anthropicTools = [
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
    cache_control: { type: "ephemeral" },
  },
];

async function generateReplyAnthropic(userMessage, history = []) {
  const client = new Anthropic();

  /** @type {Anthropic.MessageParam[]} */
  const messages = [...history, { role: "user", content: userMessage }];
  let meetingCard = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      system: buildAnthropicSystem(),
      tools: anthropicTools,
      messages,
    });

    const { usage } = response;
    if (usage) {
      const cached = usage.cache_read_input_tokens || 0;
      const created = usage.cache_creation_input_tokens || 0;
      const uncached = usage.input_tokens || 0;
      console.log(`[ai] tokens: cached=${cached} created=${created} uncached=${uncached} output=${usage.output_tokens || 0}`);
    }

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

// ─── OpenAI (Responses API) ──────────────────────────────────────────────────

const openaiTools = [
  {
    type: "function",
    name: "wecom_cli",
    description:
      "Execute a wecom-cli command. Pass category, method, and ALL command arguments as top-level properties (NOT nested in an args object). Copy the JSON fields from the skill docs examples directly.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "contact, doc, meeting, msg, schedule, todo" },
        method: { type: "string", description: "Method name, e.g. create_meeting, get_userlist, send_message" },
      },
      required: ["category", "method"],
      additionalProperties: true,
    },
  },
];

function createOpenAIClient() {
  if (isChatGPTAuth) {
    // ChatGPT OAuth → chatgpt.com backend API (stricter than api.openai.com)
    return new OpenAI({
      baseURL: "https://chatgpt.com/backend-api/codex",
      apiKey: chatgptTokens.access_token,
      timeout: 120_000, // Codex streaming can be slow to start
      defaultHeaders: {
        "ChatGPT-Account-ID": chatgptTokens.account_id,
        originator: "codex_cli_rs",
      },
    });
  }
  // Standard API key (reads OPENAI_API_KEY from env)
  return new OpenAI({ timeout: 120_000 });
}

// Consume SSE stream and return the parsed final response
async function consumeStream(stream) {
  let response = null;
  for await (const event of stream) {
    if (event.type === "response.completed") {
      response = event.response;
    }
  }
  return response;
}

// Extract text from response — SDK Response has output_text getter, but streamed raw objects don't
function getOutputText(response) {
  if (response.output_text) return response.output_text;
  return response.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n") || null;
}

async function callOpenAI(client, inputItems, prevResponseId = null) {
  const params = {
    model: AI_MODEL,
    instructions: buildSystemPrompt(),
    input: inputItems,
    tools: openaiTools,
  };

  if (isChatGPTAuth) {
    // Codex backend: input=array, store=false, stream=true, no max_output_tokens,
    // no previous_response_id (must build full conversation in input)
    params.store = false;
    params.stream = true;
    const stream = await client.responses.create(params);
    return consumeStream(stream);
  }

  // Standard API: supports previous_response_id for server-managed state
  params.max_output_tokens = MAX_TOKENS;
  if (prevResponseId) params.previous_response_id = prevResponseId;
  return client.responses.create(params);
}

async function generateReplyOpenAI(userMessage, history = []) {
  const client = createOpenAIClient();
  let meetingCard = null;

  // Build conversation as input items array
  const conversation = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let response = await callOpenAI(client, conversation);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const functionCalls = response.output.filter((item) => item.type === "function_call");
    if (functionCalls.length === 0) break;

    const toolResults = [];
    for (const fc of functionCalls) {
      console.log(`[ai-tool] raw: ${fc.arguments}`);
      const input = JSON.parse(fc.arguments);
      const result = await executeTool(fc.name, input);
      console.log(`[ai-tool] result: errcode=${result.errcode}${result.errmsg ? " " + result.errmsg.substring(0, 100) : ""}`);

      if (input.method === "create_meeting" && result.errcode === 0) {
        meetingCard = { ...input.args, ...result };
      }

      toolResults.push({
        type: "function_call_output",
        call_id: fc.call_id,
        output: JSON.stringify(result),
      });
    }

    if (isChatGPTAuth) {
      // Codex backend: no previous_response_id, so append the model's output + tool results to conversation
      conversation.push(...response.output);
      conversation.push(...toolResults);
      response = await callOpenAI(client, conversation);
    } else {
      // Standard API: use previous_response_id, only send tool results
      response = await callOpenAI(client, toolResults, response.id);
    }
  }

  const text = getOutputText(response) || "Done.";
  return { text, meetingCard };
}

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * @param {string} userMessage
 * @param {{ role: string, content: string }[]} [history] Prior conversation turns
 */
export async function generateReply(userMessage, history = []) {
  return isOpenAI ? generateReplyOpenAI(userMessage, history) : generateReplyAnthropic(userMessage, history);
}
