import { createHash, randomBytes } from 'node:crypto';
import { getAddress, Wallet } from 'ethers';
import { buildSignedMessage } from './authService.js';

const SCENARIO_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'allow-balance-read',
    name: 'Authorized Balance Read',
    description:
      'Valid signature + permitted capability/template. Expected result: query executes with status 200.',
    expectedStatusCode: 200,
    expectedDecision: 'allow',
    stage: 'execution'
  }),
  Object.freeze({
    id: 'deny-policy-write-attempt',
    name: 'Denied Policy Write Attempt',
    description:
      'Valid signature but read capability attempting write template. Expected result: policy denial with status 403.',
    expectedStatusCode: 403,
    expectedDecision: 'deny',
    stage: 'policy'
  }),
  Object.freeze({
    id: 'deny-auth-signer-mismatch',
    name: 'Denied Auth Signer Mismatch',
    description:
      'Payload requester address does not match signature signer. Expected result: auth failure with status 401.',
    expectedStatusCode: 401,
    expectedDecision: 'deny',
    stage: 'authentication'
  })
]);

function derivePrivateKey(seed) {
  return `0x${createHash('sha256').update(seed).digest('hex')}`;
}

function ensurePrivateKey(rawKey, fallbackSeed) {
  if (rawKey && rawKey.trim().length > 0) {
    return rawKey.trim();
  }

  return derivePrivateKey(fallbackSeed);
}

function createWallets(demoConfig) {
  const signerPrivateKey = ensurePrivateKey(demoConfig.signerPrivateKey, 'demo-primary-signer');
  const altSignerPrivateKey = ensurePrivateKey(demoConfig.altSignerPrivateKey, 'demo-alt-signer');

  return {
    primaryWallet: new Wallet(signerPrivateKey),
    alternateWallet: new Wallet(altSignerPrivateKey)
  };
}

function normalizeAddress(rawAddress) {
  return getAddress(rawAddress);
}

function createRequestId(scenarioId, nowMs) {
  return `demo-${scenarioId}-${nowMs}`;
}

function createNonce() {
  return randomBytes(12).toString('hex');
}

function createScenarioMetadata(scenario, requester) {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    expectedStatusCode: scenario.expectedStatusCode,
    expectedDecision: scenario.expectedDecision,
    stage: scenario.stage,
    requester
  };
}

async function buildSignedPayload(basePayload, signerWallet) {
  const signedMessage = buildSignedMessage(basePayload);
  const signature = await signerWallet.signMessage(signedMessage);

  return {
    ...basePayload,
    auth: {
      ...basePayload.auth,
      signature
    }
  };
}

function createAllowPayload({ requester, targetWalletAddress, chainId, nowIso, nowMs }) {
  return {
    requestId: createRequestId('allow-balance-read', nowMs),
    requester,
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: targetWalletAddress,
      chainId,
      limit: 5
    },
    auth: {
      nonce: createNonce(),
      signedAt: nowIso
    }
  };
}

function createPolicyDenyPayload({ requester, targetWalletAddress, nowIso, nowMs }) {
  return {
    requestId: createRequestId('deny-policy-write-attempt', nowMs),
    requester,
    capability: 'balances:read',
    queryTemplate: 'access_log_insert',
    queryParams: {
      requestId: `deny-write-${nowMs}`,
      requester: targetWalletAddress,
      capability: 'balances:read',
      queryTemplate: 'access_log_insert',
      decision: 'allow',
      createdAt: nowIso
    },
    auth: {
      nonce: createNonce(),
      signedAt: nowIso
    }
  };
}

function createAuthDenyPayload({ requester, targetWalletAddress, chainId, nowIso, nowMs }) {
  return {
    requestId: createRequestId('deny-auth-signer-mismatch', nowMs),
    requester,
    capability: 'balances:read',
    queryTemplate: 'wallet_balances',
    queryParams: {
      walletAddress: targetWalletAddress,
      chainId,
      limit: 5
    },
    auth: {
      nonce: createNonce(),
      signedAt: nowIso
    }
  };
}

export function createDemoScenarioService(demoConfig, { now = () => new Date() } = {}) {
  const defaultTargetWallet = '0x8ba1f109551bd432803012645ac136ddd64dba72';

  const config = {
    enabled: demoConfig?.enabled !== undefined ? Boolean(demoConfig.enabled) : true,
    targetWalletAddress: normalizeAddress(
      demoConfig?.targetWalletAddress || defaultTargetWallet
    ),
    defaultChainId: demoConfig?.defaultChainId || 1,
    signerPrivateKey: demoConfig?.signerPrivateKey || '',
    altSignerPrivateKey: demoConfig?.altSignerPrivateKey || ''
  };

  const { primaryWallet, alternateWallet } = createWallets(config);

  function listScenarios() {
    return SCENARIO_DEFINITIONS.map((scenario) =>
      createScenarioMetadata(scenario, primaryWallet.address)
    );
  }

  async function buildScenarioPayload(scenarioId) {
    if (!config.enabled) {
      return {
        ok: false,
        code: 'DEMO_DISABLED',
        message: 'Demo scenarios are disabled.'
      };
    }

    const scenario = SCENARIO_DEFINITIONS.find((candidate) => candidate.id === scenarioId);
    if (!scenario) {
      return {
        ok: false,
        code: 'UNKNOWN_SCENARIO',
        message: `Unknown demo scenario '${scenarioId}'.`
      };
    }

    const nowDate = now();
    const nowIso = nowDate.toISOString();
    const nowMs = nowDate.getTime();
    const requester = primaryWallet.address;

    if (scenario.id === 'allow-balance-read') {
      const payload = createAllowPayload({
        requester,
        targetWalletAddress: config.targetWalletAddress,
        chainId: config.defaultChainId,
        nowIso,
        nowMs
      });

      return {
        ok: true,
        scenario: createScenarioMetadata(scenario, requester),
        payload: await buildSignedPayload(payload, primaryWallet)
      };
    }

    if (scenario.id === 'deny-policy-write-attempt') {
      const payload = createPolicyDenyPayload({
        requester,
        targetWalletAddress: config.targetWalletAddress,
        nowIso,
        nowMs
      });

      return {
        ok: true,
        scenario: createScenarioMetadata(scenario, requester),
        payload: await buildSignedPayload(payload, primaryWallet)
      };
    }

    if (scenario.id === 'deny-auth-signer-mismatch') {
      const payload = createAuthDenyPayload({
        requester,
        targetWalletAddress: config.targetWalletAddress,
        chainId: config.defaultChainId,
        nowIso,
        nowMs
      });

      return {
        ok: true,
        scenario: createScenarioMetadata(scenario, requester),
        payload: await buildSignedPayload(payload, alternateWallet)
      };
    }

    return {
      ok: false,
      code: 'UNSUPPORTED_SCENARIO',
      message: `Scenario '${scenarioId}' is not supported.`
    };
  }

  return {
    listScenarios,
    buildScenarioPayload
  };
}
