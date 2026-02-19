import { readJsonBody, sendJson, sendJsonBodyReadError } from '../lib/http.js';
import { handleControlPlaneSubmission } from '../services/controlPlaneSubmissionService.js';
import { handleSchemaApplyRequest } from '../services/schemaApplyService.js';

export async function handleControlPlaneSubmit(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return;
  }

  const result = await handleControlPlaneSubmission(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handleControlPlaneApply(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return;
  }

  const result = await handleSchemaApplyRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
