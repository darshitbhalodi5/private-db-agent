const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

const LOG_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

const REDACTED_VALUE = '[REDACTED]';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLevel(rawLevel) {
  const normalized = String(rawLevel || '').trim().toLowerCase();
  return LOG_LEVELS.includes(normalized) ? normalized : 'info';
}

function shouldRedactKey(key) {
  const normalized = String(key || '').toLowerCase();
  return (
    normalized.includes('secret') ||
    normalized.includes('privatekey') ||
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('signature')
  );
}

function sanitizeForLog(value, key = '', depth = 0) {
  if (depth > 4) {
    return '[MAX_DEPTH]';
  }

  if (shouldRedactKey(key)) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLog(entry, key, depth + 1));
  }

  if (isObject(value)) {
    const sanitized = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeForLog(entryValue, entryKey, depth + 1);
    }
    return sanitized;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  return value;
}

export function createLogger({
  level = 'info',
  serviceName = 'private-db-agent-api',
  version = '0.1.0',
  environment = 'development'
} = {}) {
  const minLevel = normalizeLevel(level);

  function canLog(levelName) {
    return LOG_PRIORITY[levelName] >= LOG_PRIORITY[minLevel];
  }

  function write(levelName, event, fields = {}) {
    if (!canLog(levelName)) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      event,
      service: serviceName,
      version,
      environment,
      ...sanitizeForLog(fields)
    };

    const line = JSON.stringify(entry);
    if (levelName === 'error' || levelName === 'warn') {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
    debug: (event, fields = {}) => write('debug', event, fields),
    info: (event, fields = {}) => write('info', event, fields),
    warn: (event, fields = {}) => write('warn', event, fields),
    error: (event, fields = {}) => write('error', event, fields)
  };
}
