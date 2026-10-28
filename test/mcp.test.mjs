import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';

test('official SDK client exercises the real stdio server', { timeout: 120000 }, async () => {
  await mkdir('artifacts/tests', { recursive: true });
  const output = await mkdtemp(path.resolve('artifacts/tests/mcp-'));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['dist/mcp-smoke.js', output], { timeout: 110000, maxBuffer: 2_000_000 });
  const result = JSON.parse(stdout); assert.equal(result.status, 'passed'); assert.equal(result.tools, 17); assert.equal(stderr, '');
});
