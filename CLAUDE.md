# CLAUDE.md

## Project Overview

WeCom smart robot bot sample — a Node.js service that connects to WeCom via WebSocket long connection, receives user messages, and auto-replies using Claude AI or OpenAI with wecom-cli skills.

## Architecture

- **index.js** — Entry point. WebSocket bot lifecycle, message routing, streaming replies.
- **lib/wecom-ws.js** — `WeComBot` class. WeCom WebSocket protocol (subscribe, heartbeat, reconnect, reply methods).
- **lib/ai-handler.js** — AI agentic loop supporting Anthropic (Messages API) and OpenAI (Responses API). Provider auto-detected from `AI_MODEL`. Loads skills from `skills/` as system prompt context. Single `wecom_cli` tool. Supports ChatGPT OAuth for subscription-based access (no API key needed).
- **lib/auth-chatgpt.js** — ChatGPT OAuth (PKCE) flow. Browser-based login, token storage at `~/.wecom-bot/auth.json`, auto-refresh.
- **lib/chat-history.js** — SQLite-backed conversation history. Per-session storage (userid for DMs, chatid for groups), automatic compaction when approaching context limits, TTL-based cleanup.
- **lib/tools.js** — Skill loader + wecom-cli binary executor. Resolves native `.exe` on Windows to avoid shell quoting issues.
- **scripts/login-chatgpt.js** — CLI script for ChatGPT OAuth login (`npm run login`).
- **skills/** — SKILL.md files installed from `WecomTeam/wecom-cli`. These are NOT hardcoded — the bot reads them at startup and injects into Claude's system prompt. Add/remove skills without code changes.

## Key Design Decisions

- **Skills-as-context pattern**: Instead of hardcoding tool schemas for each wecom-cli command, we load SKILL.md files and let the AI read the docs to construct correct CLI calls. One generic `wecom_cli(category, method, args)` tool handles everything. The skill loading chain:
  1. `npx wecom-cli skill install` downloads SKILL.md files into `.agents/skills/`
  2. `skills/` contains relative symlinks → `.agents/skills/` (survives folder renames)
  3. `loadSkills()` in `lib/tools.js` reads SKILL.md content at startup
  4. `lib/ai-handler.js` injects skill text into the system prompt
  5. The AI model reads the docs as context and calls `wecom_cli(category, method, args)`

  Update skills with `npx wecom-cli skill install WecomTeam/wecom-cli` — restart the bot to pick up changes. No code modifications needed.
- **WebSocket long connection** (not webhook): No public URL needed, no message encryption, supports streaming replies. Based on https://developer.work.weixin.qq.com/document/path/101463
- **Native binary resolution**: On Windows, `execFile` with `.cmd` shims mangles JSON args. We resolve the native `wecom-cli.exe` directly from `node_modules/@wecom/cli-win32-x64/bin/`.
- **Persistent chat history**: SQLite DB at `data/history.db` survives restarts. Session key is `userid` for single chats, `chatid` for groups. Automatic compaction removes oldest messages when nearing the context window limit.

## Setup

1. `npm install` — installs all deps including `@wecom/cli` (provides the `wecom-cli` binary)
2. `cp .env.example .env` — fill in credentials
3. `npx wecom-cli init` — **required one-time setup**. Interactively configures WeCom bot credentials, stored encrypted at `~/.config/wecom/bot.enc`. The `wecom-cli` binary needs this to authenticate API calls.

Skills (SKILL.md files in `skills/`) are already committed to the repo — no install step needed for basic usage.

## Commands

```bash
npm start          # Production
npm run dev        # Dev mode with auto-reload (node --watch)
npm run login      # ChatGPT OAuth login (one-time, opens browser)
```

## Environment Variables

See `.env.example`. Key vars:
- `WECOM_BOT_ID`, `WECOM_SECRET` — From WeCom admin > Smart Robot > Long Connection (for WebSocket)
- `ANTHROPIC_API_KEY` — Anthropic API key (SDK reads automatically)
- `OPENAI_API_KEY` — OpenAI API key (needed when using GPT models)
- `OPENAI_AUTH_MODE` — `api_key` (default) or `chatgpt` (OAuth via ChatGPT subscription, run `npm run login` first)
- `AI_ENABLED` — `true` to enable AI replies, `false` for echo mode
- `AI_MODEL` — Default `claude-sonnet-4-6`. Use `gpt-5.4` for OpenAI.
- `MAX_TOKENS` — Max output tokens per response (default 16384)
- `MAX_ROUNDS` — Max tool-calling rounds per message (default 999)
- `MAX_HISTORY_TOKENS` — Max estimated tokens of conversation history per session (default 100000)
- `SESSION_TTL_MINUTES` — Session inactivity timeout in minutes (default 60)

Note: `WECOM_BOT_ID`/`WECOM_SECRET` in `.env` are for the WebSocket connection. The `wecom-cli` binary uses separate credentials configured via `wecom-cli init` (stored at `~/.config/wecom/bot.enc`).

## Adding / Updating Skills

```bash
npx wecom-cli skill install WecomTeam/wecom-cli
```

Skills appear in `skills/`. Restart the bot to pick them up.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- No TypeScript — plain JS with JSDoc types where helpful
- Minimal dependencies: `@anthropic-ai/sdk`, `openai`, `@wecom/cli`, `better-sqlite3`, `ws`, `dotenv`
- Console logging with `[tag]` prefixes: `[ws]`, `[msg]`, `[ai-tool]`, `[ai]`
