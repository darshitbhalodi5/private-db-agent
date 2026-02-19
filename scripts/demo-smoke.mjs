import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';

const baseUrl = process.argv[2] || 'http://localhost:8080';

const POLICY_SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_POLICY_MUTATION_V1';
const QUERY_SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_AUTH_V1';

const runNonce = (
  process.env.DEMO_SMOKE_RUN_NONCE ||
  randomUUID().replace(/-/g, '').slice(0, 10)
).toLowerCase();

const tenantId = (
  process.env.DEMO_SMOKE_TENANT_ID || `tenant_g6_${runNonce}`
).toLowerCase();

const databaseName = `g6db${runNonce.slice(0, 6)}`;
const inventoryItemId = `item_${runNonce.slice(0, 8)}`;

let requestCounter = 0;

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

function derivePrivateKey(seed) {
  return `0x${createHash('sha256').update(seed).digest('hex')}`;
}

function createWallet(seed) {
  return new Wallet(derivePrivateKey(seed));
}

function nextRequestId(label) {
  requestCounter += 1;
  return `g6_${label}_${String(requestCounter).padStart(4, '0')}`;
}

function createNonce() {
  return randomBytes(12).toString('hex');
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

function buildPolicyMutationMessage({
  requestId,
  tenantId,
  actorWallet,
  action,
  payload,
  nonce,
  signedAt
}) {
  const envelope = {
    requestId,
    tenantId,
    actorWallet,
    action,
    payload: payload || {},
    nonce,
    signedAt
  };

  return `${POLICY_SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

function buildQuerySignedMessage({
  requestId,
  tenantId,
  requester,
  capability,
  queryTemplate,
  queryParams,
  nonce,
  signedAt
}) {
  const envelope = {
    requestId,
    tenantId,
    requester,
    capability,
    queryTemplate,
    queryParams: queryParams || {},
    nonce,
    signedAt
  };

  return `${QUERY_SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

async function signPolicyAction({ wallet, requestId, tenantId, action, payload }) {
  const actorWallet = wallet.address.toLowerCase();
  const nonce = createNonce();
  const signedAt = new Date().toISOString();
  const signingMessage = buildPolicyMutationMessage({
    requestId,
    tenantId,
    actorWallet,
    action,
    payload,
    nonce,
    signedAt
  });
  const signature = await wallet.signMessage(signingMessage);

  return {
    actorWallet,
    auth: {
      nonce,
      signedAt,
      signature
    }
  };
}

async function signQueryAction({
  wallet,
  requestId,
  tenantId,
  capability,
  queryTemplate,
  queryParams
}) {
  const requester = wallet.address;
  const nonce = createNonce();
  const signedAt = new Date().toISOString();
  const signingMessage = buildQuerySignedMessage({
    requestId,
    tenantId,
    requester,
    capability,
    queryTemplate,
    queryParams,
    nonce,
    signedAt
  });
  const signature = await wallet.signMessage(signingMessage);

  return {
    requester,
    auth: {
      nonce,
      signedAt,
      signature
    }
  };
}

function evaluateEnvelope(body, expectedDecision = null) {
  const issues = [];
  const decision = body?.decision;
  const receipt = body?.receipt;
  const runtimeStatus = receipt?.verification?.runtime?.verification?.status;
  const audit = body?.audit;

  if (!decision || typeof decision !== 'object') {
    issues.push('decision envelope missing.');
  }

  if (expectedDecision && decision?.outcome !== expectedDecision) {
    issues.push(`decision.outcome expected '${expectedDecision}' but got '${decision?.outcome}'.`);
  }

  if (!receipt || typeof receipt !== 'object') {
    issues.push('receipt envelope missing.');
  } else {
    if (typeof receipt.requestHash !== 'string' || receipt.requestHash.length === 0) {
      issues.push('receipt.requestHash missing.');
    }
    if (typeof receipt.decisionHash !== 'string' || receipt.decisionHash.length === 0) {
      issues.push('receipt.decisionHash missing.');
    }
    if (typeof receipt.verificationHash !== 'string' || receipt.verificationHash.length === 0) {
      issues.push('receipt.verificationHash missing.');
    }
    if (typeof runtimeStatus !== 'string' || runtimeStatus.length === 0) {
      issues.push('receipt verification runtime status missing.');
    }
  }

  if (!audit || typeof audit !== 'object' || typeof audit.logged !== 'boolean') {
    issues.push('audit envelope missing or invalid.');
  }

  return {
    ok: issues.length === 0,
    issues,
    decisionOutcome: decision?.outcome || null,
    decisionCode: decision?.code || null,
    receiptId: receipt?.receiptId || null,
    requestHash: receipt?.requestHash || null,
    decisionHash: receipt?.decisionHash || null,
    verificationHash: receipt?.verificationHash || null,
    runtimeStatus: runtimeStatus || null,
    auditLogged: typeof audit?.logged === 'boolean' ? audit.logged : null
  };
}

function toScenarioRecord({
  id,
  name,
  response,
  expectedStatus,
  expectedDecision = null,
  extraIssues = [],
  extra = {}
}) {
  const envelope = evaluateEnvelope(response.body, expectedDecision);
  const issues = [...envelope.issues, ...extraIssues];
  const pass = response.status === expectedStatus && issues.length === 0;

  return {
    id,
    name,
    pass,
    expectedStatus,
    actualStatus: response.status,
    expectedDecision,
    actualDecision: envelope.decisionOutcome,
    code: response.body?.code || response.body?.error || null,
    receiptId: envelope.receiptId,
    requestHash: envelope.requestHash,
    decisionHash: envelope.decisionHash,
    verificationHash: envelope.verificationHash,
    runtimeStatus: envelope.runtimeStatus,
    auditLogged: envelope.auditLogged,
    issues,
    ...extra
  };
}

async function createPolicyGrant({ actorWallet, grant }) {
  const requestId = nextRequestId('grant_create');
  const signing = await signPolicyAction({
    wallet: actorWallet,
    requestId,
    tenantId,
    action: 'grant:create',
    payload: grant
  });

  return fetchJson(`${baseUrl}/v1/policy/grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      requestId,
      tenantId,
      actorWallet: signing.actorWallet,
      grant,
      auth: signing.auth
    })
  });
}

async function applySchema({ actorWallet, payload }) {
  const signing = await signPolicyAction({
    wallet: actorWallet,
    requestId: payload.requestId,
    tenantId,
    action: 'schema:apply',
    payload: {
      database: payload.database || null,
      tables: Array.isArray(payload.tables) ? payload.tables : []
    }
  });

  return fetchJson(`${baseUrl}/v1/control-plane/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      actorWallet: signing.actorWallet,
      auth: signing.auth
    })
  });
}

async function executeDataAction({ actorWallet, operation, tableName, values, filters, columns, limit }) {
  const requestId = nextRequestId(`data_${operation}`);
  const actionPayload = {
    tableName,
    operation,
    values: values ?? null,
    filters: filters ?? null,
    columns: columns ?? null,
    limit: limit ?? null,
    agentOverride: null,
    bypassPolicy: null,
    skipAuth: null,
    executeAsAgent: null,
    superuser: null,
    trustedOperator: null
  };

  const signing = await signPolicyAction({
    wallet: actorWallet,
    requestId,
    tenantId,
    action: 'data:execute',
    payload: actionPayload
  });

  const requestPayload = {
    requestId,
    tenantId,
    actorWallet: signing.actorWallet,
    operation,
    tableName,
    auth: signing.auth
  };

  if (values !== undefined) {
    requestPayload.values = values;
  }
  if (filters !== undefined) {
    requestPayload.filters = filters;
  }
  if (columns !== undefined) {
    requestPayload.columns = columns;
  }
  if (limit !== undefined) {
    requestPayload.limit = limit;
  }

  return fetchJson(`${baseUrl}/v1/data/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestPayload)
  });
}

async function executeQueryAction({
  actorWallet,
  capability,
  queryTemplate,
  queryParams
}) {
  const requestId = nextRequestId('query');
  const signing = await signQueryAction({
    wallet: actorWallet,
    requestId,
    tenantId,
    capability,
    queryTemplate,
    queryParams
  });

  return fetchJson(`${baseUrl}/v1/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      requestId,
      tenantId,
      requester: signing.requester,
      capability,
      queryTemplate,
      queryParams,
      auth: signing.auth
    })
  });
}

async function createAiSchemaDraft({ actorWallet, prompt }) {
  return fetchJson(`${baseUrl}/v1/ai/schema-draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      requestId: nextRequestId('ai_schema_draft'),
      tenantId,
      actorWallet: actorWallet.address.toLowerCase(),
      prompt,
      context: {
        databaseName,
        engine: 'sqlite',
        description: 'G6 smoke AI schema draft',
        creatorWallet: actorWallet.address.toLowerCase(),
        chainId: 1,
        tableNames: ['inventory']
      }
    })
  });
}

async function approveAiDraft({ actorWallet, draftId, draftHash }) {
  const requestId = nextRequestId('ai_approve');
  const signing = await signPolicyAction({
    wallet: actorWallet,
    requestId,
    tenantId,
    action: 'ai:draft:approve',
    payload: {
      draftId,
      draftHash
    }
  });

  return fetchJson(`${baseUrl}/v1/ai/approve-draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      requestId,
      tenantId,
      draftId,
      draftHash,
      actorWallet: signing.actorWallet,
      auth: signing.auth
    })
  });
}

async function setupTenant({ adminWallet, managerWallet }) {
  const setupResults = [];

  const bootstrapGrant = {
    walletAddress: adminWallet.address.toLowerCase(),
    scopeType: 'database',
    scopeId: '*',
    operation: 'all',
    effect: 'allow'
  };
  const bootstrapResponse = await createPolicyGrant({
    actorWallet: adminWallet,
    grant: bootstrapGrant
  });
  setupResults.push({
    step: 'bootstrap-grant',
    status: bootstrapResponse.status,
    code: bootstrapResponse.body?.code || bootstrapResponse.body?.error || null
  });
  if (bootstrapResponse.status !== 201) {
    throw new Error(
      `Bootstrap grant failed (${bootstrapResponse.status}): ${JSON.stringify(bootstrapResponse.body)}`
    );
  }

  const initialSchemaPayload = {
    requestId: nextRequestId('schema_apply_base'),
    tenantId,
    creator: {
      walletAddress: adminWallet.address.toLowerCase(),
      chainId: 1
    },
    database: {
      name: databaseName,
      engine: 'sqlite',
      description: 'G6 matrix setup'
    },
    tables: [
      {
        name: 'inventory',
        fields: [
          {
            name: 'item_id',
            type: 'text',
            primaryKey: true,
            nullable: false
          },
          {
            name: 'quantity',
            type: 'integer',
            nullable: false
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            nullable: false
          }
        ]
      }
    ]
  };
  const schemaApplyResponse = await applySchema({
    actorWallet: adminWallet,
    payload: initialSchemaPayload
  });
  setupResults.push({
    step: 'schema-apply-base',
    status: schemaApplyResponse.status,
    code: schemaApplyResponse.body?.code || schemaApplyResponse.body?.error || null
  });
  if (schemaApplyResponse.status !== 201) {
    throw new Error(
      `Base schema apply failed (${schemaApplyResponse.status}): ${JSON.stringify(schemaApplyResponse.body)}`
    );
  }

  const managerInsertGrant = {
    walletAddress: managerWallet.address.toLowerCase(),
    scopeType: 'table',
    scopeId: 'inventory',
    operation: 'insert',
    effect: 'allow'
  };
  const managerGrantResponse = await createPolicyGrant({
    actorWallet: adminWallet,
    grant: managerInsertGrant
  });
  setupResults.push({
    step: 'manager-insert-grant',
    status: managerGrantResponse.status,
    code: managerGrantResponse.body?.code || managerGrantResponse.body?.error || null
  });
  if (managerGrantResponse.status !== 201) {
    throw new Error(
      `Manager insert grant failed (${managerGrantResponse.status}): ${JSON.stringify(managerGrantResponse.body)}`
    );
  }

  return setupResults;
}

async function main() {
  const adminWallet = createWallet('g6-admin-wallet');
  const managerWallet = createWallet('g6-manager-wallet');
  const unknownWallet = createWallet('g6-unknown-wallet');

  const health = await fetchJson(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed (${health.status}): ${JSON.stringify(health.body)}`);
  }

  const runtimeAttestation = await fetchJson(`${baseUrl}/v1/runtime/attestation`);
  if (!runtimeAttestation.ok) {
    throw new Error(
      `Runtime attestation failed (${runtimeAttestation.status}): ${JSON.stringify(runtimeAttestation.body)}`
    );
  }

  const setup = await setupTenant({
    adminWallet,
    managerWallet
  });

  const actionScenarios = [];

  const managerInsertResponse = await executeDataAction({
    actorWallet: managerWallet,
    operation: 'insert',
    tableName: 'inventory',
    values: {
      item_id: inventoryItemId,
      quantity: 1,
      updated_at: new Date().toISOString()
    }
  });
  const managerInsertScenario = toScenarioRecord({
    id: 'allowed-insert-table-wallet',
    name: 'Allowed insert on permitted table wallet',
    response: managerInsertResponse,
    expectedStatus: 200,
    expectedDecision: 'allow'
  });
  actionScenarios.push(managerInsertScenario);

  const managerDeleteResponse = await executeDataAction({
    actorWallet: managerWallet,
    operation: 'delete',
    tableName: 'inventory',
    filters: {
      item_id: inventoryItemId
    }
  });
  const managerDeleteScenario = toScenarioRecord({
    id: 'denied-delete-without-grant',
    name: 'Denied delete for wallet without delete grant',
    response: managerDeleteResponse,
    expectedStatus: 403,
    expectedDecision: 'deny'
  });
  actionScenarios.push(managerDeleteScenario);

  const unknownQueryResponse = await executeQueryAction({
    actorWallet: unknownWallet,
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: adminWallet.address.toLowerCase(),
      chainId: 1,
      limit: 1
    }
  });
  const unknownScenario = toScenarioRecord({
    id: 'denied-unknown-wallet',
    name: 'Denied access for unknown wallet',
    response: unknownQueryResponse,
    expectedStatus: 403,
    expectedDecision: 'deny'
  });
  actionScenarios.push(unknownScenario);

  const adminDeleteResponse = await executeDataAction({
    actorWallet: adminWallet,
    operation: 'delete',
    tableName: 'inventory',
    filters: {
      item_id: inventoryItemId
    }
  });
  const adminDeleteScenario = toScenarioRecord({
    id: 'allowed-admin-db-all',
    name: 'Allowed admin action via DB-level all grant',
    response: adminDeleteResponse,
    expectedStatus: 200,
    expectedDecision: 'allow'
  });
  actionScenarios.push(adminDeleteScenario);

  const aiDraftResponse = await createAiSchemaDraft({
    actorWallet: adminWallet,
    prompt: 'Create inventory and inventory_audit tables with operational tracking.'
  });

  const draftId = aiDraftResponse.body?.draft?.draftId || null;
  const draftHash = aiDraftResponse.body?.draft?.draftHash || null;
  const submissionPayload = aiDraftResponse.body?.submissionPayload || null;

  const aiDraftStepPass =
    aiDraftResponse.status === 200 &&
    typeof draftId === 'string' &&
    draftId.length > 0 &&
    typeof draftHash === 'string' &&
    draftHash.length > 0 &&
    submissionPayload &&
    typeof submissionPayload === 'object' &&
    aiDraftResponse.body?.approval?.required === true;

  let applyWithoutApprovalScenario = {
    id: 'ai-apply-without-approval',
    name: 'AI schema apply denied without approval metadata',
    pass: false,
    expectedStatus: 403,
    actualStatus: null,
    expectedDecision: 'deny',
    actualDecision: null,
    code: null,
    issues: ['AI draft did not provide required fields.']
  };

  let aiApproveScenario = {
    id: 'ai-draft-approval',
    name: 'AI draft approval succeeds with signed actor request',
    pass: false,
    expectedStatus: 201,
    actualStatus: null,
    expectedDecision: 'allow',
    actualDecision: null,
    code: null,
    issues: ['AI draft approval not attempted because draft setup failed.']
  };

  let applyWithApprovalScenario = {
    id: 'ai-apply-with-approval',
    name: 'AI schema apply succeeds after approval',
    pass: false,
    expectedStatus: 201,
    actualStatus: null,
    expectedDecision: 'allow',
    actualDecision: null,
    code: null,
    issues: ['AI approved apply not attempted because approval setup failed.']
  };

  if (aiDraftStepPass) {
    const applyWithoutApprovalPayload = {
      ...submissionPayload,
      requestId: nextRequestId('ai_apply_denied'),
      tenantId,
      aiAssist: {
        source: 'eigen-ai',
        draftId,
        draftHash
      }
    };

    const applyWithoutApprovalResponse = await applySchema({
      actorWallet: adminWallet,
      payload: applyWithoutApprovalPayload
    });
    applyWithoutApprovalScenario = toScenarioRecord({
      id: 'ai-apply-without-approval',
      name: 'AI schema apply denied without approval metadata',
      response: applyWithoutApprovalResponse,
      expectedStatus: 403,
      expectedDecision: 'deny'
    });

    const aiApproveResponse = await approveAiDraft({
      actorWallet: adminWallet,
      draftId,
      draftHash
    });
    aiApproveScenario = toScenarioRecord({
      id: 'ai-draft-approval',
      name: 'AI draft approval succeeds with signed actor request',
      response: aiApproveResponse,
      expectedStatus: 201,
      expectedDecision: 'allow'
    });

    const approvalId = aiApproveResponse.body?.aiAssist?.approvalId || null;
    const approvedBy = aiApproveResponse.body?.aiAssist?.approvedBy || null;
    const canApplyWithApproval =
      typeof approvalId === 'string' &&
      approvalId.length > 0 &&
      typeof approvedBy === 'string' &&
      approvedBy.length > 0;

    if (canApplyWithApproval) {
      const applyWithApprovalPayload = {
        ...submissionPayload,
        requestId: nextRequestId('ai_apply_allowed'),
        tenantId,
        aiAssist: {
          source: 'eigen-ai',
          draftId,
          draftHash,
          approvalId,
          approvedBy
        }
      };

      const applyWithApprovalResponse = await applySchema({
        actorWallet: adminWallet,
        payload: applyWithApprovalPayload
      });
      applyWithApprovalScenario = toScenarioRecord({
        id: 'ai-apply-with-approval',
        name: 'AI schema apply succeeds after approval',
        response: applyWithApprovalResponse,
        expectedStatus: 201,
        expectedDecision: 'allow'
      });
    } else {
      applyWithApprovalScenario = {
        ...applyWithApprovalScenario,
        actualStatus: aiApproveResponse.status,
        code: aiApproveResponse.body?.code || aiApproveResponse.body?.error || null,
        issues: [
          'AI approval response missing approvalId or approvedBy.',
          `aiDraftApprovalPass=${String(aiApproveScenario.pass)}`
        ]
      };
    }
  } else {
    applyWithoutApprovalScenario = {
      ...applyWithoutApprovalScenario,
      actualStatus: aiDraftResponse.status,
      code: aiDraftResponse.body?.code || aiDraftResponse.body?.error || null,
      issues: [
        'AI schema draft did not return draftId/draftHash/submissionPayload.',
        `status=${aiDraftResponse.status}`
      ]
    };
    aiApproveScenario = {
      ...aiApproveScenario,
      actualStatus: aiDraftResponse.status,
      code: aiDraftResponse.body?.code || aiDraftResponse.body?.error || null
    };
    applyWithApprovalScenario = {
      ...applyWithApprovalScenario,
      actualStatus: aiDraftResponse.status,
      code: aiDraftResponse.body?.code || aiDraftResponse.body?.error || null
    };
  }

  actionScenarios.push(applyWithoutApprovalScenario);
  actionScenarios.push(aiApproveScenario);
  actionScenarios.push(applyWithApprovalScenario);

  const aiMatrixScenario = {
    id: 'ai-schema-requires-approval',
    name: 'AI-generated schema accepted only after validation + approval',
    pass:
      aiDraftStepPass &&
      applyWithoutApprovalScenario.pass &&
      aiApproveScenario.pass &&
      applyWithApprovalScenario.pass,
    expected:
      'draft=200 with approval.required=true, apply_without_approval=403, approve=201, apply_with_approval=201',
    actual: {
      draftStatus: aiDraftResponse.status,
      draftCode: aiDraftResponse.body?.code || aiDraftResponse.body?.error || null,
      applyWithoutApproval: {
        status: applyWithoutApprovalScenario.actualStatus,
        code: applyWithoutApprovalScenario.code
      },
      approve: {
        status: aiApproveScenario.actualStatus,
        code: aiApproveScenario.code
      },
      applyWithApproval: {
        status: applyWithApprovalScenario.actualStatus,
        code: applyWithApprovalScenario.code
      }
    },
    issues: [
      ...(aiDraftStepPass ? [] : ['AI schema draft response invalid.']),
      ...(!applyWithoutApprovalScenario.pass
        ? ['Unapproved AI apply did not fail as expected.']
        : []),
      ...(!aiApproveScenario.pass ? ['AI approval action did not pass.'] : []),
      ...(!applyWithApprovalScenario.pass ? ['Approved AI apply did not pass.'] : [])
    ]
  };

  const receiptCoverageTargets = actionScenarios.filter((entry) => entry.receiptId !== undefined);
  const receiptCoverageScenario = {
    id: 'receipt-metadata-coverage',
    name: 'Receipts include decision + verification metadata for each action',
    pass: receiptCoverageTargets.every((entry) => entry.pass),
    expected: 'All action responses include decision, receipt hashes, runtime verification status, and audit.',
    actual: {
      totalActions: receiptCoverageTargets.length,
      passedActions: receiptCoverageTargets.filter((entry) => entry.pass).length
    },
    issues: receiptCoverageTargets
      .filter((entry) => !entry.pass)
      .map((entry) => `${entry.id} failed envelope/status checks.`)
  };

  const matrix = [
    managerInsertScenario,
    managerDeleteScenario,
    unknownScenario,
    adminDeleteScenario,
    aiMatrixScenario,
    receiptCoverageScenario
  ];

  const failed = matrix.filter((entry) => !entry.pass);

  const summary = {
    baseUrl,
    tenantId,
    databaseName,
    runNonce,
    wallets: {
      admin: adminWallet.address.toLowerCase(),
      manager: managerWallet.address.toLowerCase(),
      unknown: unknownWallet.address.toLowerCase()
    },
    runtime: {
      verified: Boolean(runtimeAttestation.body?.runtime?.verified),
      verificationStatus: runtimeAttestation.body?.runtime?.verificationStatus || null,
      claimsHash: runtimeAttestation.body?.runtime?.claimsHash || null
    },
    setup,
    matrix,
    actionScenarios,
    totals: {
      checks: matrix.length,
      failed: failed.length
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
