import { isNativeApp } from './platform';
import { rewriteRequestUrl, withNativeHeaders } from './urlRewrite';

const INSTALLED = Symbol.for('companysync.nativeApiBase');

function configuredApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  return (fromEnv && String(fromEnv).trim()) || 'https://getcompanysync.com';
}

export function installNativeApiBase(win) {
  const target = win || (typeof window !== 'undefined' ? window : undefined);
  if (!target || !isNativeApp(target)) return false;
  if (target[INSTALLED] === target.fetch) return false;

  const apiBase = configuredApiBase();
  const native = true;
  target.document?.documentElement?.classList?.add('capacitor-native');

  const originalFetch = target.fetch.bind(target);
  target.fetch = (input, init) => {
    const rewritten = rewriteRequestUrl(input, { native, apiBase });
    const nextInit = withNativeHeaders(init, { native });
    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(rewritten, nextInit);
    }
    if (rewritten === input.url) return originalFetch(input, nextInit);
    const request = new Request(rewritten, input);
    return originalFetch(request, nextInit);
  };

  const OriginalXHR = target.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  OriginalXHR.prototype.open = function open(method, url, ...rest) {
    return originalOpen.call(this, method, rewriteRequestUrl(url, { native, apiBase }), ...rest);
  };
  const originalSetHeader = OriginalXHR.prototype.setRequestHeader;
  const originalSend = OriginalXHR.prototype.send;
  OriginalXHR.prototype.send = function send(body) {
    try {
      originalSetHeader.call(this, 'X-CompanySync-Native', '1');
    } catch {
      // A header can already be locked after send in some retry paths.
    }
    this.withCredentials = true;
    return originalSend.call(this, body);
  };

  const OriginalWebSocket = target.WebSocket;
  function NativeWebSocket(url, protocols) {
    const rewritten = rewriteRequestUrl(url, { native, apiBase });
    if (protocols === undefined) return new OriginalWebSocket(rewritten);
    return new OriginalWebSocket(rewritten, protocols);
  }
  NativeWebSocket.prototype = OriginalWebSocket.prototype;
  NativeWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  NativeWebSocket.OPEN = OriginalWebSocket.OPEN;
  NativeWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  NativeWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  target.WebSocket = NativeWebSocket;

  target[INSTALLED] = target.fetch;
  target.__COMPANYSYNC_API_BASE__ = apiBase;
  return true;
}
