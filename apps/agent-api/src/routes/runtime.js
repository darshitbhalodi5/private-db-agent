import { loadConfig } from '../config.js';
import { sendJson } from '../lib/http.js';
import { createRuntimeAttestationService } from '../services/runtimeAttestationService.js';

const runtimeConfig = loadConfig();
const runtimeAttestationService = createRuntimeAttestationService(runtimeConfig.proof);

export async function handleRuntimeAttestationStatus(req, res) {
  try {
    const runtime = await runtimeAttestationService.getSnapshot({
      action: 'runtime:attestation:read',
      sensitive: false
    });

    sendJson(res, 200, {
      code: 'RUNTIME_ATTESTATION_STATUS',
      runtime
    });
  } catch (error) {
    sendJson(res, 503, {
      error: 'RUNTIME_ATTESTATION_UNAVAILABLE',
      message: error?.message || 'Unable to resolve runtime attestation status.'
    });
  }
}
