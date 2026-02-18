import { sendJson } from '../lib/http.js';

export function handleHealth(req, res, config) {
  sendJson(res, 200, {
    status: 'ok',
    service: config.serviceName,
    version: config.version,
    timestamp: new Date().toISOString()
  });
}
