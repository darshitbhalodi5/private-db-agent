import { readJsonBody, sendJson, sendJsonBodyReadError } from '../lib/http.js';
import { handleQueryRequest } from '../services/queryService.js';

export async function handleQuery(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return;
  }

  const result = await handleQueryRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
