import type { PublicClientRow } from '../db/types';
import { isPublicIpAddress } from './request-ip.ts';

export type PublicClient = Omit<PublicClientRow, 'ipv4' | 'ipv6'> & {
  has_ipv4: boolean;
  has_ipv6: boolean;
  tags: string;
};

const PRIVATE_CLIENT_FIELDS = [
  'token', 'token_hash', 'token_last_used_at', 'token_last_used_ip', 'token_rotated_at', 'remark',
] as const;
type PrivateClientField = typeof PRIVATE_CLIENT_FIELDS[number];
type PublicClientSource = PublicClientRow & Partial<Record<PrivateClientField, unknown>>;

// A TypeScript Omit does not remove fields from database rows or DO overlays.
// Both HTTP metadata and WebSocket metadata need the same runtime projection.
export function withoutPrivateClientFields<T extends object>(client: T): Omit<T, PrivateClientField> {
  const safe = { ...client };
  for (const field of PRIVATE_CLIENT_FIELDS) delete (safe as Record<string, unknown>)[field];
  return safe;
}

function isPublicTag(tag: string): boolean {
  const text = tag.replace(/<\w+>$/, '').trim().toLowerCase();
  return !['ipv4', 'ipv6', 'ip4', 'ip6', 'v4', 'v6'].includes(text);
}

export function sanitizePublicTags(tags: unknown): string {
  if (typeof tags !== 'string') return '';
  return tags
    .split(/[;,]/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .filter(isPublicTag)
    .join(';');
}

export function toPublicClient(client: PublicClientSource): PublicClient {
  const {
    ipv4,
    ipv6,
    ...publicClient
  } = withoutPrivateClientFields(client);
  return {
    ...publicClient,
    has_ipv4: typeof ipv4 === 'string' && isPublicIpAddress(ipv4),
    has_ipv6: typeof ipv6 === 'string' && isPublicIpAddress(ipv6),
    tags: sanitizePublicTags(publicClient.tags),
  };
}
