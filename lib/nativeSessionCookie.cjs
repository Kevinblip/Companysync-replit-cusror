'use strict';

const NATIVE_HEADER = 'x-companysync-native';

const CAPACITOR_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

function isNativeClient(req) {
  return String(req?.headers?.[NATIVE_HEADER] || '') === '1';
}

function isCapacitorOrigin(origin) {
  return CAPACITOR_ORIGINS.has(String(origin || ''));
}

function applyNativeSameSite(cookieValue) {
  return String(cookieValue).replace(/SameSite=Lax/gi, 'SameSite=None');
}

function rewriteHeaderBag(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  const copy = { ...headers };
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase() !== 'set-cookie') continue;
    const value = copy[key];
    copy[key] = Array.isArray(value) ? value.map(applyNativeSameSite) : applyNativeSameSite(value);
  }
  return copy;
}

function installNativeCookieRewrite(req, res) {
  if (!isNativeClient(req) || res.__companysyncNativeCookie) return;
  res.__companysyncNativeCookie = true;

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function setHeader(name, value) {
    if (String(name).toLowerCase() === 'set-cookie') {
      value = Array.isArray(value) ? value.map(applyNativeSameSite) : applyNativeSameSite(value);
    }
    return origSetHeader(name, value);
  };

  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function writeHead(statusCode, arg2, arg3) {
    if (typeof arg2 === 'string') {
      return origWriteHead(statusCode, arg2, arg3 && typeof arg3 === 'object' ? rewriteHeaderBag(arg3) : arg3);
    }
    if (arg2 && typeof arg2 === 'object') return origWriteHead(statusCode, rewriteHeaderBag(arg2));
    return origWriteHead(statusCode, arg2, arg3);
  };
}

module.exports = {
  CAPACITOR_ORIGINS,
  isNativeClient,
  isCapacitorOrigin,
  applyNativeSameSite,
  installNativeCookieRewrite,
};
