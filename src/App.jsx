import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import PresenceTracker from '@/components/PresenceTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ImpersonationProvider, useImpersonation } from '@/lib/ImpersonationContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ErrorBoundary from '@/components/ErrorBoundary';

const SignContractCustomer = lazy(() => import('@/pages/sign-contract-customer'));
const ViewEstimate = lazy(() => import('@/pages/ViewEstimate'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : () => <></>;

const PageFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-slate-950 z-50">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

function useActiveCompanyId() {
  const { impersonatedCompanyId: impersonatedId } = useImpersonation();
  const [storedId, setStoredId] = useState(() => localStorage.getItem('last_used_company_id'));

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'last_used_company_id') {
        setStoredId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);

    const handleCompanySwitch = (e) => {
      if (e.detail?.companyId) {
        setStoredId(e.detail.companyId);
      }
    };
    window.addEventListener('company-switched', handleCompanySwitch);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('company-switched', handleCompanySwitch);
    };
  }, []);

  return impersonatedId || storedId || 'default';
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError, navigateToLogin } = useAuth();

  if (isLoadingAuth) {
    return <PageFallback />;
  }

  if (!isAuthenticated) {
    const currentUrl = window.location.pathname + window.location.search;
    if (currentUrl && currentUrl !== '/' && currentUrl !== '/login') {
      sessionStorage.setItem('post_login_redirect', currentUrl);
    }
    return (
      <Suspense fallback={<PageFallback />}>
        <LoginPage />
      </Suspense>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={
          <LayoutWrapper currentPageName={mainPageKey}>
            <ErrorBoundary>
              <MainPage />
            </ErrorBoundary>
          </LayoutWrapper>
        } />
        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <ErrorBoundary>
                  <Page />
                </ErrorBoundary>
              </LayoutWrapper>
            }
          />
        ))}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Suspense>
  );
};


const AppRouter = () => {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={
          <ErrorBoundary><LoginPage /></ErrorBoundary>
        } />
        <Route path="/signup" element={
          <ErrorBoundary><SignupPage /></ErrorBoundary>
        } />
        <Route path="/ForgotPassword" element={
          <ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>
        } />
        <Route path="/ResetPassword" element={
          <ErrorBoundary><ResetPasswordPage /></ErrorBoundary>
        } />
        <Route path="/sign-contract-customer" element={
          <ErrorBoundary><SignContractCustomer /></ErrorBoundary>
        } />
        <Route path="/sign-contract" element={
          <ErrorBoundary><SignContractCustomer /></ErrorBoundary>
        } />
        <Route path="/ViewEstimate" element={
          <ErrorBoundary><ViewEstimate /></ErrorBoundary>
        } />
        <Route path="/view-estimate" element={
          <ErrorBoundary><ViewEstimate /></ErrorBoundary>
        } />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </Suspense>
  );
};

function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ImpersonationProvider>
          <ErrorBoundary>
            <Router>
              <NavigationTracker />
              <PresenceTracker />
              <AppRouter />
            </Router>
          </ErrorBoundary>
          <Toaster />
          <VisualEditAgent />
        </ImpersonationProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
