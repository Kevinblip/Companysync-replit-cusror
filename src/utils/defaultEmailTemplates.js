/**
 * Default branded email templates used when admins leave the email body blank in Company Setup.
 *
 * These templates are the canonical frontend source of truth for the default email designs.
 * The backend Deno functions in functions/sendInspectionAssignment.ts contain equivalent
 * hardcoded HTML that must be kept in sync with these constants if either is updated.
 * (Deno functions cannot import JS modules from src/, so they maintain their own copy.)
 *
 * Merge field tokens (e.g. {inspector_name}) are replaced at send time using real job data,
 * and at preview time using REMINDER_SAMPLE_DATA from CompanySetup.jsx.
 */

export const DEFAULT_ASSIGNMENT_EMAIL_HTML = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#1e40af;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">📸 You've Been Assigned to PhotoSync</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">{company_name}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi {inspector_name},</p>
    <p style="color:#374151;margin-bottom:24px">You have a new inspection assignment. Here's everything you need to know before you head out.</p>
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#1e40af;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">📋 Job Details</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px;vertical-align:top">Address</td><td style="padding:6px 0;font-weight:600;color:#111827">📍 {property_address}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Scheduled</td><td style="padding:6px 0;font-weight:600;color:#059669">📅 {scheduled_date} at {scheduled_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Type</td><td style="padding:6px 0;color:#111827">{inspection_type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Damage</td><td style="padding:6px 0;color:#111827">{damage_type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Priority</td><td style="padding:6px 0;font-weight:600;color:#dc2626">{priority}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;vertical-align:top">Claim #</td><td style="padding:6px 0;color:#111827">{claim_number}</td></tr>
      </table>
    </div>
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">👤 Contact Info</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Client</td><td style="padding:6px 0;font-weight:600;color:#111827">{client_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:6px 0;font-weight:600;color:#111827">📞 {client_phone}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:6px 0;color:#111827">{client_email}</td></tr>
      </table>
    </div>
    <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:16px;margin:0 0 20px">
      <p style="margin:0 0 4px;font-weight:600;color:#854d0e;font-size:13px">🔑 Access Instructions</p>
      <p style="margin:0;color:#713f12;font-size:14px">{access_instructions}</p>
    </div>
    <div style="text-align:center;margin:28px 0 8px">
      <a href="{crewcam_link}" style="display:inline-block;background:#1e40af;color:white;font-size:17px;font-weight:700;padding:16px 40px;border-radius:10px;text-decoration:none;letter-spacing:0.3px">📸 Start Taking Photos</a>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:8px">Tap the button above to open PhotoSync directly for this job</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">{company_name} • Powered by CompanySync</p>
  </div>
</div>`;

export const DEFAULT_CLIENT_EMAIL_HTML = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#059669;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">✅ Inspection Confirmed</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">{company_name}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi {client_name},</p>
    <p style="color:#374151;margin-bottom:24px">Your property inspection has been scheduled. Here are the details:</p>
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">📋 Inspection Details</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Property</td><td style="padding:6px 0;font-weight:600;color:#111827">📍 {property_address}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:6px 0;font-weight:600;color:#059669">📅 {scheduled_date} at {scheduled_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Type</td><td style="padding:6px 0;color:#111827">{inspection_type}</td></tr>
      </table>
    </div>
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 12px;font-weight:700;color:#1e40af;font-size:14px;text-transform:uppercase;letter-spacing:0.5px">👷 Your Inspector</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px">Name</td><td style="padding:6px 0;font-weight:600;color:#111827">{inspector_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:6px 0;font-weight:600">📞 {inspector_phone}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:6px 0;color:#111827">{inspector_email}</td></tr>
      </table>
    </div>
    <p style="color:#6b7280;font-size:14px;margin:0">Your inspector will reach out to confirm the appointment. If you have any questions, contact us at {company_email}.</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">{company_name} • Powered by CompanySync</p>
  </div>
</div>`;

/**
 * Returns the assignment email HTML with the company's brand primary color
 * substituted for the default blue (#1e40af). Call this in preview renders
 * so the preview updates live as the operator changes their brand color.
 */
export function getDefaultAssignmentEmailHTML(brandColor = '#1e40af') {
  return DEFAULT_ASSIGNMENT_EMAIL_HTML.replace(/#1e40af/g, brandColor);
}

/**
 * Returns the client confirmation email HTML with the company's brand primary
 * color substituted for the default green (#059669). Call this in preview
 * renders so the preview updates live as the operator changes their brand color.
 */
export function getDefaultClientEmailHTML(brandColor = '#059669') {
  return DEFAULT_CLIENT_EMAIL_HTML.replace(/#059669/g, brandColor);
}
