/**
 * Absolute CompanySync brand assets for email HTML.
 * Email clients do not reliably render SVG, so these are the PNG lockups.
 * Full colour on light backgrounds; white on navy or other dark backgrounds.
 */
const SITE = 'https://getcompanysync.com';
const LOGO_ALT = 'CompanySync roofing CRM logo';
const LOGO_COLOR = `${SITE}/brand/companysync-roofing-crm-logo-horizontal.png`;
const LOGO_WHITE = `${SITE}/brand/companysync-roofing-crm-logo-horizontal-white.png`;

function emailLogoImg({ variant = 'color', width = 200 } = {}) {
  const src = variant === 'white' ? LOGO_WHITE : LOGO_COLOR;
  const height = Math.max(1, Math.round((width * 252) / 1000));
  return `<img src="${src}" alt="${LOGO_ALT}" width="${width}" height="${height}" style="display:block;margin:0 auto 12px;width:${width}px;height:auto;border:0;" />`;
}

module.exports = { SITE, LOGO_ALT, LOGO_COLOR, LOGO_WHITE, emailLogoImg };
