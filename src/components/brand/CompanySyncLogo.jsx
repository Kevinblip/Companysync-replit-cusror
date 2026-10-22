const ALT = "CompanySync roofing CRM logo";

/** Full colour on light backgrounds; white on navy or other dark backgrounds. */
const SOURCES = {
  horizontal: {
    light: "/brand/companysync-roofing-crm-logo-horizontal.svg",
    dark: "/brand/companysync-roofing-crm-logo-horizontal-white.svg",
    navy: "/brand/companysync-roofing-crm-logo-horizontal-navy.svg",
    black: "/brand/companysync-roofing-crm-logo-horizontal-black.svg",
  },
  stacked: {
    light: "/brand/companysync-roofing-crm-logo-stacked.svg",
    dark: "/brand/companysync-roofing-crm-logo-stacked-white.svg",
    navy: "/brand/companysync-roofing-crm-logo-stacked-navy.svg",
    black: "/brand/companysync-roofing-crm-logo-stacked-black.svg",
  },
  icon: {
    light: "/brand/companysync-roofing-crm-icon.svg",
    dark: "/brand/companysync-roofing-crm-icon-white.svg",
    navy: "/brand/companysync-roofing-crm-icon-navy.svg",
    black: "/brand/companysync-roofing-crm-icon-black.svg",
  },
};

export default function CompanySyncLogo({
  layout = "horizontal",
  tone = "light",
  className = "",
  ...rest
}) {
  const set = SOURCES[layout] || SOURCES.horizontal;
  const src = set[tone] || set.light;
  return <img src={src} alt={ALT} className={className} {...rest} />;
}
