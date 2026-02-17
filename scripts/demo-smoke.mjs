const baseUrl = process.argv[2] || 'http://localhost:8080';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();

  return {
    status: response.status,
    ok: response.ok,
    body
  };
}

async function runScenario(scenario) {
  const payloadResponse = await fetchJson(
    `${baseUrl}/v1/demo/payload?scenario=${encodeURIComponent(scenario.id)}`
  );

  if (!payloadResponse.ok) {
    throw new Error(
      `[${scenario.id}] failed to build payload (${payloadResponse.status}): ${JSON.stringify(payloadResponse.body)}`
    );
  }

  const queryResponse = await fetchJson(`${baseUrl}/v1/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payloadResponse.body.payload)
  });

  const pass = queryResponse.status === scenario.expectedStatusCode;

  return {
    scenarioId: scenario.id,
    expectedStatusCode: scenario.expectedStatusCode,
    actualStatusCode: queryResponse.status,
    pass,
    resultCode: queryResponse.body?.code || queryResponse.body?.error || 'UNKNOWN',
    receiptId: queryResponse.body?.receipt?.receiptId || null,
    decision: queryResponse.body?.receipt?.verification?.decision?.outcome || null
  };
}

async function main() {
  const health = await fetchJson(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed (${health.status}).`);
  }

  const scenariosResponse = await fetchJson(`${baseUrl}/v1/demo/scenarios`);
  if (!scenariosResponse.ok) {
    throw new Error(
      `Failed to load scenarios (${scenariosResponse.status}): ${JSON.stringify(scenariosResponse.body)}`
    );
  }

  const scenarios = scenariosResponse.body.scenarios || [];
  if (scenarios.length === 0) {
    throw new Error('No demo scenarios returned by API.');
  }

  const results = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  const failed = results.filter((result) => !result.pass);

  console.log(JSON.stringify({
    baseUrl,
    total: results.length,
    failed: failed.length,
    results
  }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
