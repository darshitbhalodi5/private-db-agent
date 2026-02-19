import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from '../src/lib/http.js';

test('readJsonBody parses valid JSON payload', async () => {
  const req = Readable.from([Buffer.from('{"hello":"world"}')]);
  req.context = {
    maxJsonBodyBytes: 1024
  };

  const payload = await readJsonBody(req);
  assert.equal(payload.hello, 'world');
});

test('readJsonBody rejects payload above maxJsonBodyBytes', async () => {
  const req = Readable.from([Buffer.from('{"large":"1234567890"}')]);
  req.context = {
    maxJsonBodyBytes: 8
  };

  await assert.rejects(
    async () => readJsonBody(req),
    (error) => error?.code === 'PAYLOAD_TOO_LARGE'
  );
});

test('readJsonBody rejects invalid JSON payloads', async () => {
  const req = Readable.from([Buffer.from('{invalid')]);
  req.context = {
    maxJsonBodyBytes: 1024
  };

  await assert.rejects(
    async () => readJsonBody(req),
    (error) => error?.code === 'INVALID_JSON'
  );
});
