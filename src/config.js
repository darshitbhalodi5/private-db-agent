const DEFAULT_PORT = 8080;
const DEFAULT_NONCE_TTL_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
const DEFAULT_POSTGRES_POOL_SIZE = 10;
const DEFAULT_SQLITE_PATH = './data/private-db-agent.sqlite';

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

function parseBoolean(rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${rawValue}`);
}

function parsePositiveInteger(name, rawValue, defaultValue) {
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return parsed;
}

function parseJsonObject(name, rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('must be an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${name} JSON: ${error.message}`);
  }
}

function parseString(name, rawValue, defaultValue = '') {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid ${name} value: expected string.`);
  }

  return rawValue;
}

function parseEnum(name, rawValue, allowedValues, defaultValue) {
  const value = rawValue || defaultValue;
  if (!allowedValues.includes(value)) {
    throw new Error(
      `Invalid ${name} value: ${value}. Allowed values: ${allowedValues.join(', ')}`
    );
  }

  return value;
}

export function loadConfig(env = process.env) {
  return {
    serviceName: env.SERVICE_NAME || 'private-db-agent-api',
    nodeEnv: env.NODE_ENV || 'development',
    port: parsePort(env.PORT),
    version: env.SERVICE_VERSION || '0.1.0',
    auth: {
      enabled: parseBoolean(env.AUTH_ENABLED, true),
      nonceTtlSeconds: parsePositiveInteger(
        'AUTH_NONCE_TTL_SECONDS',
        env.AUTH_NONCE_TTL_SECONDS,
        DEFAULT_NONCE_TTL_SECONDS
      ),
      maxFutureSkewSeconds: parsePositiveInteger(
        'AUTH_MAX_FUTURE_SKEW_SECONDS',
        env.AUTH_MAX_FUTURE_SKEW_SECONDS,
        DEFAULT_MAX_FUTURE_SKEW_SECONDS
      )
    },
    policy: {
      capabilityRules: parseJsonObject(
        'POLICY_CAPABILITY_RULES_JSON',
        env.POLICY_CAPABILITY_RULES_JSON
      ),
      enforceCapabilityMode: parseBoolean(env.POLICY_ENFORCE_CAPABILITY_MODE, true)
    },
    database: {
      driver: parseEnum('DB_DRIVER', env.DB_DRIVER, ['postgres', 'sqlite'], 'sqlite'),
      postgres: {
        connectionString: parseString('DATABASE_URL', env.DATABASE_URL, ''),
        ssl: parseBoolean(env.POSTGRES_SSL, false),
        maxPoolSize: parsePositiveInteger(
          'POSTGRES_MAX_POOL_SIZE',
          env.POSTGRES_MAX_POOL_SIZE,
          DEFAULT_POSTGRES_POOL_SIZE
        )
      },
      sqlite: {
        filePath: parseString('SQLITE_FILE_PATH', env.SQLITE_FILE_PATH, DEFAULT_SQLITE_PATH)
      }
    }
  };
}
