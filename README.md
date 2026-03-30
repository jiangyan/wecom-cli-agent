# wecom-bot-sample

A sample WeCom smart robot that auto-answers user messages using Claude AI and [wecom-cli](https://github.com/WecomTeam/wecom-cli) skills.

## How It Works

```
User messages bot in WeCom
        |
  WebSocket long connection (wss://openws.work.weixin.qq.com)
        |
  Bot receives message → calls Claude API (Anthropic SDK)
        |
  Claude reads wecom-cli skill docs → calls wecom_cli tool
        |
  Bot executes wecom-cli command → returns result to Claude
        |
  Claude generates reply → bot sends streaming response
```

The bot has **zero hardcoded knowledge** of WeCom APIs. It loads [wecom-cli skills](https://github.com/WecomTeam/wecom-cli) (SKILL.md files) as system prompt context, and Claude figures out which commands to call by reading the docs.

## Prerequisites

- Node.js >= 18
- A WeCom smart robot with **Long Connection** API mode enabled
- An Anthropic API key
- wecom-cli initialized (`wecom-cli init`)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/user/wecom-bot-sample.git
cd wecom-bot-sample

# 2. Install dependencies
npm install

# 3. Install wecom-cli skills
npx wecom-cli skill install WecomTeam/wecom-cli

# 4. Configure
cp .env.example .env
# Edit .env with your credentials:
#   WECOM_BOT_ID    — from WeCom admin > Smart Robot > Long Connection
#   WECOM_SECRET    — long connection secret
#   ANTHROPIC_API_KEY — your Anthropic API key
#   AI_ENABLED=true

# 5. Initialize wecom-cli (if not done)
npx wecom-cli init

# 6. Run
npm start
```

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
│   ├── ai-handler.js     # Anthropic SDK — agentic loop with tool calling
│   └── tools.js          # Skill loader + wecom-cli executor
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
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `AI_ENABLED` | No | `false` | Enable AI replies (`true`/`false`) |
| `AI_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `MAX_ROUNDS` | No | `999` | Max tool-calling rounds per message |
| `WELCOME_MESSAGE` | No | `Hello! I'm the smart assistant...` | Welcome message on enter_chat |
| `SKILLS_DIR` | No | `./skills/` | Path to skills directory |

## Features

- **WebSocket long connection** — No public URL or ngrok needed
- **Streaming replies** — Shows "Thinking..." then updates with final answer
- **Meeting cards** — Rich template cards for created meetings (clickable join link)
- **Auto-reconnect** — Heartbeat every 30s, reconnects on disconnect
- **Echo mode** — Set `AI_ENABLED=false` to test without AI (echoes messages back)

## WeCom API Reference

- [Smart Robot Long Connection](https://developer.work.weixin.qq.com/document/path/101463)
- [Active Reply Messages](https://developer.work.weixin.qq.com/document/path/101138)
- [Template Card Types](https://developer.work.weixin.qq.com/document/path/101032)

## License

MIT
