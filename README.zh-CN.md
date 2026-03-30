# wecom-bot-sample

[English](./README.md)

一个企业微信智能机器人示例，使用 Claude AI 和 [wecom-cli](https://github.com/WecomTeam/wecom-cli) skills 自动回复用户消息。

## 工作原理

```text
用户在企业微信中给机器人发消息
        |
  WebSocket 长连接 (wss://openws.work.weixin.qq.com)
        |
  机器人接收消息 -> 调用 Claude API (Anthropic SDK)
        |
  Claude 读取 wecom-cli skill 文档 -> 调用 wecom_cli 工具
        |
  机器人执行 wecom-cli 命令 -> 将结果返回给 Claude
        |
  Claude 生成回复 -> 机器人发送流式响应
```

这个机器人对企业微信 API 没有任何硬编码知识。它会把 [wecom-cli skills](https://github.com/WecomTeam/wecom-cli)（`SKILL.md` 文件）加载为 system prompt 上下文，Claude 通过阅读文档来决定该调用哪些命令。

## 前置要求

- Node.js >= 18
- 已启用 **长连接** API 模式的企业微信智能机器人
- 一个 Anthropic API Key

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/user/wecom-bot-sample.git
cd wecom-bot-sample

# 2. 安装依赖（包含 wecom-cli 二进制）
npm install

# 3. 初始化 wecom-cli（只需一次）
#    为 CLI API 调用配置企业微信机器人凭据。
#    凭据会被加密存储到 ~/.config/wecom/bot.enc
npx wecom-cli init

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的凭据：
#   WECOM_BOT_ID      — 来自 企业微信管理后台 > 智能机器人 > 长连接
#   WECOM_SECRET      — 长连接密钥
#   ANTHROPIC_API_KEY — 你的 Anthropic API Key
#   AI_ENABLED=true

# 5. 运行
npm start
```

> **注意：** `skills/` 里的 skills（`SKILL.md` 文件）已经包含在仓库中，不需要额外安装。如果要更新 skills 或安装新 skills，运行 `npx wecom-cli skill install WecomTeam/wecom-cli`。

## 机器人能做什么？

机器人能执行所有已安装 wecom-cli skills 支持的能力：

| 能力 | Skills |
|---|---|
| 创建 / 查询 / 管理会议 | wecomcli-create-meeting, wecomcli-get-meeting, wecomcli-edit-meeting |
| 管理日程安排 | wecomcli-manage-schedule |
| 创建 / 查询 / 编辑待办 | wecomcli-edit-todo, wecomcli-get-todo-list, wecomcli-get-todo-detail |
| 发送 / 读取消息 | wecomcli-get-msg |
| 查询联系人 | wecomcli-lookup-contact |
| 创建 / 编辑文档 | wecomcli-manage-doc |
| 管理智能表格数据和结构 | wecomcli-manage-smartsheet-data, wecomcli-manage-smartsheet-schema |

**增加更多 skills = 机器人学会更多能力，不需要改代码。**

## 项目结构

```text
wecom-bot-sample/
├── index.js              # 机器人入口 - WebSocket 生命周期、消息路由
├── lib/
│   ├── wecom-ws.js       # WeComBot 类 - 企业微信 WebSocket 协议
│   ├── ai-handler.js     # Anthropic SDK - 带工具调用的 agentic loop
│   └── tools.js          # Skill 加载器 + wecom-cli 执行器
├── skills/               # 已安装的 wecom-cli skills（SKILL.md 文件）
│   ├── wecomcli-create-meeting/
│   ├── wecomcli-manage-doc/
│   └── ...
├── .env.example          # 环境变量模板
├── package.json
└── CLAUDE.md             # AI 助手上下文
```

## 配置项

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `WECOM_BOT_ID` | 是 | — | 智能机器人 BotID |
| `WECOM_SECRET` | 是 | — | 长连接密钥 |
| `ANTHROPIC_API_KEY` | 是 | — | Anthropic API Key |
| `AI_ENABLED` | 否 | `false` | 是否启用 AI 回复（`true`/`false`） |
| `AI_MODEL` | 否 | `claude-sonnet-4-6` | 使用的 Claude 模型 |
| `MAX_ROUNDS` | 否 | `999` | 每条消息最多工具调用轮数 |
| `WELCOME_MESSAGE` | 否 | `Hello! I'm the smart assistant...` | `enter_chat` 时的欢迎语 |
| `SKILLS_DIR` | 否 | `./skills/` | skills 目录路径 |

## 特性

- **WebSocket 长连接** - 不需要公网 URL 或 ngrok
- **流式回复** - 先显示 “Thinking...”，再更新为最终答案
- **会议卡片** - 为创建的会议发送富文本模板卡片（可点击入会链接）
- **自动重连** - 每 30 秒发送一次心跳，断开后自动重连
- **回声模式** - 设置 `AI_ENABLED=false` 可在不启用 AI 的情况下测试（原样回显消息）

## 企业微信 API 参考

- [智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)
- [主动回复消息](https://developer.work.weixin.qq.com/document/path/101138)
- [模板卡片类型](https://developer.work.weixin.qq.com/document/path/101032)

## License

MIT
