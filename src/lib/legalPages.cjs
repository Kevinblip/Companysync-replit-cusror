const LAST_UPDATED = 'September 1, 2026';
const COMPANY = 'CompanySync';
const PRODUCT = 'roofing CRM';
const CONTACT_EMAIL = 'yicnteam@gmail.com';
const ADDRESS_LINE = '5420 Mardale Ave, Bedford Heights, OH 44146';
const SITE_URL = 'https://getcompanysync.com';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const LEGAL_ROUTES = {
  '/privacy': 'privacy',
  '/privacy/': 'privacy',
  '/privacy-policy': 'privacy',
  '/privacy-policy/': 'privacy',
  '/terms': 'terms',
  '/terms/': 'terms',
};

function matchLegalRoute(pathname) {
  if (!pathname) return null;
  const path = String(pathname).split('?')[0].toLowerCase();
  return LEGAL_ROUTES[path] || null;
}

const privacySections = [
  {
    id: 'who-we-are',
    title: '1. Who we are',
    paragraphs: [
      'CompanySync is a roofing CRM and business-management platform used by roofing contractors to run customers, jobs, estimates, inspections, scheduling, and billing in one place.',
      'This Privacy Policy explains what information we collect, how we use it, how we share it, and the choices you have. It applies to getcompanysync.com and the CompanySync application (the “Service”).',
      `Operator: CompanySync. Contact: ${CONTACT_EMAIL}. Mailing address: ${ADDRESS_LINE}.`,
    ],
  },
  {
    id: 'information-we-collect',
    title: '2. Information we collect',
    paragraphs: [
      'We collect information that you and your company provide when using CompanySync, information created as you operate the CRM, and limited technical data needed to keep the Service secure and working.',
    ],
    bullets: [
      'Account information: name, email address, password (stored as a hash), profile photo, role, and company affiliation.',
      'Company and CRM data: company profile, staff/crew records, customers, leads, jobs/projects, estimates, proposals, invoices, contracts, documents, photos, notes, tasks, messages, and related job workflow data.',
      'Scheduling data: job appointments, inspections, and crew schedules that you create in CompanySync.',
      'Billing and subscription data: plan selection, subscription status, invoices, and payment-related records associated with your CompanySync account.',
      'Support and communications: emails, in-app messages, and other correspondence you send to us.',
      'Technical and usage data: IP address, browser type, device information, approximate location derived from IP, log data, and pages or features used, for security, debugging, and service reliability.',
    ],
  },
  {
    id: 'google-sign-in',
    title: '3. Google Sign-In',
    paragraphs: [
      'CompanySync offers Google Sign-In so subscribers can create an account or log in with their Google account instead of a password.',
      'When you choose “Sign in with Google,” Google authenticates you and, with your consent, shares basic profile information we need to operate your account: your Google account email address, name, unique Google user ID, and profile photo if one is available.',
      'We use that information only to create or sign you into your CompanySync account, associate you with the correct company, and display your identity in the app. We do not use Google Sign-In data to advertise to you, and we do not sell it.',
      'You can stop using Google Sign-In by using a CompanySync email/password login (if configured) or by contacting us to delete your account. You may also revoke CompanySync’s access to your Google account from your Google Account permissions page.',
    ],
  },
  {
    id: 'google-calendar',
    title: '4. Google Calendar access',
    paragraphs: [
      'CompanySync can sync job appointments, inspections, and crew schedules to a subscriber’s own Google Calendar when that subscriber chooses to connect Calendar.',
      `To do this, CompanySync requests the following Google OAuth scopes: ${CALENDAR_SCOPE} and ${CALENDAR_EVENTS_SCOPE}.`,
      'Those scopes let CompanySync read calendar metadata needed to place events on the correct calendar and create, update, and delete calendar events that correspond to CompanySync job appointments, inspections, and crew schedules.',
      'We use Google Calendar data only to create, update, or delete those calendar events at the user’s request (including automatic sync of appointments the user or their company creates in CompanySync). We do not use Google Calendar data for advertising. We do not sell Google Calendar data. We do not use Google Calendar data for any purpose other than providing this user-facing calendar sync feature.',
      'Calendar tokens and related connection details are stored so we can keep syncing on your behalf until you disconnect. Users can disconnect Google Calendar in CompanySync settings (Calendar / Calendar Settings). After disconnect, we stop creating, updating, or deleting events on that Google Calendar and we no longer use the associated Google Calendar tokens.',
      'You may also revoke Calendar access at any time from your Google Account permissions. Revoking access in Google or disconnecting in CompanySync both stop CompanySync from accessing that calendar.',
    ],
  },
  {
    id: 'google-limited-use',
    title: '5. Limited use of Google user data',
    paragraphs: [
      'CompanySync’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
      'In particular: we only use Google user data to provide and improve user-facing features of CompanySync (sign-in and calendar sync). We do not transfer Google user data to others except as necessary to provide the Service, to comply with the law, or as part of a merger or acquisition, and then only in accordance with this policy. We do not use Google user data for serving advertisements. We do not allow humans to read Google user data unless you give us permission to do so for support, it is necessary for security reasons, we are required by law, or the data is aggregated and anonymized for internal operations.',
    ],
  },
  {
    id: 'payments',
    title: '6. Payments (Stripe)',
    paragraphs: [
      'Paid CompanySync subscriptions and certain customer payments are processed by Stripe, a third-party payment processor.',
      'When you enter payment information, Stripe collects and processes card or bank details according to Stripe’s own privacy policy. CompanySync does not store full credit-card numbers on our servers. We receive limited billing metadata from Stripe (for example, subscription status, last-four digits or payment-method type, invoice amounts, and whether a charge succeeded) so we can provision your plan and show billing history.',
      'If your company uses Stripe to collect payments from your roofing customers through CompanySync, those payment details are also processed by Stripe. We use that information only to record the payment against the related invoice or job in the CRM.',
    ],
  },
  {
    id: 'cookies',
    title: '7. Cookies and session',
    paragraphs: [
      'CompanySync uses cookies and similar technologies that are required to operate the Service.',
      'After you sign in, we set a session cookie so your browser stays logged in as you use the app. The session cookie is used for authentication and security (including CSRF-related protections where applicable). We also use local browser storage for preferences such as the last selected company.',
      'We do not use advertising cookies, and we do not sell cookie data. If you block cookies entirely, you will not be able to remain signed in. Logging out clears the session.',
    ],
  },
  {
    id: 'how-we-use',
    title: '8. How we use information',
    paragraphs: [
      'We use the information described above to:',
    ],
    bullets: [
      'Provide the CRM: customers, jobs, estimates, invoices, scheduling, inspections, documents, and related roofing-workflow features.',
      'Authenticate users, keep accounts secure, and prevent abuse.',
      'Sync job appointments, inspections, and crew schedules to Google Calendar when you connect that feature.',
      'Process subscriptions and payments via Stripe.',
      'Send transactional messages (login, password reset, billing receipts, and product notices related to your account).',
      'Provide customer support and diagnose technical issues.',
      'Maintain backups, logs, and security monitoring needed to operate a production SaaS product.',
      'Comply with law and enforce our Terms of Service.',
    ],
  },
  {
    id: 'sharing',
    title: '9. Sharing and subprocessors',
    paragraphs: [
      'We do not sell your personal information or your Google Calendar data.',
      'We share information only as needed to run CompanySync:',
    ],
    bullets: [
      'Service providers / subprocessors: hosting and infrastructure, database, email delivery, SMS/voice providers, payment processing (Stripe), and Google (Sign-In and Calendar APIs when you use those features). These parties process data on our instructions to provide their services.',
      'Your own company users: staff and invited team members in your CompanySync company can see CRM data according to the permissions you configure.',
      'Legal and safety: we may disclose information if required by law, court order, or to protect the rights, safety, or property of CompanySync, our users, or the public.',
      'Business transfers: if CompanySync is involved in a merger, acquisition, or asset sale, information may be transferred as part of that transaction, subject to this policy or a successor policy.',
    ],
  },
  {
    id: 'retention',
    title: '10. Retention',
    paragraphs: [
      'We keep account, company, and CRM data for as long as your company maintains an active CompanySync account and as needed to provide the Service.',
      'If you close your account or ask us to delete it, we delete or de-identify personal data associated with that account within a reasonable period, except where we must retain limited records for legal, tax, accounting, dispute, or security purposes (for example, billing records or abuse-prevention logs).',
      'Google Calendar access tokens are retained only while Calendar remains connected. We delete or invalidate those tokens when you disconnect Calendar or delete your account.',
      'Backups may persist for a limited time after deletion until they rotate out of our backup cycle.',
    ],
  },
  {
    id: 'your-rights',
    title: '11. Your rights and choices',
    paragraphs: [
      'Depending on where you live, you may have rights to access, correct, delete, or export personal information, or to object to or restrict certain processing. You can:',
    ],
    bullets: [
      'Review and update much of your account and CRM data directly in CompanySync.',
      'Disconnect Google Calendar in settings, which stops Calendar sync and our use of those Google Calendar tokens.',
      'Revoke Google Sign-In or Calendar access from your Google Account.',
      'Request access, correction, or deletion by emailing yicnteam@gmail.com. We will verify the request and respond within a reasonable time.',
      'Ask us to delete your CompanySync account and associated personal data, subject to legal retention requirements.',
    ],
    paragraphsAfter: [
      'If you are a staff user of a roofing company that subscribes to CompanySync, some records (such as jobs or customers) are controlled by that company. We may need to coordinate deletion requests with the company administrator.',
    ],
  },
  {
    id: 'security',
    title: '12. Security',
    paragraphs: [
      'We use administrative, technical, and physical safeguards appropriate to a business CRM, including encrypted connections (HTTPS), hashed passwords, access controls, and restricted production access. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.',
    ],
  },
  {
    id: 'children',
    title: '13. Children',
    paragraphs: [
      'CompanySync is a business product for roofing contractors and their staff. It is not directed to children under 13 (or the equivalent age in your jurisdiction), and we do not knowingly collect personal information from children.',
    ],
  },
  {
    id: 'changes',
    title: '14. Changes to this policy',
    paragraphs: [
      `We may update this Privacy Policy from time to time. The “Last updated” date at the top of this page will change when we do. Material changes may also be communicated by email or an in-app notice. Continued use of CompanySync after an update means you accept the revised policy.`,
    ],
  },
  {
    id: 'contact',
    title: '15. Contact us / how to delete data',
    paragraphs: [
      'To ask a privacy question, request a copy of your data, disconnect a Google integration, or delete your account, contact:',
      `CompanySync`,
      `Email: ${CONTACT_EMAIL}`,
      `Mail: ${ADDRESS_LINE}`,
      'Please include the email address on your CompanySync account so we can locate and verify the request. For account deletion, we will confirm when deletion is complete or explain any legally required retention.',
    ],
  },
];

const termsSections = [
  {
    id: 'agreement',
    title: '1. Agreement',
    paragraphs: [
      'These Terms of Service (“Terms”) govern access to and use of CompanySync, a roofing CRM and business-management platform operated by CompanySync.',
      `By creating an account, signing in (including with Google), or using getcompanysync.com, you agree to these Terms and to our Privacy Policy. If you are using CompanySync on behalf of a company, you represent that you have authority to bind that company.`,
      `Contact: ${CONTACT_EMAIL}. Mailing address: ${ADDRESS_LINE}.`,
    ],
  },
  {
    id: 'the-service',
    title: '2. The Service',
    paragraphs: [
      'CompanySync provides software for roofing contractors, including customer and job management, estimates, invoicing, scheduling, inspections, communications, and related tools. Features depend on your subscription plan. We may add, change, or discontinue features with reasonable notice where practical.',
      'Optional integrations (including Google Sign-In, Google Calendar, and Stripe payments) are provided as-is and require you to comply with those providers’ terms as well.',
    ],
  },
  {
    id: 'accounts',
    title: '3. Accounts and acceptable use',
    paragraphs: [
      'You are responsible for the accuracy of account information, for keeping credentials confidential, and for activity under your account. Notify us promptly of unauthorized use.',
      'You agree not to:',
    ],
    bullets: [
      'Use CompanySync for anything unlawful, fraudulent, or that infringes others’ rights.',
      'Probe, scan, or disrupt the Service, or attempt to bypass security or access controls.',
      'Upload malware, or content you do not have the right to use.',
      'Misuse Google, Stripe, SMS, email, or other connected services, including sending spam.',
      'Resell or provide the Service to third parties except as expressly allowed by your plan.',
      'Use the Service to store or process data that you are not legally allowed to process.',
    ],
    paragraphsAfter: [
      'We may suspend or terminate access for violations, non-payment, or to protect the Service and other users.',
    ],
  },
  {
    id: 'customer-data',
    title: '4. Your data',
    paragraphs: [
      'You retain ownership of the customer, job, and company data you put into CompanySync. You grant us a limited license to host, process, backup, and display that data solely to provide the Service to you.',
      'You are responsible for having the rights and consents needed to enter customer and job information into the CRM. Our handling of personal data is described in the Privacy Policy.',
    ],
  },
  {
    id: 'subscriptions',
    title: '5. Subscriptions and billing',
    paragraphs: [
      'Paid plans are billed in advance through Stripe on the interval shown at checkout (typically monthly or annually) unless otherwise agreed in writing.',
      'Fees are non-refundable except where required by law or where we expressly offer a refund. Plan changes take effect according to the billing flow in the app. If a payment fails, we may retry the charge and may limit or suspend access until the account is current.',
      'You authorize us and Stripe to charge the payment method on file for subscription fees, applicable taxes, and usage-based charges described in your plan (if any).',
      'You may cancel in billing settings or by emailing yicnteam@gmail.com. Cancellation stops future renewal charges; you generally retain access through the end of the then-current paid period unless we state otherwise.',
    ],
  },
  {
    id: 'integrations',
    title: '6. Google and other integrations',
    paragraphs: [
      'If you connect Google Sign-In or Google Calendar, you authorize CompanySync to access the Google data described in the Privacy Policy, only to provide those features. You can disconnect Calendar in settings. Google and Stripe are independent providers; we are not responsible for outages or changes in their services.',
    ],
  },
  {
    id: 'disclaimer',
    title: '7. Disclaimers and limitation of liability',
    paragraphs: [
      'CompanySync is provided “as is” and “as available.” We do not warrant that the Service will be uninterrupted, error-free, or that estimates, inspections, or other outputs will meet a particular result. Roofing measurements, pricing, and job decisions remain your professional responsibility.',
      'To the maximum extent permitted by law, CompanySync is not liable for indirect, incidental, special, consequential, or lost-profits damages, or for loss of data, arising from use of the Service. Our total liability for any claim relating to the Service is limited to the fees you paid us for the Service in the three months before the claim.',
    ],
  },
  {
    id: 'indemnity',
    title: '8. Indemnity',
    paragraphs: [
      'You will indemnify and hold CompanySync harmless from claims arising out of your use of the Service, your customer or job data, or your violation of these Terms or applicable law.',
    ],
  },
  {
    id: 'governing-law',
    title: '9. Governing law',
    paragraphs: [
      'These Terms are governed by the laws of the State of Ohio, without regard to conflict-of-law rules. Courts located in Cuyahoga County, Ohio will have exclusive jurisdiction, except that we may seek injunctive relief in any jurisdiction.',
    ],
  },
  {
    id: 'changes-contact',
    title: '10. Changes and contact',
    paragraphs: [
      `We may update these Terms from time to time. The “Last updated” date will change when we do. Continued use after a change constitutes acceptance. Questions: ${CONTACT_EMAIL}, ${ADDRESS_LINE}.`,
    ],
  },
];

const PAGE_META = {
  privacy: {
    title: 'Privacy Policy',
    description: 'CompanySync Privacy Policy — how we collect, use, and protect account, CRM, Google Calendar, and billing data.',
    path: '/privacy',
    sections: privacySections,
  },
  terms: {
    title: 'Terms of Service',
    description: 'CompanySync Terms of Service — acceptable use and subscription terms for the roofing CRM.',
    path: '/terms',
    sections: termsSections,
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSectionHtml(section) {
  const parts = [];
  parts.push(`<section id="${escapeHtml(section.id)}">`);
  parts.push(`<h2>${escapeHtml(section.title)}</h2>`);
  for (const p of section.paragraphs || []) {
    parts.push(`<p>${escapeHtml(p)}</p>`);
  }
  if (section.bullets && section.bullets.length) {
    parts.push('<ul>');
    for (const item of section.bullets) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }
  for (const p of section.paragraphsAfter || []) {
    parts.push(`<p>${escapeHtml(p)}</p>`);
  }
  parts.push('</section>');
  return parts.join('\n');
}

function renderLegalHtml(pageKey) {
  const page = PAGE_META[pageKey];
  if (!page) return null;
  const other = pageKey === 'privacy'
    ? { href: '/terms', label: 'Terms of Service' }
    : { href: '/privacy', label: 'Privacy Policy' };
  const body = page.sections.map(renderSectionHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title)} | ${escapeHtml(COMPANY)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  <link rel="canonical" href="${SITE_URL}${page.path}" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      line-height: 1.65;
    }
    header {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1e293b 100%);
      color: #fff;
      padding: 28px 24px;
    }
    header .wrap, main, footer .wrap { max-width: 760px; margin: 0 auto; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
    .tagline { margin: 4px 0 0; color: #bfdbfe; font-size: 13px; }
    nav { margin-top: 16px; font-size: 14px; }
    nav a { color: #bfdbfe; margin-right: 16px; text-decoration: none; }
    nav a:hover { text-decoration: underline; color: #fff; }
    main { background: #fff; padding: 40px 24px 64px; }
    h1 { font-size: 32px; letter-spacing: -0.03em; margin: 0 0 8px; }
    .updated { color: #64748b; font-size: 14px; margin: 0 0 32px; }
    h2 { font-size: 20px; margin: 32px 0 12px; color: #0f172a; }
    p, li { color: #334155; font-size: 16px; }
    ul { padding-left: 1.25rem; }
    li { margin: 8px 0; }
    footer {
      border-top: 1px solid #e2e8f0;
      padding: 24px;
      color: #64748b;
      font-size: 13px;
      background: #f8fafc;
    }
    footer a { color: #2563eb; text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <p class="brand">${escapeHtml(COMPANY)}</p>
      <p class="tagline">Roofing Business Management</p>
      <nav>
        <a href="/login">Sign in</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
      </nav>
    </div>
  </header>
  <main>
    <h1>${escapeHtml(COMPANY)} ${escapeHtml(page.title)}</h1>
    <p class="updated">Last updated ${escapeHtml(LAST_UPDATED)}</p>
    ${body}
  </main>
  <footer>
    <div class="wrap">
      <p>${escapeHtml(COMPANY)} · ${escapeHtml(PRODUCT)} · <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a></p>
      <p>${escapeHtml(ADDRESS_LINE)}</p>
      <p><a href="${other.href}">${escapeHtml(other.label)}</a> · <a href="/login">Sign in</a></p>
    </div>
  </footer>
</body>
</html>`;
}

module.exports = {
  LAST_UPDATED,
  COMPANY,
  PRODUCT,
  CONTACT_EMAIL,
  ADDRESS_LINE,
  SITE_URL,
  CALENDAR_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  LEGAL_ROUTES,
  privacySections,
  termsSections,
  PAGE_META,
  matchLegalRoute,
  renderLegalHtml,
};
