import { randomUUID } from 'node:crypto';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createPlaceholders(dialect, count, offset = 0) {
  if (dialect === 'postgres') {
    return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`);
  }

  return Array.from({ length: count }, () => '?');
}

function serializeJson(value) {
  return JSON.stringify(value || {});
}

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function toDraft(row) {
  if (!row) {
    return null;
  }

  return {
    draftId: row.draft_id,
    tenantId: row.tenant_id,
    draftType: row.draft_type,
    prompt: row.prompt,
    draftHash: row.draft_hash,
    planHash: row.plan_hash || null,
    payload: parseJson(row.payload_json),
    provider: row.provider,
    model: row.model,
    signerAddress: row.signer_address,
    signature: row.signature,
    issuedAt: row.issued_at,
    createdAt: row.created_at
  };
}

function toApproval(row) {
  if (!row) {
    return null;
  }

  return {
    approvalId: row.approval_id,
    tenantId: row.tenant_id,
    draftId: row.draft_id,
    draftHash: row.draft_hash,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    signatureHash: row.signature_hash
  };
}

export function createAiDraftStore({ databaseAdapter }) {
  if (!databaseAdapter || typeof databaseAdapter.execute !== 'function') {
    throw new Error('databaseAdapter is required for AI draft store.');
  }

  const dialect = databaseAdapter.dialect;
  let initPromise = null;

  async function ensureInitialized() {
    if (!initPromise) {
      initPromise = initializeSchema().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    return initPromise;
  }

  async function initializeSchema() {
    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE TABLE IF NOT EXISTS ai_drafts (
          draft_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          draft_type TEXT NOT NULL,
          prompt TEXT NOT NULL,
          draft_hash TEXT NOT NULL,
          plan_hash TEXT,
          payload_json TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          signer_address TEXT NOT NULL,
          signature TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_ai_drafts_tenant_type_time
        ON ai_drafts (tenant_id, draft_type, created_at DESC)
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE TABLE IF NOT EXISTS ai_draft_approvals (
          approval_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          draft_id TEXT NOT NULL,
          draft_hash TEXT NOT NULL,
          approved_by TEXT NOT NULL,
          approved_at TEXT NOT NULL,
          signature_hash TEXT NOT NULL
        )
      `,
      values: []
    });

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_ai_draft_approvals_lookup
        ON ai_draft_approvals (tenant_id, draft_id, approved_by, approved_at DESC)
      `,
      values: []
    });
  }

  async function createDraft({
    tenantId,
    draftType,
    prompt,
    draftHash,
    planHash,
    payload,
    provider,
    model,
    signerAddress,
    signature,
    issuedAt,
    createdAt
  }) {
    await ensureInitialized();
    const draftId = randomUUID();
    const placeholders = createPlaceholders(dialect, 13);

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        INSERT INTO ai_drafts (
          draft_id,
          tenant_id,
          draft_type,
          prompt,
          draft_hash,
          plan_hash,
          payload_json,
          provider,
          model,
          signer_address,
          signature,
          issued_at,
          created_at
        )
        VALUES (${placeholders.join(', ')})
      `,
      values: [
        draftId,
        tenantId,
        draftType,
        prompt,
        draftHash,
        planHash || null,
        serializeJson(payload),
        provider,
        model,
        signerAddress,
        signature,
        issuedAt,
        createdAt
      ]
    });

    return {
      draftId,
      tenantId,
      draftType,
      prompt,
      draftHash,
      planHash: planHash || null,
      payload,
      provider,
      model,
      signerAddress,
      signature,
      issuedAt,
      createdAt
    };
  }

  async function getDraft({ tenantId, draftId }) {
    await ensureInitialized();
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(draftId)) {
      return null;
    }

    const placeholders = createPlaceholders(dialect, 2);
    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: `
        SELECT *
        FROM ai_drafts
        WHERE tenant_id = ${placeholders[0]} AND draft_id = ${placeholders[1]}
        LIMIT 1
      `,
      values: [tenantId.trim().toLowerCase(), draftId.trim()]
    });

    return toDraft(result.rows?.[0] || null);
  }

  async function createApproval({
    tenantId,
    draftId,
    draftHash,
    approvedBy,
    approvedAt,
    signatureHash
  }) {
    await ensureInitialized();
    const approvalId = randomUUID();
    const placeholders = createPlaceholders(dialect, 7);

    await databaseAdapter.execute({
      mode: 'write',
      sql: `
        INSERT INTO ai_draft_approvals (
          approval_id,
          tenant_id,
          draft_id,
          draft_hash,
          approved_by,
          approved_at,
          signature_hash
        )
        VALUES (${placeholders.join(', ')})
      `,
      values: [approvalId, tenantId, draftId, draftHash, approvedBy, approvedAt, signatureHash]
    });

    return {
      approvalId,
      tenantId,
      draftId,
      draftHash,
      approvedBy,
      approvedAt,
      signatureHash
    };
  }

  async function getApproval({ tenantId, draftId, approvalId }) {
    await ensureInitialized();
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(draftId) || !isNonEmptyString(approvalId)) {
      return null;
    }

    const placeholders = createPlaceholders(dialect, 3);
    const result = await databaseAdapter.execute({
      mode: 'read',
      sql: `
        SELECT *
        FROM ai_draft_approvals
        WHERE
          tenant_id = ${placeholders[0]}
          AND draft_id = ${placeholders[1]}
          AND approval_id = ${placeholders[2]}
        LIMIT 1
      `,
      values: [tenantId.trim().toLowerCase(), draftId.trim(), approvalId.trim()]
    });

    return toApproval(result.rows?.[0] || null);
  }

  return {
    ensureInitialized,
    createDraft,
    getDraft,
    createApproval,
    getApproval
  };
}
