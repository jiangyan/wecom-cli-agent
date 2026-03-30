/**
 * SQLite-backed conversation history with automatic compaction.
 * Persists across bot restarts. One DB file, keyed by session.
 *
 * Session keys:
 *   - Single chat: userid
 *   - Group chat:  chatid
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Token estimation: ~2 chars/token for mixed CJK/English (conservative).
const CHARS_PER_TOKEN = 2;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export class ChatHistory {
  #db;
  #stmts;
  #maxHistoryTokens;
  #sessionTtlMs;
  #minKeepPairs;

  /**
   * @param {object} options
   * @param {string}  options.dbPath           Path to SQLite file
   * @param {number}  [options.maxHistoryTokens=100000] Max estimated tokens of history to keep
   * @param {number}  [options.sessionTtlMs=3600000]    Session TTL in ms (default 1 hour)
   * @param {number}  [options.minKeepPairs=2]          Min recent user+assistant pairs to always keep
   */
  constructor({ dbPath, maxHistoryTokens = 100_000, sessionTtlMs = 3_600_000, minKeepPairs = 2 }) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("busy_timeout = 3000");
    this.#maxHistoryTokens = maxHistoryTokens;
    this.#sessionTtlMs = sessionTtlMs;
    this.#minKeepPairs = minKeepPairs;

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_session_time ON messages(session_key, created_at, id);
    `);

    this.#stmts = {
      getHistory: this.#db.prepare(
        `SELECT role, content FROM messages WHERE session_key = ? ORDER BY created_at, id`
      ),
      addMessage: this.#db.prepare(
        `INSERT INTO messages (session_key, role, content) VALUES (?, ?, ?)`
      ),
      getOldestIds: this.#db.prepare(
        `SELECT id, LENGTH(content) as len FROM messages WHERE session_key = ? ORDER BY created_at, id`
      ),
      deleteById: this.#db.prepare(
        `DELETE FROM messages WHERE id = ?`
      ),
      deleteExpired: this.#db.prepare(
        `DELETE FROM messages WHERE created_at < ?`
      ),
      clearSession: this.#db.prepare(
        `DELETE FROM messages WHERE session_key = ?`
      ),
      sessionCount: this.#db.prepare(
        `SELECT COUNT(*) as cnt FROM messages WHERE session_key = ?`
      ),
    };

    // Cleanup expired sessions on start
    this.cleanup();
  }

  /** Get conversation history as [{role, content}, ...] */
  getHistory(sessionKey) {
    return this.#stmts.getHistory.all(sessionKey);
  }

  /** Append a message, then compact if over token limit */
  addMessage(sessionKey, role, content) {
    this.#stmts.addMessage.run(sessionKey, role, content);
    this.#compact(sessionKey);
  }

  /** Add both user message and assistant reply in one call */
  addTurn(sessionKey, userMessage, assistantReply) {
    const addBoth = this.#db.transaction(() => {
      this.#stmts.addMessage.run(sessionKey, "user", userMessage);
      this.#stmts.addMessage.run(sessionKey, "assistant", assistantReply);
      this.#compact(sessionKey);
    });
    addBoth();
  }

  /** Remove oldest messages when estimated tokens exceed limit */
  #compact(sessionKey) {
    const rows = this.#stmts.getOldestIds.all(sessionKey);
    if (rows.length === 0) return;

    let totalTokens = 0;
    for (const row of rows) {
      totalTokens += Math.ceil(row.len / CHARS_PER_TOKEN);
    }

    if (totalTokens <= this.#maxHistoryTokens) return;

    // Keep at least minKeepPairs * 2 messages (user+assistant pairs) from the end
    const minKeep = this.#minKeepPairs * 2;
    const removable = rows.length - minKeep;
    if (removable <= 0) return;

    let removed = 0;
    const deleteMany = this.#db.transaction(() => {
      for (let i = 0; i < removable && totalTokens > this.#maxHistoryTokens; i++) {
        const row = rows[i];
        const tokens = Math.ceil(row.len / CHARS_PER_TOKEN);
        this.#stmts.deleteById.run(row.id);
        totalTokens -= tokens;
        removed++;
      }
    });
    deleteMany();

    if (removed > 0) {
      console.log(`[history] Compacted ${sessionKey}: removed ${removed} messages, ~${totalTokens} tokens remaining`);
    }
  }

  /** Delete messages older than TTL */
  cleanup() {
    const cutoff = Math.floor((Date.now() - this.#sessionTtlMs) / 1000);
    const result = this.#stmts.deleteExpired.run(cutoff);
    if (result.changes > 0) {
      console.log(`[history] Cleaned up ${result.changes} expired messages`);
    }
  }

  /** Clear a specific session */
  clearSession(sessionKey) {
    this.#stmts.clearSession.run(sessionKey);
  }

  /** Close the database */
  close() {
    this.#db.close();
  }
}
