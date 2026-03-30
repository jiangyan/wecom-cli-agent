# wecom-cli-agent / 基于企微CLI + 企微机器人构建的Agent

[简体中文](./README.zh-CN.md)

<img width="810" height="959" alt="image" src="https://github.com/user-attachments/assets/c561df73-f449-4b9b-9289-290a293880d8" />
<img width="811" height="954" alt="image" src="https://github.com/user-attachments/assets/cf784e30-52d6-4b6f-9572-e5ec10777704" />

A sample WeCom smart robot that auto-answers user messages using Claude AI or OpenAI and [wecom-cli](https://github.com/WecomTeam/wecom-cli) skills.

## How It Works

```
User messages bot in WeCom
        |
  WebSocket long connection (wss://openws.work.weixin.qq.com)
        |
  Bot receives message → calls AI API (Anthropic or OpenAI)
        |
  AI reads wecom-cli skill docs → calls wecom_cli tool
        |
  Bot executes wecom-cli command → returns result to Claude
        |
  AI generates reply → bot sends streaming response
```

The bot has **zero hardcoded knowledge** of WeCom APIs. It loads [wecom-cli skills](https://github.com/WecomTeam/wecom-cli) (SKILL.md files) as system prompt context, and the AI model figures out which commands to call by reading the docs.

### How Skills Flow into AI Calls

```
npx wecom-cli skill install        .agents/skills/        skills/          loadSkills()        system prompt        AI model
  downloads SKILL.md files  ──→  actual files here  ←── symlinks  ──→  reads content  ──→  injected as text  ──→  reads docs & calls
                                                                                                                  wecom_cli tool
```

`skills/` are **relative symlinks** to `.agents/skills/`. Running `npx wecom-cli skill install WecomTeam/wecom-cli` updates the source files — restart the bot and the AI automatically learns the new capabilities. No code changes needed.

## Prerequisites

- Node.js >= 18
- A WeCom smart robot with **Long Connection** API mode enabled
- An Anthropic API key or OpenAI API key

## Quick Start

```bash
# 1. Clone
git clone https://github.com/user/wecom-bot-sample.git
cd wecom-bot-sample

# 2. Install dependencies (includes wecom-cli binary)
npm install

# 3. Initialize wecom-cli (required one-time setup)
#    Configures WeCom bot credentials for CLI API calls.
#    Credentials are stored encrypted at ~/.config/wecom/bot.enc
npx wecom-cli init

# 4. Configure environment
cp .env.example .env
# Edit .env with your credentials:
#   WECOM_BOT_ID    — from WeCom admin > Smart Robot > Long Connection
#   WECOM_SECRET    — long connection secret
#   ANTHROPIC_API_KEY — your Anthropic API key
#   AI_ENABLED=true

# 5. Run
npm start
```

> **Note:** Skills (SKILL.md files in `skills/`) are already included in the repo — no separate install needed. To update skills or add new ones, run `npx wecom-cli skill install WecomTeam/wecom-cli`.

## What Can the Bot Do?

The bot can do anything the installed wecom-cli skills support:

| Capability | Skills |
|---|---|
| Create/query/manage meetings | wecomcli-create-meeting, wecomcli-get-meeting, wecomcli-edit-meeting |
| Manage calendar schedules | wecomcli-manage-schedule |
| Create/query/edit todos | wecomcli-edit-todo, wecomcli-get-todo-list, wecomcli-get-todo-detail |
| Send/read messages | wecomcli-get-msg |
| Look up contacts | wecomcli-lookup-contact |
| Create/edit documents | wecomcli-manage-doc |
| Manage smartsheet data & schema | wecomcli-manage-smartsheet-data, wecomcli-manage-smartsheet-schema |

**Add more skills = bot learns new abilities. No code changes needed.**

## Project Structure

```
wecom-bot-sample/
├── index.js              # Bot entry — WebSocket lifecycle, message routing
├── lib/
│   ├── wecom-ws.js       # WeComBot class — WeCom WebSocket protocol
│   ├── ai-handler.js     # AI agentic loop (Anthropic + OpenAI) with tool calling
│   ├── tools.js          # Skill loader + wecom-cli executor
│   ├── auth-chatgpt.js   # ChatGPT OAuth — PKCE login, token refresh
│   └── chat-history.js   # SQLite conversation history + compaction
├── data/                 # SQLite database (gitignored)
├── scripts/              # CLI utilities
│   └── login-chatgpt.js  # ChatGPT OAuth login (npm run login)
├── skills/               # Installed wecom-cli skills (SKILL.md files)
│   ├── wecomcli-create-meeting/
│   ├── wecomcli-manage-doc/
│   └── ...
├── .env.example          # Environment variable template
├── package.json
└── CLAUDE.md             # AI assistant context
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `WECOM_BOT_ID` | Yes | — | Smart robot BotID |
| `WECOM_SECRET` | Yes | — | Long connection secret |
| `ANTHROPIC_API_KEY` | Conditional | — | Anthropic API key (required for Claude models) |
| `OPENAI_API_KEY` | Conditional | — | OpenAI API key (required for GPT models) |
| `OPENAI_AUTH_MODE` | No | `api_key` | `api_key` or `chatgpt` (OAuth via subscription) |
| `AI_ENABLED` | No | `false` | Enable AI replies (`true`/`false`) |
| `AI_MODEL` | No | `claude-sonnet-4-6` | AI model (`claude-*` for Anthropic, `gpt-*` for OpenAI) |
| `MAX_ROUNDS` | No | `999` | Max tool-calling rounds per message |
| `MAX_TOKENS` | No | `16384` | Max output tokens per AI response |
| `WELCOME_MESSAGE` | No | `Hello! I'm the smart assistant...` | Welcome message on enter_chat |
| `SKILLS_DIR` | No | `./skills/` | Path to skills directory |
| `MAX_HISTORY_TOKENS` | No | `100000` | Max estimated tokens of history per session |
| `SESSION_TTL_MINUTES` | No | `60` | Session inactivity timeout (minutes) |

## ChatGPT OAuth (No API Key)

You can use your ChatGPT Plus/Pro subscription instead of an OpenAI API key:

```bash
# 1. Login with your ChatGPT account (one-time, opens browser)
npm run login

# 2. Set in .env
AI_MODEL=gpt-5.4
OPENAI_AUTH_MODE=chatgpt

# 3. Run as usual
npm start
```

Tokens are stored at `~/.wecom-bot/auth.json` and auto-refreshed. Re-run `npm run login` if tokens expire.

## Features

- **WebSocket long connection** — No public URL or ngrok needed
- **Streaming replies** — Shows "Thinking..." then updates with final answer
- **Meeting cards** — Rich template cards for created meetings (clickable join link)
- **Auto-reconnect** — Heartbeat every 30s, reconnects on disconnect
- **Echo mode** — Set `AI_ENABLED=false` to test without AI (echoes messages back)
- **Conversation memory** — Multi-turn context persisted in SQLite, auto-compacts when nearing context limits

## WeCom API Reference

- [Smart Robot Long Connection](https://developer.work.weixin.qq.com/document/path/101463)
- [Active Reply Messages](https://developer.work.weixin.qq.com/document/path/101138)
- [Template Card Types](https://developer.work.weixin.qq.com/document/path/101032)

## License

MIT
