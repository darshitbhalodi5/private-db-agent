import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import {
  handleA2aAgentCard,
  handleA2aContracts,
  handleA2aTaskCreate,
  handleA2aTaskGet,
  handleA2aTaskList
} from './routes/a2a.js';
import {
  handleAiApproveDraft,
  handleAiPolicyDraft,
  handleAiSchemaDraft
} from './routes/ai.js';
import { handleControlPlaneApply, handleControlPlaneSubmit } from './routes/controlPlane.js';
import { handleDataOperationExecute } from './routes/dataOperation.js';
import { handleDemoPage, handleDemoPayload, handleDemoScenarios } from './routes/demo.js';
import { handleHealth } from './routes/health.js';
import {
  handlePolicyGrantCreate,
  handlePolicyGrantList,
  handlePolicyGrantRevoke,
  handlePolicyPreviewDecision
} from './routes/policy.js';
import { handleQuery } from './routes/query.js';
import { handleRuntimeAttestationStatus } from './routes/runtime.js';
import { sendJson } from './lib/http.js';
import { createDemoScenarioService } from './services/demoScenarioService.js';

export function createServer(config = loadConfig()) {
  const demoScenarioService = createDemoScenarioService(config.demo);

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    const correlationIdHeader = req.headers['x-correlation-id'];
    const correlationId =
      typeof correlationIdHeader === 'string' && correlationIdHeader.trim().length > 0
        ? correlationIdHeader.trim()
        : randomUUID();
    req.context = {
      correlationId,
      apiVersion: 'v1'
    };
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-api-version', 'v1');

    if (req.method === 'GET' && pathname === '/health') {
      handleHealth(req, res, config);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/query') {
      await handleQuery(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/.well-known/agent-card.json') {
      await handleA2aAgentCard(req, res, requestUrl);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/a2a/agent-card') {
      await handleA2aAgentCard(req, res, requestUrl);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/a2a/contracts') {
      await handleA2aContracts(req, res, requestUrl);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/a2a/tasks') {
      await handleA2aTaskCreate(req, res, requestUrl);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/a2a/tasks') {
      await handleA2aTaskList(req, res, requestUrl);
      return;
    }

    const a2aTaskMatch = pathname.match(/^\/v1\/a2a\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && a2aTaskMatch) {
      await handleA2aTaskGet(req, res, requestUrl, decodeURIComponent(a2aTaskMatch[1]));
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/runtime/attestation') {
      await handleRuntimeAttestationStatus(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/control-plane/submit') {
      await handleControlPlaneSubmit(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/ai/schema-draft') {
      await handleAiSchemaDraft(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/ai/policy-draft') {
      await handleAiPolicyDraft(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/ai/approve-draft') {
      await handleAiApproveDraft(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/control-plane/apply') {
      await handleControlPlaneApply(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/data/execute') {
      await handleDataOperationExecute(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/policy/grants') {
      await handlePolicyGrantList(req, res, requestUrl);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/policy/grants') {
      await handlePolicyGrantCreate(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/policy/grants/revoke') {
      await handlePolicyGrantRevoke(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/policy/preview-decision') {
      await handlePolicyPreviewDecision(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/demo/scenarios') {
      handleDemoScenarios(req, res, demoScenarioService);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/demo/payload') {
      await handleDemoPayload(req, res, demoScenarioService, requestUrl);
      return;
    }

    if (req.method === 'GET' && (pathname === '/demo' || pathname === '/')) {
      await handleDemoPage(req, res);
      return;
    }

    sendJson(res, 404, {
      error: 'NOT_FOUND',
      message: 'Route not found.'
    });
  });
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const config = loadConfig();
  const server = createServer(config);

  server.listen(config.port, () => {
    // Keep startup log minimal and deterministic for local scripts.
    console.log(`${config.serviceName} listening on port ${config.port}`);
  });
}
