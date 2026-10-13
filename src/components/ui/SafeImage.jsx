import { useState, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Normalize any /uploads/ URL to use the current origin.
 * Photos uploaded from older Replit preview URLs or prior deployments
 * have stale hostnames baked into the stored file_url. Extracting just
 * the path ensures the current production server serves the file.
 */
function normalizePhotoUrl(src) {
  if (!src) return src;
  try {
    const url = new URL(src);
    // If the URL contains /uploads/ and the host differs from current origin,
    // rewrite to use the current server — the file is stored here.
    if (url.pathname.startsWith('/uploads/') && url.host !== window.location.host) {
      return url.pathname + url.search;
    }
  } catch {
    // Relative URLs or malformed URLs — use as-is
  }
  return src;
}

export default function SafeImage({ src, alt, className, style, objectFit = 'cover', onClick, ...props }) {
  const [status, setStatus] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);

  const normalizedSrc = normalizePhotoUrl(src);

  const handleLoad = useCallback(() => setStatus('loaded'), []);
  const handleError = useCallback(() => setStatus('error'), []);

  const retry = useCallback((e) => {
    e.stopPropagation();
    setStatus('loading');
    setRetryKey(k => k + 1);
  }, []);

  if (!normalizedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400 ${className || ''}`}
        style={style}
      >
        <AlertCircle className="w-6 h-6 text-gray-300" />
        <span className="text-xs">No photo</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className || ''}`} style={style} onClick={onClick}>
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400">
          <AlertCircle className="w-6 h-6 text-gray-300" />
          <span className="text-[10px] text-gray-400 text-center px-2 leading-tight">Photo unavailable</span>
          <button
            onClick={retry}
            className="mt-0.5 flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 underline"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      <img
        key={retryKey}
        src={normalizedSrc}
        alt={alt || ''}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        style={{
          display: status === 'error' ? 'none' : 'block',
          opacity: status === 'loaded' ? 1 : 0,
          transition: 'opacity 0.25s',
          width: '100%',
          height: '100%',
          objectFit,
        }}
        {...props}
      />
    </div>
  );
}
