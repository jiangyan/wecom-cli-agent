/**
 * WeCom Smart Robot WebSocket Long Connection Client.
 * Protocol: JSON over WSS to wss://openws.work.weixin.qq.com
 */
import { WebSocket } from "ws";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const WS_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_DELAY = 5_000;

export class WeComBot extends EventEmitter {
  #ws = null;
  #botId;
  #secret;
  #heartbeatTimer = null;
  #reconnectTimer = null;
  #connected = false;
  #subscribed = false;
  #shouldReconnect = true;

  constructor(botId, secret) {
    super();
    this.#botId = botId;
    this.#secret = secret;
  }

  #genReqId(prefix = "req") {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  }

  #send(data) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.#ws.send(JSON.stringify(data));
    return data.headers?.req_id;
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      try {
        this.#send({ cmd: "ping", headers: { req_id: this.#genReqId("ping") } });
      } catch {
        this.#reconnect();
      }
    }, HEARTBEAT_INTERVAL);
  }

  #stopHeartbeat() {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #reconnect() {
    if (!this.#shouldReconnect || this.#reconnectTimer) return;
    this.#stopHeartbeat();
    console.log(`[ws] Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  connect() {
    this.#shouldReconnect = true;
    this.#connected = false;
    this.#subscribed = false;

    this.#ws = new WebSocket(WS_URL);

    this.#ws.on("open", () => {
      this.#connected = true;
      this.#send({
        cmd: "aibot_subscribe",
        headers: { req_id: this.#genReqId("sub") },
        body: { bot_id: this.#botId, secret: this.#secret },
      });
    });

    this.#ws.on("message", (raw) => {
      try { this.#handleMessage(JSON.parse(raw.toString())); }
      catch (err) { console.error("[ws] Parse error:", err.message); }
    });

    this.#ws.on("close", (code, reason) => {
      this.#connected = false;
      this.#subscribed = false;
      this.#stopHeartbeat();
      this.emit("disconnected", { code, reason: reason.toString() });
      this.#reconnect();
    });

    this.#ws.on("error", (err) => console.error("[ws]", err.message));
  }

  #handleMessage(data) {
    const cmd = data.cmd;

    // Responses without cmd: subscribe result, heartbeat pong, or send_msg error
    if (!cmd && data.errcode !== undefined) {
      if (data.errcode === 0 && !this.#subscribed) {
        this.#subscribed = true;
        this.#startHeartbeat();
        this.emit("ready");
      } else if (data.errcode !== 0 && !this.#subscribed) {
        this.emit("error", new Error(`Subscribe failed: [${data.errcode}] ${data.errmsg}`));
      } else if (data.errcode !== 0) {
        // Already subscribed — this is a command error (e.g. invalid chatid), not subscribe failure
        console.error(`[ws] Command error: [${data.errcode}] ${data.errmsg}`);
      }
      return;
    }

    switch (cmd) {
      case "aibot_msg_callback":
        this.emit("message", data);
        break;
      case "aibot_event_callback": {
        const eventType = data.body?.event?.eventtype;
        if (eventType === "disconnected_event") this.#shouldReconnect = true;
        this.emit("event", data);
        this.emit(`event:${eventType}`, data);
        break;
      }
      default:
        if (data.errcode && data.errcode !== 0) {
          console.error(`[ws] Error: [${data.errcode}] ${data.errmsg}`);
        }
        break;
    }
  }

  // --- Reply methods ---

  replyStream(reqId, content, options = {}) {
    const streamId = options.streamId || this.#genReqId("stream");
    this.#send({
      cmd: "aibot_respond_msg",
      headers: { req_id: reqId },
      body: { msgtype: "stream", stream: { id: streamId, finish: options.finish ?? true, content } },
    });
    return streamId;
  }

  replyMarkdown(reqId, content) {
    this.#send({
      cmd: "aibot_respond_msg",
      headers: { req_id: reqId },
      body: { msgtype: "markdown", markdown: { content } },
    });
  }

  replyTemplateCard(reqId, templateCard) {
    this.#send({
      cmd: "aibot_respond_msg",
      headers: { req_id: reqId },
      body: { msgtype: "template_card", template_card: templateCard },
    });
  }

  replyMeetingCard(reqId, meeting) {
    const code = meeting.meeting_code?.replace(/(\d{3})(\d{3})(\d{3})/, "$1-$2-$3");
    const mins = Math.round((meeting.meeting_duration || 1800) / 60);

    const rows = [
      { keyname: "会议号", value: code || "—" },
      { keyname: "开始时间", value: meeting.meeting_start_datetime || "—" },
      { keyname: "时长", value: `${mins} 分钟` },
    ];
    if (meeting.location) rows.push({ keyname: "地点", value: meeting.location });
    if (meeting.invitees_userid?.length) {
      rows.push({ keyname: "参与人", value: meeting.invitees_userid.join("、") });
    }
    if (meeting.meeting_link) {
      rows.push({ keyname: "加入会议", value: "点击加入", type: 1, url: meeting.meeting_link });
    }

    this.replyTemplateCard(reqId, {
      card_type: "text_notice",
      main_title: { title: meeting.title || "会议邀请", desc: `会议号: ${code || "—"}` },
      sub_title_text: `${meeting.meeting_start_datetime || ""} · ${mins}分钟${meeting.location ? " · " + meeting.location : ""}`,
      horizontal_content_list: rows,
      card_action: { type: 1, url: meeting.meeting_link || "https://work.weixin.qq.com" },
    });
  }

  replyWelcome(reqId, content) {
    this.#send({
      cmd: "aibot_respond_welcome_msg",
      headers: { req_id: reqId },
      body: { msgtype: "text", text: { content } },
    });
  }

  updateTemplateCard(reqId, templateCard) {
    this.#send({
      cmd: "aibot_respond_update_msg",
      headers: { req_id: reqId },
      body: { response_type: "update_template_card", template_card: templateCard },
    });
  }

  sendMessage(chatId, content, options = {}) {
    this.#send({
      cmd: "aibot_send_msg",
      headers: { req_id: this.#genReqId("push") },
      body: { chatid: chatId, chat_type: options.chatType || 1, msgtype: "markdown", markdown: { content } },
    });
  }

  disconnect() {
    this.#shouldReconnect = false;
    this.#stopHeartbeat();
    if (this.#reconnectTimer) { clearTimeout(this.#reconnectTimer); this.#reconnectTimer = null; }
    if (this.#ws) { this.#ws.close(); this.#ws = null; }
  }

  get connected() { return this.#connected; }
  get subscribed() { return this.#subscribed; }
}
