const API_PATH = "/api/topic-request";
const MAX_BODY_BYTES = 4096;
const MAX_TOPIC_LENGTH = 1000;
const MAX_NAME_LENGTH = 80;
const MAX_CONTACT_LENGTH = 120;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_MAX_REQUESTS = 3;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === API_PATH) {
        return await handleTopicRequest(request, env);
      }

      return await serveStaticAsset(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(JSON.stringify({ message: "request failed", error: message, path: url.pathname }));
      return json({ error: "Something went sideways. Please try again." }, 500);
    }
  },
};

async function handleTopicRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Send the request as JSON." }, 415);
  }

  let bodyText;

  try {
    bodyText = await readBodyText(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "That topic request is too large." }, 413);
    }

    throw error;
  }
  let payload;

  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "That request was not valid JSON." }, 400);
  }

  const website = cleanField(payload.website, 200);
  if (website) {
    return json({ ok: true, message: "Topic queued." });
  }

  const topic = cleanField(payload.topic, MAX_TOPIC_LENGTH);
  const name = cleanField(payload.name, MAX_NAME_LENGTH) || "Cyber Cat";
  const contact = cleanField(payload.contact, MAX_CONTACT_LENGTH);

  if (topic.length < 3) {
    return json({ error: "Add a topic first and we will get it queued up." }, 400);
  }

  if (!env.DISCORD_WEBHOOK_URL) {
    console.error(JSON.stringify({ message: "missing discord webhook secret" }));
    return json({ error: "The topic queue is not connected yet." }, 503);
  }

  const limit = await checkRateLimit(request);
  if (!limit.allowed) {
    return json(
      { error: "You are sending topics a little fast. Try again in a few minutes." },
      429,
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDiscordMessage({ name, contact, topic, request })),
  });

  if (!discordResponse.ok) {
    console.error(JSON.stringify({ message: "discord webhook failed", status: discordResponse.status }));
    return json({ error: "Discord did not take the request. Please try again." }, 502);
  }

  return json({ ok: true, message: "Topic sent to Discord." });
}

async function readBodyText(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;

    if (received > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function checkRateLimit(request) {
  if (!globalThis.caches?.default) {
    return { allowed: true, retryAfter: 0 };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const fingerprint = await hashFingerprint(request);
    const cacheKey = new Request(`https://rate-limit.cansncats.local/topic/${fingerprint}`, { method: "GET" });
    const cached = await caches.default.match(cacheKey);
    let record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_SECONDS };

    if (cached) {
      const cachedRecord = await safeReadJson(cached);

      if (isRateLimitRecord(cachedRecord) && cachedRecord.resetAt > now) {
        record = cachedRecord;
      }
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: false, retryAfter: Math.max(1, record.resetAt - now) };
    }

    const nextRecord = { count: record.count + 1, resetAt: record.resetAt };
    const maxAge = Math.max(1, nextRecord.resetAt - now);
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(nextRecord), {
        headers: {
          "Cache-Control": `max-age=${maxAge}`,
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
    );

    return { allowed: true, retryAfter: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(JSON.stringify({ message: "rate limit unavailable", error: message }));
    return { allowed: true, retryAfter: 0 };
  }
}

async function hashFingerprint(request) {
  const ip = request.headers.get("CF-Connecting-IP")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const data = new TextEncoder().encode(`${ip}|${userAgent}`);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildDiscordMessage({ name, contact, topic, request }) {
  const referer = request.headers.get("referer");
  const source = getSourceHost(referer, request.url);

  return {
    username: "Cans n Cats Topic Bot",
    avatar_url: "https://cdn.discordapp.com/embed/avatars/4.png",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "New topic request",
        color: 0x00b9b5,
        fields: [
          { name: "Name", value: clipForDiscord(name), inline: true },
          { name: "Contact", value: clipForDiscord(contact || "Not provided"), inline: true },
          { name: "Source", value: clipForDiscord(source), inline: true },
          { name: "Topic", value: clipForDiscord(topic) },
        ],
        footer: { text: "Cans n Cats site" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getSourceHost(referer, fallbackUrl) {
  try {
    return referer ? new URL(referer).hostname : new URL(fallbackUrl).hostname;
  } catch {
    return "cansncats.com";
  }
}

async function serveStaticAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");

  if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
    return response;
  }

  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";

  return env.ASSETS.fetch(new Request(indexUrl, request));
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRateLimitRecord(value) {
  return Boolean(
    value
      && Number.isInteger(value.count)
      && Number.isInteger(value.resetAt)
      && value.count >= 0
      && value.count <= RATE_LIMIT_MAX_REQUESTS
      && value.resetAt > 0,
  );
}

function cleanField(value, maxLength) {
  return String(value || "")
    .replace(/\p{C}/gu, "")
    .trim()
    .slice(0, maxLength);
}

function clipForDiscord(value) {
  return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}
