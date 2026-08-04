# Channel Setup: Telegram

## Prerequisites

- A Telegram account
- OpenThreads running at a publicly accessible HTTPS URL (required for webhooks)

## Step 1 — Create a bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** (format: `123456789:ABCdefGhIJKlmNoPQRstUVwxyZ`)

## Step 2 — Configure the bot (optional)

```
/setdescription — add a description
/setuserpic     — add a profile photo
/setcommands    — define bot commands (e.g., /help)
```

## Step 3 — Register webhook

OpenThreads registers the webhook automatically when you start the server with
`TELEGRAM_BOT_TOKEN` set. You can verify:

```bash
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

## Step 4 — Register in OpenThreads

```bash
curl -s -X POST http://localhost:3000/api/channels \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
  -d '{
    "id": "my-telegram",
    "name": "My Telegram Bot",
    "platform": "telegram",
    "credentialsRef": "telegram-main"
  }' | jq .
```

Set environment variables:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRstUVwxyZ
# Optional: restrict webhook updates to a secret token
TELEGRAM_WEBHOOK_SECRET=your-random-secret
```

## Telegram capabilities

| Feature | Supported |
|---|---|
| Inline keyboards (buttons) | Yes — A2H Method 1 |
| Reply to message | Yes — A2H Method 2 |
| Native threads | No (groups only, not DMs) |
| File uploads | Yes |
| Group chats | Yes |
| DMs | Yes |
