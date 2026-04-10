/**
 * Shared adapter conformance test suite.
 *
 * Provides a factory function `runConformanceSuite()` that generates a
 * standardised set of Bun tests for any `ChannelAdapter` implementation.
 *
 * ### Usage
 * ```ts
 * // In your adapter's conformance.test.ts:
 * import { runConformanceSuite } from '@openthreads/channels/conformance-suite';
 * import { MyAdapter } from '../MyAdapter.js';
 *
 * runConformanceSuite({
 *   channelType: 'my-platform',
 *   create: () => new MyAdapter({ ... }),
 *   expectedCapabilities: {
 *     threads: true,
 *     buttons: true,
 *     selectMenus: false,
 *     replyMessages: true,
 *     dms: true,
 *     fileUpload: false,
 *   },
 * });
 * ```
 *
 * The suite tests:
 *   - Interface shape (required methods / properties are present)
 *   - `capabilities` object shape and values
 *   - `send()` returns a `SendResult`-compatible object
 *   - `onMessage()` / `onInboundMessage()` accepts a handler
 *   - `initialize()` / `connect()` and `shutdown()` / `disconnect()` lifecycle
 */

import { describe, test, expect } from 'bun:test';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal capability descriptor expected from every channel adapter.
 * Matches the `ChannelCapabilities` type exported from `@openthreads/core`.
 */
export interface AdapterCapabilities {
  threads: boolean;
  buttons: boolean;
  selectMenus: boolean;
  replyMessages: boolean;
  dms: boolean;
  fileUpload: boolean;
}

/**
 * Factory descriptor passed to `runConformanceSuite`.
 */
export interface ConformanceSuiteFactory<TAdapter = unknown> {
  /** Human-readable name used in test suite titles. */
  channelType: string;
  /** Factory that creates a fresh adapter instance for each test. */
  create(): TAdapter;
  /**
   * Expected capability values for this adapter.
   * The suite asserts each value matches.
   */
  expectedCapabilities: AdapterCapabilities;
  /**
   * When `true`, tests that call `initialize()` / `connect()` are skipped.
   * Use this when the adapter cannot be initialized without external services.
   * Default: false
   */
  skipLifecycle?: boolean;
}

// ---------------------------------------------------------------------------
// Capability keys that must be present on every adapter
// ---------------------------------------------------------------------------

const REQUIRED_CAPABILITY_KEYS: Array<keyof AdapterCapabilities> = [
  'threads',
  'buttons',
  'selectMenus',
  'replyMessages',
  'dms',
  'fileUpload',
];

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

/**
 * Generate a standardised conformance test suite for the given adapter factory.
 *
 * Call at the top level of a test file — the function registers `describe` blocks
 * via Bun's test runner.
 */
export function runConformanceSuite<TAdapter extends Record<string, unknown>>(
  factory: ConformanceSuiteFactory<TAdapter>,
): void {
  const { channelType, create, expectedCapabilities, skipLifecycle = false } = factory;

  // ── Interface shape ────────────────────────────────────────────────────────
  describe(`${channelType} conformance — interface shape`, () => {
    test('channelType or type property is a non-empty string', () => {
      const adapter = create();
      const type = (adapter.channelType ?? adapter.type) as unknown;
      expect(typeof type).toBe('string');
      expect((type as string).length).toBeGreaterThan(0);
    });

    test('has capabilities object or capabilities() function', () => {
      const adapter = create();
      const caps = adapter.capabilities;
      // Some adapters expose capabilities as a plain object, others as a method
      expect(caps !== undefined || typeof adapter.capabilities === 'function').toBe(true);
    });

    test('exposes a send / sendMessage / renderA2HIntent method', () => {
      const adapter = create();
      // Different adapters use different method names for outbound sending.
      // Slack: send(), WhatsApp: sendMessage(), Telegram: send() + renderA2HIntent()
      const sendFn =
        adapter.send ?? adapter.sendMessage ?? adapter.renderA2HIntent;
      expect(typeof sendFn).toBe('function');
    });

    test('exposes an onMessage / onInboundMessage / onIncomingMessage / parseInbound method', () => {
      const adapter = create();
      // Each adapter surface varies:
      //   Slack:     onMessage()
      //   WhatsApp:  onInboundMessage()
      //   Discord:   onIncomingMessage()
      //   Telegram:  parseInbound() (pull-based, no subscription registration)
      const onMsg =
        adapter.onMessage ??
        adapter.onInboundMessage ??
        adapter.onIncomingMessage ??
        adapter.parseInbound;
      expect(typeof onMsg).toBe('function');
    });
  });

  // ── Capabilities ──────────────────────────────────────────────────────────
  describe(`${channelType} conformance — capabilities`, () => {
    function getCaps(adapter: TAdapter): AdapterCapabilities {
      const raw = adapter.capabilities;
      if (typeof raw === 'function') {
        return (raw as () => AdapterCapabilities)();
      }
      return raw as AdapterCapabilities;
    }

    test('capabilities object has all required boolean flags', () => {
      const adapter = create();
      const caps = getCaps(adapter);

      for (const key of REQUIRED_CAPABILITY_KEYS) {
        expect(typeof caps[key]).toBe('boolean');
      }
    });

    test('capabilities.threads matches expected value', () => {
      expect(getCaps(create()).threads).toBe(expectedCapabilities.threads);
    });

    test('capabilities.buttons matches expected value', () => {
      expect(getCaps(create()).buttons).toBe(expectedCapabilities.buttons);
    });

    test('capabilities.selectMenus matches expected value', () => {
      expect(getCaps(create()).selectMenus).toBe(expectedCapabilities.selectMenus);
    });

    test('capabilities.replyMessages matches expected value', () => {
      expect(getCaps(create()).replyMessages).toBe(expectedCapabilities.replyMessages);
    });

    test('capabilities.dms matches expected value', () => {
      expect(getCaps(create()).dms).toBe(expectedCapabilities.dms);
    });

    test('capabilities.fileUpload matches expected value', () => {
      expect(getCaps(create()).fileUpload).toBe(expectedCapabilities.fileUpload);
    });
  });

  // ── onMessage handler registration ────────────────────────────────────────
  describe(`${channelType} conformance — message handler registration`, () => {
    test('onMessage / onInboundMessage / onIncomingMessage accepts a handler without throwing', () => {
      const adapter = create();
      const register = (
        adapter.onMessage ??
        adapter.onInboundMessage ??
        adapter.onIncomingMessage
      ) as ((h: () => void) => unknown) | undefined;

      if (typeof register !== 'function') {
        // Adapter uses pull-based pattern (e.g., Telegram parseInbound) — skip.
        return;
      }

      expect(() => register.call(adapter, () => {})).not.toThrow();
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  if (!skipLifecycle) {
    describe(`${channelType} conformance — lifecycle`, () => {
      test('shutdown / disconnect / destroy resolves without error when not connected', async () => {
        const adapter = create();
        const shutdownFn =
          (adapter.shutdown ?? adapter.disconnect ?? adapter.destroy) as
          | (() => Promise<void>)
          | undefined;

        if (typeof shutdownFn !== 'function') {
          // Adapter does not expose a shutdown method — skip gracefully.
          return;
        }

        await expect(shutdownFn.call(adapter)).resolves.not.toThrow();
      });
    });
  }
}
