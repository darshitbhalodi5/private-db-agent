import { createHash, randomUUID } from 'node:crypto';
import { Wallet, verifyMessage } from 'ethers';
import {
  OPERATION_TYPES,
  SCOPE_TYPES,
  WALLET_ADDRESS_PATTERN
} from '@eigen-private-db-agent/shared-types';
import { loadConfig } from '../config.js';
import { createDatabaseAdapter } from '../db/databaseAdapterFactory.js';
import {
  attachActionResponseEnvelope,
  createNoopAuditService
} from './actionResponseEnvelopeService.js';
import { createAiDraftStore } from './aiDraftStore.js';
import { createAuditService } from './auditService.js';
import {
  buildPolicyMutationMessage,
  createPolicyMutationAuthService
} from './policyMutationAuthService.js';
import { createReceiptService } from './receiptService.js';
import { validateAndCompileSchemaDsl } from './schemaDslService.js';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const walletRegex = new RegExp(WALLET_ADDRESS_PATTERN);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTenantId(rawTenantId) {
  if (!isNonEmptyString(rawTenantId)) {
    return null;
  }

  const normalized = rawTenantId.trim().toLowerCase();
  return TENANT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeWalletAddress(rawWalletAddress) {
  if (!isNonEmptyString(rawWalletAddress)) {
    return null;
  }

  const normalized = rawWalletAddress.trim().toLowerCase();
  return walletRegex.test(normalized) ? normalized : null;
}

function normalizeIdentifier(rawValue, fallbackValue) {
  const candidate = isNonEmptyString(rawValue) ? rawValue.trim().toLowerCase() : fallbackValue;
  return IDENTIFIER_PATTERN.test(candidate) ? candidate : fallbackValue;
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
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
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function buildAiDraftSigningMessage(envelope) {
  return `EIGEN_AI_DRAFT_V1\n${stableStringify(envelope)}`;
}

function getAiSignerWallet(aiConfig) {
  if (!isNonEmptyString(aiConfig?.signerPrivateKey)) {
    throw new Error('AI signer private key is required.');
  }

  return new Wallet(aiConfig.signerPrivateKey);
}

function resolveExpectedSignerAddress({ aiConfig, signerWallet }) {
  const configured = normalizeWalletAddress(aiConfig?.signerAddress);
  return configured || signerWallet.address.toLowerCase();
}

async function signAndVerifyDraftEnvelope({ envelope, aiConfig }) {
  const signerWallet = getAiSignerWallet(aiConfig);
  const expectedSignerAddress = resolveExpectedSignerAddress({ aiConfig, signerWallet });
  const signingMessage = buildAiDraftSigningMessage(envelope);
  const signature = await signerWallet.signMessage(signingMessage);
  const recoveredSignerAddress = verifyMessage(signingMessage, signature).toLowerCase();
  const verified = recoveredSignerAddress === expectedSignerAddress;

  if (!verified) {
    return {
      ok: false,
      error: {
        error: 'AI_SIGNATURE_VERIFICATION_FAILED',
        message: 'AI draft signature verification failed.',
        details: {
          expectedSignerAddress,
          recoveredSignerAddress
        }
      }
    };
  }

  return {
    ok: true,
    signature,
    signerAddress: expectedSignerAddress,
    verification: {
      verified: true,
      expectedSignerAddress,
      recoveredSignerAddress
    }
  };
}

function createDefaultTableDraft(prompt, { databaseName }) {
  const normalizedPrompt = String(prompt || '').toLowerCase();

  if (normalizedPrompt.includes('inventory')) {
    return [
      {
        name: 'inventory',
        fields: [
          { name: 'item_id', type: 'text', primaryKey: true, nullable: false },
          { name: 'quantity', type: 'integer', nullable: false },
          { name: 'updated_at', type: 'timestamp', nullable: false }
        ]
      },
      {
        name: 'inventory_audit',
        fields: [
          { name: 'event_id', type: 'text', primaryKey: true, nullable: false },
          { name: 'item_id', type: 'text', nullable: false },
          { name: 'event_payload', type: 'jsonb', nullable: true }
        ]
      }
    ];
  }

  const baseTableName = normalizeIdentifier(`${databaseName}_records`, 'workspace_records');
  return [
    {
      name: baseTableName,
      fields: [
        { name: 'record_id', type: 'text', primaryKey: true, nullable: false },
        { name: 'name', type: 'text', nullable: false },
        { name: 'created_at', type: 'timestamp', nullable: false }
      ]
    }
  ];
}

function createDefaultPolicyDraft({ prompt, tableNames = [], actorWallet }) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  const wantsReadOnly = normalizedPrompt.includes('read-only');
  const operation = wantsReadOnly ? 'read' : 'all';
  const grants = [];

  for (const tableName of tableNames) {
    grants.push({
      walletAddress: actorWallet,
      scopeType: 'table',
      scopeId: tableName,
      operation,
      effect: 'allow'
    });
  }

  if (tableNames.length === 0) {
    grants.push({
      walletAddress: actorWallet,
      scopeType: 'database',
      scopeId: '*',
      operation,
      effect: 'allow'
    });
  }

  return grants;
}

function safeResponseError(statusCode, error, message, details = null) {
  return {
    statusCode,
    body: {
      error,
      message,
      ...(details ? { details } : {})
    }
  };
}

function normalizeRequestHeaders(rawHeaders) {
  if (!isObject(rawHeaders)) {
    return {};
  }

  const normalized = {};
  for (const [headerName, headerValue] of Object.entries(rawHeaders)) {
    if (!isNonEmptyString(headerName)) {
      continue;
    }
    if (headerValue === null || headerValue === undefined) {
      continue;
    }
    normalized[headerName.trim()] = String(headerValue);
  }

  return normalized;
}

function resolveProviderEndpoint(baseUrl, endpointPath) {
  if (!isNonEmptyString(baseUrl)) {
    return null;
  }

  const normalizedPath = isNonEmptyString(endpointPath) ? endpointPath.trim() : '/';
  try {
    return new URL(normalizedPath, baseUrl.trim()).toString();
  } catch {
    return null;
  }
}

function extractProviderDraft(responseBody) {
  const candidates = [
    responseBody?.draft,
    responseBody?.result,
    responseBody?.output,
    responseBody?.data,
    responseBody
  ];

  for (const candidate of candidates) {
    if (isObject(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeProviderSchemaSubmissionPayload({
  payload,
  tenantId,
  actorWallet,
  requestId,
  providerDraft
}) {
  const context = isObject(payload?.context) ? payload.context : {};
  const databaseName = normalizeIdentifier(context.databaseName, 'workspace');
  const databaseEngine =
    context.engine === 'postgres' || context.engine === 'sqlite' ? context.engine : 'sqlite';
  const creatorWallet = normalizeWalletAddress(context.creatorWallet) || actorWallet;
  const chainId =
    typeof context.chainId === 'number' && Number.isInteger(context.chainId) ? context.chainId : null;
  const description = isNonEmptyString(context.description) ? context.description.trim() : null;

  const providerSubmission = isObject(providerDraft?.submissionPayload)
    ? providerDraft.submissionPayload
    : null;
  const providerTables = Array.isArray(providerSubmission?.tables)
    ? providerSubmission.tables
    : Array.isArray(providerDraft?.tables)
      ? providerDraft.tables
      : null;

  if (!Array.isArray(providerTables) || providerTables.length === 0) {
    return {
      ok: false,
      error: safeResponseError(
        422,
        'AI_PROVIDER_RESPONSE_INVALID',
        'Eigen AI schema draft response did not include tables.',
        {
          expected: 'submissionPayload.tables or tables[]'
        }
      )
    };
  }

  const providerDatabase = isObject(providerSubmission?.database)
    ? providerSubmission.database
    : isObject(providerDraft?.database)
      ? providerDraft.database
      : {};
  const providerCreator = isObject(providerSubmission?.creator)
    ? providerSubmission.creator
    : isObject(providerDraft?.creator)
      ? providerDraft.creator
      : {};
  const providerGrants = Array.isArray(providerSubmission?.grants)
    ? providerSubmission.grants
    : Array.isArray(providerDraft?.grants)
      ? providerDraft.grants
      : [];

  return {
    ok: true,
    value: {
      tenantId,
      requestId,
      actorWallet,
      creator: {
        walletAddress: normalizeWalletAddress(providerCreator.walletAddress) || creatorWallet,
        chainId:
          typeof providerCreator.chainId === 'number' && Number.isInteger(providerCreator.chainId)
            ? providerCreator.chainId
            : chainId
      },
      database: {
        name: normalizeIdentifier(providerDatabase.name, databaseName),
        engine:
          providerDatabase.engine === 'postgres' || providerDatabase.engine === 'sqlite'
            ? providerDatabase.engine
            : databaseEngine,
        description: isNonEmptyString(providerDatabase.description)
          ? providerDatabase.description.trim()
          : description
      },
      tables: providerTables,
      grants: providerGrants
    }
  };
}

function normalizeProviderPolicyGrants(providerDraft) {
  if (Array.isArray(providerDraft?.grants)) {
    return providerDraft.grants;
  }

  if (Array.isArray(providerDraft?.policy?.grants)) {
    return providerDraft.policy.grants;
  }

  return null;
}

async function parseProviderResponseBody(response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {
      raw
    };
  }
}

function buildProviderHeaders(aiConfig) {
  const requestHeaders = normalizeRequestHeaders(aiConfig.requestHeaders);
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...requestHeaders
  };

  if (isNonEmptyString(aiConfig.apiKey)) {
    headers.authorization = `Bearer ${aiConfig.apiKey.trim()}`;
  }

  return headers;
}

function buildProviderRequestPayload({
  draftType,
  requestId,
  tenantId,
  actorWallet,
  prompt,
  context,
  model
}) {
  return {
    requestId,
    draftType,
    tenantId,
    actorWallet,
    prompt,
    context: isObject(context) ? context : {},
    model
  };
}

async function requestProviderDraft({
  aiConfig,
  draftType,
  requestId,
  tenantId,
  actorWallet,
  prompt,
  context,
  fetchImpl
}) {
  if (aiConfig.provider !== 'eigen') {
    return {
      ok: false,
      error: safeResponseError(500, 'AI_PROVIDER_UNSUPPORTED', `Unsupported AI provider '${aiConfig.provider}'.`)
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      error: safeResponseError(503, 'AI_PROVIDER_UNAVAILABLE', 'Fetch implementation is not available.')
    };
  }

  if (!isNonEmptyString(aiConfig.apiKey)) {
    return {
      ok: false,
      error: safeResponseError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'AI_API_KEY is required for AI_PROVIDER=eigen.')
    };
  }

  const endpoint = resolveProviderEndpoint(
    aiConfig.baseUrl,
    draftType === 'schema' ? aiConfig.schemaDraftPath : aiConfig.policyDraftPath
  );
  if (!endpoint) {
    return {
      ok: false,
      error: safeResponseError(
        503,
        'AI_PROVIDER_NOT_CONFIGURED',
        `Invalid provider endpoint for ${draftType} draft. Configure AI_BASE_URL and path envs.`
      )
    };
  }

  const headers = buildProviderHeaders(aiConfig);
  const requestPayload = buildProviderRequestPayload({
    draftType,
    requestId,
    tenantId,
    actorWallet,
    prompt,
    context,
    model: aiConfig.model
  });
  const timeoutMs =
    Number.isInteger(aiConfig.requestTimeoutMs) && aiConfig.requestTimeoutMs > 0
      ? aiConfig.requestTimeoutMs
      : 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        error: safeResponseError(504, 'AI_PROVIDER_TIMEOUT', `Eigen AI request timed out after ${timeoutMs}ms.`)
      };
    }

    return {
      ok: false,
      error: safeResponseError(
        503,
        'AI_PROVIDER_UNREACHABLE',
        error?.message || 'Failed to reach Eigen AI provider.'
      )
    };
  }
  clearTimeout(timer);

  const responseBody = await parseProviderResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      error: safeResponseError(
        502,
        'AI_PROVIDER_HTTP_ERROR',
        `Eigen AI provider responded with HTTP ${response.status}.`,
        {
          providerStatus: response.status,
          providerBody:
            isObject(responseBody) && typeof responseBody.raw === 'undefined' ? responseBody : null
        }
      )
    };
  }

  const draft = extractProviderDraft(responseBody);
  if (!draft) {
    return {
      ok: false,
      error: safeResponseError(
        502,
        'AI_PROVIDER_RESPONSE_INVALID',
        'Eigen AI response body is not a valid JSON object.'
      )
    };
  }

  return {
    ok: true,
    draft,
    metadata: {
      endpoint,
      providerStatus: response.status
    }
  };
}

function validatePolicyGrants(grants) {
  if (!Array.isArray(grants) || grants.length === 0) {
    return {
      ok: false,
      issues: [
        {
          path: 'grants',
          code: 'required',
          message: 'grants must be a non-empty array.'
        }
      ]
    };
  }

  const issues = [];
  const normalized = [];

  grants.forEach((grant, index) => {
    if (!isObject(grant)) {
      issues.push({
        path: `grants[${index}]`,
        code: 'invalid_type',
        message: 'Grant must be an object.'
      });
      return;
    }

    const walletAddress = normalizeWalletAddress(grant.walletAddress);
    if (!walletAddress) {
      issues.push({
        path: `grants[${index}].walletAddress`,
        code: 'invalid_wallet',
        message: 'walletAddress must be a valid EVM address.'
      });
    }

    const scopeType = String(grant.scopeType || '').trim().toLowerCase();
    if (!SCOPE_TYPES.includes(scopeType)) {
      issues.push({
        path: `grants[${index}].scopeType`,
        code: 'invalid_scope_type',
        message: `scopeType must be one of: ${SCOPE_TYPES.join(', ')}.`
      });
    }

    const scopeId =
      scopeType === 'database'
        ? '*'
        : normalizeIdentifier(grant.scopeId, '');
    if (scopeType === 'table' && !isNonEmptyString(scopeId)) {
      issues.push({
        path: `grants[${index}].scopeId`,
        code: 'invalid_scope_id',
        message: 'scopeId is required for table scope.'
      });
    }

    const operation = String(grant.operation || '').trim().toLowerCase();
    if (!OPERATION_TYPES.includes(operation)) {
      issues.push({
        path: `grants[${index}].operation`,
        code: 'invalid_operation',
        message: `operation must be one of: ${OPERATION_TYPES.join(', ')}.`
      });
    }

    const effect = String(grant.effect || '').trim().toLowerCase();
    if (!['allow', 'deny'].includes(effect)) {
      issues.push({
        path: `grants[${index}].effect`,
        code: 'invalid_effect',
        message: 'effect must be one of: allow, deny.'
      });
    }

    if (issues.length === 0) {
      normalized.push({
        walletAddress,
        scopeType,
        scopeId,
        operation,
        effect
      });
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    normalized
  };
}

export function createEigenAiService({
  aiConfig,
  aiDraftStore,
  mutationAuthService,
  now = () => new Date().toISOString(),
  fetchImpl = globalThis.fetch
}) {
  if (!aiDraftStore) {
    throw new Error('aiDraftStore is required.');
  }

  if (!mutationAuthService) {
    throw new Error('mutationAuthService is required.');
  }

  async function createSchemaDraft(payload) {
    if (!aiConfig?.enabled) {
      return {
        statusCode: 503,
        body: {
          error: 'AI_DISABLED',
          message: 'AI draft service is disabled.'
        }
      };
    }

    const tenantId = normalizeTenantId(payload?.tenantId);
    const actorWallet = normalizeWalletAddress(payload?.actorWallet);
    const prompt = isNonEmptyString(payload?.prompt) ? payload.prompt.trim() : null;
    const requestId = isNonEmptyString(payload?.requestId) ? payload.requestId.trim() : null;

    if (!tenantId || !actorWallet || !prompt || !requestId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'tenantId, actorWallet, prompt, and requestId are required.'
        }
      };
    }

    const context = isObject(payload.context) ? payload.context : {};
    let submissionPayload;
    let providerMetadata = null;
    if (aiConfig.provider === 'eigen') {
      const providerResponse = await requestProviderDraft({
        aiConfig,
        draftType: 'schema',
        requestId,
        tenantId,
        actorWallet,
        prompt,
        context,
        fetchImpl
      });
      if (!providerResponse.ok) {
        return providerResponse.error;
      }

      const normalizedSubmission = normalizeProviderSchemaSubmissionPayload({
        payload,
        tenantId,
        actorWallet,
        requestId,
        providerDraft: providerResponse.draft
      });
      if (!normalizedSubmission.ok) {
        return normalizedSubmission.error;
      }

      submissionPayload = normalizedSubmission.value;
      providerMetadata = providerResponse.metadata;
    } else {
      const databaseName = normalizeIdentifier(context.databaseName, 'workspace');
      const databaseEngine =
        context.engine === 'postgres' || context.engine === 'sqlite' ? context.engine : 'sqlite';
      submissionPayload = {
        tenantId,
        requestId,
        actorWallet,
        creator: {
          walletAddress: normalizeWalletAddress(context.creatorWallet) || actorWallet,
          chainId:
            typeof context.chainId === 'number' && Number.isInteger(context.chainId)
              ? context.chainId
              : null
        },
        database: {
          name: databaseName,
          engine: databaseEngine,
          description: isNonEmptyString(context.description) ? context.description.trim() : null
        },
        tables: createDefaultTableDraft(prompt, { databaseName }),
        grants: []
      };
    }

    const schemaDslResult = validateAndCompileSchemaDsl(submissionPayload);
    if (!schemaDslResult.ok) {
      return {
        statusCode: 422,
        body: {
          error: 'AI_DRAFT_INVALID',
          message: 'AI-generated schema draft did not pass DSL validation.',
          details: schemaDslResult.error?.details || null
        }
      };
    }

    const issuedAt = now();
    const envelope = {
      responseId: randomUUID(),
      draftType: 'schema',
      tenantId,
      prompt,
      submissionPayload,
      migrationPlan: schemaDslResult.migrationPlan,
      provider: aiConfig.provider,
      model: aiConfig.model,
      issuedAt,
      providerMetadata
    };

    const signatureResult = await signAndVerifyDraftEnvelope({
      envelope,
      aiConfig
    });
    if (!signatureResult.ok) {
      return {
        statusCode: 500,
        body: signatureResult.error
      };
    }

    const draftHash = hashPayload(envelope);
    const draftRecord = await aiDraftStore.createDraft({
      tenantId,
      draftType: 'schema',
      prompt,
      draftHash,
      planHash: schemaDslResult.migrationPlan.planHash,
      payload: envelope,
      provider: aiConfig.provider,
      model: aiConfig.model,
      signerAddress: signatureResult.signerAddress,
      signature: signatureResult.signature,
      issuedAt,
      createdAt: issuedAt
    });

    return {
      statusCode: 200,
      body: {
        code: 'AI_SCHEMA_DRAFT_READY',
        draft: {
          draftId: draftRecord.draftId,
          draftHash,
          draftType: 'schema',
          issuedAt,
          provider: aiConfig.provider,
          model: aiConfig.model,
          signerAddress: signatureResult.signerAddress,
          signature: signatureResult.signature,
          verification: signatureResult.verification,
          planHash: schemaDslResult.migrationPlan.planHash,
          providerMetadata
        },
        submissionPayload,
        migrationPlan: schemaDslResult.migrationPlan,
        approval: {
          required: true,
          action: 'ai:draft:approve'
        }
      }
    };
  }

  async function createPolicyDraft(payload) {
    if (!aiConfig?.enabled) {
      return {
        statusCode: 503,
        body: {
          error: 'AI_DISABLED',
          message: 'AI draft service is disabled.'
        }
      };
    }

    const tenantId = normalizeTenantId(payload?.tenantId);
    const actorWallet = normalizeWalletAddress(payload?.actorWallet);
    const prompt = isNonEmptyString(payload?.prompt) ? payload.prompt.trim() : null;
    const requestId = isNonEmptyString(payload?.requestId) ? payload.requestId.trim() : null;

    if (!tenantId || !actorWallet || !prompt || !requestId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'tenantId, actorWallet, prompt, and requestId are required.'
        }
      };
    }

    const tableNames = Array.isArray(payload?.context?.tableNames)
      ? payload.context.tableNames
          .map((tableName) => normalizeIdentifier(tableName, ''))
          .filter((tableName) => isNonEmptyString(tableName))
      : [];
    let grants;
    let providerMetadata = null;
    if (aiConfig.provider === 'eigen') {
      const providerResponse = await requestProviderDraft({
        aiConfig,
        draftType: 'policy',
        requestId,
        tenantId,
        actorWallet,
        prompt,
        context: payload?.context,
        fetchImpl
      });
      if (!providerResponse.ok) {
        return providerResponse.error;
      }

      grants = normalizeProviderPolicyGrants(providerResponse.draft);
      providerMetadata = providerResponse.metadata;
      if (!Array.isArray(grants) || grants.length === 0) {
        return safeResponseError(
          422,
          'AI_PROVIDER_RESPONSE_INVALID',
          'Eigen AI policy draft response did not include grants.',
          {
            expected: 'grants[]'
          }
        );
      }
    } else {
      grants = createDefaultPolicyDraft({
        prompt,
        tableNames,
        actorWallet
      });
    }

    const grantValidation = validatePolicyGrants(grants);
    if (!grantValidation.ok) {
      return {
        statusCode: 422,
        body: {
          error: 'AI_POLICY_DRAFT_INVALID',
          message: 'AI-generated policy draft did not pass validation.',
          details: {
            issues: grantValidation.issues
          }
        }
      };
    }

    const issuedAt = now();
    const envelope = {
      responseId: randomUUID(),
      draftType: 'policy',
      tenantId,
      prompt,
      requestId,
      grants: grantValidation.normalized,
      provider: aiConfig.provider,
      model: aiConfig.model,
      issuedAt,
      providerMetadata
    };

    const signatureResult = await signAndVerifyDraftEnvelope({
      envelope,
      aiConfig
    });
    if (!signatureResult.ok) {
      return {
        statusCode: 500,
        body: signatureResult.error
      };
    }

    const draftHash = hashPayload(envelope);
    const draftRecord = await aiDraftStore.createDraft({
      tenantId,
      draftType: 'policy',
      prompt,
      draftHash,
      planHash: null,
      payload: envelope,
      provider: aiConfig.provider,
      model: aiConfig.model,
      signerAddress: signatureResult.signerAddress,
      signature: signatureResult.signature,
      issuedAt,
      createdAt: issuedAt
    });

    return {
      statusCode: 200,
      body: {
        code: 'AI_POLICY_DRAFT_READY',
        draft: {
          draftId: draftRecord.draftId,
          draftHash,
          draftType: 'policy',
          issuedAt,
          provider: aiConfig.provider,
          model: aiConfig.model,
          signerAddress: signatureResult.signerAddress,
          signature: signatureResult.signature,
          verification: signatureResult.verification,
          providerMetadata
        },
        grants: grantValidation.normalized,
        approval: {
          required: true,
          action: 'ai:draft:approve'
        }
      }
    };
  }

  async function approveDraft(payload) {
    const tenantId = normalizeTenantId(payload?.tenantId);
    const draftId = isNonEmptyString(payload?.draftId) ? payload.draftId.trim() : null;
    const draftHash = isNonEmptyString(payload?.draftHash) ? payload.draftHash.trim() : null;
    const actorWallet = normalizeWalletAddress(payload?.actorWallet);
    const requestId = isNonEmptyString(payload?.requestId) ? payload.requestId.trim() : null;

    if (!tenantId || !draftId || !draftHash || !actorWallet || !requestId) {
      return {
        statusCode: 400,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'tenantId, draftId, draftHash, actorWallet, and requestId are required.'
        }
      };
    }

    const draft = await aiDraftStore.getDraft({
      tenantId,
      draftId
    });

    if (!draft) {
      return {
        statusCode: 404,
        body: {
          error: 'AI_DRAFT_NOT_FOUND',
          message: 'AI draft not found for tenant.'
        }
      };
    }

    if (draft.draftHash !== draftHash) {
      return {
        statusCode: 409,
        body: {
          error: 'AI_DRAFT_HASH_MISMATCH',
          message: 'draftHash does not match persisted AI draft.'
        }
      };
    }

    const authResult = await mutationAuthService.authenticate({
      requestId,
      tenantId,
      actorWallet,
      action: 'ai:draft:approve',
      payload: {
        draftId,
        draftHash
      },
      auth: payload.auth
    });

    if (!authResult.ok) {
      return {
        statusCode: authResult.statusCode || 401,
        body: {
          error: authResult.code || 'AUTHENTICATION_FAILED',
          message: authResult.message || 'Authentication failed.'
        }
      };
    }

    const approvedAt = now();
    const approval = await aiDraftStore.createApproval({
      tenantId,
      draftId,
      draftHash,
      approvedBy: authResult.actorWallet,
      approvedAt,
      signatureHash: authResult.signatureHash
    });

    return {
      statusCode: 201,
      body: {
        code: 'AI_DRAFT_APPROVED',
        message: 'AI draft approved for execution.',
        approval,
        aiAssist: {
          source: 'eigen-ai',
          draftId,
          draftHash,
          approvalId: approval.approvalId,
          approvedBy: approval.approvedBy
        }
      }
    };
  }

  return {
    createSchemaDraft,
    createPolicyDraft,
    approveDraft
  };
}

const runtimeConfig = loadConfig();
const runtimeMetadata = {
  serviceName: runtimeConfig.serviceName,
  version: runtimeConfig.version,
  nodeEnv: runtimeConfig.nodeEnv
};
const defaultReceiptService = createReceiptService(runtimeConfig.proof, runtimeMetadata);
const defaultAuditService = createNoopAuditService();
let runtimeEigenAiServicePromise = null;

async function buildRuntimeEigenAiService() {
  const databaseAdapter = await createDatabaseAdapter(runtimeConfig.database);
  const aiDraftStore = createAiDraftStore({ databaseAdapter });
  await aiDraftStore.ensureInitialized();

  return {
    service: createEigenAiService({
      aiConfig: runtimeConfig.ai,
      aiDraftStore,
      mutationAuthService: createPolicyMutationAuthService({
        ...runtimeConfig.auth,
        enabled: true
      })
    }),
    databaseDialect: databaseAdapter.dialect || 'unknown',
    receiptService: defaultReceiptService,
    auditService: createAuditService({ databaseAdapter })
  };
}

async function getRuntimeEigenAiService() {
  if (!runtimeEigenAiServicePromise) {
    runtimeEigenAiServicePromise = buildRuntimeEigenAiService().catch((error) => {
      runtimeEigenAiServicePromise = null;
      throw error;
    });
  }

  return runtimeEigenAiServicePromise;
}

function serviceUnavailable(message) {
  return {
    statusCode: 503,
    body: {
      error: 'SERVICE_UNAVAILABLE',
      message: message || 'Eigen AI service unavailable.'
    }
  };
}

async function attachAiApproveEnvelope({
  payload,
  result,
  databaseDialect = 'unknown',
  receiptService = defaultReceiptService,
  auditService = defaultAuditService
}) {
  return attachActionResponseEnvelope({
    payload,
    result,
    auth: {
      ok: Number.isInteger(result?.statusCode) ? result.statusCode < 400 : false,
      requester: payload?.actorWallet || result?.body?.approval?.approvedBy || null,
      code: result?.body?.error || result?.body?.code || null
    },
    policy: null,
    execution: {
      ok: Number.isInteger(result?.statusCode) ? result.statusCode < 400 : false,
      code: result?.body?.code || result?.body?.error || null,
      data: {
        rowCount: result?.body?.approval ? 1 : 0,
        rows: result?.body?.approval ? [result.body.approval] : []
      }
    },
    runtimeVerification: null,
    auditContext: {
      action: 'ai:draft:approve',
      resource: payload?.draftId || null,
      requester: payload?.actorWallet || result?.body?.approval?.approvedBy || null
    },
    receiptService,
    auditService,
    databaseDialect
  });
}

export async function handleAiSchemaDraftRequest(payload, overrides = null) {
  try {
    const runtimeContext =
      overrides?.eigenAiService ? { service: overrides.eigenAiService } : await getRuntimeEigenAiService();
    return runtimeContext.service.createSchemaDraft(payload);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleAiPolicyDraftRequest(payload, overrides = null) {
  try {
    const runtimeContext =
      overrides?.eigenAiService ? { service: overrides.eigenAiService } : await getRuntimeEigenAiService();
    return runtimeContext.service.createPolicyDraft(payload);
  } catch (error) {
    return serviceUnavailable(error?.message);
  }
}

export async function handleAiApproveDraftRequest(payload, overrides = null) {
  try {
    if (overrides?.eigenAiService) {
      const result = await overrides.eigenAiService.approveDraft(payload);
      return attachAiApproveEnvelope({
        payload,
        result,
        databaseDialect: overrides.databaseDialect || 'unknown',
        receiptService: overrides.receiptService || defaultReceiptService,
        auditService: overrides.auditService || defaultAuditService
      });
    }

    const runtimeContext = await getRuntimeEigenAiService();
    const result = await runtimeContext.service.approveDraft(payload);
    return attachAiApproveEnvelope({
      payload,
      result,
      databaseDialect: runtimeContext.databaseDialect,
      receiptService: runtimeContext.receiptService,
      auditService: runtimeContext.auditService
    });
  } catch (error) {
    return attachAiApproveEnvelope({
      payload,
      result: serviceUnavailable(error?.message),
      databaseDialect: overrides?.databaseDialect || 'unknown',
      receiptService: overrides?.receiptService || defaultReceiptService,
      auditService: overrides?.auditService || defaultAuditService
    });
  }
}

export { buildAiDraftSigningMessage, buildPolicyMutationMessage };
