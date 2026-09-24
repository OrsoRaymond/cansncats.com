// Cans n Cats site API. Runs on PM2 as `cansncats-api`, bound to 127.0.0.1:3006 behind nginx (/api/*).
//
//   POST /api/topic-request  form submission → saved to server/data/topic-requests.jsonl, then posted to
//                            the Discord webhook. If the webhook is missing or Discord fails, the entry is
//                            also written to server/data/pending.jsonl and delivered later (on start-up and
//                            every 5 minutes) once DISCORD_WEBHOOK_URL is set. Nothing is ever lost.
//   GET  /api/community      member/online counts for the Discord invite (public invite API, cached 10 min)
//   GET  /api/health         status for monitoring
//
// Config comes from ../.env (DISCORD_WEBHOOK_URL, PORT, DISCORD_INVITE_CODE, DATA_DIR).
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, "..", ".env"));

const PORT = Number(process.env.PORT || 3006);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "topic-requests.jsonl");
const PENDING_FILE = path.join(DATA_DIR, "pending.jsonl");
const DISCORD_INVITE = (process.env.DISCORD_INVITE_CODE || "otoro").replace(/[^A-Za-z0-9_-]/g, "");
const COMMUNITY_TTL_MS = 10 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const MAX_TOPIC_LENGTH = 1000;
const MAX_NAME_LENGTH = 80;
const MAX_CONTACT_LENGTH = 120;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

const buckets = new Map();
let communityCache = { at: 0, data: null };
let flushing = false;
const pendingDuringFlush = [];
const startedAt = Date.now();

mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://cansncats.com");
  try {
    if (url.pathname === "/api/topic-request") return await handleTopicRequest(req, res);
    if (url.pathname === "/api/community") return await handleCommunity(req, res);
    if (url.pathname === "/api/health") return handleHealth(req, res);
    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    console.error(JSON.stringify({ message: "request failed", error: error?.message, path: url.pathname }));
    return json(res, { error: "Something went sideways. Please try again." }, 500);
  }
});

async function handleTopicRequest(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST") return json(res, { error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    return json(res, { error: "Send the request as JSON." }, 415);
  }

  let bodyText;
  try { bodyText = await readBody(req); } catch { return json(res, { error: "That topic request is too large." }, 413); }
  let payload;
  try { payload = JSON.parse(bodyText); } catch { return json(res, { error: "That request was not valid JSON." }, 400); }
  if (!payload || typeof payload !== "object") return json(res, { error: "That request was not valid JSON." }, 400);

  if (cleanField(payload.website, 200)) return json(res, { ok: true, message: "Topic queued." }); // honeypot hit

  const topic = cleanField(payload.topic, MAX_TOPIC_LENGTH);
  const name = cleanField(payload.name, MAX_NAME_LENGTH) || "Cyber Cat";
  const contact = cleanField(payload.contact, MAX_CONTACT_LENGTH);
  if (topic.length < 3) return json(res, { error: "Add a topic first and we will get it queued up." }, 400);

  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    return json(res, { error: "You are sending topics a little fast. Try again in a few minutes." }, 429,
      { "Retry-After": String(limit.retryAfter) });
  }

  const entry = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    name,
    contact,
    topic,
    source: sourceOf(req),
    ipHash: createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 16),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
  };
  appendLine(LOG_FILE, entry);

  if (!process.env.DISCORD_WEBHOOK_URL) {
    savePending(entry);
    console.error(JSON.stringify({ message: "missing DISCORD_WEBHOOK_URL; topic saved to pending", id: entry.id }));
    return json(res, { ok: true, queued: true, message: "Saved to the topic queue. We will dig into it." });
  }

  const delivered = await postToDiscord(entry);
  if (!delivered) {
    savePending(entry);
    return json(res, { ok: true, queued: true, message: "Saved to the topic queue. We will dig into it." });
  }
  return json(res, { ok: true, queued: false, message: "Sent to the Cans n Cats Discord. We will dig into it." });
}

async function handleCommunity(req, res) {
  if (req.method !== "GET") return json(res, { error: "Method not allowed" }, 405, { Allow: "GET" });
  const now = Date.now();
  if (!communityCache.data || now - communityCache.at > COMMUNITY_TTL_MS) {
    try {
      const response = await fetch(`https://discord.com/api/v10/invites/${DISCORD_INVITE}?with_counts=true`, {
        headers: { "User-Agent": "cansncats-site/1.0 (+https://cansncats.com)" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        communityCache = {
          at: now,
          data: {
            name: data.guild?.name || null,
            members: data.approximate_member_count ?? null,
            online: data.approximate_presence_count ?? null,
            invite: `https://discord.gg/${DISCORD_INVITE}`,
          },
        };
      } else {
        console.error(JSON.stringify({ message: "discord invite lookup failed", status: response.status }));
        communityCache.at = now; // keep whatever we had, retry after the TTL
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "discord invite lookup error", error: error?.message }));
      communityCache.at = now;
    }
  }
  if (!communityCache.data) return json(res, { error: "Community stats unavailable right now." }, 503);
  return json(res, communityCache.data, 200, { "Cache-Control": "public, max-age=300" });
}

function handleHealth(req, res) {
  if (req.method !== "GET") return json(res, { error: "Method not allowed" }, 405, { Allow: "GET" });
  return json(res, {
    ok: true,
    discordWebhook: Boolean(process.env.DISCORD_WEBHOOK_URL),
    received: countLines(LOG_FILE),
    pending: countLines(PENDING_FILE),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }, 200, { "Cache-Control": "no-store" });
}

// --- Discord delivery --------------------------------------------------------

async function postToDiscord(entry, { backlog = false } = {}) {
  try {
    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordMessage(entry, backlog)),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ message: "discord webhook failed", status: response.status, id: entry.id }));
      return false;
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({ message: "discord webhook error", error: error?.message, id: entry.id }));
    return false;
  }
}

function buildDiscordMessage(entry, backlog) {
  return {
    username: "Cans n Cats Topic Bot",
    avatar_url: "https://cansncats.com/icon-192.png",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: backlog ? "Topic request (from the queue)" : "New topic request",
      color: 0x00b9b5,
      fields: [
        { name: "Name", value: clip(entry.name), inline: true },
        { name: "Contact", value: clip(entry.contact || "Not provided"), inline: true },
        { name: "Source", value: clip(entry.source), inline: true },
        { name: "Topic", value: clip(entry.topic) },
      ],
      footer: { text: backlog ? `Cans n Cats site · received ${entry.receivedAt.slice(0, 16).replace("T", " ")} UTC` : "Cans n Cats site" },
      timestamp: entry.receivedAt,
    }],
  };
}

function savePending(entry) {
  if (flushing) pendingDuringFlush.push(entry);
  else appendLine(PENDING_FILE, entry);
}

async function flushPending() {
  if (flushing || !process.env.DISCORD_WEBHOOK_URL || !existsSync(PENDING_FILE)) return;
  const lines = readFileSync(PENDING_FILE, "utf8").split("\n").filter(Boolean);
  if (!lines.length) return;
  flushing = true;
  const remaining = [];
  try {
    for (let i = 0; i < lines.length; i += 1) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      const delivered = await postToDiscord(entry, { backlog: true });
      if (!delivered) { remaining.push(...lines.slice(i)); break; }
      await sleep(1500); // stay well under Discord's webhook rate limit
    }
  } finally {
    for (const entry of pendingDuringFlush.splice(0)) remaining.push(JSON.stringify(entry));
    writeFileSync(PENDING_FILE, remaining.length ? `${remaining.join("\n")}\n` : "");
    flushing = false;
  }
  console.log(JSON.stringify({ message: "flushed pending topic requests", delivered: lines.length - remaining.length, remaining: remaining.length }));
}

// --- helpers -----------------------------------------------------------------

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) return reject(new Error("too large"));
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); return reject(new Error("too large")); }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clientIp(req) {
  return req.headers["cf-connecting-ip"]
    || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress
    || "unknown";
}

function sourceOf(req) {
  try { if (req.headers.referer) return new URL(req.headers.referer).hostname; } catch {}
  return "cansncats.com";
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = createHash("sha256").update(`${clientIp(req)}|${req.headers["user-agent"] || "unknown"}`).digest("hex");
  let rec = buckets.get(key);
  if (!rec || rec.resetAt <= now) rec = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (rec.count >= RATE_LIMIT_MAX_REQUESTS) return { allowed: false, retryAfter: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
  rec.count += 1;
  buckets.set(key, rec);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return { allowed: true, retryAfter: 0 };
}

function appendLine(file, entry) {
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function countLines(file) {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).length; } catch { return 0; }
}

const cleanField = (value, max) => String(value || "").replace(/\p{C}/gu, "").trim().slice(0, max);
const clip = (value) => (value.length > 1000 ? `${value.slice(0, 997)}...` : value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(res, data, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cansncats api on 127.0.0.1:${PORT} (webhook ${process.env.DISCORD_WEBHOOK_URL ? "set" : "NOT set"}, pending ${countLines(PENDING_FILE)})`);
  flushPending();
  setInterval(flushPending, FLUSH_INTERVAL_MS).unref();
});
