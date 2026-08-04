# Custom Channel Adapter Guide

OpenThreads uses a `ChannelAdapter` interface to abstract platform-specific
messaging. This guide explains how to implement a custom adapter for any
platform not natively supported.

## When do you need a custom adapter?

- Your platform isn't supported out of the box (WhatsApp via Baileys, Signal, Matrix, etc.)
- You need custom rendering for A2H intents on a supported platform
- You're integrating with an internal messaging system

## The ChannelAdapter interface

```typescript
import type { ChannelAdapter } from '@openthreads/core';

export class MyAdapter implements ChannelAdapter {
  // Report what your platform supports
  capabilities(): ChannelCapabilities { ... }

  // Set up webhooks / subscriptions when a channel is registered
  async register(config: ChannelConfig): Promise<void> { ... }

  // Send a message to a target (channel, group, user)
  async sendMessage(target: string, message: ...): Promise<void> { ... }

  // Render a Chat SDK message in platform-native format
  async renderChatSDK(message: ChatSDKMessage, capabilities): Promise<RenderedMessage> { ... }

  // Render an A2H intent as inline interactive elements (buttons, menus)
  // Only called for Method 1 (inline rendering)
  async renderA2HInline(intent: A2HMessage, capabilities): Promise<RenderedMessage> { ... }

  // Capture a free-text response from the human (Method 2)
  async captureResponse(thread: Thread, turn: Turn): Promise<ChatSDKMessage> { ... }
}
```

## Step-by-step: implement a minimal adapter

### 1. Create a new package

```
packages/channels/my-platform/
  src/
    adapter.ts     # ChannelAdapter implementation
    index.ts       # public exports
  package.json
```

### 2. Declare capabilities

```typescript
capabilities(): ChannelCapabilities {
  return {
    threads: false,          // does your platform have native threads?
    buttons: true,           // can you render interactive buttons?
    selectMenus: false,      // can you render dropdown menus?
    replyMessages: true,     // can senders reply to specific messages?
    dms: true,               // does it support DMs?
    fileUpload: false,       // can you upload files?
  };
}
```

The Reply Engine uses these flags to select the best method (1-4) for each
A2H intent. Reporting wrong capabilities leads to degraded UX.

### 3. Implement `renderChatSDK`

Map the Chat SDK message to your platform's native format:

```typescript
async renderChatSDK(
  message: ChatSDKMessage,
  _capabilities: ChannelCapabilities,
): Promise<RenderedMessage> {
  return {
    text: message.text ?? '',
    // Add platform-specific fields
  };
}
```

### 4. Implement `renderA2HInline` (Method 1)

For `AUTHORIZE` (approve/deny) and `COLLECT` with closed options:

```typescript
async renderA2HInline(
  intent: A2HMessage,
  _capabilities: ChannelCapabilities,
): Promise<RenderedMessage> {
  if (intent.intent === 'AUTHORIZE') {
    return {
      text: intent.description ?? 'Action requires your approval',
      // Platform-specific button payload
      buttons: [
        { id: 'approve', text: 'Approve', value: 'true' },
        { id: 'deny', text: 'Deny', value: 'false' },
      ],
    };
  }
  // Handle COLLECT with options...
}
```

### 5. Implement `captureResponse` (Method 2)

For free-text collection via thread/reply:

```typescript
async captureResponse(thread: Thread, turn: Turn): Promise<ChatSDKMessage> {
  // Set up a listener for the next message in this thread from the sender
  // This depends heavily on your platform's event system
  return new Promise((resolve) => {
    // ... platform-specific listener
  });
}
```

### 6. Implement `register`

```typescript
async register(config: ChannelConfig): Promise<void> {
  // Store config
  // Register webhooks with the platform
  // Subscribe to events
}
```

## Example: WhatsApp via Baileys

See `packages/channels/whatsapp/` for a real-world example using the
[Baileys](https://github.com/WhiskeySockets/Baileys) library.

## Publishing your adapter

Adapters are standalone npm packages. Publish yours and users can install it
alongside OpenThreads:

```bash
npm install @my-org/openthreads-adapter-myplatform
```

Then register it in the OpenThreads channel configuration.
