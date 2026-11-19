import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('plugin preferences persist, converge and remain controllable while off', () => {
  const result = spawnSync('python3', [resolve('tests/plugin_settings_test.py')], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
