# Self-Hosting Guide

OpenThreads is designed to be self-hosted. This guide covers Docker, environment
variable configuration, and MongoDB setup.

## Prerequisites

- Docker + Docker Compose (v2.x)
- A domain name with HTTPS (required for Slack/Discord webhooks in production)
- MongoDB 7.x (managed by Docker Compose or an external service)

---

## Quick start with Docker Compose

### 1. Clone or scaffold

```bash
# Scaffold a new deployment:
bunx create-openthreads my-deployment
cd my-deployment

# Or clone the repository:
git clone https://github.com/deepducks/OpenThreads.git
cd OpenThreads
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum, set JWT_SECRET and MONGODB_URI
```

### 3. Start

```bash
# Start MongoDB + OpenThreads
docker compose --profile production up -d

# Check logs
docker compose logs -f app

# Health check
curl http://localhost:3000/api/health
```

---

## Environment Variables

### Required

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB connection URI | `mongodb://user:pass@host:27017/openthreads` |
| `JWT_SECRET` | Secret for signing JWTs — use a long random string | `openssl rand -hex 32` |

### Recommended for production

| Variable | Description | Default |
|---|---|---|
| `MANAGEMENT_API_KEY` | Protects `/api/*` management endpoints | unset (open) |
| `OPENTHREADS_BASE_URL` | Public base URL (used in `replyTo` URLs) | `http://localhost:3000` |
| `NODE_ENV` | Set to `production` in prod | `development` |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `LOG_FORMAT` | `json` for structured logging, `text` for human-readable | `json` in prod |
| `REPLY_TOKEN_TTL` | `replyTo` token TTL in seconds | `86400` (24h) |

### Channel credentials

Set the credentials for each channel you want to enable. See the [channel setup guides](./channels/) for how to obtain these values.

| Variable | Platform |
|---|---|
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` | Slack |
| `TELEGRAM_BOT_TOKEN` | Telegram |
| `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` | Discord |

### Trust layer (optional)

| Variable | Description | Default |
|---|---|---|
| `TRUST_LAYER_ENABLED` | Enable JWS signing and WebAuthn | `false` |
| `TRUST_JWS_ALGORITHM` | JWS algorithm | `RS256` |
| `TRUST_PRIVATE_KEY_PATH` | Path to private key PEM | — |
| `TRUST_PUBLIC_KEY_PATH` | Path to public key PEM | — |

### OpenTelemetry (optional)

| Variable | Description |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint, e.g. `http://otel-collector:4318` |
| `OTEL_SERVICE_NAME` | Service name tag (default: `openthreads`) |
| `OTEL_SDK_DISABLED` | Set to `true` to disable tracing |

---

## MongoDB Setup

### Using the bundled Docker Compose MongoDB

The included `docker-compose.yml` starts a MongoDB 7 instance with:
- Username: `openthreads`
- Password: `openthreads`
- Database: `openthreads`
- Data persisted in the `mongodb_data` Docker volume

Connection string: `mongodb://openthreads:openthreads@localhost:27017/openthreads`

### Using an external MongoDB

Set `MONGODB_URI` to your connection string. OpenThreads creates indexes
automatically on first start.

Recommended: MongoDB Atlas free tier for small deployments.

### Indexes

OpenThreads automatically ensures the following indexes on startup:
- `channels.id` (unique)
- `recipients.id` (unique)
- `threads.threadId` (unique), `threads.channelId+nativeThreadId`
- `turns.turnId` (unique), `turns.threadId+timestamp`
- `routes.id` (unique), `routes.priority`
- `tokens.value` (unique, with TTL)
- `audit_log.*` (several indexes)

---

## Production checklist

- [ ] `JWT_SECRET` is a long random string (not `change-me`)
- [ ] `MANAGEMENT_API_KEY` is set (protects admin API)
- [ ] `OPENTHREADS_BASE_URL` is your public HTTPS URL
- [ ] `NODE_ENV=production`
- [ ] `LOG_FORMAT=json` (for log aggregators like Loki/CloudWatch)
- [ ] TLS termination via reverse proxy (nginx, Caddy, Cloudflare Tunnel)
- [ ] MongoDB has authentication enabled and is not exposed publicly
- [ ] Prometheus scraping configured (if using `LOG_FORMAT=json`)

---

## Reverse proxy setup

### Caddy (recommended)

```caddyfile
openthreads.example.com {
  reverse_proxy localhost:3000
}
```

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name openthreads.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
