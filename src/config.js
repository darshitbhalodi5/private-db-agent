const DEFAULT_PORT = 8080;

function parsePort(rawValue) {
  if (!rawValue) {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${rawValue}`);
  }

  return parsed;
}

export function loadConfig(env = process.env) {
  return {
    serviceName: env.SERVICE_NAME || 'private-db-agent-api',
    nodeEnv: env.NODE_ENV || 'development',
    port: parsePort(env.PORT),
    version: env.SERVICE_VERSION || '0.1.0'
  };
}
