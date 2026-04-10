/**
 * GET /form/:formKey — Auto-generated A2H form page.
 *
 * Renders a temporary web form for A2H reply methods 3 (single intent) and
 * 4 (batch of intents). The form key is either `turnId` (method 3) or
 * `${turnId}_batch` (method 4).
 *
 * This server component loads the turn data and passes it to the client
 * component which renders the interactive form UI.
 */

import { notFound } from 'next/navigation';
import { getTurn, getFormRecord, createFormRecord } from '@/lib/db';
import FormClient from './FormClient';

export const runtime = 'nodejs';

type PageProps = { params: Promise<{ formKey: string }> };

/** Default form TTL matches the reply token TTL (env: REPLY_TOKEN_TTL, default 24h). */
function getFormTtlMs(): number {
  return Number(process.env.REPLY_TOKEN_TTL ?? 86400) * 1000;
}

/** Extract base turnId and batch flag from formKey. */
function parseFormKey(formKey: string): { turnId: string; isBatch: boolean } {
  if (formKey.endsWith('_batch')) {
    return { turnId: formKey.slice(0, -6), isBatch: true };
  }
  return { turnId: formKey, isBatch: false };
}

/** Type guard: checks if an item is an A2H message (has an `intent` string field). */
function isA2HMessage(item: unknown): item is { intent: string; context?: Record<string, unknown>; description?: string } {
  return (
    typeof item === 'object' &&
    item !== null &&
    'intent' in item &&
    typeof (item as Record<string, unknown>).intent === 'string'
  );
}

export default async function FormPage({ params }: PageProps) {
  const { formKey } = await params;
  const { turnId, isBatch } = parseFormKey(formKey);

  // Load (or lazily create) the form record.
  let formRecord = await getFormRecord(formKey);

  if (!formRecord) {
    // First access: resolve the turn and create the form record.
    const turn = await getTurn(turnId);
    if (!turn) {
      notFound();
    }

    // Extract A2H intents from the turn message.
    const messages = Array.isArray(turn.message) ? turn.message : [turn.message];
    const intents = messages.filter(isA2HMessage);

    if (intents.length === 0) {
      // This turn has no A2H intents — no form to show.
      notFound();
    }

    // Create the form record.
    const expiresAt = new Date(new Date(turn.timestamp).getTime() + getFormTtlMs());
    formRecord = await createFormRecord({
      formKey,
      turnId,
      isBatch,
      intents,
      status: 'pending',
      expiresAt,
    });
  }

  const now = new Date();
  const isExpired = formRecord.expiresAt < now;

  return (
    <FormClient
      formKey={formKey}
      intents={formRecord.intents as Array<{
        intent: string;
        context?: Record<string, unknown>;
        description?: string;
      }>}
      isBatch={formRecord.isBatch}
      status={isExpired ? 'expired' : formRecord.status}
      expiresAt={formRecord.expiresAt.toISOString()}
    />
  );
}
