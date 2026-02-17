import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { handleHealth } from './routes/health.js';
import { handleQuery } from './routes/query.js';
import { sendJson } from './lib/http.js';

export function createServer(config = loadConfig()) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      handleHealth(req, res, config);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/query') {
      await handleQuery(req, res);
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
