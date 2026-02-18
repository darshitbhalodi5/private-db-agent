import { readJsonBody, sendJson } from '../lib/http.js';
import { handleDataOperationRequest } from '../services/dataOperationService.js';

export async function handleDataOperationExecute(req, res) {
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

  const result = await handleDataOperationRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
