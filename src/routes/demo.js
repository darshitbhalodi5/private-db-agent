import fs from 'node:fs/promises';
import { sendJson } from '../lib/http.js';

const demoPagePath = new URL('../../public/demo.html', import.meta.url);
let demoPageHtmlPromise = null;

async function loadDemoPageHtml() {
  if (!demoPageHtmlPromise) {
    demoPageHtmlPromise = fs.readFile(demoPagePath, 'utf-8').catch((error) => {
      demoPageHtmlPromise = null;
      throw error;
    });
  }

  return demoPageHtmlPromise;
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8'
  });
  res.end(html);
}

export async function handleDemoPage(req, res) {
  try {
    const html = await loadDemoPageHtml();
    sendHtml(res, 200, html);
  } catch {
    sendJson(res, 500, {
      error: 'DEMO_PAGE_UNAVAILABLE',
      message: 'Unable to load demo page.'
    });
  }
}

export function handleDemoScenarios(req, res, demoScenarioService) {
  sendJson(res, 200, {
    scenarios: demoScenarioService.listScenarios()
  });
}

export async function handleDemoPayload(req, res, demoScenarioService, urlObject) {
  const scenarioId = urlObject.searchParams.get('scenario');

  if (!scenarioId) {
    sendJson(res, 400, {
      error: 'MISSING_SCENARIO',
      message: 'Query parameter \"scenario\" is required.'
    });
    return;
  }

  const scenarioPayload = await demoScenarioService.buildScenarioPayload(scenarioId);
  if (!scenarioPayload.ok) {
    const statusCode = scenarioPayload.code === 'UNKNOWN_SCENARIO' ? 404 : 400;

    sendJson(res, statusCode, {
      error: scenarioPayload.code,
      message: scenarioPayload.message
    });
    return;
  }

  sendJson(res, 200, {
    scenario: scenarioPayload.scenario,
    payload: scenarioPayload.payload
  });
}
