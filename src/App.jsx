import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import PresenceTracker from '@/components/PresenceTracker'
import { pagesConfig } from './pages.lazy.config'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ImpersonationProvider, useImpersonation } from '@/lib/ImpersonationContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ErrorBoundary from '@/components/ErrorBoundary';
import { UploadQueueProvider } from '@/context/UploadQueueContext';
import UpcomingEventAlert from '@/components/UpcomingEventAlert';
import { getLastUsedCompanyId } from '@/lib/activeCompanySelection';
import CompanySyncLogo from '@/components/brand/CompanySyncLogo';

const SignContractCustomer = lazy(() => import('@/pages/sign-contract-customer'));
const ContractEditor = lazy(() => import('@/pages/ContractEditor'));
const ViewEstimate = lazy(() => import('@/pages/ViewEstimate'));
const SharePortal = lazy(() => import('@/pages/SharePortal'));
const CustomerPortalPublic = lazy(() => import('@/pages/CustomerPortalPublic'));
const CrewPhotoUpload = lazy(() => import('@/pages/CrewPhotoUpload'));
const CrewWorkOrderPortal = lazy(() => import('@/pages/CrewWorkOrderPortal'));
const AdjusterReview = lazy(() => import('@/pages/AdjusterReview'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const PaymentSuccess = lazy(() => import('@/pages/PaymentSuccess'));
const PaymentCancel = lazy(() => import('@/pages/PaymentCancel'));
const PublicColorViz = lazy(() => import('@/pages/PublicColorViz'));
const MarketingFeatures = lazy(() => import('@/pages/MarketingFeatures'));
const OnboardingWizard = lazy(() => import('@/pages/OnboardingWizard'));
const PublicPricing = lazy(() => import('@/pages/PublicPricing'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;
const PageLoading = () => (
  <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 bg-white text-sm text-slate-500 dark:bg-[#1E374D] dark:text-slate-200">
    <CompanySyncLogo tone="light" className="h-8 w-auto dark:hidden" />
    <CompanySyncLogo tone="dark" className="hidden h-8 w-auto dark:block" />
    Loading page…
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

function useActiveCompanyId() {
  const { impersonatedCompanyId: impersonatedId } = useImpersonation();
  const [storedId, setStoredId] = useState(() => getLastUsedCompanyId());

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key?.startsWith('last_used_company_id:')) {
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
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-white dark:bg-[#1E374D] z-50">
        <CompanySyncLogo tone="light" className="h-12 w-auto dark:hidden" />
        <CompanySyncLogo tone="dark" className="hidden h-12 w-auto dark:block" />
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#087EE1] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const currentUrl = window.location.pathname + window.location.search;
    if (currentUrl && currentUrl !== '/' && currentUrl !== '/login') {
      sessionStorage.setItem('post_login_redirect', currentUrl);
    }
    return <Suspense fallback={<PageLoading />}><LoginPage /></Suspense>;
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
    <Suspense fallback={<PageLoading />}>
      <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <ErrorBoundary>
            <Suspense fallback={<PageLoading />}><MainPage /></Suspense>
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
                <Suspense fallback={<PageLoading />}><Page /></Suspense>
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
    <Suspense fallback={<PageLoading />}>
      <Routes>
      <Route path="/login" element={
        <ErrorBoundary><LoginPage /></ErrorBoundary>
      } />
      <Route path="/signup" element={
        <ErrorBoundary><SignupPage /></ErrorBoundary>
      } />
      {/* Pricing and onboarding are intentionally public. They must render
          before authentication so a new subscriber can complete the form and
          then continue through the normal /signup flow. */}
      <Route path="/PublicPricing" element={
        <ErrorBoundary><PublicPricing /></ErrorBoundary>
      } />
      <Route path="/OnboardingWizard" element={
        <ErrorBoundary><OnboardingWizard /></ErrorBoundary>
      } />
      <Route path="/privacy" element={
        <ErrorBoundary><PrivacyPolicy /></ErrorBoundary>
      } />
      <Route path="/terms" element={
        <ErrorBoundary><TermsOfService /></ErrorBoundary>
      } />
      <Route path="/Privacy" element={<Navigate to="/privacy" replace />} />
      <Route path="/Terms" element={<Navigate to="/terms" replace />} />
      <Route path="/ForgotPassword" element={
        <ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>
      } />
      <Route path="/ResetPassword" element={
        <ErrorBoundary><ResetPasswordPage /></ErrorBoundary>
      } />
      <Route path="/contract-editor" element={
        <ErrorBoundary><ContractEditor /></ErrorBoundary>
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
      <Route path="/share/:hash" element={
        <ErrorBoundary><SharePortal /></ErrorBoundary>
      } />
      <Route path="/portal" element={
        <ErrorBoundary><CustomerPortalPublic /></ErrorBoundary>
      } />
      <Route path="/crew-upload" element={
        <ErrorBoundary><CrewPhotoUpload /></ErrorBoundary>
      } />
      <Route path="/crew-portal" element={
        <ErrorBoundary><CrewWorkOrderPortal /></ErrorBoundary>
      } />
      <Route path="/CrewPhotoUpload" element={
        <ErrorBoundary><CrewPhotoUpload /></ErrorBoundary>
      } />
      <Route path="/adjuster-review" element={
        <ErrorBoundary><AdjusterReview /></ErrorBoundary>
      } />
      <Route path="/payment-success" element={
        <ErrorBoundary><PaymentSuccess /></ErrorBoundary>
      } />
      <Route path="/color-viz" element={
        <ErrorBoundary><PublicColorViz /></ErrorBoundary>
      } />
      <Route path="/features" element={
        <ErrorBoundary><MarketingFeatures /></ErrorBoundary>
      } />
      <Route path="/feature" element={
        <ErrorBoundary><MarketingFeatures /></ErrorBoundary>
      } />
      <Route path="/payment-cancel" element={
        <ErrorBoundary><PaymentCancel /></ErrorBoundary>
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
          <UploadQueueProvider>
            <ErrorBoundary>
              <Router>
                <NavigationTracker />
                <PresenceTracker />
                <UpcomingEventAlert />
                <AppRouter />
              </Router>
            </ErrorBoundary>
            <Toaster />
            <VisualEditAgent />
          </UploadQueueProvider>
        </ImpersonationProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
