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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLowercaseString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDecisionOutcome(rawOutcome, fallbackOutcome) {
  const normalized = normalizeLowercaseString(rawOutcome);
  if (normalized === 'allow' || normalized === 'deny') {
    return normalized;
  }

  return fallbackOutcome;
}

function inferDecisionStage({ reason, statusCode, outcome }) {
  const normalizedReason = String(reason || '').toUpperCase();
  if (
    normalizedReason.includes('VALIDATION') ||
    normalizedReason.startsWith('INVALID_') ||
    normalizedReason.includes('RAW_SQL')
  ) {
    return 'validation';
  }

  if (
    normalizedReason.includes('AUTH') ||
    normalizedReason.includes('SIGNATURE') ||
    normalizedReason.includes('SIGNER') ||
    normalizedReason.includes('NONCE')
  ) {
    return 'authentication';
  }

  if (
    normalizedReason.includes('POLICY') ||
    normalizedReason.includes('BOOTSTRAP') ||
    normalizedReason.includes('SELF_ESCALATION') ||
    normalizedReason.includes('REVOKE_NOT_AUTHORIZED') ||
    normalizedReason.includes('FALLBACK_DENY') ||
    normalizedReason.includes('TAMPER')
  ) {
    return 'policy';
  }

  if (normalizedReason.includes('RUNTIME')) {
    return 'runtime';
  }

  if (normalizedReason.includes('RATE_LIMIT')) {
    return 'rate_limit';
  }

  if (normalizedReason.includes('TIMEOUT')) {
    return 'timeout';
  }

  if (normalizedReason.includes('SERVICE_UNAVAILABLE')) {
    return 'service';
  }

  if (statusCode >= 500) {
    return 'execution';
  }

  if (outcome === 'allow') {
    return 'execution';
  }

  return 'policy';
}

function inferEmbeddedDecision(payload) {
  if (!isObject(payload)) {
    return null;
  }

  const candidates = [payload.decision, payload.authorization?.decision, payload.details?.decision];
  for (const candidate of candidates) {
    if (isObject(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeReason(statusCode, payload, decision) {
  if (typeof decision?.code === 'string' && decision.code.trim().length > 0) {
    return decision.code.trim();
  }

  if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
    return payload.error.trim();
  }

  if (typeof payload?.code === 'string' && payload.code.trim().length > 0) {
    return payload.code.trim();
  }

  return `HTTP_${statusCode || 'UNKNOWN'}`;
}

export function resolveActionDomain(path) {
  const normalizedPath = typeof path === 'string' ? path : '';

  if (normalizedPath.startsWith('/v1/data/')) {
    return 'data';
  }

  if (normalizedPath.startsWith('/v1/control-plane/')) {
    return 'schema';
  }

  if (normalizedPath.startsWith('/v1/policy/')) {
    return 'policy';
  }

  if (normalizedPath.startsWith('/v1/ai/')) {
    return 'ai';
  }

  if (normalizedPath === '/v1/query') {
    return 'query';
  }

  if (normalizedPath.startsWith('/v1/a2a/')) {
    return 'a2a';
  }

  if (normalizedPath.startsWith('/v1/runtime/')) {
    return 'runtime';
  }

  if (normalizedPath.startsWith('/v1/ops/')) {
    return 'ops';
  }

  if (normalizedPath === '/health') {
    return 'health';
  }

  if (normalizedPath === '/' || normalizedPath === '/demo') {
    return 'demo';
  }

  return normalizedPath.startsWith('/v1/') ? 'api' : 'public';
}

const ACTION_PATH_DOMAINS = new Set(['data', 'schema', 'policy', 'ai']);

export function inferRequestDecisionTelemetry({ statusCode, payload, path, action }) {
  const fallbackOutcome = statusCode >= 200 && statusCode < 400 ? 'allow' : 'deny';
  const embeddedDecision = inferEmbeddedDecision(payload);
  const outcome =
    typeof embeddedDecision?.allowed === 'boolean'
      ? embeddedDecision.allowed
        ? 'allow'
        : 'deny'
      : normalizeDecisionOutcome(embeddedDecision?.outcome, fallbackOutcome);

  const reason = normalizeReason(statusCode, payload, embeddedDecision);
  const stage =
    normalizeLowercaseString(embeddedDecision?.stage) ||
    inferDecisionStage({
      reason,
      statusCode,
      outcome
    });

  const domain = resolveActionDomain(path);
  const actionLabel = normalizeLowercaseString(action) || `${domain}:unknown`;

  return {
    outcome,
    reason,
    stage,
    domain,
    action: actionLabel,
    denyReason: outcome === 'deny' ? reason : null
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
    payload,
    action
  }) {
    const decision = inferRequestDecisionTelemetry({
      statusCode,
      payload,
      path,
      action
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
      reason: decision.reason,
      stage: decision.stage,
      domain: decision.domain,
      action: decision.action
    });

    if (ACTION_PATH_DOMAINS.has(decision.domain)) {
      incrementCounter('action_decision_outcomes_total', {
        outcome: decision.outcome,
        reason: decision.reason,
        stage: decision.stage,
        domain: decision.domain,
        action: decision.action
      });

      if (decision.outcome === 'deny') {
        incrementCounter('action_deny_reasons_total', {
          reason: decision.reason,
          stage: decision.stage,
          domain: decision.domain,
          action: decision.action
        });
      }
    }

    return decision;
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
