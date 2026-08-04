/**
 * GET  /api/form/:formKey — Return form metadata (intent data, status, expiry).
 * POST /api/form/:formKey — Handle form submission: validate, store, resolve intent.
 *
 * The form key is either `turnId` (method 3) or `${turnId}_batch` (method 4).
 * On successful POST the blocking A2H promise in the in-process `formRegistry` is
 * resolved so the Reply Engine can return the human's answer to the recipient.
 *
 * Trust layer integration (when TRUST_LAYER_ENABLED=true):
 *   - GET includes `requiresAuth: true` and the supported auth methods
 *   - POST requires a verified `challengeId` in the body before submitting
 *   - After submission, the response is signed and the evidence is recorded in the audit log
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFormRecord, updateFormRecord } from '@/lib/db';
import { formRegistry, type A2HResponse } from '@/lib/form-registry';
import { getTrustService, getTrustEnabled } from '@/lib/trust-service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ formKey: string }> };

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { formKey } = await context.params;

  const record = await getFormRecord(formKey);
  if (!record) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }

  const now = new Date();
  const isExpired = record.expiresAt < now;

  const trustEnabled = getTrustEnabled();

  // Emit audit event: intent rendered (first time form is viewed and trust is active).
  if (trustEnabled && !isExpired && record.status === 'pending') {
    const trust = await getTrustService();
    await trust.log('intent_rendered', record.turnId, {
      payload: { formKey, isBatch: record.isBatch },
    });
  }

  return NextResponse.json({
    formKey: record.formKey,
    turnId: record.turnId,
    isBatch: record.isBatch,
    status: isExpired ? 'expired' : record.status,
    intents: record.intents,
    expiresAt: record.expiresAt.toISOString(),
    // Trust layer metadata
    requiresAuth: trustEnabled,
    authMethods: trustEnabled ? ['totp', 'webauthn'] : undefined,
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { formKey } = await context.params;

  // Load the form record.
  const record = await getFormRecord(formKey);
  if (!record) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }

  // Reject expired forms.
  const now = new Date();
  if (record.expiresAt < now) {
    return NextResponse.json({ error: 'Form has expired' }, { status: 410 });
  }

  // Reject already-submitted forms (single-use link).
  if (record.status === 'submitted') {
    return NextResponse.json({ error: 'Form already submitted' }, { status: 409 });
  }

  // Parse the submission body.
  let body: { responses?: unknown[]; challengeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.responses) || body.responses.length === 0) {
    return NextResponse.json({ error: 'Missing required field: responses' }, { status: 400 });
  }

  // Validate that response count matches intent count.
  if (body.responses.length !== record.intents.length) {
    return NextResponse.json(
      {
        error: `Expected ${record.intents.length} response(s), got ${body.responses.length}`,
      },
      { status: 400 },
    );
  }

  // Validate each response has the required shape.
  for (let i = 0; i < body.responses.length; i++) {
    const r = body.responses[i];
    if (typeof r !== 'object' || r === null || !('intent' in r)) {
      return NextResponse.json(
        { error: `Response[${i}] is missing required field: intent` },
        { status: 400 },
      );
    }
  }

  // ── Trust layer: verify auth challenge before accepting submission ───────────
  const trustEnabled = getTrustEnabled();
  let actorId: string | undefined;

  if (trustEnabled) {
    if (!body.challengeId) {
      return NextResponse.json(
        {
          error: 'Trust layer requires authentication. Submit a challengeId obtained from POST /api/form/:formKey/auth',
        },
        { status: 401 },
      );
    }

    const trust = await getTrustService();
    const verified = trust.getVerifiedChallenge(body.challengeId);

    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid or expired challengeId. Complete authentication first.' },
        { status: 401 },
      );
    }

    if (verified.formKey !== formKey) {
      return NextResponse.json(
        { error: 'Challenge was issued for a different form' },
        { status: 401 },
      );
    }

    actorId = verified.identityId;
  }

  // Mark the form as submitted in MongoDB (single-use: prevents replay via resubmission).
  await updateFormRecord(formKey, {
    status: 'submitted',
    responses: body.responses,
  });

  // ── Trust layer: sign evidence and record audit entries ──────────────────────
  if (trustEnabled) {
    const trust = await getTrustService();

    // Log each response received.
    for (const r of body.responses) {
      const response = r as Record<string, unknown>;
      await trust.log('response_received', record.turnId, {
        intentType: response['intent'] as Parameters<typeof trust.log>[2]['intentType'],
        actorId,
        payload: { formKey, response: r },
      });
    }
  }

  // Resolve blocking promises in the in-process registry.
  // For batch forms: sub-keys are `${formKey}_${i}`.
  // For single forms: key is the formKey itself.
  if (record.isBatch) {
    for (let i = 0; i < body.responses.length; i++) {
      const subKey = `${formKey}_${i}`;
      formRegistry.submit(subKey, body.responses[i] as A2HResponse);
    }
  } else {
    formRegistry.submit(formKey, body.responses[0] as A2HResponse);
  }

  return NextResponse.json({
    ok: true,
    formKey,
    submittedAt: new Date().toISOString(),
  });
}
