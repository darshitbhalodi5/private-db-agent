import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

const DEFAULT_AGENT_API_URL = 'http://localhost:8080';

function getAgentApiBaseUrl() {
  const configured =
    process.env.AGENT_API_URL || process.env.NEXT_PUBLIC_AGENT_API_URL || DEFAULT_AGENT_API_URL;

  return configured.replace(/\/+$/, '');
}

function createForwardHeaders(request, { requireIdempotencyKey = false } = {}) {
  const headers = {
    accept: 'application/json'
  };

  const headerNames = [
    'x-agent-id',
    'x-agent-signature',
    'x-agent-timestamp',
    'x-agent-nonce',
    'x-correlation-id',
    'x-idempotency-key'
  ];

  for (const name of headerNames) {
    const value = request.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  if (requireIdempotencyKey && !headers['x-idempotency-key']) {
    headers['x-idempotency-key'] = `web_a2a_${randomUUID()}`;
  }

  return headers;
}

export async function GET(request) {
  const query = request.nextUrl.search || '';
  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/a2a/tasks${query}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'GET',
      headers: createForwardHeaders(request),
      cache: 'no-store'
    });

    const upstreamBody = await upstreamResponse.json().catch(() => null);
    if (!upstreamResponse.ok) {
      if (upstreamBody && typeof upstreamBody === 'object') {
        return NextResponse.json(upstreamBody, { status: upstreamResponse.status });
      }

      return NextResponse.json(
        {
          error: 'UPSTREAM_A2A_TASK_LIST_FAILED',
          message: `Agent API returned status ${upstreamResponse.status}.`
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(upstreamBody, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_A2A_TASK_LIST_UNREACHABLE',
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

  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/a2a/tasks`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        ...createForwardHeaders(request, {
          requireIdempotencyKey: true
        }),
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
          error: 'UPSTREAM_A2A_TASK_CREATE_FAILED',
          message: `Agent API returned status ${upstreamResponse.status}.`
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(upstreamBody, { status: upstreamResponse.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_A2A_TASK_CREATE_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}
