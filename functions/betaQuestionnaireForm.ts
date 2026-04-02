import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  
  // Handle form submission
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const base44 = createClientFromRequest(req);
      
      await base44.asServiceRole.entities.BetaQuestionnaire.create({
        first_name: body.first_name || '',
        last_name: body.last_name || '',
        email: body.email || '',
        phone: body.phone || '',
        company_name: body.company_name || '',
        company_size: body.company_size || '',
        years_in_business: body.years_in_business || '',
        current_tools: body.current_tools || [],
        current_tools_other: body.current_tools_other || '',
        biggest_pain_points: body.biggest_pain_points || [],
        pain_points_other: body.pain_points_other || '',
        most_wanted_features: body.most_wanted_features || [],
        features_other: body.features_other || '',
        monthly_budget: body.monthly_budget || '',
        beta_availability: body.beta_availability || '',
        additional_comments: body.additional_comments || '',
        status: 'new'
      });
      
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  
  // Serve the HTML form
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CompanySync Beta Questionnaire</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f172a 100%); min-height: 100vh; padding: 2rem 1rem; color: #1f2937; }
    .container { max-width: 640px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 2rem; }
    .badge { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 0.5rem 1rem; border-radius: 9999px; color: rgba(255,255,255,0.9); font-size: 0.875rem; font-weight: 500; margin-bottom: 1.5rem; }
    .badge svg { color: #facc15; }
    h1 { font-size: 2rem; font-weight: 700; color: white; margin-bottom: 0.75rem; line-height: 1.2; }
    .subtitle { color: rgba(191,219,254,0.8); font-size: 1.1rem; max-width: 500px; margin: 0 auto; }
    .progress { display: flex; gap: 0.5rem; max-width: 200px; margin: 0 auto 1.5rem; }
    .progress-bar { height: 6px; flex: 1; border-radius: 9999px; background: rgba(255,255,255,0.2); transition: background 0.3s; }
    .progress-bar.active { background: #60a5fa; }
    .card { background: white; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); padding: 2rem; }
    .step-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; }
    .step-icon { width: 40px; height: 40px; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; }
    .step-icon.blue { background: #dbeafe; }
    .step-icon.orange { background: #ffedd5; }
    .step-icon.green { background: #dcfce7; }
    .step-title { font-size: 1.125rem; font-weight: 700; }
    .step-sub { font-size: 0.875rem; color: #6b7280; }
    .form-group { margin-bottom: 1.25rem; }
    label.field-label { display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.375rem; }
    input[type="text"], input[type="email"], input[type="tel"], select, textarea {
      width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 1rem; font-family: inherit; outline: none; transition: border-color 0.2s;
    }
    input:focus, select:focus, textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 500px) { .grid-2 { grid-template-columns: 1fr; } h1 { font-size: 1.5rem; } }
    .checkbox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    @media (max-width: 500px) { .checkbox-grid { grid-template-columns: 1fr; } }
    .checkbox-item { display: flex; align-items: center; gap: 0.625rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #e5e7eb; cursor: pointer; transition: all 0.2s; font-size: 0.875rem; }
    .checkbox-item:hover { background: #f9fafb; }
    .checkbox-item.selected { background: #eff6ff; border-color: #93c5fd; }
    .checkbox-item.selected.orange { background: #fff7ed; border-color: #fdba74; }
    .checkbox-item.selected.green { background: #f0fdf4; border-color: #86efac; }
    .checkbox-item input[type="checkbox"] { width: 18px; height: 18px; accent-color: #3b82f6; cursor: pointer; flex-shrink: 0; }
    .checkbox-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .btn { padding: 0.875rem 1.5rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; width: 100%; font-family: inherit; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
    .btn-success { background: #16a34a; color: white; }
    .btn-success:hover { background: #15803d; }
    .btn-outline { background: white; color: #374151; border: 1px solid #d1d5db; }
    .btn-outline:hover { background: #f9fafb; }
    .btn-row { display: flex; gap: 0.75rem; }
    .btn-row .btn { flex: 1; }
    .footer { text-align: center; color: rgba(255,255,255,0.3); font-size: 0.75rem; margin-top: 1.5rem; }
    .success-screen { text-align: center; padding: 3rem 2rem; }
    .success-icon { width: 80px; height: 80px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2.5rem; }
    .success-screen h2 { font-size: 1.5rem; margin-bottom: 0.75rem; }
    .success-screen p { color: #6b7280; margin-bottom: 0.5rem; }
    .success-footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #9ca3af; }
    .hidden { display: none; }
    .loading { display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: white; animation: spin 0.8s linear infinite; margin-right: 0.5rem; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Beta Program — Limited Spots
      </div>
      <h1>Help Us Build the CRM<br>Roofers Actually Need</h1>
      <p class="subtitle">Quick questionnaire — takes about 2 minutes. Your answers directly shape what we build.</p>
    </div>

    <div class="progress">
      <div class="progress-bar active" id="prog1"></div>
      <div class="progress-bar" id="prog2"></div>
      <div class="progress-bar" id="prog3"></div>
    </div>

    <!-- SUCCESS SCREEN -->
    <div id="success-screen" class="card hidden">
      <div class="success-screen">
        <div class="success-icon">✅</div>
        <h2>You're In!</h2>
        <p>Thanks for signing up for the CompanySync beta.</p>
        <p style="font-size:0.875rem;">We'll review your responses and reach out shortly with next steps. Keep an eye on your inbox!</p>
        <div class="success-footer">— Alexa Stone, Sales & Marketing | CompanySync.io</div>
      </div>
    </div>

    <!-- STEP 1 -->
    <div id="step1" class="card">
      <div class="step-header">
        <div class="step-icon blue">🏢</div>
        <div><div class="step-title">About You & Your Company</div><div class="step-sub">Step 1 of 3</div></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="field-label">First Name *</label><input type="text" id="first_name" placeholder="John"></div>
        <div class="form-group"><label class="field-label">Last Name</label><input type="text" id="last_name" placeholder="Smith"></div>
      </div>
      <div class="form-group"><label class="field-label">Email *</label><input type="email" id="email" placeholder="john@example.com"></div>
      <div class="form-group"><label class="field-label">Phone</label><input type="tel" id="phone" placeholder="(555) 123-4567"></div>
      <div class="form-group"><label class="field-label">Company Name *</label><input type="text" id="company_name" placeholder="Smith Roofing LLC"></div>
      <div class="grid-2">
        <div class="form-group">
          <label class="field-label">Company Size</label>
          <select id="company_size"><option value="">Select...</option><option value="just_me">Just Me</option><option value="2_5">2–5 employees</option><option value="6_15">6–15 employees</option><option value="16_plus">16+ employees</option></select>
        </div>
        <div class="form-group">
          <label class="field-label">Years in Business</label>
          <select id="years_in_business"><option value="">Select...</option><option value="less_than_1">Less than 1 year</option><option value="1_3">1–3 years</option><option value="4_10">4–10 years</option><option value="10_plus">10+ years</option></select>
        </div>
      </div>
      <button class="btn btn-primary" onclick="goToStep(2)" id="btn-step1">Continue →</button>
    </div>

    <!-- STEP 2 -->
    <div id="step2" class="card hidden">
      <div class="step-header">
        <div class="step-icon orange">🔧</div>
        <div><div class="step-title">Your Current Setup & Pain Points</div><div class="step-sub">Step 2 of 3</div></div>
      </div>
      <div class="form-group">
        <label class="field-label">What tools/apps do you currently use? <span style="color:#9ca3af;font-weight:400;font-size:0.8rem">(select all that apply)</span></label>
        <div class="checkbox-grid" id="tools-grid"></div>
        <input type="text" id="current_tools_other" placeholder="Other tools..." style="margin-top:0.5rem;">
      </div>
      <div class="form-group">
        <label class="field-label">What are your biggest pain points? <span style="color:#9ca3af;font-weight:400;font-size:0.8rem">(select all that apply)</span></label>
        <div class="checkbox-list" id="pain-grid"></div>
        <input type="text" id="pain_points_other" placeholder="Other pain points..." style="margin-top:0.5rem;">
      </div>
      <div class="btn-row">
        <button class="btn btn-outline" onclick="goToStep(1)">← Back</button>
        <button class="btn btn-primary" onclick="goToStep(3)">Continue →</button>
      </div>
    </div>

    <!-- STEP 3 -->
    <div id="step3" class="card hidden">
      <div class="step-header">
        <div class="step-icon green">⚡</div>
        <div><div class="step-title">What Would Help You Most?</div><div class="step-sub">Step 3 of 3 — Almost done!</div></div>
      </div>
      <div class="form-group">
        <label class="field-label">Which features matter most to you? <span style="color:#9ca3af;font-weight:400;font-size:0.8rem">(select all that apply)</span></label>
        <div class="checkbox-grid" id="features-grid"></div>
        <input type="text" id="features_other" placeholder="Other features..." style="margin-top:0.5rem;">
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="field-label">Monthly Software Budget</label>
          <select id="monthly_budget"><option value="">Select...</option><option value="under_50">Under $50/mo</option><option value="50_100">$50–$100/mo</option><option value="100_200">$100–$200/mo</option><option value="200_plus">$200+/mo</option><option value="not_sure">Not sure yet</option></select>
        </div>
        <div class="form-group">
          <label class="field-label">When could you start testing?</label>
          <select id="beta_availability"><option value="">Select...</option><option value="asap">ASAP — I'm ready</option><option value="few_weeks">In a few weeks</option><option value="next_month">Next month</option><option value="just_curious">Just curious for now</option></select>
        </div>
      </div>
      <div class="form-group">
        <label class="field-label">Anything else you'd like us to know?</label>
        <textarea id="additional_comments" rows="3" placeholder="What frustrates you most about your current setup? What would your dream system look like?"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn btn-outline" onclick="goToStep(2)">← Back</button>
        <button class="btn btn-success" onclick="submitForm()" id="submit-btn">Submit Questionnaire ✓</button>
      </div>
    </div>

    <p class="footer">CompanySync.io — Built for roofers, by roofers.</p>
  </div>

  <script>
    const TOOLS = ["AccuLynx","JobNimbus","Leap","RoofSnap","EagleView","CompanyCam","Jobber","ServiceTitan","Housecall Pro","GoHighLevel","Spreadsheets/Google Sheets","Pen & Paper"];
    const PAINS = ["Too many apps that don't talk to each other","Missed or slow follow-ups on estimates","Job photos, notes & customer info scattered everywhere","Hard to track crew schedules & job progress","Invoicing & payment collection is a hassle","No good way to manage insurance claims","Can't easily generate estimates in the field","Difficult to train new staff on the system"];
    const FEATURES = ["All-in-one CRM + job management","AI-powered estimate generation","Built-in calling, texting & email","Photo documentation & inspection reports","Automated follow-ups & reminders","Customer portal for approvals & payments","Commission & payout tracking","Storm tracking & lead generation","Field rep mobile app","Insurance claim management"];

    function buildCheckboxes(containerId, items, colorClass) {
      const container = document.getElementById(containerId);
      items.forEach(item => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = '<input type="checkbox" value="' + item.replace(/"/g, '&quot;') + '"><span>' + item + '</span>';
        label.querySelector('input').addEventListener('change', function() {
          label.classList.toggle('selected', this.checked);
          if (colorClass) label.classList.toggle(colorClass, this.checked);
        });
        container.appendChild(label);
      });
    }

    buildCheckboxes('tools-grid', TOOLS);
    buildCheckboxes('pain-grid', PAINS, 'orange');
    buildCheckboxes('features-grid', FEATURES, 'green');

    function goToStep(step) {
      if (step === 2) {
        const fn = document.getElementById('first_name').value.trim();
        const em = document.getElementById('email').value.trim();
        const cn = document.getElementById('company_name').value.trim();
        if (!fn || !em || !cn) { alert('Please fill in First Name, Email, and Company Name.'); return; }
      }
      document.getElementById('step1').classList.toggle('hidden', step !== 1);
      document.getElementById('step2').classList.toggle('hidden', step !== 2);
      document.getElementById('step3').classList.toggle('hidden', step !== 3);
      document.getElementById('prog1').classList.toggle('active', step >= 1);
      document.getElementById('prog2').classList.toggle('active', step >= 2);
      document.getElementById('prog3').classList.toggle('active', step >= 3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function getChecked(containerId) {
      return Array.from(document.querySelectorAll('#' + containerId + ' input[type=checkbox]:checked')).map(cb => cb.value);
    }

    async function submitForm() {
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Submitting...';

      const data = {
        first_name: document.getElementById('first_name').value.trim(),
        last_name: document.getElementById('last_name').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        company_name: document.getElementById('company_name').value.trim(),
        company_size: document.getElementById('company_size').value,
        years_in_business: document.getElementById('years_in_business').value,
        current_tools: getChecked('tools-grid'),
        current_tools_other: document.getElementById('current_tools_other').value.trim(),
        biggest_pain_points: getChecked('pain-grid'),
        pain_points_other: document.getElementById('pain_points_other').value.trim(),
        most_wanted_features: getChecked('features-grid'),
        features_other: document.getElementById('features_other').value.trim(),
        monthly_budget: document.getElementById('monthly_budget').value,
        beta_availability: document.getElementById('beta_availability').value,
        additional_comments: document.getElementById('additional_comments').value.trim()
      };

      try {
        const res = await fetch(window.location.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Submit failed');
        document.getElementById('step3').classList.add('hidden');
        document.getElementById('success-screen').classList.remove('hidden');
      } catch (e) {
        alert('Something went wrong. Please try again.');
        btn.disabled = false;
        btn.innerHTML = 'Submit Questionnaire ✓';
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});