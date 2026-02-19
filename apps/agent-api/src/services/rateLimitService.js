function normalizeInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallbackValue;
  }

  return parsed;
}

export function createRateLimitService(
  rawConfig = {},
  { now = () => Date.now() } = {}
) {
  const config = {
    enabled: rawConfig.enabled !== undefined ? Boolean(rawConfig.enabled) : true,
    windowMs: normalizeInteger(rawConfig.windowMs, 60_000),
    maxRequests: normalizeInteger(rawConfig.maxRequests, 300)
  };

  const windows = new Map();

  function pruneExpired(nowMs) {
    for (const [key, entry] of windows.entries()) {
      if (entry.resetAt <= nowMs) {
        windows.delete(key);
      }
    }
  }

  function consume(key) {
    if (!config.enabled) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        retryAfterSeconds: 0
      };
    }

    const safeKey = String(key || '').trim().toLowerCase();
    if (!safeKey) {
      return {
        allowed: true,
        remaining: config.maxRequests,
        retryAfterSeconds: 0
      };
    }

    const nowMs = now();
    pruneExpired(nowMs);

    const existing = windows.get(safeKey);
    if (!existing || existing.resetAt <= nowMs) {
      windows.set(safeKey, {
        count: 1,
        resetAt: nowMs + config.windowMs
      });

      return {
        allowed: true,
        remaining: Math.max(0, config.maxRequests - 1),
        retryAfterSeconds: Math.ceil(config.windowMs / 1000)
      };
    }

    if (existing.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000))
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, config.maxRequests - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000))
    };
  }

  return {
    consume
  };
}
