import React from "react";
import LegalPageLayout from "./LegalPageLayout";

const Section = ({ title, children }) => (
  <section>
    <h2 className="mb-2 text-xl font-semibold text-slate-950">{title}</h2>
    {children}
  </section>
);

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <p>
        This Privacy Policy explains how CompanySync CRM at{" "}
        <a className="text-blue-700 underline" href="https://getcompanysync.com">getcompanysync.com</a>{" "}
        handles information when you use the service. Questions or deletion requests can be sent to{" "}
        <a className="text-blue-700 underline" href="mailto:io.companysync@gmail.com">io.companysync@gmail.com</a>.
      </p>

      <Section title="Information we collect">
        <p>Depending on how you use CompanySync, we may collect:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>Your account email address and name.</li>
          <li>Your company profile, including business contact details and preferences.</li>
          <li>Customers, leads, jobs, estimates, invoices, photos, and other business information you enter.</li>
          <li>Service logs, device and browser information needed to operate and protect the service, and cookies or session information used to keep you signed in.</li>
        </ul>
      </Section>

      <Section title="Optional connections">
        <p>
          CompanySync can connect to services that you choose to turn on. These may include Google Calendar
          (including the <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">calendar</code> and{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">calendar.events</code> permissions),
          Twilio phone and SMS, Stripe payments, and your own Postmark or Amazon SES email account.
          These connections are optional and are used to provide the feature you requested.
        </p>
      </Section>

      <Section title="Google Calendar">
        <p>
          We only access a Google Calendar after you click Connect and authorize the connection. We use that
          access to show and create your business events in CompanySync. We do not sell Google Calendar data
          or use it for advertising.
        </p>
      </Section>

      <Section title="How we use information">
        <p>
          We use information to provide CompanySync, save and display your business records, operate optional
          connections, respond to support requests, prevent abuse, and maintain the security and reliability
          of the service. We do not sell personal information.
        </p>
      </Section>

      <Section title="Your business data and choices">
        <p>
          You control the customer and job information you enter. To ask a question, request deletion, or
          exercise another privacy choice, email{" "}
          <a className="text-blue-700 underline" href="mailto:io.companysync@gmail.com">io.companysync@gmail.com</a>.
          We may need to verify the request and retain limited information where required for security,
          legal, accounting, or dispute-resolution purposes.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy as CompanySync changes. The date at the top of this page shows when it was
          last updated. Continued use of the service after an update means the revised policy applies.
        </p>
      </Section>
    </LegalPageLayout>
  );
}