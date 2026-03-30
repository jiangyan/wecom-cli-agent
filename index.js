/**
 * WeCom Smart Robot — WebSocket Long Connection Bot
 * https://developer.work.weixin.qq.com/document/path/101463
 */
import "dotenv/config";
import { WeComBot } from "./lib/wecom-ws.js";
import { generateReply } from "./lib/ai-handler.js";

const {
  WECOM_BOT_ID,
  WECOM_SECRET,
  AI_ENABLED = "false",
  WELCOME_MESSAGE = "Hello! I'm the smart assistant, how can I help you?",
} = process.env;

if (!WECOM_BOT_ID || !WECOM_SECRET) {
  console.error("Error: WECOM_BOT_ID and WECOM_SECRET are required in .env");
  process.exit(1);
}

const bot = new WeComBot(WECOM_BOT_ID, WECOM_SECRET);

bot.on("ready", () => {
  console.log(`\n  WeCom Bot ready | AI: ${AI_ENABLED === "true" ? "ON" : "OFF"}\n`);
});

bot.on("event:enter_chat", (data) => {
  bot.replyWelcome(data.headers.req_id, WELCOME_MESSAGE);
});

bot.on("message", async (data) => {
  const reqId = data.headers.req_id;
  const msgType = data.body?.msgtype;
  const fromUser = data.body?.from?.userid;

  // Extract text (text + voice supported; reject others)
  let userMessage = "";
  if (msgType === "text") userMessage = data.body.text?.content || "";
  else if (msgType === "voice") userMessage = data.body.voice?.content || "";
  else {
    bot.replyMarkdown(reqId, "Currently only text and voice messages are supported.");
    return;
  }

  userMessage = userMessage.replace(/^@\S+\s*/, "").trim();
  if (!userMessage) return;

  console.log(`[msg] ${fromUser}: ${userMessage}`);

  if (AI_ENABLED !== "true") {
    bot.replyMarkdown(reqId, `> ${userMessage}\n\n*Echo mode. Set AI_ENABLED=true for AI.*`);
    return;
  }

  const streamId = bot.replyStream(reqId, "Thinking...", { finish: false });
  try {
    const { text, meetingCard } = await generateReply(userMessage);
    bot.replyStream(reqId, text, { streamId, finish: true });
    if (meetingCard) bot.replyMeetingCard(reqId, meetingCard);
  } catch (err) {
    console.error(`[ai] ${err.message}`);
    bot.replyStream(reqId, "Sorry, something went wrong.", { streamId, finish: true });
  }
});

bot.on("event:feedback_event", (data) => {
  console.log("[feedback]", JSON.stringify(data.body));
});

bot.on("error", (err) => console.error("[bot]", err.message));

const shutdown = () => { bot.disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bot.connect();
