import { Link } from "react-router-dom";
import legalPagesModule from "@/lib/legalPages.cjs";

const legalPages = legalPagesModule?.PAGE_META ? legalPagesModule : (legalPagesModule?.default || legalPagesModule);

function Section({ section }) {
  return (
    <section id={section.id} className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900 pt-2">{section.title}</h2>
      {(section.paragraphs || []).map((p, i) => (
        <p key={`${section.id}-p-${i}`} className="text-slate-600 leading-relaxed">
          {p}
        </p>
      ))}
      {section.bullets?.length ? (
        <ul className="list-disc pl-5 space-y-2 text-slate-600 leading-relaxed">
          {section.bullets.map((item, i) => (
            <li key={`${section.id}-b-${i}`}>{item}</li>
          ))}
        </ul>
      ) : null}
      {(section.paragraphsAfter || []).map((p, i) => (
        <p key={`${section.id}-pa-${i}`} className="text-slate-600 leading-relaxed">
          {p}
        </p>
      ))}
    </section>
  );
}

export default function LegalDocument({ pageKey }) {
  const page = legalPages.PAGE_META[pageKey];
  if (!page) return null;
  const other = pageKey === "privacy"
    ? { href: "/terms", label: "Terms of Service" }
    : { href: "/privacy", label: "Privacy Policy" };

  return (
    <div className="min-h-screen bg-slate-50" data-testid={`legal-page-${pageKey}`}>
      <header className="bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 text-white">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-2xl font-bold tracking-tight">{legalPages.COMPANY}</p>
          <p className="text-blue-200 text-sm mt-1">Roofing Business Management</p>
          <nav className="mt-5 flex flex-wrap gap-4 text-sm text-blue-200">
            <Link to="/login" className="hover:text-white">Sign in</Link>
            <Link to="/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white">Terms of Service</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 bg-white">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {legalPages.COMPANY} {page.title}
        </h1>
        <p className="text-slate-500 text-sm mt-2 mb-8">
          Last updated {legalPages.LAST_UPDATED}
        </p>
        <div className="space-y-8">
          {page.sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-3xl mx-auto px-6 py-6 text-sm text-slate-500 space-y-1">
          <p>
            {legalPages.COMPANY} · {legalPages.PRODUCT} ·{" "}
            <a className="text-blue-600 hover:underline" href={`mailto:${legalPages.CONTACT_EMAIL}`}>
              {legalPages.CONTACT_EMAIL}
            </a>
          </p>
          <p>{legalPages.ADDRESS_LINE}</p>
          <p>
            <Link to={other.href} className="text-blue-600 hover:underline">{other.label}</Link>
            {" · "}
            <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
