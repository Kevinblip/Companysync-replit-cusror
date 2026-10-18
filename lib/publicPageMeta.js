// Titles and descriptions for the public ad-landing pages. Body copy on those
// pages is unchanged. og:image reuses the existing 512px app icon; a 1200x630
// image is still needed for link previews.

const DEFAULT_ORIGIN = 'https://getcompanysync.com';
const OG_IMAGE_PATH = '/icons/icon-512.png';

const PAGES = {
  '/features': {
    title: 'CompanySync Features for Roofing Contractors',
    description: 'CRM, estimating, scheduling, invoicing, and a 24/7 AI receptionist for roofing contractors. See what CompanySync includes.',
  },
  '/feature': {
    title: 'CompanySync Features for Roofing Contractors',
    description: 'CRM, estimating, scheduling, invoicing, and a 24/7 AI receptionist for roofing contractors. See what CompanySync includes.',
  },
  '/PublicPricing': {
    title: 'CompanySync Pricing',
    description: 'CompanySync pricing for roofing contractors. Start a 14-day free trial, no credit card required.',
  },
  '/signup': {
    title: 'Start Your CompanySync Free Trial',
    description: 'Start your CompanySync free trial. 14 days, no credit card required.',
  },
  '/login': {
    title: 'Log in to CompanySync',
    description: 'Log in to CompanySync, the roofing CRM for estimates, jobs, invoices, and your crew.',
  },
};

function normalizePath(pathname) {
  const path = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getPublicPageMeta(pathname, origin) {
  const path = normalizePath(pathname);
  const page = PAGES[path];
  if (!page) return null;
  const base = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '') || DEFAULT_ORIGIN;
  const canonicalPath = path === '/feature' ? '/features' : path;
  return {
    path,
    title: page.title,
    description: page.description,
    image: `${base}${OG_IMAGE_PATH}`,
    url: `${base}${canonicalPath}`,
  };
}

function upsertMeta(html, attr, key, content) {
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(`<meta\\s+${attr}=["']${key}["'][^>]*>`, 'i');
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

export function applyPublicPageMeta(html, pathname, origin) {
  const meta = getPublicPageMeta(pathname, origin);
  if (!meta || typeof html !== 'string' || !html) return html;
  let next = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  next = upsertMeta(next, 'name', 'description', meta.description);
  next = upsertMeta(next, 'property', 'og:title', meta.title);
  next = upsertMeta(next, 'property', 'og:description', meta.description);
  next = upsertMeta(next, 'property', 'og:image', meta.image);
  next = upsertMeta(next, 'property', 'og:url', meta.url);
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(next)) {
    next = next.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtml(meta.url)}" />`);
  }
  return next;
}
