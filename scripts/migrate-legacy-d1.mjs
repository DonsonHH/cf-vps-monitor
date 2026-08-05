import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPORT_VERSION = 1;
const LEGACY_TABLES = {
  servers: 'select * from servers order by coalesce(sort_order, 2147483647), name',
  metrics: 'select * from metrics',
  monitored_sites: 'select * from monitored_sites order by coalesce(sort_order, 2147483647), name',
  monthly_traffic_baselines: 'select * from monthly_traffic_baselines order by server_id, year, month',
  app_config: 'select * from app_config',
};

function fail(message) {
  throw new Error(message);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseArgs(args) {
  const exportPath = valueAfter(args, '--export');
  const inputPath = valueAfter(args, '--from-export');
  const apply = args.includes('--apply');
  const yes = args.includes('--yes');
  if (args.includes('--help')) return { help: true };
  if (args.includes('--export') && !exportPath) fail('--export requires a file path');
  if (args.includes('--from-export') && !inputPath) fail('--from-export requires a file path');
  if (apply && !yes) fail('Writing to Supabase requires both --apply and --yes.');
  return { exportPath, inputPath, apply, yes, help: false };
}

function string(value, max = 10_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : String(value ?? '').trim().slice(0, max);
}

function number(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(number(value, fallback));
}

function bool(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function parseJson(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isoTime(value) {
  const numeric = number(value, 0);
  if (!numeric) return new Date().toISOString();
  return new Date(numeric > 100_000_000_000 ? numeric : numeric * 1000).toISOString();
}

function optionalIsoTime(value) {
  return number(value, 0) > 0 ? isoTime(value) : null;
}

function bounded(value, min = 0, max = 1_000_000_000_000_000) {
  return Math.min(max, Math.max(min, number(value)));
}

function bytesFromLegacyKiB(value) {
  return bounded(value) * 1024;
}

function bytesFromLegacyGiB(value) {
  return bounded(value) * 1024 * 1024 * 1024;
}

function sha256Token(token) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function mapLegacyClient(server) {
  const token = string(server.api_key, 512);
  if (!string(server.id, 128)) fail('Legacy server without an id cannot be migrated.');
  if (!token) fail(`Legacy server ${server.id} has no API key and cannot be migrated safely.`);
  const description = string(server.description, 2048);
  return {
    uuid: string(server.id, 128),
    token,
    token_hash: sha256Token(token),
    token_rotated_at: isoTime(server.created_at),
    name: string(server.name, 256) || string(server.id, 128),
    remark: description,
    public_remark: description,
    hidden: !bool(server.is_public),
    sort_order: integer(server.sort_order),
    created_at: isoTime(server.created_at),
    updated_at: new Date().toISOString(),
  };
}

export function mapLegacyMetric(metric) {
  const cpu = parseJson(metric.cpu);
  const memory = parseJson(metric.memory);
  const disk = parseJson(metric.disk);
  const network = parseJson(metric.network);
  return {
    client: string(metric.server_id, 128),
    time: isoTime(metric.timestamp),
    cpu: bounded(cpu.usage_percent),
    gpu: 0,
    ram: bytesFromLegacyKiB(memory.used),
    ram_total: bytesFromLegacyKiB(memory.total),
    swap: 0,
    swap_total: 0,
    load: bounded(Array.isArray(cpu.load_avg) ? cpu.load_avg[0] : 0, 0, 10_000),
    temp: 0,
    disk: bytesFromLegacyGiB(disk.used),
    disk_total: bytesFromLegacyGiB(disk.total),
    net_in: bounded(network.download_speed),
    net_out: bounded(network.upload_speed),
    net_total_up: bounded(network.total_upload),
    net_total_down: bounded(network.total_download),
    process_count: 0,
    connections: 0,
    connections_udp: 0,
    uptime: bounded(metric.uptime, 0, 315_576_000),
  };
}

export function mapLegacyWebsite(site) {
  const status = string(site.last_status).toLowerCase();
  const isUp = ['up', 'online', 'ok', 'healthy', 'success'].includes(status);
  const isDown = ['down', 'offline', 'error', 'failed', 'unhealthy'].includes(status);
  return {
    name: string(site.name, 256) || string(site.url, 2048),
    url: string(site.url, 2048),
    method: 'GET',
    expected_status_min: 200,
    expected_status_max: 399,
    interval_sec: 120,
    timeout_sec: 10,
    grace_period_sec: 180,
    enabled: true,
    hidden: !bool(site.is_public),
    hide_url: false,
    agent_probe_mode: 'off',
    agent_probe_clients: [],
    agent_probe_limit: 3,
    agent_probe_status_enabled: false,
    legacy_status: isUp ? 'up' : isDown ? 'down' : 'pending',
    legacy_checked_at: optionalIsoTime(site.last_checked),
    legacy_status_code: integer(site.last_status_code, 0) || null,
    legacy_latency_ms: integer(site.last_response_time_ms, 0) || null,
  };
}

export function mapLegacyExport(legacy) {
  const rows = legacy.tables || {};
  const clients = (rows.servers || []).map(mapLegacyClient);
  const records = (rows.metrics || []).map(mapLegacyMetric).filter(record => record.client);
  const websites = (rows.monitored_sites || []).map(mapLegacyWebsite).filter(site => site.url);
  return { clients, records, websites };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

async function d1Query({ accountId, databaseId, token }, sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) fail(`D1 query failed: ${body?.errors?.[0]?.message || response.statusText}`);
  return body.result?.[0]?.results || [];
}

export async function exportLegacyD1(config) {
  const tables = {};
  for (const [name, sql] of Object.entries(LEGACY_TABLES)) {
    try {
      tables[name] = await d1Query(config, sql);
    } catch (error) {
      // Several optional tables were added over the legacy project's lifetime.
      // Keep the archive usable when an old deployment never created one.
      tables[name] = [];
      console.warn(`Skipping unavailable D1 table ${name}: ${error.message}`);
    }
  }
  if (tables.servers.length === 0 && tables.metrics.length === 0) {
    fail('D1 export contained no servers or metrics; check CF_ACCOUNT_ID and CF_D1_DATABASE_ID.');
  }
  return {
    format: 'cf-vps-monitor-legacy-d1-export',
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    tables,
  };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseRequest(config, path, body, headers = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: 'POST',
    headers: supabaseHeaders(config.key, headers),
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(`Supabase ${path} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}

async function supabaseGet(config, path) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, { headers: supabaseHeaders(config.key) });
  if (!response.ok) fail(`Supabase ${path} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function assertEmptyTarget(config, clientIds) {
  if (clientIds.length === 0) return;
  const quoted = clientIds.map(id => `"${id.replaceAll('"', '\\"')}"`).join(',');
  const existing = await supabaseGet(config, `clients?select=uuid&uuid=in.(${encodeURIComponent(quoted)})`);
  if (Array.isArray(existing) && existing.length > 0) {
    fail('Target Supabase already contains one or more legacy client IDs. Refusing a duplicate import.');
  }
}

export async function importToSupabase(legacy, config) {
  const mapped = mapLegacyExport(legacy);
  await assertEmptyTarget(config, mapped.clients.map(client => client.uuid));
  for (const client of mapped.clients) {
    await supabaseRequest(config, 'clients', client, { Prefer: 'return=minimal' });
  }
  for (const record of mapped.records) {
    await supabaseRequest(config, 'records', record, { Prefer: 'return=minimal' });
  }
  for (const website of mapped.websites) {
    await supabaseRequest(config, 'rpc/cfm_create_website_monitor', {
      input_monitor: Object.fromEntries(Object.entries(website).filter(([key]) => !key.startsWith('legacy_'))),
    });
  }
  return { clients: mapped.clients.length, records: mapped.records.length, websites: mapped.websites.length };
}

function usage() {
  return `Usage:
  node scripts/migrate-legacy-d1.mjs --export legacy-d1-export.json
  node scripts/migrate-legacy-d1.mjs --from-export legacy-d1-export.json --apply --yes

Export requires CF_ACCOUNT_ID, CF_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN.
Import requires SUPABASE_URL and SUPABASE_SECRET_KEY. Import refuses a target that
already has any of the legacy client IDs. The archive contains legacy Agent tokens;
store it outside source control and delete it after verifying the migration.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());
  let legacy;
  if (args.inputPath) {
    legacy = JSON.parse(await readFile(resolve(args.inputPath), 'utf8'));
  } else {
    legacy = await exportLegacyD1({
      accountId: requireEnv('CF_ACCOUNT_ID'),
      databaseId: requireEnv('CF_D1_DATABASE_ID'),
      token: requireEnv('CLOUDFLARE_API_TOKEN'),
    });
  }
  if (legacy.format !== 'cf-vps-monitor-legacy-d1-export' || legacy.version !== EXPORT_VERSION) {
    fail('The supplied file is not a supported legacy D1 export.');
  }
  const mapped = mapLegacyExport(legacy);
  console.log(`Prepared ${mapped.clients.length} clients, ${mapped.records.length} latest records, and ${mapped.websites.length} website monitors.`);
  if (args.exportPath) {
    await writeFile(resolve(args.exportPath), `${JSON.stringify(legacy, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`Legacy D1 archive written to ${resolve(args.exportPath)}.`);
  }
  if (args.apply) {
    const result = await importToSupabase(legacy, {
      url: requireEnv('SUPABASE_URL').replace(/\/+$/, ''),
      key: requireEnv('SUPABASE_SECRET_KEY'),
    });
    console.log(`Imported ${result.clients} clients, ${result.records} latest records, and ${result.websites} website monitors.`);
  } else {
    console.log('Dry run only. Add --apply --yes after reviewing the export.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
