import { Component } from "react";
import { AlertTriangle, RefreshCw, Home, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  }

  handleReload = () => {
    window.location.reload();
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
              <div className="bg-slate-800 dark:bg-slate-950 px-6 py-5 flex items-center gap-3">
                <div className="rounded-full bg-amber-500/20 p-2 flex-shrink-0">
                  <ShieldCheck className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-base leading-tight">System Recovering</h3>
                  <p className="text-slate-400 text-xs mt-0.5">CompanySync detected an unexpected issue</p>
                </div>
              </div>

              <div className="px-6 py-5">
                <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                  A component encountered an error and was automatically isolated to protect the rest of the platform.
                  <span className="font-medium text-slate-800 dark:text-slate-100"> Your data is safe</span> — no information was lost.
                </p>

                {this.state.error && (
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
                  <Button
                    className="flex-1 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white"
                    onClick={this.handleReload}
                    data-testid="button-error-retry"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reload Page
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-slate-400 mt-3">
              If this keeps happening, contact your CompanySync administrator.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
