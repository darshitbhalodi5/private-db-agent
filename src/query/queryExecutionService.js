import { getAddress } from 'ethers';
import { getQueryTemplate, TEMPLATE_MODE } from './templateRegistry.js';

function createError(statusCode, code, message, details = {}) {
  return {
    ok: false,
    statusCode,
    code,
    message,
    details
  };
}

function validateAndNormalizeParam(paramSpec, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (paramSpec.required) {
      return { ok: false, code: 'MISSING_PARAM', message: `Missing required param '${paramSpec.name}'.` };
    }

    if (Object.hasOwn(paramSpec, 'default')) {
      return { ok: true, value: paramSpec.default };
    }

    return { ok: true, value: undefined };
  }

  if (paramSpec.type === 'integer') {
    const parsed = Number.parseInt(String(rawValue), 10);

    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        code: 'INVALID_PARAM_TYPE',
        message: `Param '${paramSpec.name}' must be an integer.`
      };
    }

    if (paramSpec.min !== undefined && parsed < paramSpec.min) {
      return {
        ok: false,
        code: 'INVALID_PARAM_RANGE',
        message: `Param '${paramSpec.name}' must be >= ${paramSpec.min}.`
      };
    }

    if (paramSpec.max !== undefined && parsed > paramSpec.max) {
      return {
        ok: false,
        code: 'INVALID_PARAM_RANGE',
        message: `Param '${paramSpec.name}' must be <= ${paramSpec.max}.`
      };
    }

    return { ok: true, value: parsed };
  }

  if (paramSpec.type === 'string') {
    const normalized = String(rawValue).trim();

    if (paramSpec.minLength !== undefined && normalized.length < paramSpec.minLength) {
      return {
        ok: false,
        code: 'INVALID_PARAM_LENGTH',
        message: `Param '${paramSpec.name}' length must be >= ${paramSpec.minLength}.`
      };
    }

    if (paramSpec.maxLength !== undefined && normalized.length > paramSpec.maxLength) {
      return {
        ok: false,
        code: 'INVALID_PARAM_LENGTH',
        message: `Param '${paramSpec.name}' length must be <= ${paramSpec.maxLength}.`
      };
    }

    return { ok: true, value: normalized };
  }

  if (paramSpec.type === 'address') {
    try {
      return { ok: true, value: getAddress(String(rawValue)).toLowerCase() };
    } catch {
      return {
        ok: false,
        code: 'INVALID_PARAM_FORMAT',
        message: `Param '${paramSpec.name}' must be a valid EVM address.`
      };
    }
  }

  if (paramSpec.type === 'enum') {
    const normalized = String(rawValue);
    if (!paramSpec.values.includes(normalized)) {
      return {
        ok: false,
        code: 'INVALID_PARAM_VALUE',
        message: `Param '${paramSpec.name}' must be one of: ${paramSpec.values.join(', ')}.`
      };
    }

    return { ok: true, value: normalized };
  }

  if (paramSpec.type === 'isoDate') {
    const parsedMs = Date.parse(String(rawValue));
    if (!Number.isFinite(parsedMs)) {
      return {
        ok: false,
        code: 'INVALID_PARAM_FORMAT',
        message: `Param '${paramSpec.name}' must be a valid ISO date string.`
      };
    }

    return { ok: true, value: new Date(parsedMs).toISOString() };
  }

  return {
    ok: false,
    code: 'INVALID_TEMPLATE_CONFIG',
    message: `Unsupported param type '${paramSpec.type}' in template config.`
  };
}

function validateParams(template, queryParams = {}) {
  const normalized = {};
  const allowedNames = new Set(template.params.map((param) => param.name));

  for (const key of Object.keys(queryParams)) {
    if (!allowedNames.has(key)) {
      return createError(400, 'UNKNOWN_PARAM', `Unknown query param '${key}'.`, {
        allowedParams: [...allowedNames]
      });
    }
  }

  for (const paramSpec of template.params) {
    const result = validateAndNormalizeParam(paramSpec, queryParams[paramSpec.name]);
    if (!result.ok) {
      return createError(400, result.code, result.message, {
        param: paramSpec.name
      });
    }

    if (result.value !== undefined) {
      normalized[paramSpec.name] = result.value;
    }
  }

  return {
    ok: true,
    normalized
  };
}

function inferCapabilityMode(capability) {
  if (capability.endsWith(':read')) {
    return TEMPLATE_MODE.READ;
  }

  if (capability.endsWith(':write')) {
    return TEMPLATE_MODE.WRITE;
  }

  return 'mixed';
}

function enforceModeCompatibility(capability, templateMode, enabled) {
  if (!enabled) {
    return { ok: true };
  }

  const capabilityMode = inferCapabilityMode(capability);

  if (capabilityMode === TEMPLATE_MODE.READ && templateMode === TEMPLATE_MODE.WRITE) {
    return createError(
      403,
      'CAPABILITY_MODE_MISMATCH',
      `Capability '${capability}' cannot execute write templates.`
    );
  }

  return { ok: true };
}

export function createQueryExecutionService({
  databaseAdapter,
  enforceCapabilityMode = true
}) {
  async function execute({ capability, queryTemplate, queryParams }) {
    const template = getQueryTemplate(queryTemplate);

    if (!template) {
      return createError(400, 'UNKNOWN_QUERY_TEMPLATE', `Unknown query template '${queryTemplate}'.`);
    }

    const modeCheck = enforceModeCompatibility(capability, template.mode, enforceCapabilityMode);
    if (!modeCheck.ok) {
      return modeCheck;
    }

    const normalizedParamsResult = validateParams(template, queryParams || {});
    if (!normalizedParamsResult.ok) {
      return normalizedParamsResult;
    }

    const sql = template.sql[databaseAdapter.dialect];
    if (!sql) {
      return createError(
        500,
        'UNSUPPORTED_DIALECT',
        `Template '${queryTemplate}' does not support dialect '${databaseAdapter.dialect}'.`
      );
    }

    const values = template.bind(normalizedParamsResult.normalized);

    try {
      const execution = await databaseAdapter.execute({
        mode: template.mode,
        queryTemplate,
        sql,
        values
      });

      return {
        ok: true,
        statusCode: 200,
        data: {
          queryTemplate,
          mode: template.mode,
          rowCount: execution.rowCount,
          rows: execution.rows,
          normalizedParams: normalizedParamsResult.normalized
        }
      };
    } catch (error) {
      return createError(500, 'DB_EXECUTION_FAILED', error.message || 'Database query failed.');
    }
  }

  return {
    execute
  };
}
