# Channel Setup: Slack

## Prerequisites

- A Slack workspace where you have admin permissions
- OpenThreads running at a publicly accessible HTTPS URL (required for webhooks)

## Step 1 — Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name your app (e.g., `OpenThreads`) and choose your workspace
3. Note your **App ID** and **Signing Secret** (under **Basic Information**)

## Step 2 — Configure OAuth scopes

Under **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:

| Scope | Purpose |
|---|---|
| `channels:history` | Read messages in public channels |
| `channels:read` | List channels |
| `chat:write` | Post messages |
| `im:history` | Read DMs |
| `im:write` | Send DMs |
| `groups:history` | Read private channels |
| `users:read` | Look up user info |
| `app_mentions:read` | Receive mention events |
| `reactions:write` | Add emoji reactions |

For interactive components (A2H Method 1 — buttons):

| Scope | Purpose |
|---|---|
| `chat:write.customize` | Post as custom names/icons |

## Step 3 — Enable Event Subscriptions

Under **Event Subscriptions**:
1. Toggle **Enable Events** on
2. Set **Request URL** to: `https://your-openthreads.example.com/webhook/<channel-id>`
3. Subscribe to bot events:
   - `message.channels`
   - `message.im`
   - `message.groups`
   - `app_mention`

## Step 4 — Enable Interactivity (for A2H Method 1)

Under **Interactivity & Shortcuts**:
1. Toggle **Interactivity** on
2. Set **Request URL** to: `https://your-openthreads.example.com/webhook/<channel-id>/interactive`

## Step 5 — Install the app

Under **OAuth & Permissions** → **Install to Workspace**. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

## Step 6 — Register in OpenThreads

```bash
curl -s -X POST http://localhost:3000/api/channels \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
  -d '{
    "id": "my-slack",
    "name": "My Slack",
    "platform": "slack",
    "credentialsRef": "slack-main"
  }' | jq .
```

Set environment variables:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # for Socket Mode
```
