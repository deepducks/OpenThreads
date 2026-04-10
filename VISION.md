# OpenThreads — Project Document

> Part of the **DeepDucks** ecosystem

---

## 1. Goal

**OpenThreads** is a web server that abstracts communication channels (Slack, Discord, Telegram, WhatsApp, etc.) into a unified ingress/egress interface with native human-in-the-loop support.

The core idea: any agent or external system interacts with humans via standardized HTTP webhooks, without knowing or caring which chat platform is behind them.

### What OpenThreads does

1. **Triggers** — registers listeners for each communication channel (bot tokens, platform webhooks, etc.)
2. **Ingress routes** — maps incoming events (messages in channels, groups, DMs, threads, mentions) to configurable outbound webhooks
3. **Replies** — sends responses back to the originating channel in two modes:
   - **Conventional:** text, markdown, blocks, embeds, cards — automatically adapted to each platform's capabilities
   - **Human-in-the-loop:** approve/deny, text answer, multiple choice, multiple choice + text — structured responses with blocking request-response semantics

### What OpenThreads does NOT do

- Not an agent framework (no workflow orchestration, no conversation state management)
- Not an LLM gateway
- Not opinionated about what consumes the webhooks

It's communication infrastructure. Think of it as a **reverse proxy for chat channels**, the same way Nginx is a reverse proxy for HTTP.

---

## 2. Background and References

### OpenClaw

Primary inspiration for channel modeling. OpenClaw solves the problem but is a complete, opinionated system (orchestration, agents, security, all bundled). OpenThreads extracts only the channel abstraction layer.

### Vercel Chat SDK (`npm i chat`)

Foundation for channel adapters, integrated into core. Pluggable adapter architecture in TypeScript. Natively supports Slack, Discord, Telegram, MS Teams, Google Chat. Available abstractions: threads, channels, mentions, reactions, subscriptions, DMs, slash commands, modals, typing indicators, message history iterators.

**Known gaps:** no WhatsApp (Baileys adapter needed), no Signal, no iMessage. SDK is still recent.

### A2H Protocol (Twilio)

Open source protocol (released Feb 2026, repo: `twilio-labs/a2h-spec`) that defines a channel-agnostic, auditable interface for agents to communicate with humans. Fills the exact gap missing from the protocol ecosystem (MCP = tools, A2A = inter-agent, A2H = agent↔human).

The mental model is simple: **asynchronous RPC where the "server" is a human.** The agent doesn't know (nor needs to know) whether the human is on Slack, SMS, or Telegram. It sends a structured intent to a Gateway, and the Gateway handles the rest.

#### How it works

```
Agent  ──intent──►  A2H Gateway  ──channel──►  Human
                                 ◄──response──
       ◄──evidence──
```

**3 actors:** Agent (requester), Gateway (router and authenticator), Human (responder).

**5 atomic, composable intents (Layer 1):**

| Intent | Type | Description |
|---|---|---|
| `INFORM` | Fire-and-forget | One-way notification. "Letting you know I did X." |
| `COLLECT` | Blocking | Collects structured data. "What's your shipping address?" |
| `AUTHORIZE` | Blocking | Requests approval with evidence and strong authentication. |
| `ESCALATE` | Handoff | Escalates to a human operator. |
| `RESULT` | Response | Returns a task result to the agent. |

Each intent carries context, justification, and trace IDs — allowing full decision path reconstruction for auditing.

**Built-in protocol security:**
- Cryptographic evidence (JWS) binding intent → consent → action
- Replay protection: idempotency, timestamp validation, nonce binding, single-use approval links
- Flexible authentication: WebAuthn/Passkeys demonstrated, extensible to OTP, push, voice IVR

**Native MCP mappings:** `human_inform()`, `human_collect()`, `human_authorize()` — the agent uses the same tool-calling conventions it already uses for everything else.

**Layer 2 (roadmap):** POLICY (standing approvals), REVOKE, DELEGATE, SCOPE — autonomy governance. E.g., "pre-authorize transactions up to $100 without asking me."

#### Integration with OpenThreads

A2H defines 3 actors: Agent, Gateway, Human. The central question: **would OpenThreads be the Gateway?**

**Yes and no.** OpenThreads already does the transport part of the Gateway naturally (receive something, route to the right channel, deliver to the human, collect the response). But a "pure" A2H Gateway also handles policy checks, authentication (WebAuthn/passkeys), JWS signing, and audit logging — heavier responsibilities.

**Decision: implement A2H in two layers within OpenThreads:**

1. **Transport (core)** — already the reason OpenThreads exists. When an external system sends a reply with an A2H intent (e.g., `AUTHORIZE`), the Reply Engine renders the interaction in the native channel (approve/deny buttons on Slack, inline keyboard on Telegram, etc.), collects the response, and returns it.

2. **Trust layer (pluggable, optional)** — JWS signing, strong authentication, audit logging. Enable it for compliance; skip it for a quick "yes/no" on Telegram. When active, the trust layer automatically escalates to the **external form (method 3)** — the only method that supports strong authentication (WebAuthn/passkeys, OTP), since these primitives don't exist inline in chat channels. The auto-generated form serves as the surface for authentication and cryptographic evidence collection.

This avoids OpenClaw's mistake (everything opinionated, everything mandatory). OpenThreads speaks A2H on the wire, but doesn't require passkeys to approve a staging deploy.

**In practice, the reply API accepts both formats in the `message` field — type is inferred via duck typing:**
- Chat SDK: `{ "text": "Deploy complete." }`
- A2H: `{ "intent": "AUTHORIZE", "context": {...} }`

### HumanLayer

Its primitive design (`require_approval` as a gate + `human_as_tool` as an open channel) validated the mental model. However, A2H is more complete (5 intents vs 2 primitives) and has institutional backing (Twilio). A2H conceptually subsumes HumanLayer.

---

## 3. Market Research (Historical)

### Phase 1 — Channel Abstraction

Three categories were evaluated:

**Notification (outbound-only):** Novu, Apprise, ntfy — unidirectional, not suitable.

**Message bridges (bidirectional):** Matterbridge — broad coverage (~40 platforms) but is a standalone Go binary, not embeddable. Works as a sidecar, not an SDK.

**Embeddable SDKs:** Vercel Chat SDK — the most viable. Details in the Background section above.

**Conclusion:** the ecosystem is surprisingly thin. No project solves embeddable channel abstraction in a mature way.

### Phase 2 — Human-in-the-Loop

| Project | Approach | Limitation |
|---|---|---|
| HumanLayer | Gate + open channel, framework-agnostic | Routing depends on their cloud |
| AG-UI (CopilotKit) | Event-based protocol, ~16 event types | Frontend-first, doesn't cover independent channels |
| LangGraph interrupts | Native `interrupt()` | Locked to the LangChain ecosystem |
| **A2H (Twilio)** | **5 atomic intents, channel-agnostic gateway** | **Layer 2 still in development** |

**Conclusion:** A2H is the most complete reference for HITL semantics. Combining A2H (semantics) + Vercel Chat SDK (transport) is the natural composition.

---

## 4. Data Model

### Concepts

**Channel** — registration of an external messaging account/channel (a Slack bot, a Telegram bot, etc.). The interface with the human world (senders).

**Recipient** — external system that consumes messages and responds (agent, API, service). The interface with the machine world.

**Thread** — conversation identified by a `threadId` generated by OpenThreads. Three scenarios:
- **Channel with native threads** (Slack, Discord forums): 1:1 mapping with the native thread.
- **Channel without threads** (Telegram DM, WhatsApp): OpenThreads creates virtual threads by grouping messages replied in sequence (reply chains).
- **Messages outside threads**: belong to the channel/target's `main thread` — a special threadId representing the main message flow.

**Turn** — each individual interaction within a thread, identified by a `turnId`. Represents one sender-message → recipient-response cycle.

**Route** — routing rule that maps incoming messages (sender via channel) to outbound recipients. Based on criteria such as: channel, group, DM, thread, mention, sender, content, etc.

### Flows

```
Sender (human)               OpenThreads                   Recipient (system)
     │                            │                              │
     │──msg──► channel inbound ──►│                              │
     │                            │──route──► recipient outbound─►│
     │                            │   (envelope w/ threadId,      │
     │                            │    turnId, replyTo)           │
     │                            │                              │
     │◄──msg── channel outbound ◄─│◄────────── recipient inbound─│
     │                            │   (POST to replyTo)           │
```

**Channel inbound** — webhook or subscription that triggers OpenThreads when a sender sends a message in a registered channel.

**Recipient outbound** — outbound webhook to the external system. Carries the standardized envelope with threadId, turnId, replyTo, and the message payload.

**Recipient inbound** — OpenThreads REST endpoint with a deterministic URL:

```
POST /send/channel/:channelId/target/:groupOrUser/thread/:threadIdOrMessageId
```

**Two authentication modes:**

- **replyTo with ephemeral token** — the URL in the outbound envelope includes a `?token=` with a default TTL of 24h (globally configurable). Works as a temporary authenticated shortcut, scoped to the specific thread/message. The recipient just POSTs to the replyTo without needing an API key.
- **Channel API key** — for direct sending (outside a replyTo context). When registering a channel, the user receives an API key bound to that channel. The recipient uses this key to send to any target reachable by the channel. Permission scope is delegated to the native channel — if the Slack bot has access to #general but not #private, OpenThreads passes through the adapter error, it doesn't try to work around it.

```
# replyTo with ephemeral token (scoped to thread, default TTL 24h)
POST /send/channel/slack-main/target/C0123/thread/ot_thr_abc123?token=ot_tk_abc123

# Direct send with channel API key (scoped to channel, no TTL)
POST /send/channel/slack-main/target/C0123
Authorization: Bearer ot_ch_sk_...
```

This covers two profiles: the casual webhook (n8n, script, lambda) that uses the replyTo and doesn't manage credentials, and the permanent agent that has the channel API key and sends proactively.

Without `:threadIdOrMessageId`, OpenThreads creates a new thread.

**Channel outbound** — rendered message sent to the destination channel.

### Envelope

The OpenThreads envelope is a routing wrapper. The `message` field accepts a **single object or array** — when it's an array, each item follows the **Vercel Chat SDK** or **A2H Protocol** schema, allowing conventional messages and A2H intents to be mixed in a single reply. When it's an object, it's treated as a 1-item array. Each item's type is inferred automatically by content (duck typing: presence of `intent` = A2H, otherwise = Chat SDK).

**Recipient outbound (OpenThreads → external system):**

```json
{
  "threadId": "ot_thr_abc123",
  "turnId": "ot_turn_001",
  "replyTo": "https://openthreads.host/send/channel/slack-main/target/C0123/thread/ot_thr_abc123?token=ot_tk_e8f2a1",
  "source": {
    "channel": "slack",
    "channelId": "C0123",
    "sender": { "id": "U456", "name": "João" }
  },
  "message": [
    {
      "text": "Can I deploy branch feature-x to staging?",
      "attachments": []
    }
  ]
}
```

**Recipient inbound — mixed reply (Chat SDK + A2H):**

```
POST /send/channel/slack-main/target/C0123/thread/ot_thr_abc123
```

```json
{
  "message": [
    { "text": "Tests passed. Ready for production." },
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

The Reply Engine processes the array sequentially: sends the text as a message, then renders the AUTHORIZE as a structured interaction. The sender's response to the intent is returned to the recipient.

**Recipient inbound — simple reply (object):**

```
POST /send/channel/slack-main/target/C0123/thread/ot_thr_abc123
```

```json
{
  "message": { "text": "Deploy started. ETA 3 minutes." }
}
```

**Recipient inbound — new thread (no threadId):**

```
POST /send/channel/slack-main/target/C0123
```

```json
{
  "message": { "text": "Deploy completed successfully." }
}
```

### Reply Methods

When the `message` array contains A2H items, the Reply Engine must decide **how** to render each intent in the channel. The choice depends on the intent type and the destination channel's capabilities.

**Method 1 — Inline in channel (buttons/actions)**

For simple `AUTHORIZE` (approve/deny) or `COLLECT` with closed options. Uses native channel primitives: Slack buttons/select menus, Telegram inline keyboard, Discord message components.

The sender responds without leaving the chat. OpenThreads receives the button callback and returns the response to the recipient.

**Method 2 — Text capture (thread, reply message, or DM)**

For free-text `COLLECT`. OpenThreads sends the question in the channel and captures the response using the platform's native affordances — the sender responds the way they normally respond in that channel.

**Capture hierarchy (most to least explicit):**

1. **Native thread** (Slack, Discord) → any message from the sender in the thread = response
2. **Native reply message** (WhatsApp, Telegram in groups) → sender replies to the COLLECT message = response
3. **DM** → implicit context, next message from sender = response
4. **None of the above** (group without reply, SMS) → escalates to method 3 (external form)

OpenThreads checks: "does this message have a thread or reply link to the COLLECT message?" If yes, capture. If no and it's a DM, capture by implicit context. If no and it's a group/channel without a link, don't capture — generate a link.

**Method 3 — External form (temporary link)**

For more complex intents: `COLLECT` with multiple fields, `AUTHORIZE` requiring strong authentication, or any case where channel primitives are insufficient. OpenThreads generates a temporary URL (`https://openthreads.host/form/ot_turn_001`) with auto-generated UI, sends the link in the channel, and awaits the submit. Similar to how n8n handles human-in-the-loop.

This is also the natural path for the trust layer — WebAuthn/passkeys don't make sense inline in a Telegram chat.

**Method 4 — Question page (batch of intents)**

When the `message` array contains multiple A2H intents (or a `COLLECT` with an N-field schema), the Reply Engine groups everything into a single page (external form, method 3) with all questions. Returns all responses at once to the recipient.

At the protocol level, A2H is 1 intent → 1 response. Batch composition is an OpenThreads extension over the spec — grouping is transparent to the recipient, which receives an array of responses in the same order as the intents sent.

**Automatic selection logic:**

```
For each A2H item in the message array:
  ├─ Trust layer active? → method 3 (external form, always — required for strong auth)
  ├─ Simple AUTHORIZE (approve/deny)
  │    └─ channel supports buttons? → method 1 (inline)
  │    └─ otherwise → method 3 (external form)
  ├─ COLLECT with closed options
  │    └─ channel supports select/buttons? → method 1 (inline)
  │    └─ otherwise → method 3 (external form)
  ├─ Free-text COLLECT (1 field)
  │    └─ channel has native threads? → method 2 (thread capture)
  │    └─ channel has reply message? → method 2 (reply capture)
  │    └─ context is DM? → method 2 (implicit capture)
  │    └─ otherwise → method 3 (external form)
  ├─ COLLECT with multiple fields
  │    └─ method 3 (external form)
  └─ Multiple A2H intents in the same array
       └─ method 4 (question page via external form)
```

The recipient doesn't need to know which method was used — it sends the array of intents, OpenThreads decides the best way to present them, and returns responses in the same format regardless of whether it was a button on Slack or a form on a temporary page.

---

## 5. Architecture

```
                    ┌──────────────────────────────────┐
                    │          OpenThreads              │
                    │          (web server)             │
                    │                                   │
  Slack ──adapter──►│  Channel Inbound                  │
  Discord ─────────►│    ↓                              │
  Telegram ────────►│  Router (routes + rules)          │
  WhatsApp ────────►│    ↓                              │
                    │  Recipient Outbound ──────────────│──webhook──► Recipient
                    │                                   │
                    │  Recipient Inbound ◄──────────────│◄─reply──── Recipient
                    │    ↓  (POST /send/channel/...)    │
                    │  Reply Engine                     │
                    │    • Chat SDK → text/blocks/etc   │
                    │    • A2H → method 1-4 (auto)      │
                    │    ↓                              │
                    │  Channel Outbound ───────────────►│──► Sender (in channel)
                    │                                   │
                    │  ┌─ UI Layer ────────────────────┐│
                    │  │  Temporary forms (A2H)        ││
                    │  │  Visual route editor           ││
                    │  │  Channel registration          ││
                    │  │  Threads/turns dashboard       ││
                    │  └───────────────────────────────┘│
                    │                                   │
                    │  ┌─ Trust Layer (optional) ──────┐│
                    │  │  JWS signing · auth · audit   ││
                    │  └───────────────────────────────┘│
                    └──────────────────────────────────┘
```

### Two A2H operating modes

| Mode | Trust Layer | Authentication | Evidence | Typical use |
|---|---|---|---|---|
| **Lightweight** | Off | None (channel response = implicit consent) | No signing | Dev, staging, low-stakes approvals |
| **Auditable** | On | WebAuthn/OTP/Push | JWS signed evidence | Production, compliance, financial transactions |

The external system chooses the mode per request. Default is lightweight.

---

## 6. Decisions Log

| Decision | Resolution |
|---|---|
| replyTo token TTL | Default 24h, globally configurable |
| Outbound permissions | Delegated to the native channel via channel API key. OpenThreads does not manage its own ACLs. |
| Thread ID vs native thread | 1:1 with native threads; virtual threads (reply chains) when unavailable; messages outside threads = `main thread` |
| Free-text COLLECT | Capture hierarchy: native thread → native reply message → DM → fallback to external form |
| UI stack | Next.js + Ant Design 5 + ReactFlow |

---

## 7. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | |
| Build | Vite | |
| Monorepo | Bun workspaces | |
| Channel adapters | Vercel Chat SDK | Adapter foundation, extended with custom adapters (e.g., Baileys) |
| HITL protocol | A2H (Twilio) | Intents + duck typing in the envelope |
| UI framework | Next.js | Auto-generated A2H forms, route editor, channel registration, dashboard |
| UI components | Ant Design 5 | |
| Route editor | ReactFlow | Visual route flow editing |
| Persistence | Abstracted, MongoDB by default | Pluggable storage interface — monorepo allows users to add adapters for Postgres, SQLite, etc. |

### Monorepo structure (draft)

```
openthreads/
  packages/
    core/           # router, reply engine, envelope, thread/turn management,
                    # Vercel Chat SDK integrated, abstract storage interface
    storage/
      mongodb/      # MongoDB implementation (default)
    channels/       # custom channel adapters (Baileys, etc.)
                    # native Chat SDK adapters live in core
    server/         # Next.js app (API server, dashboard, route editor,
                    # auto-generated A2H forms, channel registration)
    trust/          # optional trust layer (JWS, auth, audit)
```

To add Postgres support, a user creates `storage/postgres` implementing the interface defined in `core`, without touching anything else.
