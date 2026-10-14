// Pure URL rewrite used by the Capacitor shell. Web builds pass native:false
// and every URL is returned unchanged.

const API_PREFIXES = ['/api/', '/api?', '/ws/', '/uploads/'];

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function isLocalShellHost(hostname) {
  const host = String(hostname || '').toLowerCase().split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

export function shouldPrefixRelative(pathname) {
  const path = pathname || '/';
  if (path === '/api' || path === '/ws') return true;
  return API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Rewrite a request URL onto the production API when the page is the bundled
 * native shell. Static assets (/assets, /icons, routes) stay local.
 */
export function rewriteRequestUrl(input, { native, apiBase } = {}) {
  if (!native || !apiBase) return input == null ? input : String(input);
  const base = stripTrailingSlash(apiBase);
  const raw = typeof input === 'string' ? input : (input && input.url) || '';
  if (!raw) return raw;

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    const pathname = raw.split(/[?#]/)[0];
    if (!shouldPrefixRelative(pathname)) return raw;
    return `${base}${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  const localShell = isLocalShellHost(parsed.hostname)
    || parsed.protocol === 'capacitor:'
    || parsed.protocol === 'ionic:';
  if (!localShell) return raw;
  if (!shouldPrefixRelative(parsed.pathname)) return raw;

  const remote = new URL(base);
  const protocol = parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
    ? (remote.protocol === 'https:' ? 'wss:' : 'ws:')
    : remote.protocol;
  return `${protocol}//${remote.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function withNativeHeaders(init, { native } = {}) {
  if (!native) return init;
  const next = init ? { ...init } : {};
  if (!next.credentials) next.credentials = 'include';
  const headers = new Headers(next.headers || {});
  if (!headers.has('X-CompanySync-Native')) headers.set('X-CompanySync-Native', '1');
  next.headers = headers;
  return next;
}
