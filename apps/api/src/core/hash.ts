import { createHash } from 'node:crypto';

/**
 * Deterministic canonical JSON serialisation.
 *
 * Keys are sorted recursively so that two structurally equal payloads always
 * produce the same string, and therefore the same SHA-256 hash. This is the
 * binding between "what the human saw in the preview" and "what the gateway
 * is about to execute" (PRD 6.1).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = sortValue(source[key]);
  }
  return out;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Payload hash as required by data/03_policies.json:
 * "canonical-json-sha256 with plan version, tenant and action ID".
 */
export function computePayloadHash(input: {
  tenant_id: string;
  action_id: string;
  version: number;
  payload: unknown;
}): string {
  return sha256(
    canonicalJson({
      tenant_id: input.tenant_id,
      action_id: input.action_id,
      version: input.version,
      payload: input.payload,
    }),
  );
}

export function hashChain(prevHash: string, event: Record<string, unknown>): string {
  return sha256(prevHash + '|' + canonicalJson(event));
}
