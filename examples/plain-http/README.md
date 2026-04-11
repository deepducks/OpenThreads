# Example: Plain HTTP Webhook Consumer

The simplest possible OpenThreads integration — a standalone HTTP server that
receives OpenThreads envelopes, processes them, and replies using `replyTo`.

No frameworks, no SDK. Just `curl`-level HTTP.

## How it works

```
Human (Slack)  →  OpenThreads  →  POST /inbound  (this server)
                                                   ↓
                                             processes message
                                                   ↓
Human (Slack)  ←  OpenThreads  ←  POST replyTo   (this server)
```

## Prerequisites

- An OpenThreads instance running at `http://localhost:3000` (see root `docker-compose.yml`)
- A channel registered in OpenThreads (Slack, Telegram, Discord, etc.)
- A route pointing to `http://localhost:4000/inbound`

## Run the server

```bash
bun run server.ts
# or
node server.js
```

The server listens on port `4000` and:
1. Receives POST requests from OpenThreads at `/inbound`
2. Echoes the message back with a text reply via `replyTo`

## cURL test (without OpenThreads)

You can test the inbound handler directly with curl:

```bash
curl -s -X POST http://localhost:4000/inbound \
  -H 'Content-Type: application/json' \
  -d '{
    "threadId": "ot_thr_test",
    "turnId": "ot_turn_test",
    "replyTo": "http://localhost:3000/send/channel/my-slack/target/C0123/thread/ot_thr_test?token=ot_tk_test",
    "source": {
      "channel": "slack",
      "channelId": "my-slack",
      "sender": { "id": "U456", "name": "Alice" }
    },
    "message": [{ "text": "Hello, agent!" }]
  }' | jq .
```

## A2H example

To send a human approval request back:

```bash
# POST to replyTo with an A2H AUTHORIZE intent
curl -s -X POST "$REPLY_TO_URL" \
  -H 'Content-Type: application/json' \
  -d '{
    "message": [
      { "text": "I need your approval to proceed." },
      {
        "intent": "AUTHORIZE",
        "context": {
          "action": "deploy-to-production",
          "details": "Branch feature-x → production (12 services)"
        }
      }
    ]
  }' | jq .
```
