import { readJsonBody, sendJson } from '../lib/http.js';
import { handleQueryRequest } from '../services/queryService.js';

export async function handleQuery(req, res) {
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

  const result = await handleQueryRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
