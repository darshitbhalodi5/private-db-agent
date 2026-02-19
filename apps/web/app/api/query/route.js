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

  if (typeof payload.requester !== 'string' || payload.requester.trim().length === 0) {
    return 'Payload must include requester.';
  }

  if (typeof payload.capability !== 'string' || payload.capability.trim().length === 0) {
    return 'Payload must include capability.';
  }

  if (typeof payload.queryTemplate !== 'string' || payload.queryTemplate.trim().length === 0) {
    return 'Payload must include queryTemplate.';
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

  if (
    payload.queryParams !== undefined &&
    (payload.queryParams === null ||
      Array.isArray(payload.queryParams) ||
      typeof payload.queryParams !== 'object')
  ) {
    return 'Payload queryParams must be a JSON object when provided.';
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

  const submissionId = `web_query_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/query`;

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
          error: 'UPSTREAM_QUERY_FAILED',
          message: 'Agent API rejected query payload.',
          submissionId,
          receivedAt,
          upstreamStatus: upstreamResponse.status
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(
      {
        code: 'QUERY_FORWARDED',
        message: 'Query payload forwarded to agent API.',
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
        error: 'UPSTREAM_QUERY_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}
