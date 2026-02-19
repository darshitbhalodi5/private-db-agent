import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLogContext, resolveRouteAction, shouldApplyRateLimit } from '../src/server.js';

function createContextInput({
  method,
  pathname,
  requestPayload = null,
  responsePayload = null,
  statusCode,
  search = ''
}) {
  const url = new URL(`http://localhost${pathname}${search}`);
  return {
    req: requestPayload ? { __parsedJsonBody: requestPayload } : {},
    requestUrl: url,
    method,
    pathname,
    payload: responsePayload,
    statusCode
  };
}

test('resolveRouteAction maps protected action routes to stable labels', () => {
  assert.equal(resolveRouteAction('POST', '/v1/data/execute'), 'data:execute');
  assert.equal(resolveRouteAction('POST', '/v1/control-plane/apply'), 'schema:apply');
  assert.equal(resolveRouteAction('POST', '/v1/control-plane/submit'), 'schema:submit');
  assert.equal(resolveRouteAction('POST', '/v1/policy/grants'), 'policy:grant:create');
  assert.equal(resolveRouteAction('POST', '/v1/ai/schema-draft'), 'ai:schema:draft');
});

test('shouldApplyRateLimit keeps v1 routes protected and excludes health/demo', () => {
  assert.equal(shouldApplyRateLimit('/v1/data/execute'), true);
  assert.equal(shouldApplyRateLimit('/v1/ai/schema-draft'), true);
  assert.equal(shouldApplyRateLimit('/health'), false);
  assert.equal(shouldApplyRateLimit('/demo'), false);
  assert.equal(shouldApplyRateLimit('/'), false);
});

test('collectLogContext includes actor, tenant, action, correlation-ready decision fields', () => {
  const actorWallet = '0x000000000000000000000000000000000000ABCD';
  const context = collectLogContext(
    createContextInput({
      method: 'POST',
      pathname: '/v1/control-plane/submit',
      statusCode: 400,
      requestPayload: {
        requestId: 'req-obs-1',
        tenantId: 'tenant_demo',
        actorWallet
      },
      responsePayload: {
        error: 'VALIDATION_ERROR',
        message: 'auth object is required.'
      }
    })
  );

  assert.equal(context.action, 'schema:submit');
  assert.equal(context.actorWallet, actorWallet.toLowerCase());
  assert.equal(context.tenantId, 'tenant_demo');
  assert.equal(context.decision.outcome, 'deny');
  assert.equal(context.decision.stage, 'validation');
  assert.equal(context.decision.denyReason, 'VALIDATION_ERROR');
});

test('collectLogContext resolves deny reason for rate-limited action responses', () => {
  const context = collectLogContext(
    createContextInput({
      method: 'POST',
      pathname: '/v1/control-plane/submit',
      statusCode: 429,
      responsePayload: {
        error: 'RATE_LIMITED',
        message: 'Too many requests.'
      }
    })
  );

  assert.equal(context.action, 'schema:submit');
  assert.equal(context.decision.outcome, 'deny');
  assert.equal(context.decision.stage, 'rate_limit');
  assert.equal(context.decision.denyReason, 'RATE_LIMITED');
});

test('collectLogContext resolves deny reason for body size violations on AI routes', () => {
  const context = collectLogContext(
    createContextInput({
      method: 'POST',
      pathname: '/v1/ai/schema-draft',
      statusCode: 413,
      responsePayload: {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds configured limit.'
      }
    })
  );

  assert.equal(context.action, 'ai:schema:draft');
  assert.equal(context.decision.outcome, 'deny');
  assert.equal(context.decision.stage, 'policy');
  assert.equal(context.decision.denyReason, 'PAYLOAD_TOO_LARGE');
});
