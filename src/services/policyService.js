import { DEFAULT_CAPABILITY_RULES } from '../policy/capabilityRules.js';

function cloneRules(inputRules) {
  return JSON.parse(JSON.stringify(inputRules));
}

function normalizeStringList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const normalized = values
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  return normalized.length > 0 ? normalized : null;
}

function normalizeRules(rawRules) {
  const baseRules = rawRules || DEFAULT_CAPABILITY_RULES;
  const normalizedRules = {};

  for (const [capability, rule] of Object.entries(baseRules)) {
    const templates = normalizeStringList(rule?.templates);
    if (!templates) {
      continue;
    }

    const requesters = normalizeStringList(rule?.requesters)?.map((address) =>
      address.toLowerCase()
    );

    normalizedRules[capability] = {
      templates,
      requesters: requesters || null
    };
  }

  return normalizedRules;
}

export function createPolicyService(policyConfig = {}) {
  const capabilityRules = normalizeRules(
    policyConfig.capabilityRules ? cloneRules(policyConfig.capabilityRules) : null
  );

  function evaluateAccess({ requester, capability, queryTemplate }) {
    const rule = capabilityRules[capability];

    if (!rule) {
      return {
        allowed: false,
        code: 'UNKNOWN_CAPABILITY',
        message: `Capability '${capability}' is not configured.`,
        capability,
        queryTemplate
      };
    }

    if (!rule.templates.includes(queryTemplate)) {
      return {
        allowed: false,
        code: 'TEMPLATE_NOT_ALLOWED',
        message: `Capability '${capability}' does not allow template '${queryTemplate}'.`,
        capability,
        queryTemplate,
        allowedTemplates: rule.templates
      };
    }

    if (rule.requesters && !rule.requesters.includes(requester.toLowerCase())) {
      return {
        allowed: false,
        code: 'REQUESTER_NOT_ALLOWED',
        message: `Requester is not authorized for capability '${capability}'.`,
        capability,
        queryTemplate
      };
    }

    return {
      allowed: true,
      code: 'ALLOWED',
      message: 'Capability policy matched.',
      capability,
      queryTemplate
    };
  }

  return {
    evaluateAccess
  };
}
