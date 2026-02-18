import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

const DEFAULT_AGENT_API_URL = 'http://localhost:8080';

function getAgentApiBaseUrl() {
  const configured =
    process.env.AGENT_API_URL || process.env.NEXT_PUBLIC_AGENT_API_URL || DEFAULT_AGENT_API_URL;

  return configured.replace(/\/+$/, '');
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Payload must be a JSON object.';
  }

  if (typeof payload.requestId !== 'string' || payload.requestId.trim().length === 0) {
    return 'Payload must include requestId.';
  }

  if (typeof payload.tenantId !== 'string' || payload.tenantId.trim().length === 0) {
    return 'Payload must include tenantId.';
  }

  if (typeof payload.draftId !== 'string' || payload.draftId.trim().length === 0) {
    return 'Payload must include draftId.';
  }

  if (typeof payload.draftHash !== 'string' || payload.draftHash.trim().length === 0) {
    return 'Payload must include draftHash.';
  }

  if (typeof payload.actorWallet !== 'string' || payload.actorWallet.trim().length === 0) {
    return 'Payload must include actorWallet.';
  }

  if (!payload.auth || typeof payload.auth !== 'object' || Array.isArray(payload.auth)) {
    return 'Payload must include auth object.';
  }

  return null;
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

  const validationMessage = validatePayload(payload);
  if (validationMessage) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: validationMessage
      },
      { status: 400 }
    );
  }

  const submissionId = `web_ai_approval_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const agentApiBaseUrl = getAgentApiBaseUrl();
  const upstreamUrl = `${agentApiBaseUrl}/v1/ai/approve-draft`;

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
          error: 'UPSTREAM_AI_APPROVAL_FAILED',
          message: 'Agent API rejected AI draft approval request.',
          submissionId,
          receivedAt,
          upstreamStatus: upstreamResponse.status
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(
      {
        code: 'AI_DRAFT_APPROVAL_FORWARDED',
        message: 'AI draft approval forwarded to agent API.',
        submissionId,
        receivedAt,
        upstreamStatus: upstreamResponse.status,
        upstreamBody
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_AI_APPROVAL_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}
