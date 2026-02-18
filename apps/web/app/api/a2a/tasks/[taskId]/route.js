import { NextResponse } from 'next/server';

const DEFAULT_AGENT_API_URL = 'http://localhost:8080';

function getAgentApiBaseUrl() {
  const configured =
    process.env.AGENT_API_URL || process.env.NEXT_PUBLIC_AGENT_API_URL || DEFAULT_AGENT_API_URL;

  return configured.replace(/\/+$/, '');
}

function createForwardHeaders(request) {
  const headers = {
    accept: 'application/json'
  };

  const headerNames = [
    'x-agent-id',
    'x-agent-signature',
    'x-agent-timestamp',
    'x-agent-nonce',
    'x-correlation-id'
  ];

  for (const name of headerNames) {
    const value = request.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  return headers;
}

export async function GET(request, { params }) {
  const taskId = encodeURIComponent(params.taskId);
  const upstreamUrl = `${getAgentApiBaseUrl()}/v1/a2a/tasks/${taskId}`;

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
          error: 'UPSTREAM_A2A_TASK_GET_FAILED',
          message: `Agent API returned status ${upstreamResponse.status}.`
        },
        { status: upstreamResponse.status }
      );
    }

    return NextResponse.json(upstreamBody, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'UPSTREAM_A2A_TASK_GET_UNREACHABLE',
        message: error?.message || 'Unable to reach agent API.'
      },
      { status: 502 }
    );
  }
}
