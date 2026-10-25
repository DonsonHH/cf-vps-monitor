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

async function loadLiveDataDO() {
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
  try { return (await import('../do/live-data.ts')).LiveDataDO; }
  finally { hooks.deregister(); }
}

test('DO public metadata omits admin fields while its admin snapshot retains audit details', async () => {
  const LiveDataDO = await loadLiveDataDO();
  const subject = Object.create(LiveDataDO.prototype);
  const input = structuredClone(fixture);
  const projected = subject.publicClientMetadata(input);
  assertPublic(projected);
  assert.deepEqual(subject.publicClientMetadata(projected), projected, 'Projecting a safe patch again must preserve IP capability flags');
  const admin = subject.sanitizeAdminClientSnapshotItem(input);
  for (const field of ['token_last_used_at', 'token_last_used_ip', 'token_rotated_at', 'remark', 'ipv4', 'ipv6']) {
    assert.equal(admin[field], fixture[field], `Admin snapshot lost ${field}`);
  }
  assert.equal(Object.hasOwn(admin, 'token'), false);
  assert.equal(Object.hasOwn(admin, 'token_hash'), false);
  assert.deepEqual(input, fixture);
});

async function viewerFixture() {
  const LiveDataDO = await loadLiveDataDO();
  const subject = Object.create(LiveDataDO.prototype), messages = { public: [], admin: [] };
  subject.clients = new Map();
  subject.sessions = new Map();
  subject.sessionRoles = new Map();
  for (const role of ['public', 'admin']) {
    subject.sessions.set(role, {
      readyState: WebSocket.READY_STATE_OPEN,
      deserializeAttachment: () => ({ role: 'viewer', clientId: role, includeHidden: role === 'admin' }),
      send: text => messages[role].push(JSON.parse(text)),
    });
    subject.sessionRoles.set(role, 'viewer');
  }
  const refresh = async detail => {
    const response = await subject.fetch(new Request('https://do/metadata-refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(detail),
    }));
    assert.equal(response.status, 200);
  };
  return { subject, messages, refresh };
}

test('metadata-refresh filters actual public socket payloads and keeps hidden records admin-only', async () => {
  const { messages, refresh } = await viewerFixture();
  const hidden = { ...fixture, uuid: 'hidden-fixture', name: 'Hidden fixture', hidden: true };
  const detail = { clients: { upsert: [structuredClone(fixture), hidden] } }, before = structuredClone(detail);
  await refresh(detail);
  assert.equal(messages.public.length, 1);
  assert.equal(messages.admin.length, 1);
  const publicChanges = messages.public[0].clients, adminChanges = messages.admin[0].clients;
  assert.deepEqual(publicChanges.upsert.map(c => c.uuid), [fixture.uuid]);
  assertPublic(publicChanges.upsert[0]);
  assert.ok(publicChanges.remove.includes(hidden.uuid));
  assert.equal(JSON.stringify(messages.public).includes(hidden.name), false);
  assert.deepEqual(adminChanges.upsert.map(c => c.uuid), [fixture.uuid, hidden.uuid]);
  assert.equal(adminChanges.remove?.includes(hidden.uuid) || false, false);
  assert.equal(adminChanges.upsert[0].token_last_used_ip, fixture.token_last_used_ip);
  assert.equal(adminChanges.upsert[0].remark, fixture.remark);
  for (const row of adminChanges.upsert) for (const field of ['token', 'token_hash']) assert.equal(Object.hasOwn(row, field), false);
  assert.deepEqual(detail, before);
});

test('public and admin metadata refresh audiences stay separate', async () => {
  for (const audience of ['public', 'admin']) {
    const { messages, refresh } = await viewerFixture();
    await refresh({ clients: { upsert: [fixture] }, audience });
    assert.equal(messages[audience].length, 1);
    assert.equal(messages[audience === 'public' ? 'admin' : 'public'].length, 0);
    if (audience === 'public') assertPublic(messages.public[0].clients.upsert[0]);
    else assert.equal(messages.admin[0].clients.upsert[0].remark, fixture.remark);
  }
});

test('partial ordering patches retain offline visibility and do not clear IP capabilities', async () => {
  const { subject, messages, refresh } = await viewerFixture();
  subject.clients.set('live-visible', { hidden: false });
  subject.clients.set('live-hidden', { hidden: true });
  await refresh({ clients: { upsert: [
    { uuid: 'offline-visible', hidden: false, sort_order: 1 },
    { uuid: 'offline-hidden', hidden: true, sort_order: 2 },
    { uuid: 'live-visible', sort_order: 3 },
    { uuid: 'live-hidden', sort_order: 4 },
    { uuid: 'unknown-visibility', name: 'Must not become a public record' },
  ] } });
  const changes = messages.public[0].clients;
  assert.deepEqual(changes.upsert.map(c => c.uuid), ['offline-visible', 'live-visible']);
  for (const row of changes.upsert) for (const field of ['has_ipv4', 'has_ipv6']) assert.equal(Object.hasOwn(row, field), false);
  assert.ok(changes.remove.includes('offline-hidden'));
  assert.ok(changes.remove.includes('live-hidden'));
});
