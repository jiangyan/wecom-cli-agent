# CLAUDE.md

## Project Overview

WeCom smart robot bot sample — a Node.js service that connects to WeCom via WebSocket long connection, receives user messages, and auto-replies using Claude AI with wecom-cli skills.

## Architecture

- **index.js** — Entry point. WebSocket bot lifecycle, message routing, streaming replies.
- **lib/wecom-ws.js** — `WeComBot` class. WeCom WebSocket protocol (subscribe, heartbeat, reconnect, reply methods).
- **lib/ai-handler.js** — Anthropic SDK agentic loop. Loads skills from `skills/` as system prompt context. Single `wecom_cli` tool.
- **lib/tools.js** — Skill loader + wecom-cli binary executor. Resolves native `.exe` on Windows to avoid shell quoting issues.
- **skills/** — SKILL.md files installed from `WecomTeam/wecom-cli`. These are NOT hardcoded — the bot reads them at startup and injects into Claude's system prompt. Add/remove skills without code changes.

## Key Design Decisions

- **Skills-as-context pattern**: Instead of hardcoding tool schemas for each wecom-cli command, we load SKILL.md files and let Claude read the docs to construct correct CLI calls. One generic `wecom_cli(category, method, args)` tool handles everything.
- **WebSocket long connection** (not webhook): No public URL needed, no message encryption, supports streaming replies. Based on https://developer.work.weixin.qq.com/document/path/101463
- **Native binary resolution**: On Windows, `execFile` with `.cmd` shims mangles JSON args. We resolve the native `wecom-cli.exe` directly from `node_modules/@wecom/cli-win32-x64/bin/`.

## Commands

```bash
npm start          # Production
npm run dev        # Dev mode with auto-reload (node --watch)
```

## Environment Variables

See `.env.example`. Key vars:
- `WECOM_BOT_ID`, `WECOM_SECRET` — From WeCom admin > Smart Robot > Long Connection
- `ANTHROPIC_API_KEY` — Anthropic API key (SDK reads automatically)
- `AI_ENABLED` — `true` to enable AI replies, `false` for echo mode
- `AI_MODEL` — Default `claude-sonnet-4-6`
- `MAX_ROUNDS` — Max tool-calling rounds per message (default 999)

## Adding Skills

```bash
npx wecom-cli skill install WecomTeam/wecom-cli
```

Skills appear in `skills/`. Restart the bot to pick them up.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- No TypeScript — plain JS with JSDoc types where helpful
- Minimal dependencies: `@anthropic-ai/sdk`, `@wecom/cli`, `ws`, `dotenv`
- Console logging with `[tag]` prefixes: `[ws]`, `[msg]`, `[ai-tool]`, `[ai]`
