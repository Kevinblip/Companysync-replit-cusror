# Sales agent message copy (DRAFTS, for the CompanySync Email bot to polish)
Merge fields: {{first_name}} {{company}} {{trade}} {{rep_name}} {{agent_name}} {{demo_time_local}} {{tz}} {{reschedule_url}} {{trial_url}} {{pricing_url}} {{clip_url}} {{clip_title}} {{recap_bullets}} {{objection}} {{unsubscribe_url}}
Rules: prices in copy may only be Basic $99/mo, Business $199/mo, Enterprise $399/mo (14-day free trial, no card, cancel anytime); never any other number. All sends suppressed on staging (STAGING_READ_ONLY_SIDE_EFFECTS=1); the staging UI shows a rendered preview instead. Every SMS ends with "Reply STOP to opt out." Every email has {{unsubscribe_url}} and the company postal address (CAN-SPAM).

## 1. Booking confirmation
**SMS:** Hi {{first_name}}, you're booked for your CompanySync demo {{demo_time_local}} {{tz}}. Sneak peek: {{clip_url}} Need a new time? {{reschedule_url}} Reply STOP to opt out.
**Email subject:** You're booked: CompanySync demo, {{demo_time_local}}
**Body:**
Hi {{first_name}},
Your CompanySync demo is set for {{demo_time_local}} ({{tz}}). The calendar invite is attached.
We'll keep it to about 15 minutes and focus on {{trade}}: how leads get answered, measured, estimated and paid without the paperwork.
Want a head start? Here's a 2-minute look at {{clip_title}}: {{clip_url}}
Need a different time? {{reschedule_url}}
Talk soon,
{{agent_name}}, CompanySync
**Attachment:** demo.ics (METHOD:REQUEST, 15 min, reschedule link in DESCRIPTION).

## 2. Reminder, 24 hours before
**SMS:** Reminder: your CompanySync demo is tomorrow at {{demo_time_local}} {{tz}}. Can't make it? Pick a new time in one tap: {{reschedule_url}} Reply STOP to opt out.
**Email subject:** Tomorrow: your CompanySync demo
**Body:** Hi {{first_name}}, quick reminder that we're on for {{demo_time_local}} {{tz}} tomorrow. If something came up, one tap moves it: {{reschedule_url}}. See you then. {{agent_name}}

## 3. Reminder, 1 hour before
**SMS:** See you in an hour, {{first_name}} ({{demo_time_local}} {{tz}}). Running late or on a roof? Move it here: {{reschedule_url}} Reply STOP to opt out.
**Email subject:** Starting in 1 hour
**Body:** Hi {{first_name}}, we start at {{demo_time_local}}. Join link: {{join_url}}. Need to move it? {{reschedule_url}}

## 4. No-show rebook (sent 10 minutes after start if they haven't joined)
**SMS:** Hi {{first_name}}, looks like today didn't work. No problem, roofs come first. Grab a new time here: {{reschedule_url}} Reply STOP to opt out.
**Email subject:** Missed you today, want a new time?
**Body:** Hi {{first_name}}, we didn't connect at {{demo_time_local}}. Totally get it. Pick any open slot here: {{reschedule_url}}. Or just watch the 2-minute tour first: {{clip_url}}. {{agent_name}}

## 5. Handoff to a human rep (to the prospect)
**Email subject:** You're set with {{rep_name}} on {{demo_time_local}}
**Body:** Hi {{first_name}}, thanks for the time today. I've booked you with {{rep_name}} from our team for {{demo_time_local}} {{tz}} so you can go over {{handoff_reason}}. They already have my notes, so you won't have to repeat yourself. Need a different time? {{reschedule_url}}

### Internal handoff summary (to the rep; in-app notification + email, suppressed on staging)
Subject: Handoff: {{first_name}} ({{company}}, {{trade}}), {{demo_time_local}}
Body: Lead: {{first_name}} {{last_name}}, {{phone}}, {{email}} · Team size: {{team_size}} · Current software: {{current_software}} · Pain: {{pain}} · Clips shown: {{clips_shown}} · Objections: {{objections}} · Why handed off: {{handoff_reason}} · Next step promised: {{next_step}} · Recording: {{recording_url}} · Transcript: {{transcript_url}}

## 6. Non-buyer follow-up sequence (~14 days)
**Day 0, recap email.** Subject: Your CompanySync recap
Hi {{first_name}}, thanks for the time today. Here's what we covered: {{recap_bullets}}. The clips I showed are here if you want to share them with your team: {{clip_links}}. Start the 14-day free trial (no credit card): {{trial_url}}. {{agent_name}}

**Day 2, objection email** (pick the variant that matches {{objection}}):
- *Price.* Subject: What CompanySync replaces. Body: Most roofers we talk to are paying for a CRM, an answering service, a measuring tool and an e-sign app separately. CompanySync puts those in one plan. Plans are Basic $99/mo, Business $199/mo and Enterprise $399/mo: {{pricing_url}}. The trial is free for 14 days, no card, so you can check it against a real job first.
- *Switching.* Subject: Switching is smaller than it looks. Body: Week one is your company profile, a price list (CSV import takes about a minute), your estimate template and inviting the team. The Launch Checklist tells you what's left. Want a rep to walk through your setup with you? {{book_url}}
- *Already use JobNimbus/AccuLynx.* Subject: Run one job side by side. Body: No need to rip anything out today. Put your next lead through the CompanySync trial and compare: the AI receptionist answering after hours, satellite measurement, the homeowner portal with Pay Now. {{trial_url}}
- *Need to think.* Subject: Something to think with. Body: Here are the two clips that answer the questions people usually sleep on: {{clip_links}}. When you're ready, the trial is here: {{trial_url}}

**Day 5, check-in call** (AI agent, phase 2 only; on staging it's a logged task). Script opener: "Hey {{first_name}}, it's {{agent_name}} with CompanySync. We talked on {{demo_date}}. Did you get a chance to look at the trial?" If they don't answer: no voicemail drop in v1, send SMS: "Hi {{first_name}}, {{agent_name}} from CompanySync. Tried you just now. Questions about the trial? Reply here or grab a time: {{book_url}} Reply STOP to opt out."

**Day 9, trial nudge.** Subject: 14 days, no card, one real job. Body: The quickest way to know if CompanySync fits is to run one real lead through it, from the call to the estimate to the invoice. Start here: {{trial_url}}

**Day 14, breakup.** Subject: Should I close your file? Body: Hi {{first_name}}, I haven't heard back, so I'll stop reaching out. If timing changes (storm season has a way of doing that), just reply to this email or start the trial anytime: {{trial_url}}. Good luck out there. {{agent_name}}

Stop rules: end the sequence on reply, trial start, purchase, unsubscribe/STOP, or rep takeover.

## 7. Trial check-ins
**Day 1.** Subject: Day 1: three things to set up first. Body: Welcome aboard, {{first_name}}. Do these three today: (1) company profile and logo, (2) your price list, (3) add your first lead. 2-minute walkthrough: https://getcompanysync.com/TrainingVideos?v=26. Questions? Reply here.
**Day 3.** Subject: Day 3: let the AI measure your next roof. Body: Type an address into the AI Estimator and get roof measurements from satellite in about 30 seconds, then build the estimate from your price list. Watch: https://getcompanysync.com/TrainingVideos?v=4
**Day 7.** Subject: Halfway through your trial. Body: You're halfway through, {{first_name}}. Want 15 minutes with {{rep_name}} to set up Alex on your business line or import your price list? {{book_url}}. Ready to keep it? Choose a plan: {{pricing_url}}.

## 8. Daily summary for Kevin (internal)
Subject: Sales agent daily: {{date}}
Body: Calls {{calls}} ({{minutes}} min) · Demos held {{demos}} · No-shows {{no_shows}} · Trials started {{trials}} · Subscriptions {{subs}} · Handoffs {{handoffs}} · Top objections {{top_objections}} · Pipeline moves {{stage_moves}} · Calls to review (low score or handoff): {{review_links}}
