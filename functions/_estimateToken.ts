// Deno helper for HMAC-signed public estimate URLs.
// Mirrors lib/estimateToken.cjs so dev (Node) and prod (Base44/Deno) use the
// same secret + algorithm and produce/accept identical tokens.

function getSecret(): string {
  return Deno.env.get('ESTIMATE_LINK_SECRET') || Deno.env.get('SESSION_SECRET') || '';
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signEstimateToken(id: string): Promise<string> {
  const secret = getSecret();
  if (!secret || !id) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(id)));
  return toBase64Url(new Uint8Array(sig));
}

export async function verifyEstimateToken(id: string, token: string): Promise<boolean> {
  if (!token || !id) return false;
  const expected = await signEstimateToken(id);
  if (!expected || expected.length !== token.length) return false;
  // Constant-time compare (length already equal).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function isTokenRequired(): boolean {
  return Deno.env.get('ESTIMATE_REQUIRE_TOKEN') === '1';
}

export async function checkEstimateAccess(
  id: string,
  token: string | null | undefined,
  ctx?: string,
): Promise<{ ok: boolean; mode: 'enforced' | 'monitor'; reason: string }> {
  const required = isTokenRequired();
  if (!token) {
    if (required) {
      console.warn(`[estimateToken] BLOCK missing token id=${id} ctx=${ctx || ''}`);
      return { ok: false, mode: 'enforced', reason: 'missing_token' };
    }
    console.warn(`[estimateToken] MONITOR missing token id=${id} ctx=${ctx || ''}`);
    return { ok: true, mode: 'monitor', reason: 'missing_token' };
  }
  if (!(await verifyEstimateToken(id, token))) {
    console.warn(`[estimateToken] BLOCK invalid token id=${id} ctx=${ctx || ''}`);
    return { ok: false, mode: 'enforced', reason: 'invalid_token' };
  }
  return { ok: true, mode: 'enforced', reason: 'valid' };
}
