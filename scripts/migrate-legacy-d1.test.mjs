import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLegacyClient, mapLegacyExport, mapLegacyMetric, parseArgs } from './migrate-legacy-d1.mjs';

test('maps a legacy D1 client while retaining its Agent token', () => {
  const client = mapLegacyClient({
    id: 'node-1', name: 'Tokyo', description: 'legacy node', api_key: 'secret-token', created_at: 1_700_000_000, is_public: 1, sort_order: 3,
  });
  assert.equal(client.uuid, 'node-1');
  assert.equal(client.token, 'secret-token');
  assert.match(client.token_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(client.hidden, false);
});

test('converts legacy KiB RAM, GiB disk, and network counters to the v2 record format', () => {
  const record = mapLegacyMetric({
    server_id: 'node-1', timestamp: 1_700_000_000,
    cpu: JSON.stringify({ usage_percent: 23.5, load_avg: [0.42, 0.3, 0.2] }),
    memory: JSON.stringify({ used: 512 * 1024, total: 1024 * 1024 }),
    disk: JSON.stringify({ used: 12.5, total: 40 }),
    network: JSON.stringify({ upload_speed: 120, download_speed: 220, total_upload: 400, total_download: 500 }),
    uptime: 600,
  });
  assert.equal(record.ram, 512 * 1024 * 1024);
  assert.equal(record.disk_total, 40 * 1024 * 1024 * 1024);
  assert.equal(record.net_total_down, 500);
});

test('keeps a dry run read-only unless both apply and yes are supplied', () => {
  assert.deepEqual(parseArgs([]), { exportPath: undefined, inputPath: undefined, apply: false, yes: false, help: false });
  assert.throws(() => parseArgs(['--apply']), /--apply and --yes/);
  assert.equal(parseArgs(['--apply', '--yes']).apply, true);
});

test('maps only the v2-importable parts of a legacy export', () => {
  const mapped = mapLegacyExport({
    tables: {
      servers: [{ id: 'node-1', api_key: 'token', name: 'Node', created_at: 1 }],
      metrics: [], monitored_sites: [{ url: 'https://example.com', name: 'Example', last_status: 'UP' }],
      monthly_traffic_baselines: [{ server_id: 'node-1', year: 2026, month: 8 }],
    },
  });
  assert.equal(mapped.clients.length, 1);
  assert.equal(mapped.websites.length, 1);
  assert.equal(mapped.websites[0].legacy_status, 'up');
});
