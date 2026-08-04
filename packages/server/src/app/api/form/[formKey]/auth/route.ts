/**
 * Authentication challenge endpoints for the A2H Trust Layer.
 *
 * POST /api/form/:formKey/auth  — Issue a new authentication challenge.
 * PUT  /api/form/:formKey/auth  — Verify a challenge response.
 *
 * These endpoints are only active when TRUST_LAYER_ENABLED=true.
 * When the trust layer is off, returns 404.
 *
 * Flow:
 *   1. Client loads the form (GET /api/form/:formKey) and sees `requiresAuth: true`
 *   2. Client calls POST /api/form/:formKey/auth to receive an auth challenge
 *   3. Client performs authentication (TOTP, WebAuthn, etc.)
 *   4. Client calls PUT /api/form/:formKey/auth with the credential response
 *   5. On success, client receives a `challengeId` to include in form submission
 *   6. Client submits the form (POST /api/form/:formKey) with `challengeId`
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFormRecord } from '@/lib/db';
import { getTrustService, getTrustEnabled } from '@/lib/trust-service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ formKey: string }> };

// ─── POST — Issue challenge ───────────────────────────────────────────────────

export async function POST(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!getTrustEnabled()) {
    return NextResponse.json({ error: 'Trust layer is not enabled' }, { status: 404 });
  }

  const { formKey } = await context.params;

  // Verify the form exists and is still pending.
  const record = await getFormRecord(formKey);
  if (!record) {
    return NextResponse.json({ error: 'Form not found' }, { status: 404 });
  }
  if (record.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Form has expired' }, { status: 410 });
  }
  if (record.status === 'submitted') {
    return NextResponse.json({ error: 'Form already submitted' }, { status: 409 });
  }

  // Parse optional method preference from body.
  let method: 'webauthn' | 'totp' | 'sms_otp' | undefined;
  try {
    const body = await _req.json().catch(() => ({}));
    if (body && typeof body === 'object' && 'method' in body) {
      method = body.method as typeof method;
    }
  } catch {
    // no body — use default method
  }

  const trust = await getTrustService();
  const challenge = await trust.issueAuthChallenge(formKey, method);

  return NextResponse.json({
    challengeId: challenge.challengeId,
    method: challenge.method,
    challenge: challenge.challenge,
    expiresAt: challenge.expiresAt.toISOString(),
  });
}

// ─── PUT — Verify challenge ───────────────────────────────────────────────────

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!getTrustEnabled()) {
    return NextResponse.json({ error: 'Trust layer is not enabled' }, { status: 404 });
  }

  const { formKey } = await context.params;

  let body: {
    challengeId?: string;
    code?: string;               // TOTP / SMS OTP
    credentialId?: string;       // WebAuthn
    authenticatorData?: string;
    clientDataJSON?: string;
    signature?: string;
    userHandle?: string;
    publicKeyJwk?: JsonWebKey;   // WebAuthn public key for verification
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.challengeId) {
    return NextResponse.json({ error: 'Missing required field: challengeId' }, { status: 400 });
  }

  const trust = await getTrustService();

  // Determine what kind of response is being submitted.
  let response: { code: string } | {
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string;
  };

  if (body.credentialId) {
    // WebAuthn assertion
    if (!body.authenticatorData || !body.clientDataJSON || !body.signature) {
      return NextResponse.json(
        { error: 'WebAuthn assertion missing required fields' },
        { status: 400 },
      );
    }
    response = {
      credentialId: body.credentialId,
      authenticatorData: body.authenticatorData,
      clientDataJSON: body.clientDataJSON,
      signature: body.signature,
      userHandle: body.userHandle,
    };
  } else if (body.code) {
    // TOTP / SMS OTP
    response = { code: body.code };
  } else {
    return NextResponse.json(
      { error: 'Missing verification payload: provide code (TOTP) or WebAuthn fields' },
      { status: 400 },
    );
  }

  const result = await trust.verifyAuthChallenge(
    body.challengeId,
    response,
    body.publicKeyJwk,
  );

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Verification failed' }, { status: 401 });
  }

  // Log that the user verified for this form.
  await trust.log('auth_challenge_completed', formKey, {
    actorId: result.identityId,
    payload: { challengeId: body.challengeId, formKey },
  });

  return NextResponse.json({
    ok: true,
    challengeId: result.challengeId,
    verifiedAt: result.verifiedAt?.toISOString(),
    identityId: result.identityId,
  });
}
