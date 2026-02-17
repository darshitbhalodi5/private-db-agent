import { loadConfig } from '../config.js';
import { createAuthService } from './authService.js';
import { createPolicyService } from './policyService.js';

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'VALIDATION_ERROR',
        message: 'Request body must be a JSON object.'
      }
    };
  }

  const requiredFields = ['requestId', 'requester', 'capability', 'queryTemplate'];
  const missing = requiredFields.filter(
    (field) => typeof payload[field] !== 'string' || payload[field].trim().length === 0
  );

  if (missing.length > 0) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'VALIDATION_ERROR',
        message: `Missing required fields: ${missing.join(', ')}`
      }
    };
  }

  if (
    payload.queryParams !== undefined &&
    (payload.queryParams === null ||
      Array.isArray(payload.queryParams) ||
      typeof payload.queryParams !== 'object')
  ) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'VALIDATION_ERROR',
        message: 'queryParams must be a JSON object when provided.'
      }
    };
  }

  return { ok: true };
}

export function createQueryService({ authService, policyService }) {
  return {
    async handle(payload) {
      const validation = validatePayload(payload);
      if (!validation.ok) {
        return {
          statusCode: validation.statusCode,
          body: validation.body
        };
      }

      const authResult = await authService.authenticate(payload);
      if (!authResult.ok) {
        return {
          statusCode: 401,
          body: {
            error: 'AUTHENTICATION_FAILED',
            code: authResult.code,
            message: authResult.message,
            requestId: payload.requestId
          }
        };
      }

      const policyResult = policyService.evaluateAccess({
        requester: authResult.requester,
        capability: payload.capability,
        queryTemplate: payload.queryTemplate
      });

      if (!policyResult.allowed) {
        return {
          statusCode: 403,
          body: {
            error: 'POLICY_DENIED',
            code: policyResult.code,
            message: policyResult.message,
            requestId: payload.requestId,
            capability: payload.capability,
            queryTemplate: payload.queryTemplate,
            details: {
              allowedTemplates: policyResult.allowedTemplates || []
            }
          }
        };
      }

      return {
        statusCode: 501,
        body: {
          error: 'NOT_IMPLEMENTED',
          message: 'Query execution layer is not implemented yet.',
          requestId: payload.requestId,
          requester: authResult.requester,
          capability: payload.capability,
          queryTemplate: payload.queryTemplate,
          auth: {
            signedAt: authResult.signedAt || null,
            nonce: authResult.nonce || null,
            bypassed: Boolean(authResult.authBypassed)
          },
          policy: {
            code: policyResult.code,
            message: policyResult.message
          }
        }
      };
    }
  };
}

const runtimeConfig = loadConfig();
const defaultQueryService = createQueryService({
  authService: createAuthService(runtimeConfig.auth),
  policyService: createPolicyService(runtimeConfig.policy)
});

export async function handleQueryRequest(payload, overrides = null) {
  if (overrides?.authService || overrides?.policyService) {
    const queryService = createQueryService({
      authService: overrides.authService || createAuthService(runtimeConfig.auth),
      policyService: overrides.policyService || createPolicyService(runtimeConfig.policy)
    });

    return queryService.handle(payload);
  }

  return defaultQueryService.handle(payload);
}
