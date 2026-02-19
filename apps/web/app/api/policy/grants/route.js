import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

const DEFAULT_AGENT_API_URL = 'http://localhost:8080';

function getAgentApiBaseUrl() {
  const configured =
    process.env.AGENT_API_URL || process.env.NEXT_PUBLIC_AGENT_API_URL || DEFAULT_AGENT_API_URL;

  return configured.replace(/\/+$/, '');
}

function validateCreatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Payload must be a JSON object.';
  }

  if (typeof payload.requestId !== 'string' || payload.requestId.trim().length === 0) {
    return 'Payload must include requestId.';
  }

  if (typeof payload.tenantId !== 'string' || payload.tenantId.trim().length === 0) {
    return 'Payload must include tenantId.';
  }

  if (typeof payload.actorWallet !== 'string' || payload.actorWallet.trim().length === 0) {
    return 'Payload must include actorWallet.';
  }

  if (!payload.grant || typeof payload.grant !== 'object' || Array.isArray(payload.grant)) {
    return 'Payload must include grant object.';
  }

  if (
    typeof payload.grant.walletAddress !== 'string' ||
    payload.grant.walletAddress.trim().length === 0
  ) {
    return 'Payload grant must include walletAddress.';
  }

  if (typeof payload.grant.scopeType !== 'string' || payload.grant.scopeType.trim().length === 0) {
    return 'Payload grant must include scopeType.';
  }

  if (typeof payload.grant.scopeId !== 'string' || payload.grant.scopeId.trim().length === 0) {
    return 'Payload grant must include scopeId.';
  }

  if (
    typeof payload.grant.operation !== 'string' ||
    payload.grant.operation.trim().length === 0
  ) {
    return 'Payload grant must include operation.';
  }

  if (typeof payload.grant.effect !== 'string' || payload.grant.effect.trim().length === 0) {
    return 'Payload grant must include effect.';
  }

  if (!payload.auth || typeof payload.auth !== 'object' || Array.isArray(payload.auth)) {
    return 'Payload must include auth object.';
  }

  if (typeof payload.auth.nonce !== 'string' || payload.auth.nonce.trim().length === 0) {
    return 'Payload auth must include nonce.';
  }

  if (typeof payload.auth.signedAt !== 'string' || payload.auth.signedAt.trim().length === 0) {
    return 'Payload auth must include signedAt.';
  }

  if (typeof payload.auth.signature !== 'string' || payload.auth.signature.trim().length === 0) {
    return 'Payload auth must include signature.';
  }

  return null;
}

export async function GET(request) {
  const queryString = request.nextUrl.search || '';
  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/policy/grants${queryString}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'GET',
      cache: 'no-store'
    });

    const upstreamBody = await upstreamResponse.json().catch(() => null);
    if (!upstreamBody || typeof upstreamBody !== 'object') {
      return NextResponse.json(
        {
          error: 'UPSTREAM_POLICY_GRANTS_FAILED',
          message: 'Agent API returned non-JSON response for policy grants.',
          upstreamStatus: upstreamResponse.status
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(upstreamBody, { status: upstreamResponse.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_POLICY_GRANTS_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}

export async function POST(request) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: 'INVALID_JSON',
        message: 'Request body must be valid JSON.'
      },
      { status: 400 }
    );
  }

  const validationMessage = validateCreatePayload(payload);
  if (validationMessage) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: validationMessage
      },
      { status: 400 }
    );
  }

  const submissionId = `web_policy_grant_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/policy/grants`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    const upstreamBody = await upstreamResponse.json().catch(() => null);
    if (!upstreamResponse.ok) {
      if (upstreamBody && typeof upstreamBody === 'object') {
        return NextResponse.json(upstreamBody, { status: upstreamResponse.status });
      }

      return NextResponse.json(
        {
          error: 'UPSTREAM_POLICY_GRANT_CREATE_FAILED',
          message: 'Agent API rejected policy grant payload.',
          submissionId,
          receivedAt,
          upstreamStatus: upstreamResponse.status
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(
      {
        code: 'POLICY_GRANT_FORWARDED',
        message: 'Policy grant payload forwarded to agent API.',
        submissionId,
        receivedAt,
        upstreamStatus: upstreamResponse.status,
        upstreamBody
      },
      { status: upstreamResponse.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_POLICY_GRANT_CREATE_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}
