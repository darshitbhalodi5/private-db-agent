const DEFAULT_PORT = 8080;
const DEFAULT_NONCE_TTL_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;
const DEFAULT_POSTGRES_POOL_SIZE = 10;
const DEFAULT_SQLITE_PATH = './data/private-db-agent.sqlite';
const DEFAULT_DEMO_CHAIN_ID = 1;
const DEFAULT_DEMO_TENANT_ID = 'tenant_demo';
const DEFAULT_DEMO_TARGET_WALLET = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const DEFAULT_MAX_JSON_BODY_BYTES = 1_048_576;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const DEFAULT_SECRET_ROTATION_DAYS = 30;
const DEFAULT_AI_SIGNER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f094538e5b32cbac50b1f5f5c4ea7f7f0e5f7a72';

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

function parseCsvList(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
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
    proof: {
      enabled: parseBoolean(env.PROOF_RECEIPT_ENABLED, true),
      hashAlgorithm: parseEnum(
        'PROOF_HASH_ALGORITHM',
        env.PROOF_HASH_ALGORITHM,
        ['sha256'],
        'sha256'
      ),
      trustModel: parseString(
        'PROOF_TRUST_MODEL',
        env.PROOF_TRUST_MODEL,
        'eigencompute-mainnet-alpha'
      ),
      runtimeVerificationMode: parseEnum(
        'PROOF_RUNTIME_VERIFICATION_MODE',
        env.PROOF_RUNTIME_VERIFICATION_MODE,
        ['off', 'report-only', 'enforce'],
        'report-only'
      ),
      attestationSource: parseEnum(
        'PROOF_ATTESTATION_SOURCE',
        env.PROOF_ATTESTATION_SOURCE,
        ['config', 'file', 'url'],
        'config'
      ),
      attestationFilePath: parseString(
        'PROOF_ATTESTATION_FILE_PATH',
        env.PROOF_ATTESTATION_FILE_PATH,
        ''
      ),
      attestationEndpoint: parseString(
        'PROOF_ATTESTATION_ENDPOINT',
        env.PROOF_ATTESTATION_ENDPOINT,
        ''
      ),
      attestationMaxAgeSeconds: parsePositiveInteger(
        'PROOF_ATTESTATION_MAX_AGE_SECONDS',
        env.PROOF_ATTESTATION_MAX_AGE_SECONDS,
        900
      ),
      runtime: {
        appId: parseString('PROOF_APP_ID', env.PROOF_APP_ID, ''),
        imageDigest: parseString('PROOF_IMAGE_DIGEST', env.PROOF_IMAGE_DIGEST, ''),
        attestationReportHash: parseString(
          'PROOF_ATTESTATION_REPORT_HASH',
          env.PROOF_ATTESTATION_REPORT_HASH,
          ''
        ),
        onchainDeploymentTxHash: parseString(
          'PROOF_ONCHAIN_DEPLOYMENT_TX_HASH',
          env.PROOF_ONCHAIN_DEPLOYMENT_TX_HASH,
          ''
        )
      }
    },
    demo: {
      enabled: parseBoolean(env.DEMO_ENABLED, true),
      signerPrivateKey: parseString('DEMO_SIGNER_PRIVATE_KEY', env.DEMO_SIGNER_PRIVATE_KEY, ''),
      altSignerPrivateKey: parseString(
        'DEMO_ALT_SIGNER_PRIVATE_KEY',
        env.DEMO_ALT_SIGNER_PRIVATE_KEY,
        ''
      ),
      tenantId: parseString('DEMO_TENANT_ID', env.DEMO_TENANT_ID, DEFAULT_DEMO_TENANT_ID),
      targetWalletAddress: parseString(
        'DEMO_TARGET_WALLET_ADDRESS',
        env.DEMO_TARGET_WALLET_ADDRESS,
        DEFAULT_DEMO_TARGET_WALLET
      ),
      defaultChainId: parsePositiveInteger(
        'DEMO_DEFAULT_CHAIN_ID',
        env.DEMO_DEFAULT_CHAIN_ID,
        DEFAULT_DEMO_CHAIN_ID
      )
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
    },
    ai: {
      enabled: parseBoolean(env.AI_ENABLED, true),
      provider: parseEnum('AI_PROVIDER', env.AI_PROVIDER, ['mock'], 'mock'),
      model: parseString('AI_MODEL', env.AI_MODEL, 'eigen-ai-mock-v1'),
      signerPrivateKey: parseString(
        'AI_SIGNER_PRIVATE_KEY',
        env.AI_SIGNER_PRIVATE_KEY,
        DEFAULT_AI_SIGNER_PRIVATE_KEY
      ),
      signerAddress: parseString('AI_SIGNER_ADDRESS', env.AI_SIGNER_ADDRESS, '')
    },
    a2a: {
      enabled: parseBoolean(env.A2A_ENABLED, true),
      allowUnsigned: parseBoolean(env.A2A_ALLOW_UNSIGNED, false),
      sharedSecret: parseString('A2A_SHARED_SECRET', env.A2A_SHARED_SECRET, ''),
      allowedAgentIds: parseCsvList(env.A2A_ALLOWED_AGENT_IDS),
      adminAgentIds: parseCsvList(env.A2A_ADMIN_AGENT_IDS),
      taskAllowlist: parseJsonObject('A2A_TASK_ALLOWLIST_JSON', env.A2A_TASK_ALLOWLIST_JSON) || {},
      nonceTtlSeconds: parsePositiveInteger(
        'A2A_NONCE_TTL_SECONDS',
        env.A2A_NONCE_TTL_SECONDS,
        DEFAULT_NONCE_TTL_SECONDS
      ),
      maxFutureSkewSeconds: parsePositiveInteger(
        'A2A_MAX_FUTURE_SKEW_SECONDS',
        env.A2A_MAX_FUTURE_SKEW_SECONDS,
        DEFAULT_MAX_FUTURE_SKEW_SECONDS
      )
    },
    observability: {
      logLevel: parseEnum('LOG_LEVEL', env.LOG_LEVEL, ['debug', 'info', 'warn', 'error'], 'info'),
      metricsEnabled: parseBoolean(env.METRICS_ENABLED, true),
      metricsRouteEnabled: parseBoolean(env.METRICS_ROUTE_ENABLED, true)
    },
    security: {
      maxJsonBodyBytes: parsePositiveInteger(
        'MAX_JSON_BODY_BYTES',
        env.MAX_JSON_BODY_BYTES,
        DEFAULT_MAX_JSON_BODY_BYTES
      ),
      requestTimeoutMs: parsePositiveInteger(
        'REQUEST_TIMEOUT_MS',
        env.REQUEST_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS
      ),
      rateLimit: {
        enabled: parseBoolean(env.RATE_LIMIT_ENABLED, true),
        windowMs: parsePositiveInteger(
          'RATE_LIMIT_WINDOW_MS',
          env.RATE_LIMIT_WINDOW_MS,
          DEFAULT_RATE_LIMIT_WINDOW_MS
        ),
        maxRequests: parsePositiveInteger(
          'RATE_LIMIT_MAX_REQUESTS',
          env.RATE_LIMIT_MAX_REQUESTS,
          DEFAULT_RATE_LIMIT_MAX_REQUESTS
        )
      }
    },
    operations: {
      secretRotationDays: parsePositiveInteger(
        'SECRET_ROTATION_DAYS',
        env.SECRET_ROTATION_DAYS,
        DEFAULT_SECRET_ROTATION_DAYS
      )
    }
  };
}
