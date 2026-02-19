'use client';

import { useEffect, useMemo, useState } from 'react';

const DB_ENGINES = ['postgres', 'sqlite'];
const FIELD_TYPES = ['text', 'integer', 'numeric', 'boolean', 'timestamp', 'jsonb'];
const OPERATIONS = ['all', 'read', 'insert', 'update', 'delete', 'alter'];
const DATA_ACTION_OPERATIONS = ['read', 'insert', 'update', 'delete'];
const QUERY_CAPABILITIES = ['balances:read', 'transactions:read', 'audit:read'];
const QUERY_TEMPLATES = [
  'wallet_balances',
  'wallet_positions',
  'wallet_transactions',
  'access_log_recent',
  'policy_denies_recent'
];
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_POLICY_MUTATION_V1';
const QUERY_SIGNING_CONTEXT = 'PRIVATE_DB_AGENT_AUTH_V1';

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createPermissionInputs() {
  return OPERATIONS.reduce((accumulator, operation) => {
    accumulator[operation] = '';
    return accumulator;
  }, {});
}

function createField() {
  return {
    id: makeId('field'),
    name: '',
    type: 'text',
    nullable: true,
    primaryKey: false
  };
}

function createTable(index) {
  return {
    id: makeId('table'),
    name: `table_${index}`,
    fields: [createField()],
    permissionInputs: createPermissionInputs()
  };
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeWalletAddress(value) {
  return value.toLowerCase();
}

function parseWalletInput(rawValue) {
  const tokens = String(rawValue || '')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const validSet = new Set();
  const invalid = [];

  for (const token of tokens) {
    if (isWalletAddress(token)) {
      validSet.add(normalizeWalletAddress(token));
      continue;
    }

    invalid.push(token);
  }

  return {
    valid: [...validSet],
    invalid
  };
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

  return `${SIGNING_CONTEXT}\n${stableStringify(envelope)}`;
}

function buildSubmitActionPayload(payload) {
  return {
    creator: payload.creator || null,
    database: payload.database || null,
    tables: Array.isArray(payload.tables) ? payload.tables : [],
    grants: Array.isArray(payload.grants) ? payload.grants : [],
    aiAssist: payload.aiAssist || null,
    metadata: payload.metadata || null
  };
}

function buildApplyActionPayload(payload) {
  return {
    database: payload.database || null,
    tables: Array.isArray(payload.tables) ? payload.tables : []
  };
}

function buildApproveDraftActionPayload({ draftId, draftHash }) {
  return {
    draftId,
    draftHash
  };
}

function buildDataExecuteActionPayload(payload) {
  return {
    tableName: payload.tableName || null,
    operation: payload.operation || null,
    values: payload.values || null,
    filters: payload.filters || null,
    columns: payload.columns || null,
    limit: payload.limit ?? null,
    agentOverride: null,
    bypassPolicy: null,
    skipAuth: null,
    executeAsAgent: null,
    superuser: null,
    trustedOperator: null
  };
}

function buildGrantCreateActionPayload(grant) {
  return {
    walletAddress: grant.walletAddress || null,
    scopeType: grant.scopeType || null,
    scopeId: grant.scopeId || null,
    operation: grant.operation || null,
    effect: grant.effect || null
  };
}

function buildGrantRevokeActionPayload({ grantId, expectedSignatureHash = null }) {
  return {
    grantId,
    expectedSignatureHash: expectedSignatureHash || null
  };
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

function parseJsonInput(rawValue, label) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return {
      ok: true,
      value: null
    };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      ok: true,
      value: parsed
    };
  } catch {
    return {
      ok: false,
      error: `${label} must be valid JSON.`
    };
  }
}

function isObjectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapForwardedBody(body) {
  if (body && typeof body === 'object' && body.upstreamBody && typeof body.upstreamBody === 'object') {
    return body.upstreamBody;
  }

  return body;
}

function normalizeEnvelopeBody(body) {
  const unwrapped = unwrapForwardedBody(body);
  if (unwrapped && typeof unwrapped === 'object') {
    return unwrapped;
  }

  return {};
}

function deriveRuntimeVerificationStatus(body) {
  const receiptStatus = body?.receipt?.verification?.runtime?.verification?.status;
  if (typeof receiptStatus === 'string' && receiptStatus.trim().length > 0) {
    return receiptStatus;
  }

  const runtimeStatus = body?.runtime?.verificationStatus || body?.runtime?.verification?.status;
  if (typeof runtimeStatus === 'string' && runtimeStatus.trim().length > 0) {
    return runtimeStatus;
  }

  return 'unknown';
}

function deriveRuntimeVerified(body) {
  const receiptVerified = body?.receipt?.verification?.runtime?.verification?.verified;
  if (typeof receiptVerified === 'boolean') {
    return receiptVerified;
  }

  const runtimeVerified = body?.runtime?.verified;
  if (typeof runtimeVerified === 'boolean') {
    return runtimeVerified;
  }

  return null;
}

function createNonce() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return makeId('nonce');
}

function buildPayloadDraft({
  requestId,
  tenantId,
  creator,
  databaseName,
  databaseEngine,
  description,
  universalWallets,
  databasePermissionInputs,
  tables,
  aiPrompt
}) {
  const issues = [];
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();

  if (!normalizedTenantId) {
    issues.push('Tenant ID is required.');
  } else if (!TENANT_ID_PATTERN.test(normalizedTenantId)) {
    issues.push('Tenant ID must match [a-z0-9][a-z0-9_-]{0,62}.');
  }

  const creatorWallet = creator.address.trim();
  if (!creatorWallet) {
    issues.push('Connect creator wallet before submitting.');
  } else if (!isWalletAddress(creatorWallet)) {
    issues.push('Connected wallet address format is invalid.');
  }

  const dbName = databaseName.trim();
  if (!dbName) {
    issues.push('Database name is required.');
  }

  const normalizedUniversalWallets = [];
  universalWallets.forEach((row, index) => {
    const address = row.address.trim();
    const label = row.label.trim();

    if (!address && !label) {
      return;
    }

    if (!address) {
      issues.push(`Universal wallet row ${index + 1} is missing address.`);
      return;
    }

    if (!isWalletAddress(address)) {
      issues.push(`Universal wallet row ${index + 1} has invalid address: ${address}`);
      return;
    }

    normalizedUniversalWallets.push({
      walletAddress: normalizeWalletAddress(address),
      label: label || null
    });
  });

  const grants = [];
  const databasePermissions = {};

  OPERATIONS.forEach((operation) => {
    const parsed = parseWalletInput(databasePermissionInputs[operation]);
    if (parsed.invalid.length > 0) {
      issues.push(
        `Database ${operation} permission has invalid wallet(s): ${parsed.invalid.join(', ')}`
      );
    }

    databasePermissions[operation] = parsed.valid;
    parsed.valid.forEach((walletAddress) => {
      grants.push({
        walletAddress,
        scopeType: 'database',
        scopeId: '*',
        operation,
        effect: 'allow'
      });
    });
  });

  if (!Array.isArray(tables) || tables.length === 0) {
    issues.push('At least one table is required.');
  }

  const normalizedTables = (tables || []).map((table, tableIndex) => {
    const tableName = table.name.trim();
    if (!tableName) {
      issues.push(`Table ${tableIndex + 1} is missing table name.`);
    }

    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      issues.push(`Table ${tableIndex + 1} must contain at least one field.`);
    }

    const fields = (table.fields || []).map((field, fieldIndex) => {
      const fieldName = field.name.trim();
      if (!fieldName) {
        issues.push(`Table ${tableIndex + 1} field ${fieldIndex + 1} is missing field name.`);
      }

      return {
        name: fieldName,
        type: FIELD_TYPES.includes(field.type) ? field.type : 'text',
        nullable: field.primaryKey ? false : Boolean(field.nullable),
        primaryKey: Boolean(field.primaryKey)
      };
    });

    const permissions = {};
    OPERATIONS.forEach((operation) => {
      const parsed = parseWalletInput(table.permissionInputs[operation]);
      if (parsed.invalid.length > 0) {
        issues.push(
          `Table ${tableName || tableIndex + 1} ${operation} permission has invalid wallet(s): ${parsed.invalid.join(', ')}`
        );
      }

      permissions[operation] = parsed.valid;
      parsed.valid.forEach((walletAddress) => {
        grants.push({
          walletAddress,
          scopeType: 'table',
          scopeId: tableName || `table_${tableIndex + 1}`,
          operation,
          effect: 'allow'
        });
      });
    });

    return {
      tableId: table.id,
      name: tableName,
      fields,
      permissions
    };
  });

  const deduplicatedGrants = [];
  const grantKeys = new Set();

  for (const grant of grants) {
    const key = [
      grant.walletAddress,
      grant.scopeType,
      grant.scopeId,
      grant.operation,
      grant.effect
    ].join('|');

    if (grantKeys.has(key)) {
      continue;
    }

    grantKeys.add(key);
    deduplicatedGrants.push(grant);
  }

  return {
    issues,
    payload: {
      requestId,
      tenantId: normalizedTenantId || null,
      actorWallet: creatorWallet ? normalizeWalletAddress(creatorWallet) : null,
      requestedAt: new Date().toISOString(),
      creator: {
        walletAddress: creatorWallet ? normalizeWalletAddress(creatorWallet) : null,
        chainId: Number.isInteger(creator.chainId) ? creator.chainId : null
      },
      database: {
        name: dbName,
        engine: databaseEngine,
        description: description.trim() || null,
        universalWallets: normalizedUniversalWallets,
        permissions: databasePermissions
      },
      tables: normalizedTables,
      grants: deduplicatedGrants,
      aiAssist: aiPrompt.trim() ? { prompt: aiPrompt.trim() } : null,
      metadata: {
        source: 'web-control-plane',
        version: '0.1.0'
      }
    }
  };
}

function formatAddress(address) {
  if (!address) {
    return 'Not connected';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseChainId(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === 'number') {
    return Number.isInteger(rawValue) ? rawValue : null;
  }

  if (typeof rawValue === 'string' && rawValue.startsWith('0x')) {
    const parsed = Number.parseInt(rawValue, 16);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function HomePage() {
  const [requestId, setRequestId] = useState(() => makeId('req'));
  const [tenantId, setTenantId] = useState('tenant_demo');
  const [creator, setCreator] = useState({
    address: '',
    chainId: null
  });
  const [walletError, setWalletError] = useState('');

  const [databaseName, setDatabaseName] = useState('');
  const [databaseEngine, setDatabaseEngine] = useState('postgres');
  const [description, setDescription] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');

  const [universalWallets, setUniversalWallets] = useState([
    { id: makeId('wallet'), address: '', label: '' }
  ]);

  const [databasePermissionInputs, setDatabasePermissionInputs] = useState(
    createPermissionInputs()
  );

  const [tables, setTables] = useState([createTable(1)]);
  const [submission, setSubmission] = useState(null);
  const [submissionError, setSubmissionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [aiSchemaDraft, setAiSchemaDraft] = useState(null);
  const [aiPolicyDraft, setAiPolicyDraft] = useState(null);
  const [aiApproval, setAiApproval] = useState(null);
  const [aiError, setAiError] = useState('');
  const [isGeneratingSchemaDraft, setIsGeneratingSchemaDraft] = useState(false);
  const [isGeneratingPolicyDraft, setIsGeneratingPolicyDraft] = useState(false);
  const [isApprovingAiDraft, setIsApprovingAiDraft] = useState(false);
  const [queryCapability, setQueryCapability] = useState('balances:read');
  const [queryTemplate, setQueryTemplate] = useState('wallet_balances');
  const [queryParamsText, setQueryParamsText] = useState(
    JSON.stringify(
      {
        walletAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
        chainId: 1,
        limit: 25
      },
      null,
      2
    )
  );
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [dataOperation, setDataOperation] = useState('read');
  const [dataTableName, setDataTableName] = useState('inventory');
  const [dataValuesText, setDataValuesText] = useState(
    JSON.stringify(
      {
        item_id: 'item-1',
        quantity: 1
      },
      null,
      2
    )
  );
  const [dataFiltersText, setDataFiltersText] = useState(
    JSON.stringify(
      {
        item_id: 'item-1'
      },
      null,
      2
    )
  );
  const [dataColumnsText, setDataColumnsText] = useState(
    JSON.stringify(['item_id', 'quantity'], null, 2)
  );
  const [dataLimit, setDataLimit] = useState('25');
  const [isRunningDataAction, setIsRunningDataAction] = useState(false);
  const [policyGrantWallet, setPolicyGrantWallet] = useState('');
  const [policyGrantScopeType, setPolicyGrantScopeType] = useState('table');
  const [policyGrantScopeId, setPolicyGrantScopeId] = useState('inventory');
  const [policyGrantOperation, setPolicyGrantOperation] = useState('read');
  const [policyGrantEffect, setPolicyGrantEffect] = useState('allow');
  const [policyGrants, setPolicyGrants] = useState([]);
  const [selectedGrantId, setSelectedGrantId] = useState('');
  const [expectedGrantSignatureHash, setExpectedGrantSignatureHash] = useState('');
  const [isLoadingPolicyGrants, setIsLoadingPolicyGrants] = useState(false);
  const [isCreatingPolicyGrant, setIsCreatingPolicyGrant] = useState(false);
  const [isRevokingPolicyGrant, setIsRevokingPolicyGrant] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionHistory, setActionHistory] = useState([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum || !window.ethereum.on) {
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      const nextAddress = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : '';
      setCreator((previous) => ({
        ...previous,
        address: nextAddress
      }));
    };

    const handleChainChanged = (chainId) => {
      setCreator((previous) => ({
        ...previous,
        chainId: parseChainId(chainId)
      }));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      if (!window.ethereum.removeListener) {
        return;
      }

      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const draft = useMemo(
    () =>
      buildPayloadDraft({
        requestId,
        tenantId,
        creator,
        databaseName,
        databaseEngine,
        description,
        universalWallets,
        databasePermissionInputs,
        tables,
        aiPrompt
      }),
    [
      requestId,
      tenantId,
      creator,
      databaseName,
      databaseEngine,
      description,
      universalWallets,
      databasePermissionInputs,
      tables,
      aiPrompt
    ]
  );

  const canSubmit = draft.issues.length === 0;
  const aiSchemaDraftMetadata = aiSchemaDraft?.draft || null;
  const aiAssistRequired =
    typeof aiSchemaDraftMetadata?.draftId === 'string' &&
    aiSchemaDraftMetadata.draftId.length > 0 &&
    typeof aiSchemaDraftMetadata?.draftHash === 'string' &&
    aiSchemaDraftMetadata.draftHash.length > 0;
  const hasAiApproval =
    aiAssistRequired &&
    aiApproval?.aiAssist?.source === 'eigen-ai' &&
    aiApproval.aiAssist.draftId === aiSchemaDraftMetadata.draftId &&
    aiApproval.aiAssist.draftHash === aiSchemaDraftMetadata.draftHash &&
    typeof aiApproval.aiAssist.approvalId === 'string' &&
    aiApproval.aiAssist.approvalId.length > 0;
  const canApplySchema =
    canSubmit &&
    !isSubmitting &&
    !isApplying &&
    !isApprovingAiDraft &&
    (!aiAssistRequired || hasAiApproval);

  async function signPolicyAction({ action, payload, requestIdOverride = null }) {
    if (typeof window === 'undefined' || !window.ethereum?.request) {
      throw new Error('Wallet provider is required to sign this request.');
    }

    const signingWallet = creator.address.trim();
    const actorWallet = draft.payload.actorWallet;
    if (!signingWallet || !actorWallet) {
      throw new Error('Connect creator wallet before signing this action.');
    }

    if (!draft.payload.tenantId) {
      throw new Error('tenantId is required before signing this action.');
    }

    const requestIdForAction = requestIdOverride || draft.payload.requestId;
    const nonce = createNonce();
    const signedAt = new Date().toISOString();
    const signingMessage = buildPolicyMutationMessage({
      requestId: requestIdForAction,
      tenantId: draft.payload.tenantId,
      actorWallet,
      action,
      payload,
      nonce,
      signedAt
    });

    let signature;
    try {
      signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [signingMessage, signingWallet]
      });
    } catch {
      signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [signingWallet, signingMessage]
      });
    }

    return {
      actorWallet,
      requestId: requestIdForAction,
      auth: {
        nonce,
        signedAt,
        signature
      }
    };
  }

  async function signQueryAction({
    requestIdForAction,
    capability,
    queryTemplate,
    queryParams
  }) {
    if (typeof window === 'undefined' || !window.ethereum?.request) {
      throw new Error('Wallet provider is required to sign this request.');
    }

    const signingWallet = creator.address.trim();
    const requester = draft.payload.actorWallet;
    if (!signingWallet || !requester) {
      throw new Error('Connect creator wallet before signing query action.');
    }

    if (!draft.payload.tenantId) {
      throw new Error('tenantId is required before running query action.');
    }

    const nonce = createNonce();
    const signedAt = new Date().toISOString();
    const signingMessage = buildQuerySignedMessage({
      requestId: requestIdForAction,
      tenantId: draft.payload.tenantId,
      requester,
      capability,
      queryTemplate,
      queryParams,
      nonce,
      signedAt
    });

    let signature;
    try {
      signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [signingMessage, signingWallet]
      });
    } catch {
      signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [signingWallet, signingMessage]
      });
    }

    return {
      requester,
      auth: {
        nonce,
        signedAt,
        signature
      }
    };
  }

  function appendActionHistory({ actionType, label, statusCode, responseBody }) {
    const normalizedBody = normalizeEnvelopeBody(responseBody);
    const decision = isObjectValue(normalizedBody.decision) ? normalizedBody.decision : null;
    const receipt = isObjectValue(normalizedBody.receipt) ? normalizedBody.receipt : null;
    const audit = isObjectValue(normalizedBody.audit) ? normalizedBody.audit : null;
    const runtimeStatus = deriveRuntimeVerificationStatus(normalizedBody);
    const runtimeVerified = deriveRuntimeVerified(normalizedBody);

    setActionHistory((previous) =>
      [
        {
          id: makeId('action'),
          actionType,
          label,
          timestamp: new Date().toISOString(),
          requestId:
            normalizedBody.requestId ||
            normalizedBody.details?.requestId ||
            normalizedBody.submissionId ||
            null,
          statusCode,
          outcome:
            decision?.outcome ||
            (statusCode >= 200 && statusCode < 400 ? 'allow' : 'deny'),
          decisionCode: decision?.code || normalizedBody.code || normalizedBody.error || 'UNKNOWN',
          decisionMessage: decision?.message || normalizedBody.message || null,
          receiptId: receipt?.receiptId || null,
          requestHash: receipt?.requestHash || null,
          decisionHash: receipt?.decisionHash || null,
          verificationHash: receipt?.verificationHash || null,
          runtimeStatus,
          runtimeVerified,
          auditLogged: typeof audit?.logged === 'boolean' ? audit.logged : false,
          auditCode: audit?.code || null,
          body: normalizedBody
        },
        ...previous
      ].slice(0, 30)
    );
  }

  function getActionResponseMessage(responseBody, fallbackMessage) {
    const normalizedBody = normalizeEnvelopeBody(responseBody);

    if (typeof normalizedBody.message === 'string' && normalizedBody.message.trim().length > 0) {
      return normalizedBody.message;
    }

    if (typeof normalizedBody.error === 'string' && normalizedBody.error.trim().length > 0) {
      return normalizedBody.error;
    }

    return fallbackMessage;
  }

  function applySchemaDraftToBuilder(submissionPayload) {
    if (!submissionPayload || typeof submissionPayload !== 'object') {
      return;
    }

    if (submissionPayload.database && typeof submissionPayload.database === 'object') {
      if (typeof submissionPayload.database.name === 'string') {
        setDatabaseName(submissionPayload.database.name);
      }
      if (typeof submissionPayload.database.engine === 'string') {
        const nextEngine = DB_ENGINES.includes(submissionPayload.database.engine)
          ? submissionPayload.database.engine
          : 'postgres';
        setDatabaseEngine(nextEngine);
      }
      setDescription(
        typeof submissionPayload.database.description === 'string'
          ? submissionPayload.database.description
          : ''
      );
    }

    if (Array.isArray(submissionPayload.tables) && submissionPayload.tables.length > 0) {
      const nextTables = submissionPayload.tables.map((table, index) => ({
        id: makeId('table'),
        name:
          typeof table?.name === 'string' && table.name.trim().length > 0
            ? table.name.trim()
            : `table_${index + 1}`,
        fields:
          Array.isArray(table?.fields) && table.fields.length > 0
            ? table.fields.map((field, fieldIndex) => ({
                id: makeId('field'),
                name:
                  typeof field?.name === 'string' && field.name.trim().length > 0
                    ? field.name.trim()
                    : `field_${fieldIndex + 1}`,
                type: FIELD_TYPES.includes(field?.type) ? field.type : 'text',
                nullable: Boolean(field?.nullable),
                primaryKey: Boolean(field?.primaryKey)
              }))
            : [createField()],
        permissionInputs: createPermissionInputs()
      }));
      setTables(nextTables);
    }
  }

  async function generateAiSchemaDraft() {
    if (isGeneratingSchemaDraft || isGeneratingPolicyDraft || isApprovingAiDraft) {
      return;
    }

    if (!draft.payload.actorWallet) {
      setAiError('Connect creator wallet before generating an AI draft.');
      return;
    }

    if (!draft.payload.tenantId) {
      setAiError('Tenant ID is required before generating an AI draft.');
      return;
    }

    if (!aiPrompt.trim()) {
      setAiError('Provide an AI Help Prompt before requesting AI draft.');
      return;
    }

    setAiError('');
    setIsGeneratingSchemaDraft(true);

    try {
      const aiRequestId = makeId('req_ai_schema');
      const response = await fetch('/api/ai/schema-draft', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: aiRequestId,
          tenantId: draft.payload.tenantId,
          actorWallet: draft.payload.actorWallet,
          prompt: aiPrompt.trim(),
          context: {
            databaseName: databaseName.trim() || 'workspace',
            engine: databaseEngine,
            description: description.trim() || null,
            creatorWallet: draft.payload.actorWallet,
            chainId: creator.chainId,
            tableNames: draft.payload.tables
              .map((table) => table?.name)
              .filter((name) => typeof name === 'string' && name.trim().length > 0)
          }
        })
      });

      const body = await response.json().catch(() => null);
      const upstreamBody = unwrapForwardedBody(body);
      if (!response.ok) {
        throw new Error(
          upstreamBody?.message || upstreamBody?.error || body?.message || 'AI schema draft failed.'
        );
      }

      setAiSchemaDraft(upstreamBody);
      setAiApproval(null);
      applySchemaDraftToBuilder(upstreamBody?.submissionPayload || null);
    } catch (error) {
      setAiError(error?.message || 'AI schema draft failed.');
    } finally {
      setIsGeneratingSchemaDraft(false);
    }
  }

  async function generateAiPolicyDraft() {
    if (isGeneratingSchemaDraft || isGeneratingPolicyDraft || isApprovingAiDraft) {
      return;
    }

    if (!draft.payload.actorWallet) {
      setAiError('Connect creator wallet before generating an AI draft.');
      return;
    }

    if (!draft.payload.tenantId) {
      setAiError('Tenant ID is required before generating an AI draft.');
      return;
    }

    if (!aiPrompt.trim()) {
      setAiError('Provide an AI Help Prompt before requesting AI draft.');
      return;
    }

    setAiError('');
    setIsGeneratingPolicyDraft(true);

    try {
      const aiRequestId = makeId('req_ai_policy');
      const response = await fetch('/api/ai/policy-draft', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: aiRequestId,
          tenantId: draft.payload.tenantId,
          actorWallet: draft.payload.actorWallet,
          prompt: aiPrompt.trim(),
          context: {
            tableNames: draft.payload.tables
              .map((table) => table?.name)
              .filter((name) => typeof name === 'string' && name.trim().length > 0)
          }
        })
      });

      const body = await response.json().catch(() => null);
      const upstreamBody = unwrapForwardedBody(body);
      if (!response.ok) {
        throw new Error(
          upstreamBody?.message || upstreamBody?.error || body?.message || 'AI policy draft failed.'
        );
      }

      setAiPolicyDraft(upstreamBody);
    } catch (error) {
      setAiError(error?.message || 'AI policy draft failed.');
    } finally {
      setIsGeneratingPolicyDraft(false);
    }
  }

  async function approveAiSchemaDraft() {
    if (!aiAssistRequired || !aiSchemaDraftMetadata) {
      setAiError('Generate an AI schema draft before approval.');
      return;
    }

    if (isApprovingAiDraft || isGeneratingSchemaDraft || isGeneratingPolicyDraft) {
      return;
    }

    setAiError('');
    setIsApprovingAiDraft(true);

    try {
      const approvalRequestId = makeId('req_ai_approve');
      const signResult = await signPolicyAction({
        action: 'ai:draft:approve',
        payload: buildApproveDraftActionPayload({
          draftId: aiSchemaDraftMetadata.draftId,
          draftHash: aiSchemaDraftMetadata.draftHash
        }),
        requestIdOverride: approvalRequestId
      });

      const response = await fetch('/api/ai/approve-draft', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: approvalRequestId,
          tenantId: draft.payload.tenantId,
          draftId: aiSchemaDraftMetadata.draftId,
          draftHash: aiSchemaDraftMetadata.draftHash,
          actorWallet: signResult.actorWallet,
          auth: signResult.auth
        })
      });

      const body = await response.json().catch(() => null);
      const upstreamBody = unwrapForwardedBody(body);
      if (!response.ok) {
        throw new Error(
          upstreamBody?.message || upstreamBody?.error || body?.message || 'AI draft approval failed.'
        );
      }

      setAiApproval(upstreamBody);
    } catch (error) {
      setAiError(error?.message || 'AI draft approval failed.');
    } finally {
      setIsApprovingAiDraft(false);
    }
  }

  function resetAiAssistState() {
    setAiSchemaDraft(null);
    setAiPolicyDraft(null);
    setAiApproval(null);
    setAiError('');
  }

  async function connectWallet() {
    if (typeof window === 'undefined' || !window.ethereum || !window.ethereum.request) {
      setWalletError('No browser wallet found. Install MetaMask or another EIP-1193 wallet.');
      return;
    }

    setWalletError('');

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const chainIdRaw = await window.ethereum.request({ method: 'eth_chainId' });

      const address = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : '';
      setCreator({
        address,
        chainId: parseChainId(chainIdRaw)
      });
    } catch (error) {
      setWalletError(error?.message || 'Wallet connection failed.');
    }
  }

  function disconnectWallet() {
    setCreator({
      address: '',
      chainId: null
    });
    setWalletError('');
  }

  function updateUniversalWallet(id, key, value) {
    setUniversalWallets((previous) =>
      previous.map((wallet) => (wallet.id === id ? { ...wallet, [key]: value } : wallet))
    );
  }

  function addUniversalWalletRow() {
    setUniversalWallets((previous) => [...previous, { id: makeId('wallet'), address: '', label: '' }]);
  }

  function removeUniversalWalletRow(id) {
    setUniversalWallets((previous) => {
      if (previous.length === 1) {
        return [{ id: makeId('wallet'), address: '', label: '' }];
      }

      return previous.filter((wallet) => wallet.id !== id);
    });
  }

  function updateDatabasePermission(operation, value) {
    setDatabasePermissionInputs((previous) => ({
      ...previous,
      [operation]: value
    }));
  }

  function addTable() {
    setTables((previous) => [...previous, createTable(previous.length + 1)]);
  }

  function removeTable(tableId) {
    setTables((previous) => {
      if (previous.length === 1) {
        return [createTable(1)];
      }

      return previous.filter((table) => table.id !== tableId);
    });
  }

  function updateTable(tableId, key, value) {
    setTables((previous) =>
      previous.map((table) => (table.id === tableId ? { ...table, [key]: value } : table))
    );
  }

  function updateTablePermission(tableId, operation, value) {
    setTables((previous) =>
      previous.map((table) =>
        table.id === tableId
          ? {
              ...table,
              permissionInputs: {
                ...table.permissionInputs,
                [operation]: value
              }
            }
          : table
      )
    );
  }

  function addField(tableId) {
    setTables((previous) =>
      previous.map((table) =>
        table.id === tableId
          ? {
              ...table,
              fields: [...table.fields, createField()]
            }
          : table
      )
    );
  }

  function removeField(tableId, fieldId) {
    setTables((previous) =>
      previous.map((table) => {
        if (table.id !== tableId) {
          return table;
        }

        if (table.fields.length === 1) {
          return {
            ...table,
            fields: [createField()]
          };
        }

        return {
          ...table,
          fields: table.fields.filter((field) => field.id !== fieldId)
        };
      })
    );
  }

  function updateField(tableId, fieldId, key, value) {
    setTables((previous) =>
      previous.map((table) => {
        if (table.id !== tableId) {
          return table;
        }

        return {
          ...table,
          fields: table.fields.map((field) => {
            if (field.id !== fieldId) {
              return field;
            }

            const nextField = {
              ...field,
              [key]: value
            };

            if (key === 'primaryKey' && value) {
              nextField.nullable = false;
            }

            return nextField;
          })
        };
      })
    );
  }

  async function loadPolicyGrants() {
    if (isLoadingPolicyGrants) {
      return;
    }

    if (!draft.payload.tenantId) {
      setActionError('tenantId is required before loading policy grants.');
      return;
    }

    setIsLoadingPolicyGrants(true);
    setActionError('');

    try {
      const response = await fetch(
        `/api/policy/grants?tenantId=${encodeURIComponent(draft.payload.tenantId)}`,
        {
          method: 'GET',
          cache: 'no-store'
        }
      );
      const body = await response.json().catch(() => null);
      const normalizedBody = normalizeEnvelopeBody(body);

      if (!response.ok) {
        throw new Error(
          getActionResponseMessage(body, 'Unable to load policy grants for this tenant.')
        );
      }

      const nextGrants = Array.isArray(normalizedBody.grants) ? normalizedBody.grants : [];
      setPolicyGrants(nextGrants);
      setSelectedGrantId((previous) => {
        const exists = nextGrants.some((grant) => grant.grantId === previous);
        return exists ? previous : '';
      });
    } catch (error) {
      setActionError(error?.message || 'Unable to load policy grants for this tenant.');
    } finally {
      setIsLoadingPolicyGrants(false);
    }
  }

  async function runQueryAction() {
    if (isRunningQuery) {
      return;
    }

    if (!draft.payload.tenantId) {
      setActionError('tenantId is required before running query action.');
      return;
    }

    const parsedQueryParams = parseJsonInput(queryParamsText, 'Query params');
    if (!parsedQueryParams.ok) {
      setActionError(parsedQueryParams.error);
      return;
    }

    const queryParams = parsedQueryParams.value === null ? {} : parsedQueryParams.value;
    if (!isObjectValue(queryParams)) {
      setActionError('Query params must be a JSON object.');
      return;
    }

    const capability = queryCapability.trim();
    if (!capability) {
      setActionError('Capability is required for query action.');
      return;
    }

    const template = queryTemplate.trim();
    if (!template) {
      setActionError('Query template is required for query action.');
      return;
    }

    setIsRunningQuery(true);
    setActionError('');

    try {
      const queryRequestId = makeId('req_query');
      const signResult = await signQueryAction({
        requestIdForAction: queryRequestId,
        capability,
        queryTemplate: template,
        queryParams
      });

      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: queryRequestId,
          tenantId: draft.payload.tenantId,
          requester: signResult.requester,
          capability,
          queryTemplate: template,
          queryParams,
          auth: signResult.auth
        })
      });

      const body = await response.json().catch(() => null);
      appendActionHistory({
        actionType: 'query',
        label: `Query · ${template}`,
        statusCode: response.status,
        responseBody: body
      });

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Query action failed.'));
      }
    } catch (error) {
      setActionError(error?.message || 'Query action failed.');
    } finally {
      setIsRunningQuery(false);
    }
  }

  async function runDataAction() {
    if (isRunningDataAction) {
      return;
    }

    if (!draft.payload.tenantId) {
      setActionError('tenantId is required before running data action.');
      return;
    }

    const operation = String(dataOperation || '').trim().toLowerCase();
    if (!DATA_ACTION_OPERATIONS.includes(operation)) {
      setActionError(`Data operation must be one of: ${DATA_ACTION_OPERATIONS.join(', ')}.`);
      return;
    }

    const tableName = String(dataTableName || '').trim().toLowerCase();
    if (!tableName) {
      setActionError('tableName is required for data action.');
      return;
    }

    let values = null;
    let filters = null;
    let columns = null;
    let limit = null;

    if (operation === 'read') {
      const filtersInput = parseJsonInput(dataFiltersText, 'Filters');
      if (!filtersInput.ok) {
        setActionError(filtersInput.error);
        return;
      }
      if (filtersInput.value !== null && !isObjectValue(filtersInput.value)) {
        setActionError('Filters must be a JSON object for read operation.');
        return;
      }
      filters = filtersInput.value;

      const columnsInput = parseJsonInput(dataColumnsText, 'Columns');
      if (!columnsInput.ok) {
        setActionError(columnsInput.error);
        return;
      }
      if (columnsInput.value !== null) {
        if (!Array.isArray(columnsInput.value)) {
          setActionError('Columns must be a JSON array for read operation.');
          return;
        }

        const normalizedColumns = columnsInput.value
          .map((column) => (typeof column === 'string' ? column.trim().toLowerCase() : ''))
          .filter(Boolean);
        if (normalizedColumns.length !== columnsInput.value.length) {
          setActionError('Columns must contain only non-empty string values.');
          return;
        }
        columns = normalizedColumns;
      }

      if (dataLimit.trim().length > 0) {
        const parsedLimit = Number.parseInt(dataLimit, 10);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
          setActionError('Limit must be an integer between 1 and 500.');
          return;
        }
        limit = parsedLimit;
      }
    } else if (operation === 'insert') {
      const valuesInput = parseJsonInput(dataValuesText, 'Values');
      if (!valuesInput.ok) {
        setActionError(valuesInput.error);
        return;
      }
      if (!isObjectValue(valuesInput.value)) {
        setActionError('Values must be a JSON object for insert operation.');
        return;
      }
      values = valuesInput.value;
    } else if (operation === 'update') {
      const valuesInput = parseJsonInput(dataValuesText, 'Values');
      if (!valuesInput.ok) {
        setActionError(valuesInput.error);
        return;
      }
      if (!isObjectValue(valuesInput.value)) {
        setActionError('Values must be a JSON object for update operation.');
        return;
      }
      const filtersInput = parseJsonInput(dataFiltersText, 'Filters');
      if (!filtersInput.ok) {
        setActionError(filtersInput.error);
        return;
      }
      if (!isObjectValue(filtersInput.value)) {
        setActionError('Filters must be a JSON object for update operation.');
        return;
      }
      values = valuesInput.value;
      filters = filtersInput.value;
    } else {
      const filtersInput = parseJsonInput(dataFiltersText, 'Filters');
      if (!filtersInput.ok) {
        setActionError(filtersInput.error);
        return;
      }
      if (!isObjectValue(filtersInput.value)) {
        setActionError('Filters must be a JSON object for delete operation.');
        return;
      }
      filters = filtersInput.value;
    }

    setIsRunningDataAction(true);
    setActionError('');

    try {
      const dataRequestId = makeId('req_data');
      const actionPayload = buildDataExecuteActionPayload({
        tableName,
        operation,
        values,
        filters,
        columns,
        limit
      });
      const signResult = await signPolicyAction({
        action: 'data:execute',
        payload: actionPayload,
        requestIdOverride: dataRequestId
      });

      const requestPayload = {
        requestId: dataRequestId,
        tenantId: draft.payload.tenantId,
        actorWallet: signResult.actorWallet,
        operation,
        tableName,
        auth: signResult.auth
      };
      if (values !== null) {
        requestPayload.values = values;
      }
      if (filters !== null) {
        requestPayload.filters = filters;
      }
      if (columns !== null) {
        requestPayload.columns = columns;
      }
      if (limit !== null) {
        requestPayload.limit = limit;
      }

      const response = await fetch('/api/data/execute', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      const body = await response.json().catch(() => null);
      appendActionHistory({
        actionType: 'data',
        label: `Data · ${operation}`,
        statusCode: response.status,
        responseBody: body
      });

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Data operation failed.'));
      }
    } catch (error) {
      setActionError(error?.message || 'Data operation failed.');
    } finally {
      setIsRunningDataAction(false);
    }
  }

  async function createPolicyGrant() {
    if (isCreatingPolicyGrant) {
      return;
    }

    if (!draft.payload.tenantId) {
      setActionError('tenantId is required before creating policy grant.');
      return;
    }

    const targetWallet = policyGrantWallet.trim();
    if (!isWalletAddress(targetWallet)) {
      setActionError('Grant wallet must be a valid EVM wallet address.');
      return;
    }

    const scopeType = String(policyGrantScopeType || '').trim().toLowerCase();
    const scopeId =
      scopeType === 'database' ? '*' : String(policyGrantScopeId || '').trim().toLowerCase();
    if (!scopeId) {
      setActionError('Scope ID is required for table-level grant.');
      return;
    }

    const operation = String(policyGrantOperation || '').trim().toLowerCase();
    if (!OPERATIONS.includes(operation)) {
      setActionError(`Grant operation must be one of: ${OPERATIONS.join(', ')}.`);
      return;
    }

    const effect = String(policyGrantEffect || '').trim().toLowerCase();
    if (!['allow', 'deny'].includes(effect)) {
      setActionError('Grant effect must be either allow or deny.');
      return;
    }

    setIsCreatingPolicyGrant(true);
    setActionError('');

    try {
      const policyRequestId = makeId('req_grant_create');
      const grant = {
        walletAddress: normalizeWalletAddress(targetWallet),
        scopeType,
        scopeId,
        operation,
        effect
      };
      const signResult = await signPolicyAction({
        action: 'grant:create',
        payload: buildGrantCreateActionPayload(grant),
        requestIdOverride: policyRequestId
      });

      const response = await fetch('/api/policy/grants', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: policyRequestId,
          tenantId: draft.payload.tenantId,
          actorWallet: signResult.actorWallet,
          grant,
          auth: signResult.auth
        })
      });

      const body = await response.json().catch(() => null);
      appendActionHistory({
        actionType: 'policy-mutation',
        label: `Policy · create ${scopeType}:${operation}`,
        statusCode: response.status,
        responseBody: body
      });

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Policy grant creation failed.'));
      }

      setPolicyGrantWallet('');
      await loadPolicyGrants();
    } catch (error) {
      setActionError(error?.message || 'Policy grant creation failed.');
    } finally {
      setIsCreatingPolicyGrant(false);
    }
  }

  async function revokePolicyGrant() {
    if (isRevokingPolicyGrant) {
      return;
    }

    if (!draft.payload.tenantId) {
      setActionError('tenantId is required before revoking policy grant.');
      return;
    }

    const grantId = selectedGrantId.trim();
    if (!grantId) {
      setActionError('Select a grant before revoking.');
      return;
    }

    setIsRevokingPolicyGrant(true);
    setActionError('');

    try {
      const revokeRequestId = makeId('req_grant_revoke');
      const expectedHash = expectedGrantSignatureHash.trim() || null;
      const payload = buildGrantRevokeActionPayload({
        grantId,
        expectedSignatureHash: expectedHash
      });
      const signResult = await signPolicyAction({
        action: 'grant:revoke',
        payload,
        requestIdOverride: revokeRequestId
      });

      const response = await fetch('/api/policy/grants/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          requestId: revokeRequestId,
          tenantId: draft.payload.tenantId,
          actorWallet: signResult.actorWallet,
          grantId,
          expectedSignatureHash: expectedHash,
          auth: signResult.auth
        })
      });

      const body = await response.json().catch(() => null);
      appendActionHistory({
        actionType: 'policy-mutation',
        label: 'Policy · revoke grant',
        statusCode: response.status,
        responseBody: body
      });

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Policy grant revoke failed.'));
      }

      setExpectedGrantSignatureHash('');
      await loadPolicyGrants();
    } catch (error) {
      setActionError(error?.message || 'Policy grant revoke failed.');
    } finally {
      setIsRevokingPolicyGrant(false);
    }
  }

  async function submitDraft(event) {
    event.preventDefault();

    if (!canSubmit || isSubmitting || isApplying) {
      return;
    }

    setSubmission(null);
    setSubmissionError('');
    setIsSubmitting(true);

    try {
      const aiAssistMetadata = hasAiApproval
        ? {
            source: 'eigen-ai',
            draftId: aiSchemaDraftMetadata.draftId,
            draftHash: aiSchemaDraftMetadata.draftHash,
            approvalId: aiApproval.aiAssist.approvalId,
            approvedBy: aiApproval.aiAssist.approvedBy
          }
        : draft.payload.aiAssist;

      const payloadForSubmit = {
        ...draft.payload,
        aiAssist: aiAssistMetadata || null
      };

      const signResult = await signPolicyAction({
        action: 'schema:submit',
        payload: buildSubmitActionPayload(payloadForSubmit)
      });

      const signedPayload = {
        ...payloadForSubmit,
        actorWallet: signResult.actorWallet,
        auth: signResult.auth
      };

      const response = await fetch('/api/control-plane/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(signedPayload)
      });

      const body = await response.json().catch(() => null);
      const normalizedBody = normalizeEnvelopeBody(body);

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Submission failed.'));
      }

      setSubmission(normalizedBody);
      setRequestId(makeId('req'));
    } catch (error) {
      setSubmissionError(error?.message || 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function applyDraft() {
    if (!canApplySchema) {
      return;
    }

    setSubmission(null);
    setSubmissionError('');
    setIsApplying(true);

    try {
      if (aiAssistRequired && !hasAiApproval) {
        throw new Error('Approve the AI schema draft before applying AI-assisted schema changes.');
      }

      const aiAssistMetadata = aiAssistRequired
        ? {
            source: 'eigen-ai',
            draftId: aiSchemaDraftMetadata.draftId,
            draftHash: aiSchemaDraftMetadata.draftHash,
            approvalId: aiApproval.aiAssist.approvalId,
            approvedBy: aiApproval.aiAssist.approvedBy
          }
        : draft.payload.aiAssist;

      const payloadForApply = {
        ...draft.payload,
        aiAssist: aiAssistMetadata || null
      };

      const signResult = await signPolicyAction({
        action: 'schema:apply',
        payload: buildApplyActionPayload(payloadForApply)
      });

      const signedPayload = {
        ...payloadForApply,
        actorWallet: signResult.actorWallet,
        auth: signResult.auth
      };

      const response = await fetch('/api/control-plane/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(signedPayload)
      });

      const body = await response.json().catch(() => null);
      const normalizedBody = normalizeEnvelopeBody(body);
      appendActionHistory({
        actionType: 'schema-apply',
        label: 'Schema apply',
        statusCode: response.status,
        responseBody: body
      });

      if (!response.ok) {
        throw new Error(getActionResponseMessage(body, 'Schema apply failed.'));
      }

      setSubmission(normalizedBody);
      setRequestId(makeId('req'));
    } catch (error) {
      setSubmissionError(error?.message || 'Schema apply failed.');
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Task 1 · Frontend Foundation</p>
        <h1>Dynamic Policy DB Control Plane</h1>
        <p>
          Create table schema, attach wallet-level permissions by operation, preview the payload,
          then submit to the agent intake endpoint.
        </p>
      </section>

      <form className="layout-grid" onSubmit={submitDraft}>
        <section className="card">
          <header>
            <h2>1. Creator Wallet</h2>
          </header>
          <div className="stack-sm">
            <div className="inline-row">
              <button type="button" className="btn" onClick={connectWallet}>
                Connect Wallet
              </button>
              <button type="button" className="btn btn-muted" onClick={disconnectWallet}>
                Reset
              </button>
            </div>
            <div className="meta-grid">
              <p>
                <span>Address</span>
                <strong>{formatAddress(creator.address)}</strong>
              </p>
              <p>
                <span>Chain ID</span>
                <strong>{creator.chainId ?? 'Unknown'}</strong>
              </p>
              <p>
                <span>Request ID</span>
                <strong>{requestId}</strong>
              </p>
            </div>
            {walletError ? <p className="error-text">{walletError}</p> : null}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>2. Database Configuration</h2>
          </header>
          <div className="field-grid two-col">
            <label>
              Tenant ID
              <input
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="tenant_demo"
              />
            </label>
            <label>
              Database name
              <input
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
                placeholder="branch_operations"
              />
            </label>
            <label>
              Engine
              <select
                value={databaseEngine}
                onChange={(event) => setDatabaseEngine(event.target.value)}
              >
                {DB_ENGINES.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short description for this policy space"
              rows={3}
            />
          </label>
          <label>
            AI Help Prompt (draft only)
            <textarea
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="Example: create inventory and audit tables with read/insert for branch managers"
              rows={3}
            />
          </label>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>3. AI Assist (Draft, Review, Approval)</h2>
            <div className="inline-row">
              <button
                type="button"
                className="btn btn-muted"
                onClick={generateAiSchemaDraft}
                disabled={
                  isGeneratingSchemaDraft || isGeneratingPolicyDraft || isApprovingAiDraft
                }
              >
                {isGeneratingSchemaDraft ? 'Generating Schema Draft...' : 'Generate Schema Draft'}
              </button>
              <button
                type="button"
                className="btn btn-muted"
                onClick={generateAiPolicyDraft}
                disabled={
                  isGeneratingSchemaDraft || isGeneratingPolicyDraft || isApprovingAiDraft
                }
              >
                {isGeneratingPolicyDraft ? 'Generating Policy Draft...' : 'Generate Policy Draft'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={approveAiSchemaDraft}
                disabled={
                  !aiAssistRequired ||
                  hasAiApproval ||
                  isApprovingAiDraft ||
                  isGeneratingSchemaDraft ||
                  isGeneratingPolicyDraft
                }
              >
                {isApprovingAiDraft ? 'Signing + Approving...' : 'Sign + Approve Schema Draft'}
              </button>
              <button type="button" className="btn btn-danger" onClick={resetAiAssistState}>
                Reset AI State
              </button>
            </div>
          </header>

          <p className="muted">
            AI mode is approval-gated. If schema draft is active, schema apply requires completed
            approval metadata from AI draft approval.
          </p>

          {aiAssistRequired ? (
            hasAiApproval ? (
              <p className="ok-text">
                AI schema draft approved and ready for apply.
              </p>
            ) : (
              <p className="error-text">
                AI schema draft exists but is not approved yet. Apply is blocked until approval.
              </p>
            )
          ) : (
            <p className="muted">No AI schema draft is currently active.</p>
          )}

          {aiError ? <p className="error-text">{aiError}</p> : null}

          {aiSchemaDraft ? (
            <div className="result-box">
              <h3>Schema Draft Metadata</h3>
              <div className="meta-grid">
                <p>
                  <span>Draft ID</span>
                  <strong>{aiSchemaDraft?.draft?.draftId || 'N/A'}</strong>
                </p>
                <p>
                  <span>Draft Hash</span>
                  <strong>{aiSchemaDraft?.draft?.draftHash || 'N/A'}</strong>
                </p>
                <p>
                  <span>Plan Hash</span>
                  <strong>{aiSchemaDraft?.migrationPlan?.planHash || 'N/A'}</strong>
                </p>
                <p>
                  <span>Signer</span>
                  <strong>{aiSchemaDraft?.draft?.signerAddress || 'N/A'}</strong>
                </p>
                <p>
                  <span>Verified</span>
                  <strong>{String(Boolean(aiSchemaDraft?.draft?.verification?.verified))}</strong>
                </p>
                <p>
                  <span>Approval Required</span>
                  <strong>{String(Boolean(aiSchemaDraft?.approval?.required))}</strong>
                </p>
              </div>
              <pre>{JSON.stringify(aiSchemaDraft, null, 2)}</pre>
            </div>
          ) : null}

          {aiPolicyDraft ? (
            <div className="result-box">
              <h3>Policy Draft Metadata</h3>
              <div className="meta-grid">
                <p>
                  <span>Draft ID</span>
                  <strong>{aiPolicyDraft?.draft?.draftId || 'N/A'}</strong>
                </p>
                <p>
                  <span>Draft Hash</span>
                  <strong>{aiPolicyDraft?.draft?.draftHash || 'N/A'}</strong>
                </p>
                <p>
                  <span>Signer</span>
                  <strong>{aiPolicyDraft?.draft?.signerAddress || 'N/A'}</strong>
                </p>
                <p>
                  <span>Verified</span>
                  <strong>{String(Boolean(aiPolicyDraft?.draft?.verification?.verified))}</strong>
                </p>
                <p>
                  <span>Generated Grants</span>
                  <strong>{Array.isArray(aiPolicyDraft?.grants) ? aiPolicyDraft.grants.length : 0}</strong>
                </p>
              </div>
              <pre>{JSON.stringify(aiPolicyDraft, null, 2)}</pre>
            </div>
          ) : null}

          {aiApproval ? (
            <div className="result-box">
              <h3>Approval Status</h3>
              <div className="meta-grid">
                <p>
                  <span>Approval ID</span>
                  <strong>{aiApproval?.aiAssist?.approvalId || aiApproval?.approval?.approvalId || 'N/A'}</strong>
                </p>
                <p>
                  <span>Approved By</span>
                  <strong>{aiApproval?.aiAssist?.approvedBy || aiApproval?.approval?.approvedBy || 'N/A'}</strong>
                </p>
                <p>
                  <span>Decision</span>
                  <strong>{aiApproval?.decision?.outcome || 'N/A'}</strong>
                </p>
                <p>
                  <span>Audit Logged</span>
                  <strong>{String(Boolean(aiApproval?.audit?.logged))}</strong>
                </p>
                <p>
                  <span>Receipt ID</span>
                  <strong>{aiApproval?.receipt?.receiptId || 'N/A'}</strong>
                </p>
              </div>
              <pre>{JSON.stringify(aiApproval, null, 2)}</pre>
            </div>
          ) : null}
        </section>

        <section className="card">
          <header className="section-row">
            <h2>4. Universal DB Wallet List</h2>
            <button type="button" className="btn btn-muted" onClick={addUniversalWalletRow}>
              Add Wallet
            </button>
          </header>
          <div className="stack-sm">
            {universalWallets.map((wallet, index) => (
              <div className="wallet-row" key={wallet.id}>
                <label>
                  Wallet {index + 1}
                  <input
                    value={wallet.address}
                    onChange={(event) =>
                      updateUniversalWallet(wallet.id, 'address', event.target.value)
                    }
                    placeholder="0x..."
                  />
                </label>
                <label>
                  Label
                  <input
                    value={wallet.label}
                    onChange={(event) => updateUniversalWallet(wallet.id, 'label', event.target.value)}
                    placeholder="finance-admin"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeUniversalWalletRow(wallet.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>5. Database Permission Matrix</h2>
            <p className="muted">Add one or multiple addresses per operation (comma or whitespace separated).</p>
          </header>
          <div className="stack-sm">
            {OPERATIONS.map((operation) => (
              <label key={`db-${operation}`}>
                {operation}
                <input
                  value={databasePermissionInputs[operation]}
                  onChange={(event) => updateDatabasePermission(operation, event.target.value)}
                  placeholder="0xabc..., 0xdef..."
                />
              </label>
            ))}
          </div>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>6. Tables, Fields, and Table-Level Permissions</h2>
            <button type="button" className="btn" onClick={addTable}>
              Add Table
            </button>
          </header>

          <div className="stack-md">
            {tables.map((table, tableIndex) => (
              <article className="table-card" key={table.id}>
                <header className="section-row">
                  <h3>Table {tableIndex + 1}</h3>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeTable(table.id)}
                  >
                    Remove Table
                  </button>
                </header>

                <label>
                  Table name
                  <input
                    value={table.name}
                    onChange={(event) => updateTable(table.id, 'name', event.target.value)}
                    placeholder="ledger_entries"
                  />
                </label>

                <div className="section-row section-row-tight">
                  <h4>Fields</h4>
                  <button type="button" className="btn btn-muted" onClick={() => addField(table.id)}>
                    Add Field
                  </button>
                </div>

                <div className="stack-sm">
                  {table.fields.map((field, fieldIndex) => (
                    <div className="field-row" key={field.id}>
                      <label>
                        Name
                        <input
                          value={field.name}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'name', event.target.value)
                          }
                          placeholder={`field_${fieldIndex + 1}`}
                        />
                      </label>
                      <label>
                        Type
                        <select
                          value={field.type}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'type', event.target.value)
                          }
                        >
                          {FIELD_TYPES.map((fieldType) => (
                            <option key={fieldType} value={fieldType}>
                              {fieldType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={field.nullable}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'nullable', event.target.checked)
                          }
                          disabled={field.primaryKey}
                        />
                        Nullable
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={field.primaryKey}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'primaryKey', event.target.checked)
                          }
                        />
                        Primary key
                      </label>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => removeField(table.id, field.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <h4>Table Permission Matrix</h4>
                <div className="stack-sm">
                  {OPERATIONS.map((operation) => (
                    <label key={`${table.id}-${operation}`}>
                      {operation}
                      <input
                        value={table.permissionInputs[operation]}
                        onChange={(event) =>
                          updateTablePermission(table.id, operation, event.target.value)
                        }
                        placeholder="0xabc..., 0xdef..."
                      />
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>7. Request Preview and Submit</h2>
            <div className="inline-row">
              <button
                type="submit"
                className="btn"
                disabled={!canSubmit || isSubmitting || isApplying}
                title={canSubmit ? 'Submit payload' : 'Resolve validation errors first'}
              >
                {isSubmitting ? 'Signing + Submitting...' : 'Sign + Submit Payload'}
              </button>
              <button
                type="button"
                className="btn btn-muted"
                onClick={applyDraft}
                disabled={!canApplySchema}
                title={
                  aiAssistRequired && !hasAiApproval
                    ? 'Approve AI schema draft before apply.'
                    : 'Apply schema payload'
                }
              >
                {isApplying ? 'Signing + Applying...' : 'Sign + Apply Schema'}
              </button>
            </div>
          </header>

          {draft.issues.length > 0 ? (
            <div className="issues-box">
              <h3>Validation Issues</h3>
              <ul>
                {draft.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ok-text">Payload is valid and ready for submission.</p>
          )}

          {submissionError ? <p className="error-text">{submissionError}</p> : null}

          {submission ? (
            <div className="result-box">
              <h3>Submission Result</h3>
              <pre>{JSON.stringify(submission, null, 2)}</pre>
            </div>
          ) : null}

          <pre className="json-preview">{JSON.stringify(draft.payload, null, 2)}</pre>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>8. Action Playground + Proof Explorer</h2>
            <div className="inline-row">
              <button
                type="button"
                className="btn btn-muted"
                onClick={loadPolicyGrants}
                disabled={isLoadingPolicyGrants}
              >
                {isLoadingPolicyGrants ? 'Loading Grants...' : 'Refresh Policy Grants'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setActionHistory([])}
              >
                Clear Proof History
              </button>
            </div>
          </header>

          <p className="muted">
            Run query/data/policy actions and inspect cryptographic proof fields for each response.
          </p>
          {actionError ? <p className="error-text">{actionError}</p> : null}

          <div className="action-grid">
            <article className="table-card">
              <header className="section-row">
                <h3>Query Action</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={runQueryAction}
                  disabled={isRunningQuery}
                >
                  {isRunningQuery ? 'Running Query...' : 'Run Query'}
                </button>
              </header>
              <label>
                Capability
                <select
                  value={queryCapability}
                  onChange={(event) => setQueryCapability(event.target.value)}
                >
                  {QUERY_CAPABILITIES.map((capability) => (
                    <option key={capability} value={capability}>
                      {capability}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Query template
                <select
                  value={queryTemplate}
                  onChange={(event) => setQueryTemplate(event.target.value)}
                >
                  {QUERY_TEMPLATES.map((template) => (
                    <option key={template} value={template}>
                      {template}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Query params (JSON object)
                <textarea
                  rows={8}
                  value={queryParamsText}
                  onChange={(event) => setQueryParamsText(event.target.value)}
                />
              </label>
            </article>

            <article className="table-card">
              <header className="section-row">
                <h3>Data Action</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={runDataAction}
                  disabled={isRunningDataAction}
                >
                  {isRunningDataAction ? 'Running Data Action...' : 'Run Data Action'}
                </button>
              </header>

              <div className="field-grid two-col">
                <label>
                  Operation
                  <select
                    value={dataOperation}
                    onChange={(event) => setDataOperation(event.target.value)}
                  >
                    {DATA_ACTION_OPERATIONS.map((operation) => (
                      <option key={operation} value={operation}>
                        {operation}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Table name
                  <input
                    value={dataTableName}
                    onChange={(event) => setDataTableName(event.target.value)}
                    placeholder="inventory"
                  />
                </label>
              </div>

              <label>
                Values (JSON object for insert/update)
                <textarea
                  rows={5}
                  value={dataValuesText}
                  onChange={(event) => setDataValuesText(event.target.value)}
                />
              </label>
              <label>
                Filters (JSON object for read/update/delete)
                <textarea
                  rows={5}
                  value={dataFiltersText}
                  onChange={(event) => setDataFiltersText(event.target.value)}
                />
              </label>
              <div className="field-grid two-col">
                <label>
                  Columns (JSON array for read)
                  <textarea
                    rows={4}
                    value={dataColumnsText}
                    onChange={(event) => setDataColumnsText(event.target.value)}
                  />
                </label>
                <label>
                  Limit (for read)
                  <input
                    value={dataLimit}
                    onChange={(event) => setDataLimit(event.target.value)}
                    placeholder="25"
                  />
                </label>
              </div>
            </article>

            <article className="table-card">
              <header className="section-row">
                <h3>Policy Mutations</h3>
                <p className="muted">Active grants: {policyGrants.length}</p>
              </header>

              <h4>Create Grant</h4>
              <div className="field-grid two-col">
                <label>
                  Wallet address
                  <input
                    value={policyGrantWallet}
                    onChange={(event) => setPolicyGrantWallet(event.target.value)}
                    placeholder="0x..."
                  />
                </label>
                <label>
                  Scope type
                  <select
                    value={policyGrantScopeType}
                    onChange={(event) => setPolicyGrantScopeType(event.target.value)}
                  >
                    <option value="table">table</option>
                    <option value="database">database</option>
                  </select>
                </label>
                <label>
                  Scope ID
                  <input
                    value={policyGrantScopeType === 'database' ? '*' : policyGrantScopeId}
                    onChange={(event) => setPolicyGrantScopeId(event.target.value)}
                    placeholder="inventory"
                    disabled={policyGrantScopeType === 'database'}
                  />
                </label>
                <label>
                  Operation
                  <select
                    value={policyGrantOperation}
                    onChange={(event) => setPolicyGrantOperation(event.target.value)}
                  >
                    {OPERATIONS.map((operation) => (
                      <option key={`grant-op-${operation}`} value={operation}>
                        {operation}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Effect
                  <select
                    value={policyGrantEffect}
                    onChange={(event) => setPolicyGrantEffect(event.target.value)}
                  >
                    <option value="allow">allow</option>
                    <option value="deny">deny</option>
                  </select>
                </label>
              </div>

              <div className="inline-row">
                <button
                  type="button"
                  className="btn"
                  onClick={createPolicyGrant}
                  disabled={isCreatingPolicyGrant}
                >
                  {isCreatingPolicyGrant ? 'Creating...' : 'Create Grant'}
                </button>
              </div>

              <h4>Revoke Grant</h4>
              <div className="field-grid two-col">
                <label>
                  Grant ID
                  <select
                    value={selectedGrantId}
                    onChange={(event) => setSelectedGrantId(event.target.value)}
                  >
                    <option value="">Select grant</option>
                    {policyGrants.map((grant) => (
                      <option key={grant.grantId} value={grant.grantId}>
                        {grant.grantId} · {grant.scopeType}:{grant.scopeId}:{grant.operation}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Expected signature hash (optional)
                  <input
                    value={expectedGrantSignatureHash}
                    onChange={(event) => setExpectedGrantSignatureHash(event.target.value)}
                    placeholder="sha256..."
                  />
                </label>
              </div>
              <div className="inline-row">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={revokePolicyGrant}
                  disabled={isRevokingPolicyGrant}
                >
                  {isRevokingPolicyGrant ? 'Revoking...' : 'Revoke Grant'}
                </button>
              </div>
            </article>
          </div>

          {actionHistory.length === 0 ? (
            <p className="muted">No action receipts yet. Run an action to inspect proof metadata.</p>
          ) : (
            <div className="stack-sm">
              {actionHistory.map((item) => (
                <article className="table-card" key={item.id}>
                  <header className="section-row">
                    <h3>{item.label}</h3>
                    <p className="muted">
                      {item.timestamp} · HTTP {item.statusCode}
                    </p>
                  </header>
                  <div className="meta-grid">
                    <p>
                      <span>Outcome</span>
                      <strong>{item.outcome}</strong>
                    </p>
                    <p>
                      <span>Decision Code</span>
                      <strong>{item.decisionCode || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Request ID</span>
                      <strong>{item.requestId || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Receipt ID</span>
                      <strong>{item.receiptId || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Request Hash</span>
                      <strong>{item.requestHash || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Decision Hash</span>
                      <strong>{item.decisionHash || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Verification Hash</span>
                      <strong>{item.verificationHash || 'N/A'}</strong>
                    </p>
                    <p>
                      <span>Runtime Status</span>
                      <strong>
                        {item.runtimeStatus}
                        {typeof item.runtimeVerified === 'boolean'
                          ? ` (verified=${String(item.runtimeVerified)})`
                          : ''}
                      </strong>
                    </p>
                    <p>
                      <span>Audit Logged</span>
                      <strong>
                        {String(item.auditLogged)}
                        {item.auditCode ? ` (${item.auditCode})` : ''}
                      </strong>
                    </p>
                  </div>
                  <pre>{JSON.stringify(item.body, null, 2)}</pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </form>
    </main>
  );
}
