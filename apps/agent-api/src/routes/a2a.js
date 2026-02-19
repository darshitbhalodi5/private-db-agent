import { readJsonBody, sendJson, sendJsonBodyReadError } from '../lib/http.js';
import {
  handleA2aAgentCardRequest,
  handleA2aContractsRequest,
  handleA2aCreateTaskRequest,
  handleA2aGetTaskRequest,
  handleA2aListTasksRequest
} from '../services/a2aTaskService.js';

async function parseJsonBody(req, res) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendJsonBodyReadError(res, error);
    return null;
  }
}

function buildRouteContext(req, requestUrl) {
  return {
    headers: req.headers || {},
    method: req.method || 'GET',
    path: requestUrl.pathname,
    correlationId: req.context?.correlationId || null
  };
}

export async function handleA2aAgentCard(req, res, requestUrl) {
  const result = await handleA2aAgentCardRequest();
  sendJson(res, result.statusCode, result.body);
}

export async function handleA2aContracts(req, res, requestUrl) {
  const result = await handleA2aContractsRequest();
  sendJson(res, result.statusCode, result.body);
}

export async function handleA2aTaskCreate(req, res, requestUrl) {
  const payload = await parseJsonBody(req, res);
  if (!payload) {
    return;
  }

  const result = await handleA2aCreateTaskRequest(payload, buildRouteContext(req, requestUrl));
  sendJson(res, result.statusCode, result.body);
}

export async function handleA2aTaskGet(req, res, requestUrl, taskId) {
  const result = await handleA2aGetTaskRequest(taskId, buildRouteContext(req, requestUrl));
  sendJson(res, result.statusCode, result.body);
}

export async function handleA2aTaskList(req, res, requestUrl) {
  const result = await handleA2aListTasksRequest(
    {
      status: requestUrl.searchParams.get('status'),
      limit: requestUrl.searchParams.get('limit')
    },
    buildRouteContext(req, requestUrl)
  );
  sendJson(res, result.statusCode, result.body);
}
