import React from "react";
import { Link } from "react-router-dom";
import CompanySyncLogo from "@/components/brand/CompanySyncLogo";

export default function LegalPageLayout({ title, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-gradient-to-r from-slate-950 via-blue-950 to-blue-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-5">
          <Link to="/" className="inline-flex items-center" aria-label="CompanySync home">
            <CompanySyncLogo tone="dark" className="h-8 w-auto" />
          </Link>
          <nav aria-label="Legal navigation" className="flex items-center gap-4 text-sm text-blue-100">
            <Link to="/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white">Terms of Service</Link>
            <Link to="/login" className="rounded-md border border-blue-300/50 px-3 py-1.5 hover:bg-white/10">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <article className="rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <div className="mb-8 border-b border-slate-200 pb-6">
            <CompanySyncLogo tone="light" className="mb-3 h-8 w-auto" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-slate-500">Last updated: September 2, 2026</p>
          </div>
          <div className="space-y-8 text-[15px] leading-7 text-slate-700">{children}</div>
        </article>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} CompanySync</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-blue-700">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-blue-700">Terms of Service</Link>
            <a href="mailto:io.companysync@gmail.com" className="hover:text-blue-700">Contact us</a>
          </div>
        </div>
      </footer>
    </div>
  );
}