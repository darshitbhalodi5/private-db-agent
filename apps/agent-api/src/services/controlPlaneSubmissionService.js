import { randomUUID } from 'node:crypto';
import { validateAndCompileSchemaDsl } from './schemaDslService.js';

export function handleControlPlaneSubmission(
  payload,
  {
    now = () => new Date().toISOString(),
    createSubmissionId = () => `sub_${randomUUID()}`
  } = {}
) {
  const schemaDslResult = validateAndCompileSchemaDsl(payload);
  if (!schemaDslResult.ok) {
    return {
      statusCode: 400,
      body: schemaDslResult.error
    };
  }

  const grants = Array.isArray(payload.grants) ? payload.grants : [];
  const { normalizedDsl, schema, migrationPlan } = schemaDslResult;

  return {
    statusCode: 202,
    body: {
      code: 'SCHEMA_REQUEST_ACCEPTED',
      message: 'Schema DSL payload accepted and compiled to deterministic migration plan.',
      schema,
      migrationPlan,
      submission: {
        submissionId: createSubmissionId(),
        requestId: normalizedDsl.requestId,
        creatorWalletAddress: normalizedDsl.creator.walletAddress,
        databaseName: normalizedDsl.database.name,
        tableCount: normalizedDsl.tables.length,
        grantCount: grants.length,
        receivedAt: now()
      }
    }
  };
}
