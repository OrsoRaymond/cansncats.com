# cansncats.com

Site for the **Cans n Cats** podcast: a static page (`index.html`, `styles.css`, `script.js`) plus a
tiny Node API for the topic-request form.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `script.js` | The site. No build step. |
| `404.html`, `robots.txt`, `sitemap.xml`, `site.webmanifest` | Static extras served by nginx. |
| `fonts/` | Self-hosted Inter (variable, latin subset). |
| `image.webp`, `favicon.ico`, `icon-*.png`, `apple-touch-icon.png`, `og-image.jpg` | Logo, icons, share image. |
| `server/topic-api.mjs` | API behind `/api/*` (see below). |
| `worker/index.js` | Older Cloudflare Worker version of the API (not used by the box deploy). |
| `deploy.sh` | Pull, publish static files, restart the API. |

## API (`server/topic-api.mjs`)

Runs under PM2 as `cansncats-api` on `127.0.0.1:3006`; nginx proxies `/api/`.

- `POST /api/topic-request` — form submissions. Every request is appended to
  `server/data/topic-requests.jsonl`, then posted to the Discord webhook. If the webhook is not
  configured or Discord fails, the entry also goes to `server/data/pending.jsonl` and is delivered
  automatically (on start-up and every 5 minutes) once it works. Honeypot field, 3 requests per
  10 minutes per visitor.
- `GET /api/community` — member / online counts for the Discord invite, cached 10 minutes.
- `GET /api/health` — `{ ok, discordWebhook, received, pending, uptimeSeconds }`.

Config lives in `.env` next to this file (not committed):

```
DISCORD_WEBHOOK_URL=   # Discord channel → Integrations → Webhooks → New → copy URL
PORT=3006
DISCORD_INVITE_CODE=otoro
```

After editing `.env`: `pm2 restart cansncats-api`.

## Deploy (on the box)

```
/home/tide/cansncats/deploy.sh
```

Pulls `main`, rsyncs the static files to `/var/www/cansncats.com`, restarts the API.
nginx config: `/etc/nginx/sites-available/cansncats.com`.
