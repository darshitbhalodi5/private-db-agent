import { sendJson } from '../lib/http.js';
import { getRuntimeMetricsService } from '../services/metricsService.js';

const metricsService = getRuntimeMetricsService();

export function handleOpsMetrics(req, res, config, { startedAtMs } = {}) {
  const nowMs = Date.now();
  const processUptimeSeconds = Math.round(process.uptime());
  const serviceUptimeMs = startedAtMs ? nowMs - startedAtMs : null;

  sendJson(res, 200, {
    code: 'METRICS_SNAPSHOT',
    service: {
      name: config.serviceName,
      version: config.version,
      environment: config.nodeEnv
    },
    uptime: {
      processSeconds: processUptimeSeconds,
      serviceMs: serviceUptimeMs
    },
    metrics: metricsService.snapshot()
  });
}
