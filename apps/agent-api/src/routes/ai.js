import { readJsonBody, sendJson } from '../lib/http.js';
import {
  handleAiApproveDraftRequest,
  handleAiPolicyDraftRequest,
  handleAiSchemaDraftRequest
} from '../services/eigenAiService.js';

async function parseJsonBody(req, res) {
  try {
    return await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      error: 'INVALID_JSON',
      message: 'Request body must be valid JSON.'
    });
    return null;
  }
}

export async function handleAiSchemaDraft(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleAiSchemaDraftRequest(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handleAiPolicyDraft(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleAiPolicyDraftRequest(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handleAiApproveDraft(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleAiApproveDraftRequest(payload);
  sendJson(res, result.statusCode, result.body);
}
