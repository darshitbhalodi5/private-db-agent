import { readJsonBody, sendJson } from '../lib/http.js';
import { handleControlPlaneSubmission } from '../services/controlPlaneSubmissionService.js';
import { handleSchemaApplyRequest } from '../services/schemaApplyService.js';

export async function handleControlPlaneSubmit(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON.'
    });
    return;
  }

  const result = handleControlPlaneSubmission(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handleControlPlaneApply(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON.'
    });
    return;
  }

  const result = await handleSchemaApplyRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
