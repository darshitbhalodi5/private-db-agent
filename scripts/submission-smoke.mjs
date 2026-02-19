import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] || 'http://localhost:8080';
const a2aSharedSecret = process.env.A2A_SHARED_SECRET || process.argv[3] || 'demo-a2a-secret';
const a2aAgentId = process.env.A2A_AGENT_ID || 'demo-agent';

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSort(entry));
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function hashPayload(value) {
  return createHash('sha256').update(stableStringify(value || {})).digest('hex');
}

function buildA2aSigningMessage({
  agentId,
  method,
  path,
  timestamp,
  nonce,
  correlationId,
  idempotencyKey,
  payloadHash
}) {
  const envelope = {
    agentId,
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    timestamp,
    nonce,
    correlationId: correlationId || null,
    idempotencyKey: idempotencyKey || null,
    payloadHash
  };

  return `PRIVATE_DB_AGENT_A2A_V1\n${stableStringify(envelope)}`;
}

function buildA2aHeaders({ method, path, payload, idempotencyKey = null }) {
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(12).toString('hex');
  const correlationId = `smoke_${randomUUID()}`;
  const payloadHash = hashPayload(payload || {});

  const signingMessage = buildA2aSigningMessage({
    agentId: a2aAgentId,
    method,
    path,
    timestamp,
    nonce,
    correlationId,
    idempotencyKey,
    payloadHash
  });

  const signature = createHmac('sha256', a2aSharedSecret)
    .update(signingMessage)
    .digest('hex');

  return {
    accept: 'application/json',
    'x-agent-id': a2aAgentId,
    'x-agent-timestamp': timestamp,
    'x-agent-nonce': nonce,
    'x-agent-signature': signature,
    'x-correlation-id': correlationId,
    ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {})
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = {
      raw: text
    };
  }

  return {
    status: response.status,
    ok: response.ok,
    body
  };
}

function createCheckResult({ name, pass, details = {} }) {
  return {
    name,
    pass: Boolean(pass),
    ...details
  };
}

async function assertEndpoint({ name, url, options = {}, expectedStatus = 200 }) {
  const response = await fetchJson(url, options);
  const pass = response.status === expectedStatus;

  return {
    response,
    check: createCheckResult({
      name,
      pass,
      details: {
        expectedStatus,
        actualStatus: response.status,
        code: response.body?.code || response.body?.error || null
      }
    })
  };
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function runDemoAcceptanceMatrix() {
  const demoScriptPath = fileURLToPath(new URL('./demo-smoke.mjs', import.meta.url));
  const execution = spawnSync(process.execPath, [demoScriptPath, baseUrl], {
    encoding: 'utf-8',
    env: process.env
  });

  if (execution.error) {
    throw execution.error;
  }

  const summary = parseJsonOutput(execution.stdout);
  if (!summary) {
    throw new Error(
      `Unable to parse demo-smoke output. status=${execution.status}; stderr=${String(execution.stderr || '').trim()}`
    );
  }

  const matrixChecks = Array.isArray(summary.matrix) ? summary.matrix : [];
  const checks = matrixChecks.map((entry) =>
    createCheckResult({
      name: `demo-matrix:${entry.id || 'unknown'}`,
      pass: Boolean(entry.pass),
      details: {
        expectedStatus: entry.expectedStatus ?? null,
        actualStatus: entry.actualStatus ?? null,
        code: entry.code || null
      }
    })
  );

  const failedCount =
    typeof summary.totals?.failed === 'number' ? summary.totals.failed : matrixChecks.filter((entry) => !entry.pass).length;
  checks.push(
    createCheckResult({
      name: 'demo-matrix:overall',
      pass: failedCount === 0 && execution.status === 0,
      details: {
        expectedStatus: 0,
        actualStatus: execution.status ?? null,
        code: failedCount === 0 ? 'PASS' : 'FAIL',
        matrixChecks: matrixChecks.length,
        matrixFailed: failedCount
      }
    })
  );

  return {
    checks,
    summary,
    exitStatus: execution.status ?? null
  };
}

async function runA2aFlow(queryInputPayload) {
  const checks = [];
  const pathCreate = '/v1/a2a/tasks';
  const pathList = '/v1/a2a/tasks';
  const idempotencyKey = `idem_${randomUUID()}`;

  const createPayload = {
    taskType: 'query.execute',
    input: queryInputPayload
  };

  const createResponse = await fetchJson(`${baseUrl}${pathCreate}`, {
    method: 'POST',
    headers: {
      ...buildA2aHeaders({
        method: 'POST',
        path: pathCreate,
        payload: createPayload,
        idempotencyKey
      }),
      'content-type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  });

  const createPass =
    createResponse.status === 202 &&
    createResponse.body?.code === 'A2A_TASK_ACCEPTED' &&
    typeof createResponse.body?.task?.taskId === 'string';

  checks.push(
    createCheckResult({
      name: 'a2a:create-task',
      pass: createPass,
      details: {
        expectedStatus: 202,
        actualStatus: createResponse.status,
        code: createResponse.body?.code || createResponse.body?.error || null
      }
    })
  );

  const taskId = createResponse.body?.task?.taskId || null;

  const replayResponse = await fetchJson(`${baseUrl}${pathCreate}`, {
    method: 'POST',
    headers: {
      ...buildA2aHeaders({
        method: 'POST',
        path: pathCreate,
        payload: createPayload,
        idempotencyKey
      }),
      'content-type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  });

  checks.push(
    createCheckResult({
      name: 'a2a:idempotent-replay',
      pass: replayResponse.status === 200 && replayResponse.body?.code === 'A2A_TASK_REPLAY',
      details: {
        expectedStatus: 200,
        actualStatus: replayResponse.status,
        code: replayResponse.body?.code || replayResponse.body?.error || null
      }
    })
  );

  const conflictPayload = {
    taskType: 'query.execute',
    input: {
      ...queryInputPayload,
      requestId: `${queryInputPayload.requestId || 'req'}_conflict`
    }
  };

  const conflictResponse = await fetchJson(`${baseUrl}${pathCreate}`, {
    method: 'POST',
    headers: {
      ...buildA2aHeaders({
        method: 'POST',
        path: pathCreate,
        payload: conflictPayload,
        idempotencyKey
      }),
      'content-type': 'application/json'
    },
    body: JSON.stringify(conflictPayload)
  });

  checks.push(
    createCheckResult({
      name: 'a2a:idempotency-conflict',
      pass:
        conflictResponse.status === 409 &&
        conflictResponse.body?.error === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
      details: {
        expectedStatus: 409,
        actualStatus: conflictResponse.status,
        code: conflictResponse.body?.code || conflictResponse.body?.error || null
      }
    })
  );

  if (taskId) {
    const pathGet = `/v1/a2a/tasks/${encodeURIComponent(taskId)}`;
    const getResponse = await fetchJson(`${baseUrl}${pathGet}`, {
      method: 'GET',
      headers: buildA2aHeaders({
        method: 'GET',
        path: `/v1/a2a/tasks/${taskId}`,
        payload: {},
        idempotencyKey: null
      })
    });

    checks.push(
      createCheckResult({
        name: 'a2a:get-task',
        pass: getResponse.status === 200 && getResponse.body?.task?.taskId === taskId,
        details: {
          expectedStatus: 200,
          actualStatus: getResponse.status,
          code: getResponse.body?.code || getResponse.body?.error || null
        }
      })
    );
  } else {
    checks.push(
      createCheckResult({
        name: 'a2a:get-task',
        pass: false,
        details: {
          expectedStatus: 200,
          actualStatus: null,
          code: 'TASK_ID_MISSING'
        }
      })
    );
  }

  const listResponse = await fetchJson(`${baseUrl}${pathList}?limit=10`, {
    method: 'GET',
    headers: buildA2aHeaders({
      method: 'GET',
      path: pathList,
      payload: {},
      idempotencyKey: null
    })
  });

  checks.push(
    createCheckResult({
      name: 'a2a:list-tasks',
      pass: listResponse.status === 200 && Array.isArray(listResponse.body?.tasks),
      details: {
        expectedStatus: 200,
        actualStatus: listResponse.status,
        code: listResponse.body?.code || listResponse.body?.error || null,
        taskCount: Array.isArray(listResponse.body?.tasks) ? listResponse.body.tasks.length : 0
      }
    })
  );

  return {
    checks,
    taskId
  };
}

async function main() {
  const checks = [];

  const health = await assertEndpoint({
    name: 'health',
    url: `${baseUrl}/health`,
    expectedStatus: 200
  });
  checks.push(health.check);

  const runtimeAttestation = await assertEndpoint({
    name: 'runtime-attestation',
    url: `${baseUrl}/v1/runtime/attestation`,
    expectedStatus: 200
  });
  checks.push(runtimeAttestation.check);

  const agentCard = await assertEndpoint({
    name: 'agent-card',
    url: `${baseUrl}/.well-known/agent-card.json`,
    expectedStatus: 200
  });
  checks.push(agentCard.check);

  const contracts = await assertEndpoint({
    name: 'a2a-contracts',
    url: `${baseUrl}/v1/a2a/contracts`,
    expectedStatus: 200
  });
  checks.push(contracts.check);

  const demo = await runDemoAcceptanceMatrix();
  checks.push(...demo.checks);

  const allowPayloadResponse = await fetchJson(
    `${baseUrl}/v1/demo/payload?scenario=${encodeURIComponent('allow-balance-read')}`
  );
  if (!allowPayloadResponse.ok) {
    throw new Error(
      `Failed to build allow-balance-read payload (${allowPayloadResponse.status}): ${JSON.stringify(allowPayloadResponse.body)}`
    );
  }

  const a2aFlow = await runA2aFlow(allowPayloadResponse.body.payload);
  checks.push(...a2aFlow.checks);

  const metrics = await assertEndpoint({
    name: 'ops-metrics',
    url: `${baseUrl}/v1/ops/metrics`,
    expectedStatus: 200
  });
  checks.push(metrics.check);

  const passCount = checks.filter((entry) => entry.pass).length;
  const failCount = checks.length - passCount;

  const summary = {
    baseUrl,
    a2aAgentId,
    runtime: {
      verified: Boolean(runtimeAttestation.response.body?.runtime?.verified),
      verificationStatus: runtimeAttestation.response.body?.runtime?.verificationStatus || null,
      claimsHash: runtimeAttestation.response.body?.runtime?.claimsHash || null
    },
    checks,
    demoMatrix: {
      tenantId: demo.summary?.tenantId || null,
      totals: demo.summary?.totals || null,
      matrix: Array.isArray(demo.summary?.matrix) ? demo.summary.matrix : []
    },
    metricsSnapshot: {
      counters: metrics.response.body?.metrics?.counters?.length || 0,
      durations: metrics.response.body?.metrics?.durations?.length || 0
    },
    totals: {
      checks: checks.length,
      pass: passCount,
      fail: failCount
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
