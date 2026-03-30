/**
 * ChatGPT OAuth (PKCE) for Codex/GPT models.
 * Authenticates via ChatGPT subscription — no API key needed.
 *
 * Flow: browser login → access_token + refresh_token → stored locally.
 * Same OAuth flow used by the official OpenAI Codex CLI (openai/codex).
 */
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const REFRESH_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

const AUTH_DIR = join(homedir(), ".wecom-bot");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

// ─── Token storage ───────────────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
}

export function loadTokens() {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(tokens, null, 2), "utf8");
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

function decodeJwtPayload(jwt) {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

function extractAccountId(accessToken) {
  const claims = decodeJwtPayload(accessToken);
  return claims["https://api.openai.com/auth"]?.chatgpt_account_id || null;
}

function extractEmail(idToken, accessToken) {
  // Email may be in id_token or access_token depending on OpenAI's response
  for (const token of [idToken, accessToken]) {
    if (!token) continue;
    try {
      const claims = decodeJwtPayload(token);
      const email = claims["https://api.openai.com/profile"]?.email;
      if (email) return email;
    } catch { /* skip malformed token */ }
  }
  return null;
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generatePKCE() {
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ─── OAuth login (browser-based PKCE) ────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {(url: string) => void} [options.onAuthUrl] Called with the full authorization URL once the callback server is ready.
 */
export async function login(options = {}) {
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL(`${AUTH_ISSUER}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("originator", "wecom_bot");

  // Wait for OAuth callback
  const authCode = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h2>Login failed</h2><p>${error}: ${url.searchParams.get("error_description") || ""}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>State mismatch</h2>");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Login successful!</h2><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(code);
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`[auth] Waiting for OAuth callback on port ${REDIRECT_PORT}...`);
      if (options.onAuthUrl) options.onAuthUrl(authUrl.toString());
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    // Timeout after 2 minutes
    setTimeout(() => { server.close(); reject(new Error("OAuth login timed out")); }, 120_000);
  });

  // Exchange authorization code for tokens
  const tokenRes = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const { id_token, access_token, refresh_token } = await tokenRes.json();
  const account_id = extractAccountId(access_token);
  const email = extractEmail(id_token, access_token);

  const tokens = {
    auth_mode: "chatgpt",
    id_token,
    access_token,
    refresh_token,
    account_id,
    email,
    last_refresh: new Date().toISOString(),
  };

  saveTokens(tokens);
  console.log(`[auth] Logged in as ${email} (account: ${account_id})`);
  return tokens;
}

// ─── Token refresh ───────────────────────────────────────────────────────────

export async function refreshTokens(tokens) {
  const res = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  // Only update non-null fields
  if (data.access_token) tokens.access_token = data.access_token;
  if (data.id_token) tokens.id_token = data.id_token;
  if (data.refresh_token) tokens.refresh_token = data.refresh_token;
  if (data.access_token) tokens.account_id = extractAccountId(data.access_token);
  tokens.last_refresh = new Date().toISOString();

  saveTokens(tokens);
  console.log(`[auth] Token refreshed at ${tokens.last_refresh}`);
  return tokens;
}

// ─── Auth headers for API calls ──────────────────────────────────────────────

export function getAuthHeaders(tokens) {
  return {
    Authorization: `Bearer ${tokens.access_token}`,
    "ChatGPT-Account-ID": tokens.account_id,
    "Content-Type": "application/json",
  };
}

// ─── Auto-refresh manager ────────────────────────────────────────────────────

let refreshTimer = null;

export function startAutoRefresh(tokens) {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    try {
      await refreshTokens(tokens);
    } catch (err) {
      console.error(`[auth] Auto-refresh failed: ${err.message}`);
      console.error("[auth] Run `npm run login` to re-authenticate.");
    }
  }, REFRESH_INTERVAL_MS);
  // Don't block process exit
  refreshTimer.unref();
  return tokens;
}

export function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
