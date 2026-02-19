import { readJsonBody, sendJson, sendJsonBodyReadError } from '../lib/http.js';
import { handleDataOperationRequest } from '../services/dataOperationService.js';

export async function handleDataOperationExecute(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return;
  }

  const result = await handleDataOperationRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
