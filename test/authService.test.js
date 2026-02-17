import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  buildSignedMessage,
  createAuthService,
  NonceStore
} from '../src/services/authService.js';

async function createSignedPayload(wallet, overrides = {}) {
  const payload = {
    requestId: overrides.requestId || 'req-auth-1',
    requester: overrides.requester || wallet.address,
    capability: overrides.capability || 'balances:read',
    queryTemplate: overrides.queryTemplate || 'wallet_balances',
    queryParams: overrides.queryParams || { chainId: 1 },
    auth: {
      nonce: overrides.nonce || 'nonce-1',
      signedAt: overrides.signedAt || '2026-02-17T10:00:00.000Z'
    }
  };

  const message = buildSignedMessage(payload);
  const signature = await wallet.signMessage(message);
  payload.auth.signature = signature;

  return payload;
}

test('authenticate accepts valid signature and nonce', async () => {
  const wallet = Wallet.createRandom();
  const payload = await createSignedPayload(wallet);
  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-17T10:01:00.000Z')
    }
  );

  const result = await authService.authenticate(payload);

  assert.equal(result.ok, true);
  assert.equal(result.requester, wallet.address);
  assert.equal(result.nonce, 'nonce-1');
});

test('authenticate rejects signer mismatch', async () => {
  const signer = Wallet.createRandom();
  const requester = Wallet.createRandom();
  const payload = await createSignedPayload(signer, {
    requester: requester.address
  });

  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-17T10:01:00.000Z')
    }
  );

  const result = await authService.authenticate(payload);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNER_MISMATCH');
});

test('authenticate rejects nonce replay within TTL window', async () => {
  const wallet = Wallet.createRandom();
  const payload = await createSignedPayload(wallet);
  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 300,
      maxFutureSkewSeconds: 60
    },
    {
      nonceStore: new NonceStore(),
      now: () => Date.parse('2026-02-17T10:01:00.000Z')
    }
  );

  const first = await authService.authenticate(payload);
  const second = await authService.authenticate(payload);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'NONCE_REPLAY');
});

test('authenticate rejects expired signatures', async () => {
  const wallet = Wallet.createRandom();
  const payload = await createSignedPayload(wallet, {
    signedAt: '2026-02-17T10:00:00.000Z'
  });

  const authService = createAuthService(
    {
      enabled: true,
      nonceTtlSeconds: 120,
      maxFutureSkewSeconds: 60
    },
    {
      now: () => Date.parse('2026-02-17T10:05:00.000Z')
    }
  );

  const result = await authService.authenticate(payload);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNATURE_EXPIRED');
});
