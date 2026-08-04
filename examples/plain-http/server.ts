/**
 * Plain HTTP Webhook Consumer — OpenThreads example.
 *
 * Minimal Bun HTTP server that:
 *  1. Receives POST /inbound  — OpenThreads envelope (outbound from OT)
 *  2. Processes the message
 *  3. Replies via replyTo URL
 *
 * Run: bun run server.ts
 */

const PORT = Number(process.env.PORT ?? 4000);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Envelope {
  threadId: string;
  turnId: string;
  replyTo: string;
  source: {
    channel: string;
    channelId: string;
    sender: { id: string; name?: string };
  };
  message: unknown;
}

// ─── Message processing ───────────────────────────────────────────────────────

async function processEnvelope(envelope: Envelope): Promise<void> {
  const { replyTo, source, message } = envelope;
  console.log(`[inbound] message from ${source.sender.name ?? source.sender.id} on ${source.channel}:`, message);

  // Build a reply
  const reply = buildReply(message, source.sender.name ?? source.sender.id);

  // Send the reply via replyTo
  const response = await fetch(replyTo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reply),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[reply] failed: ${response.status} ${body}`);
  } else {
    console.log(`[reply] sent to ${replyTo}`);
  }
}

function buildReply(message: unknown, senderName: string): { message: unknown } {
  // Extract text from the message
  let text = '';
  if (Array.isArray(message)) {
    const texts = message
      .filter((m): m is { text: string } => typeof m === 'object' && m !== null && 'text' in m)
      .map((m) => m.text);
    text = texts.join(' ');
  } else if (typeof message === 'object' && message !== null && 'text' in message) {
    text = (message as { text: string }).text;
  }

  // Echo the message back
  return {
    message: {
      text: `Echo from webhook consumer: "${text}" (from ${senderName})`,
    },
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // POST /inbound — receive OpenThreads envelope
    if (req.method === 'POST' && url.pathname === '/inbound') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const envelope = body as Envelope;

      // Acknowledge immediately, process asynchronously
      void processEnvelope(envelope).catch((err: unknown) => {
        console.error('[processEnvelope] error:', err);
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /health — liveness probe
    if (req.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

console.log(`[server] listening on http://localhost:${server.port}`);
console.log(`[server] POST /inbound  — receive OpenThreads envelopes`);
console.log(`[server] GET  /health   — liveness probe`);
