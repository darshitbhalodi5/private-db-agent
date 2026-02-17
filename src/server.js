import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { handleDemoPage, handleDemoPayload, handleDemoScenarios } from './routes/demo.js';
import { handleHealth } from './routes/health.js';
import { handleQuery } from './routes/query.js';
import { sendJson } from './lib/http.js';
import { createDemoScenarioService } from './services/demoScenarioService.js';

export function createServer(config = loadConfig()) {
  const demoScenarioService = createDemoScenarioService(config.demo);

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      handleHealth(req, res, config);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/query') {
      await handleQuery(req, res);
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
