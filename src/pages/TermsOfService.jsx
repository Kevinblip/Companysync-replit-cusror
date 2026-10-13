import React from "react";
import LegalPageLayout from "./LegalPageLayout";

const Section = ({ title, children }) => (
  <section>
    <h2 className="mb-2 text-xl font-semibold text-slate-950">{title}</h2>
    {children}
  </section>
);

export default function TermsOfService() {
  return (
    <LegalPageLayout title="Terms of Service">
      <p>
        These Terms of Service govern your use of CompanySync CRM at{" "}
        <a className="text-blue-700 underline" href="https://getcompanysync.com">getcompanysync.com</a>.
        By creating an account or using CompanySync, you agree to these terms.
      </p>

      <Section title="Service and trial">
        <p>
          CompanySync offers a 14-day free trial. No credit card is required to start the trial. After the
          trial, the plan you select becomes a paid subscription unless you cancel or otherwise change it.
          Features and plan limits may differ by plan. You may cancel according to the options shown in your
          account.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You are responsible for providing accurate account information, keeping your login details secure,
          and making sure people using your account follow these terms. Tell us promptly if you believe your
          account has been used without permission.
        </p>
      </Section>

      <Section title="Your data">
        <p>
          You own the customer, lead, job, estimate, invoice, photo, and other business data you enter into
          CompanySync. You give CompanySync permission to host, process, back up, and display that data only
          as needed to provide, secure, and improve the service. You are responsible for having the rights and
          permissions needed to enter and use that data.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>You may not use CompanySync to:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>Break the law, infringe someone else’s rights, or violate a third party’s privacy.</li>
          <li>Upload malware, attempt unauthorized access, or interfere with the service.</li>
          <li>Send spam, scams, abusive messages, or content that you do not have permission to send.</li>
          <li>Misuse automated features, integrations, or resources in a way that creates unreasonable risk or cost.</li>
        </ul>
      </Section>

      <Section title="Suspension and termination">
        <p>
          We may suspend or limit an account when necessary to stop abuse, protect the service or other users,
          address a security issue, or comply with the law. We may also terminate accounts that repeatedly or
          seriously violate these terms. Where practical, we will provide notice and an opportunity to resolve
          the issue.
        </p>
      </Section>

      <Section title="Service availability">
        <p>
          We work to keep CompanySync available and reliable, but the service may occasionally be unavailable
          for maintenance, updates, or circumstances outside our control. CompanySync is provided as a business
          software service and should not be your only copy of important records.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Questions about these terms can be sent to{" "}
          <a className="text-blue-700 underline" href="mailto:io.companysync@gmail.com">io.companysync@gmail.com</a>.
        </p>
      </Section>
    </LegalPageLayout>
  );
}