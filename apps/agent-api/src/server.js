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
import { createLogger } from './services/loggerService.js';
import { getRuntimeMetricsService } from './services/metricsService.js';
import { createRateLimitService } from './services/rateLimitService.js';
import { handleOpsMetrics } from './routes/ops.js';

const serverStartedAtMs = Date.now();

function getClientIp(req) {
  const forwardedHeader = req.headers['x-forwarded-for'];
  if (typeof forwardedHeader === 'string' && forwardedHeader.trim().length > 0) {
    return forwardedHeader.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

function shouldApplyRateLimit(pathname) {
  if (pathname === '/health') {
    return false;
  }

  if (pathname === '/' || pathname === '/demo') {
    return false;
  }

  return pathname.startsWith('/v1/');
}

function createTimeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms.`);
  error.code = 'REQUEST_TIMEOUT';
  return error;
}

async function executeWithTimeout(fn, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return fn();
  }

  let timer = null;

  try {
    return await Promise.race([
      Promise.resolve().then(() => fn()),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(createTimeoutError(timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createServer(
  config = loadConfig(),
  {
    logger = createLogger({
      level: config.observability.logLevel,
      serviceName: config.serviceName,
      version: config.version,
      environment: config.nodeEnv
    }),
    metricsService = getRuntimeMetricsService(),
    rateLimitService = createRateLimitService(config.security.rateLimit)
  } = {}
) {
  const demoScenarioService = createDemoScenarioService(config.demo);

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    const method = req.method || 'GET';
    const clientIp = getClientIp(req);
    const requestStartMs = Date.now();
    const correlationIdHeader = req.headers['x-correlation-id'];
    const correlationId =
      typeof correlationIdHeader === 'string' && correlationIdHeader.trim().length > 0
        ? correlationIdHeader.trim()
        : randomUUID();
    req.context = {
      correlationId,
      apiVersion: 'v1',
      maxJsonBodyBytes: config.security.maxJsonBodyBytes
    };
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-api-version', 'v1');
    if (config.observability.metricsRouteEnabled) {
      res.setHeader('x-metrics-enabled', config.observability.metricsEnabled ? '1' : '0');
    }

    logger.info('http.request.start', {
      correlationId,
      method,
      path: pathname,
      clientIp
    });

    res.on('finish', () => {
      const durationMs = Math.max(0, Date.now() - requestStartMs);
      const payload = res.__responsePayload || null;
      if (config.observability.metricsEnabled) {
        metricsService.recordHttpRequest({
          method,
          path: pathname,
          statusCode: res.statusCode,
          durationMs,
          payload
        });
      }

      logger.info('http.request.complete', {
        correlationId,
        method,
        path: pathname,
        statusCode: res.statusCode,
        durationMs
      });
    });

    if (shouldApplyRateLimit(pathname)) {
      const rateLimit = rateLimitService.consume(`${clientIp}:${pathname}`);
      if (!rateLimit.allowed) {
        if (config.observability.metricsEnabled) {
          metricsService.incrementCounter('rate_limited_total', {
            path: pathname,
            method
          });
        }
        res.setHeader('retry-after', String(rateLimit.retryAfterSeconds));
        sendJson(res, 429, {
          error: 'RATE_LIMITED',
          message: 'Too many requests. Retry later.',
          retryAfterSeconds: rateLimit.retryAfterSeconds
        });
        return;
      }
    }

    async function runRoute(handler) {
      try {
        await executeWithTimeout(handler, config.security.requestTimeoutMs);
      } catch (error) {
        if (error?.code === 'REQUEST_TIMEOUT') {
          if (config.observability.metricsEnabled) {
            metricsService.incrementCounter('request_timeouts_total', {
              path: pathname,
              method
            });
          }
          logger.warn('http.request.timeout', {
            correlationId,
            method,
            path: pathname,
            timeoutMs: config.security.requestTimeoutMs
          });
          if (!res.writableEnded) {
            sendJson(res, 504, {
              error: 'REQUEST_TIMEOUT',
              message: error.message
            });
          }
          return;
        }

        logger.error('http.request.unhandled_error', {
          correlationId,
          method,
          path: pathname,
          error: error?.message || 'Unknown error'
        });
        if (!res.writableEnded) {
          sendJson(res, 500, {
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Unhandled server error.'
          });
        }
      }
    }

    if (method === 'GET' && pathname === '/health') {
      await runRoute(async () => handleHealth(req, res, config));
      return;
    }

    if (method === 'GET' && pathname === '/v1/ops/metrics') {
      if (!config.observability.metricsRouteEnabled) {
        sendJson(res, 404, {
          error: 'NOT_FOUND',
          message: 'Route not found.'
        });
        return;
      }

      await runRoute(async () =>
        handleOpsMetrics(req, res, config, {
          startedAtMs: serverStartedAtMs
        })
      );
      return;
    }

    if (method === 'POST' && pathname === '/v1/query') {
      await runRoute(async () => handleQuery(req, res));
      return;
    }

    if (method === 'GET' && pathname === '/.well-known/agent-card.json') {
      await runRoute(async () => handleA2aAgentCard(req, res, requestUrl));
      return;
    }

    if (method === 'GET' && pathname === '/v1/a2a/agent-card') {
      await runRoute(async () => handleA2aAgentCard(req, res, requestUrl));
      return;
    }

    if (method === 'GET' && pathname === '/v1/a2a/contracts') {
      await runRoute(async () => handleA2aContracts(req, res, requestUrl));
      return;
    }

    if (method === 'POST' && pathname === '/v1/a2a/tasks') {
      await runRoute(async () => handleA2aTaskCreate(req, res, requestUrl));
      return;
    }

    if (method === 'GET' && pathname === '/v1/a2a/tasks') {
      await runRoute(async () => handleA2aTaskList(req, res, requestUrl));
      return;
    }

    const a2aTaskMatch = pathname.match(/^\/v1\/a2a\/tasks\/([^/]+)$/);
    if (method === 'GET' && a2aTaskMatch) {
      await runRoute(async () =>
        handleA2aTaskGet(req, res, requestUrl, decodeURIComponent(a2aTaskMatch[1]))
      );
      return;
    }

    if (method === 'GET' && pathname === '/v1/runtime/attestation') {
      await runRoute(async () => handleRuntimeAttestationStatus(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/control-plane/submit') {
      await runRoute(async () => handleControlPlaneSubmit(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/ai/schema-draft') {
      await runRoute(async () => handleAiSchemaDraft(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/ai/policy-draft') {
      await runRoute(async () => handleAiPolicyDraft(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/ai/approve-draft') {
      await runRoute(async () => handleAiApproveDraft(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/control-plane/apply') {
      await runRoute(async () => handleControlPlaneApply(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/data/execute') {
      await runRoute(async () => handleDataOperationExecute(req, res));
      return;
    }

    if (method === 'GET' && pathname === '/v1/policy/grants') {
      await runRoute(async () => handlePolicyGrantList(req, res, requestUrl));
      return;
    }

    if (method === 'POST' && pathname === '/v1/policy/grants') {
      await runRoute(async () => handlePolicyGrantCreate(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/policy/grants/revoke') {
      await runRoute(async () => handlePolicyGrantRevoke(req, res));
      return;
    }

    if (method === 'POST' && pathname === '/v1/policy/preview-decision') {
      await runRoute(async () => handlePolicyPreviewDecision(req, res));
      return;
    }

    if (method === 'GET' && pathname === '/v1/demo/scenarios') {
      await runRoute(async () => handleDemoScenarios(req, res, demoScenarioService));
      return;
    }

    if (method === 'GET' && pathname === '/v1/demo/payload') {
      await runRoute(async () => handleDemoPayload(req, res, demoScenarioService, requestUrl));
      return;
    }

    if (method === 'GET' && (pathname === '/demo' || pathname === '/')) {
      await runRoute(async () => handleDemoPage(req, res));
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
