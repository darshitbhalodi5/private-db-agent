import { readJsonBody, sendJson, sendJsonBodyReadError } from '../lib/http.js';
import {
  handleCreatePolicyGrantRequest,
  handleListPolicyGrantsRequest,
  handlePolicyPreviewDecisionRequest,
  handleRevokePolicyGrantRequest
} from '../services/policyAdminService.js';

async function parseJsonBody(req, res) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return null;
  }
}

export async function handlePolicyGrantCreate(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleCreatePolicyGrantRequest(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handlePolicyGrantRevoke(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleRevokePolicyGrantRequest(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handlePolicyPreviewDecision(req, res) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handlePolicyPreviewDecisionRequest(payload);
  sendJson(res, result.statusCode, result.body);
}

export async function handlePolicyGrantList(req, res, urlObject) {
  const tenantId = urlObject.searchParams.get('tenantId');
  const walletAddress = urlObject.searchParams.get('walletAddress');

  const result = await handleListPolicyGrantsRequest({
    tenantId,
    walletAddress
  });
  sendJson(res, result.statusCode, result.body);
}
