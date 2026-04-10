/**
 * GET  /api/form/:formKey — Return form metadata (intent data, status, expiry).
 * POST /api/form/:formKey — Handle form submission: validate, store, resolve intent.
 *
 * The form key is either `turnId` (method 3) or `${turnId}_batch` (method 4).
 * On successful POST the blocking A2H promise in the in-process `formRegistry` is
 * resolved so the Reply Engine can return the human's answer to the recipient.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFormRecord, updateFormRecord } from '@/lib/db';
import { formRegistry, type A2HResponse } from '@/lib/form-registry';

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

  return NextResponse.json({
    formKey: record.formKey,
    turnId: record.turnId,
    isBatch: record.isBatch,
    status: isExpired ? 'expired' : record.status,
    intents: record.intents,
    expiresAt: record.expiresAt.toISOString(),
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

  // Reject already-submitted forms.
  if (record.status === 'submitted') {
    return NextResponse.json({ error: 'Form already submitted' }, { status: 409 });
  }

  // Parse the submission body.
  let body: { responses?: unknown[] };
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

  // Mark the form as submitted in MongoDB.
  await updateFormRecord(formKey, {
    status: 'submitted',
    responses: body.responses,
  });

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
