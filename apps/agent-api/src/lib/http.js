function createBodyReadError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function toPositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallbackValue;
  }

  return parsed;
}

export async function readJsonBody(req, { maxBytes } = {}) {
  const chunks = [];
  const effectiveMaxBytes = toPositiveInteger(maxBytes, req?.context?.maxJsonBodyBytes || 1_048_576);
  let totalBytes = 0;

  for await (const chunk of req) {
    const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk || ''));
    totalBytes += size;
    if (totalBytes > effectiveMaxBytes) {
      throw createBodyReadError(
        'PAYLOAD_TOO_LARGE',
        `Request body exceeds limit of ${effectiveMaxBytes} bytes.`
      );
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    const emptyPayload = {};
    req.__parsedJsonBody = emptyPayload;
    return emptyPayload;
  }

  const raw = Buffer.concat(chunks).toString('utf-8');

  try {
    const parsed = JSON.parse(raw);
    req.__parsedJsonBody = parsed;
    return parsed;
  } catch {
    throw createBodyReadError('INVALID_JSON', 'Request body must be valid JSON.');
  }
}

export function sendJson(res, statusCode, payload) {
  if (res.writableEnded) {
    return;
  }

  res.__responsePayload = payload;
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function sendJsonBodyReadError(res, error) {
  if (error?.code === 'PAYLOAD_TOO_LARGE') {
    sendJson(res, 413, {
      error: 'PAYLOAD_TOO_LARGE',
      message: error?.message || 'Request body exceeds configured limit.'
    });
    return;
  }

  sendJson(res, 400, {
    error: 'INVALID_JSON',
    message: 'Request body must be valid JSON.'
  });
}
