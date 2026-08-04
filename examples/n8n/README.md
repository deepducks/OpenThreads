# Example: n8n Integration

Receive OpenThreads message envelopes in an n8n workflow and reply via the
`replyTo` URL — no custom code required.

## Architecture

```
Human (Slack)  →  OpenThreads  →  n8n Webhook node
                                       ↓
                               [your n8n workflow]
                                       ↓
Human (Slack)  ←  OpenThreads  ←  HTTP Request node (POST replyTo)
```

## Step 1 — Create an n8n Webhook

1. In your n8n workflow, add a **Webhook** node.
2. Set **HTTP Method** to `POST`.
3. Set **Response Mode** to `Immediately` (return 200 at once; process async).
4. Copy the **Webhook URL** (e.g., `https://your-n8n.example.com/webhook/openthreads`).

## Step 2 — Create an OpenThreads Route

Register a recipient in OpenThreads that points to your n8n webhook URL:

```bash
curl -s -X POST http://localhost:3000/api/recipients \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
  -d '{
    "id": "n8n-workflow",
    "name": "n8n Workflow",
    "webhookUrl": "https://your-n8n.example.com/webhook/openthreads"
  }' | jq .
```

Then create a route to forward messages to it:

```bash
curl -s -X POST http://localhost:3000/api/routes \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MANAGEMENT_API_KEY" \
  -d '{
    "id": "slack-to-n8n",
    "name": "Slack → n8n",
    "recipientId": "n8n-workflow",
    "criteria": { "channelId": "my-slack-channel" },
    "enabled": true,
    "priority": 1
  }' | jq .
```

## Step 3 — Build your n8n workflow

The Webhook node receives the OpenThreads envelope:

```json
{
  "threadId": "ot_thr_abc123",
  "turnId": "ot_turn_001",
  "replyTo": "http://localhost:3000/send/channel/my-slack/target/C0123/thread/ot_thr_abc123?token=ot_tk_...",
  "source": {
    "channel": "slack",
    "channelId": "my-slack",
    "sender": { "id": "U456", "name": "Alice" }
  },
  "message": [{ "text": "Hello from Slack!" }]
}
```

Access envelope fields in n8n expressions:
- `{{ $json.threadId }}`
- `{{ $json.turnId }}`
- `{{ $json.replyTo }}`
- `{{ $json.source.sender.name }}`
- `{{ $json.message[0].text }}`

## Step 4 — Send a reply

Add an **HTTP Request** node after your processing steps:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `{{ $('Webhook').item.json.replyTo }}` |
| Body Content Type | `JSON` |
| Body | See below |

**Simple text reply:**
```json
{
  "message": { "text": "Hello! I processed your message." }
}
```

**A2H AUTHORIZE intent (blocking — OpenThreads waits for human response):**
```json
{
  "message": [
    { "text": "I need your approval to deploy." },
    {
      "intent": "AUTHORIZE",
      "context": {
        "action": "deploy-to-production",
        "details": "Branch feature-x → production"
      }
    }
  ]
}
```

## Tips

- The `replyTo` token expires after 24 hours (configurable via `REPLY_TOKEN_TTL`).
- Store `threadId` if you need to send follow-up messages without a `replyTo`.
- Use the **Split In Batches** node to handle multiple messages in the envelope array.
