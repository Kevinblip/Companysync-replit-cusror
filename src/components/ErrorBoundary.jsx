import { Component } from "react";
import { RefreshCw, Home, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Returns true when the error is a "stale chunk" failure — the browser has a
 * cached page referencing a JS chunk that no longer exists on the server
 * (common after a production deployment).  The only fix is a hard page reload;
 * re-mounting the component will request the same missing URL and fail again.
 */
function isStaleChunkError(error) {
  const msg = error?.message || String(error);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||       // Safari
    msg.includes('error loading dynamically imported module') // Firefox
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error(
      `[CompanySync_Error] Component crash caught by ErrorBoundary — ${error?.message || error}`,
      { error, componentStack: errorInfo?.componentStack }
    );

    // Auto-reload once for stale-chunk errors (new deployment replaced the bundle).
    // Gate on a sessionStorage flag so we don't loop if the reload itself also fails.
    if (isStaleChunkError(error)) {
      const key = 'eb_stale_reload_attempted';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleHardReload = () => {
    // Clear SW cache then reload so the new bundle is fetched fresh.
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).finally(() => window.location.reload());
    } else {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isFullPage = this.props.fullPage;
      const stale = isStaleChunkError(this.state.error);

      return (
        <div
          className={
            isFullPage
              ? "fixed inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-950 z-50 p-6"
              : "flex items-center justify-center min-h-[400px] p-6"
          }
          data-testid="error-boundary"
        >
          <div className="w-full max-w-md">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className={`px-6 py-5 flex items-center gap-3 ${stale ? 'bg-blue-700' : 'bg-slate-800 dark:bg-slate-950'}`}>
                <div className={`rounded-full p-2 flex-shrink-0 ${stale ? 'bg-blue-500/30' : 'bg-amber-500/20'}`}>
                  {stale
                    ? <Zap className="h-5 w-5 text-blue-200" />
                    : <ShieldCheck className="h-5 w-5 text-amber-400" />}
                </div>
                <div>
                  <h3 className="text-white font-semibold text-base leading-tight">
                    {stale ? 'New Version Available' : 'System Recovering'}
                  </h3>
                  <p className="text-slate-300 text-xs mt-0.5">
                    {stale
                      ? 'The app was updated — reload to get the latest version'
                      : 'CompanySync detected an unexpected issue'}
                  </p>
                </div>
              </div>

              <div className="px-6 py-5">
                {stale ? (
                  <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                    A page component couldn't load because a newer version of the app has been deployed.
                    <span className="font-medium text-slate-800 dark:text-slate-100"> Your data is safe</span> — reloading will fetch the latest version instantly.
                  </p>
                ) : (
                  <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                    A component encountered an error and was automatically isolated to protect the rest of the platform.
                    <span className="font-medium text-slate-800 dark:text-slate-100"> Your data is safe</span> — no information was lost.
                  </p>
                )}

                {this.state.error && !stale && (
                  <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2">
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all" data-testid="error-details">
                      {this.state.error.message || String(this.state.error)}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 mt-5">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={this.handleGoHome}
                    data-testid="button-error-go-home"
                  >
                    <Home className="h-4 w-4 mr-2" />
                    Go Home
                  </Button>
                  {stale ? (
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={this.handleHardReload}
                      data-testid="button-error-reload"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reload Page
                    </Button>
                  ) : (
                    <Button
                      className="flex-1 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white"
                      onClick={this.handleRetry}
                      data-testid="button-error-retry"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Try Again
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-slate-400 mt-3">
              {stale
                ? 'Reloading is safe and takes less than 5 seconds.'
                : 'If this keeps happening, contact your CompanySync administrator.'}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
