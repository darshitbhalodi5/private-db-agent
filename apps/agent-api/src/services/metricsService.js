function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSort(entry));
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }

  return value;
}

function normalizeLabels(labels = {}) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    return {};
  }

  const safe = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    safe[String(key)] = String(value);
  }
  return safe;
}

function labelsKey(labels) {
  return JSON.stringify(stableSort(normalizeLabels(labels)));
}

function counterKey(name, labels) {
  return `${name}|${labelsKey(labels)}`;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizeStatusCode(statusCode) {
  if (!Number.isInteger(statusCode)) {
    return 'unknown';
  }

  return String(statusCode);
}

function inferDecision({ statusCode, payload }) {
  if (statusCode >= 200 && statusCode < 400) {
    return {
      outcome: 'allow',
      reason: payload?.code || 'SUCCESS'
    };
  }

  return {
    outcome: 'deny',
    reason: payload?.error || payload?.code || `HTTP_${statusCode || 'UNKNOWN'}`
  };
}

export function createMetricsService() {
  const counters = new Map();
  const durations = new Map();

  function incrementCounter(name, labels = {}, value = 1) {
    if (!name || !isFiniteNumber(value)) {
      return;
    }

    const key = counterKey(name, labels);
    const current = counters.get(key);
    if (current) {
      current.value += value;
      return;
    }

    counters.set(key, {
      name,
      labels: normalizeLabels(labels),
      value
    });
  }

  function observeDuration(name, durationMs, labels = {}) {
    if (!name || !isFiniteNumber(durationMs)) {
      return;
    }

    const key = counterKey(name, labels);
    const current = durations.get(key);
    if (!current) {
      durations.set(key, {
        name,
        labels: normalizeLabels(labels),
        count: 1,
        totalMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
        lastMs: durationMs
      });
      return;
    }

    current.count += 1;
    current.totalMs += durationMs;
    current.minMs = Math.min(current.minMs, durationMs);
    current.maxMs = Math.max(current.maxMs, durationMs);
    current.lastMs = durationMs;
  }

  function recordHttpRequest({
    method,
    path,
    statusCode,
    durationMs,
    payload
  }) {
    const decision = inferDecision({
      statusCode,
      payload
    });

    incrementCounter('http_requests_total', {
      method: String(method || 'UNKNOWN').toUpperCase(),
      path: path || 'unknown',
      statusCode: normalizeStatusCode(statusCode)
    });

    observeDuration('http_request_duration_ms', durationMs, {
      method: String(method || 'UNKNOWN').toUpperCase(),
      path: path || 'unknown',
      statusCode: normalizeStatusCode(statusCode)
    });

    incrementCounter('decision_outcomes_total', {
      outcome: decision.outcome,
      reason: decision.reason
    });
  }

  function snapshot() {
    const counterList = [...counters.values()]
      .slice()
      .sort((left, right) => `${left.name}|${labelsKey(left.labels)}`.localeCompare(`${right.name}|${labelsKey(right.labels)}`, 'en'));

    const durationList = [...durations.values()]
      .map((entry) => ({
        ...entry,
        avgMs: entry.count > 0 ? entry.totalMs / entry.count : 0
      }))
      .sort((left, right) => `${left.name}|${labelsKey(left.labels)}`.localeCompare(`${right.name}|${labelsKey(right.labels)}`, 'en'));

    return {
      counters: counterList,
      durations: durationList
    };
  }

  function reset() {
    counters.clear();
    durations.clear();
  }

  return {
    incrementCounter,
    observeDuration,
    recordHttpRequest,
    snapshot,
    reset
  };
}

const runtimeMetricsService = createMetricsService();

export function getRuntimeMetricsService() {
  return runtimeMetricsService;
}
