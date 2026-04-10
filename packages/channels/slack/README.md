# @openthreads/channels-slack

Slack channel adapter for [OpenThreads](../../VISION.md).

Implements the full `ChannelAdapter` interface from `@openthreads/core`, with
native Slack thread support and Block Kit rendering for A2H intents.

## Capabilities

```json
{
  "threads": true,
  "buttons": true,
  "selectMenus": true,
  "replyMessages": false,
  "dms": true,
  "fileUpload": true
}
```

## Setup

### 1. Create a Slack App

- Go to https://api.slack.com/apps and create a new app
- Enable the following **Bot Token Scopes** (`OAuth & Permissions`):
  - `channels:history`
  - `channels:read`
  - `chat:write`
  - `commands`
  - `groups:history`
  - `im:history`
  - `im:write`
  - `mpim:history`
- Enable **Event Subscriptions** and subscribe to:
  - `message.channels`
  - `message.groups`
  - `message.im`
  - `message.mpim`
  - `app_mention`
- Enable **Interactivity** (required for Block Kit buttons and select menus)
- Install the app to your workspace to get the `xoxb-…` bot token

### 2. Socket Mode (recommended for development)

Enable Socket Mode under **Settings > Socket Mode** and create an app-level
token (`xapp-…`) with the `connections:write` scope.

```typescript
import { SlackAdapter } from "@openthreads/channels-slack";

const adapter = new SlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  appToken: process.env.SLACK_APP_TOKEN!,  // enables Socket Mode
});
```

### 3. HTTP mode (production)

For production, point Slack's event subscription URL to your server:

```typescript
const adapter = new SlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  port: 3000,
  path: "/slack/events",  // default
});
```

## Usage

```typescript
adapter.onMessage(async (message) => {
  console.log(`[${message.sender.name}]: ${message.content}`);
});

adapter.onInteraction(async (response) => {
  if ("approved" in response) {
    console.log(`Authorization ${response.approved ? "approved" : "denied"}`);
  } else {
    console.log(`Collected: ${response.value}`);
  }
});

await adapter.start();

// Send a plain message
await adapter.send("C0123456", null, [{ text: "Hello, Slack!" }]);

// Send an A2H AUTHORIZE (renders as approve/deny buttons)
await adapter.send("C0123456", null, [
  {
    intent: "AUTHORIZE",
    requestId: "req-deploy-001",
    context: {
      action: "deploy-to-production",
      details: "Branch feature-x → production",
      evidence: { sha: "abc1234", tests: "all passing" },
    },
  },
]);

// Send an A2H COLLECT with options (renders as select menu)
await adapter.send("C0123456", null, [
  {
    intent: "COLLECT",
    requestId: "req-env-001",
    question: "Which environment should we deploy to?",
    options: ["staging", "production", "dev"],
  },
]);

// Send an A2H COLLECT free-text (captures next thread reply)
await adapter.send("C0123456", null, [
  {
    intent: "COLLECT",
    requestId: "req-ticket-001",
    question: "What is the JIRA ticket number?",
  },
]);
```

## A2H Intent Rendering

| Intent | Slack rendering | Method |
|---|---|---|
| `AUTHORIZE` | Block Kit approve/deny buttons | 1 (inline) |
| `COLLECT` with `options` | Block Kit static select menu | 1 (inline) |
| `COLLECT` free-text | Question text + thread reply capture | 2 (thread) |
| `INFORM` | Plain text message | — |

## Thread Support

Slack's native `thread_ts` is used 1:1 with OpenThreads thread IDs:

- When sending, pass `thread_ts` as the `threadId` parameter
- When receiving, `nativeThreadId` on `InboundMessage` contains `thread_ts`
- Free-text `COLLECT` automatically uses the reply thread for capture
