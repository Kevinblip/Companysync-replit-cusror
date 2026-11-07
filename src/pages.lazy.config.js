import React from 'react';
const __Layout = React.lazy(() => import('./Layout.jsx'));

// Keep the generated pages.config.js as the source of the route names, but do
// not import every page into the initial bundle. Each page is fetched only
// when its route is opened.
const pageLoaders = import.meta.glob('./pages/*.{js,jsx}', { eager: false });
const PUBLIC_ONLY_PAGES = new Set([
  'AdjusterReview',
  'ContractEditor',
  'CrewPhotoUpload',
  'CrewWorkOrderPortal',
  'ForgotPasswordPage',
  'LegalPageLayout',
  'LoginPage',
  'MarketingFeatures',
  'PaymentCancel',
  'PaymentSuccess',
  'PrivacyPolicy',
  'PublicColorViz',
  'SalesDemo',
  'ResetPasswordPage',
  'SharePortal',
  'SignupPage',
  'TermsOfService',
  'ThoughtlySetup',
]);

const pageKeyFromPath = (path) => path
  .replace(/^\.\/pages\//, '')
  .replace(/\.(jsx|js)$/, '');

const Pages = Object.fromEntries(
  Object.entries(pageLoaders)
    .map(([path, loader]) => [pageKeyFromPath(path), loader])
    .filter(([key]) => !PUBLIC_ONLY_PAGES.has(key))
    .map(([key, loader]) => [key, React.lazy(loader)])
);

export const pagesConfig = {
  mainPage: 'Dashboard',
  Pages,
  Layout: __Layout,
};