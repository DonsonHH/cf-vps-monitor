import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { toPublicClient } from './public-client.ts';

const privateFields = ['token', 'token_hash', 'token_last_used_at', 'token_last_used_ip', 'token_rotated_at', 'remark'];
const fixture = {
  uuid: 'fixture-node', name: 'Fixture', hidden: false,
  token: 'fixture-token', token_hash: 'fixture-token-hash',
  token_last_used_at: '2026-01-01T00:00:00Z', token_last_used_ip: '8.8.8.8',
  token_rotated_at: '2025-12-31T00:00:00Z', remark: 'Administrator-only note',
  ipv4: '8.8.8.8', ipv6: '2001:4860:4860::8888',
  public_remark: 'Public note', tags: 'IPv4;Singapore;IPv6', cpu_cores: 1,
};

function assertPublic(value) {
  for (const field of [...privateFields, 'ipv4', 'ipv6']) {
    assert.equal(Object.hasOwn(value, field), false, `Public output exposes ${field}`);
  }
  assert.equal(value.uuid, fixture.uuid);
  assert.equal(value.name, fixture.name);
  assert.equal(value.public_remark, fixture.public_remark);
  assert.equal(value.cpu_cores, 1);
  assert.equal(value.has_ipv4, true);
  assert.equal(value.has_ipv6, true);
}

test('HTTP client and bootstrap metadata omit admin fields from real runtime rows', () => {
  const input = structuredClone(fixture);
  const output = toPublicClient(input);
  assertPublic(output);
  assert.equal(output.tags, 'Singapore');
  assert.deepEqual(input, fixture, 'Public projection must not erase the admin record');
});

test('DO public metadata omits admin fields while its admin snapshot retains audit details', async () => {
  // The Worker uses bundler-style extensionless imports; resolve them for Node's
  // native TypeScript test runtime without changing the application imports.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        for (const suffix of ['.ts', '/index.ts']) {
          const candidate = new URL(specifier + suffix, context.parentURL);
          if (existsSync(candidate)) return nextResolve(candidate.href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
  let LiveDataDO;
  try { ({ LiveDataDO } = await import('../do/live-data.ts')); }
  finally { hooks.deregister(); }
  const subject = Object.create(LiveDataDO.prototype);
  const input = structuredClone(fixture);
  assertPublic(subject.publicClientMetadata(input));
  const admin = subject.sanitizeAdminClientSnapshotItem(input);
  for (const field of ['token_last_used_at', 'token_last_used_ip', 'token_rotated_at', 'remark', 'ipv4', 'ipv6']) {
    assert.equal(admin[field], fixture[field], `Admin snapshot lost ${field}`);
  }
  assert.equal(Object.hasOwn(admin, 'token'), false);
  assert.equal(Object.hasOwn(admin, 'token_hash'), false);
  assert.deepEqual(input, fixture);
});
