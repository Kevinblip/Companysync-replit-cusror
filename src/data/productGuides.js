/**
 * Built-in Product Guides — the CompanySync Help Center catalog.
 *
 * These are shipped with the app (NOT stored per-company), so every company
 * gets an always-up-to-date "how do I use this?" library with zero manual
 * upkeep. The Help Center widget merges these with each company's own
 * Knowledge Base articles for search, page-aware suggestions, and the
 * Quick AI Answer grounding.
 *
 * Each guide:
 *   id        stable, unique, prefixed "guide-" (won't collide with entity IDs)
 *   title     shown in search results and article header
 *   category  used for browse grouping + colored badge (see CATEGORY_COLORS)
 *   route     optional page key from pages.config.js — powers "Open this page"
 *   keywords  extra search terms so plain-language questions match
 *   content   markdown-ish body (## headings, **bold**, - lists, blank lines)
 *
 * builtin: true marks these so the widget can treat them slightly differently
 * from user-authored articles (e.g. no edit/delete).
 */

export const GUIDE_CATEGORY_ORDER = [
  "Getting Started",
  "Leads & Prospecting",
  "Estimates & AI",
  "Invoicing & Payments",
  "Customers",
  "Projects & Field",
  "AI Assistant",
  "Communication",
  "Reports & Settings",
];

export const PRODUCT_GUIDES = [
  // ─────────────────────────────── Getting Started ───────────────────────────────
  {
    id: "guide-welcome",
    title: "Welcome to CompanySync",
    category: "Getting Started",
    route: "Dashboard",
    builtin: true,
    keywords: ["welcome", "getting started", "overview", "what is", "begin", "new", "intro"],
    content: `## What CompanySync does
CompanySync is your all-in-one roofing business hub. It brings your leads, estimates, invoices, payments, crews, and customer history into one place — with AI helpers built in for measuring roofs, analyzing damage photos, and answering questions.

## The fastest way to get going
1. **Set up your company** — add your logo and business info in Settings so your estimates and invoices look professional.
2. **Add your team** — invite your salespeople and crew so work can be assigned.
3. **Bring in your leads** — add them by hand, import a list, or let Lead Finder pull new prospects.
4. **Send your first estimate** — use the AI Estimator to measure a roof, then send a polished quote.
5. **Get paid** — turn the estimate into an invoice and collect payment online.

## Need help anywhere?
Click the **Help** button any time. Search a topic, ask the AI a quick question, or open a full conversation with Lexi. You can also replay the **Product Tour** whenever you want a guided walkthrough.`,
  },
  {
    id: "guide-dashboard",
    title: "Your Dashboard at a glance",
    category: "Getting Started",
    route: "Dashboard",
    builtin: true,
    keywords: ["dashboard", "home", "overview", "metrics", "kpi", "numbers", "summary"],
    content: `## What you're looking at
The Dashboard is your morning command center. In one screen you see how the business is doing right now:

- **Active leads** waiting for follow-up
- **Jobs in progress** and what stage they're at
- **Money** — outstanding invoices and recent payments
- **Action Items** — anything overdue that needs attention today

## How to use it
Start your day here. Anything with a red badge or an "overdue" tag is asking for attention. Click any number or card to jump straight to the full list behind it.

## Tip
If a number looks off, it usually means a record is missing an owner or a status. Click into it — the Dashboard always links to the real data so you can fix it fast.`,
  },
  {
    id: "guide-product-tour",
    title: "Take the Product Tour",
    category: "Getting Started",
    builtin: true,
    keywords: ["tour", "walkthrough", "onboarding", "guided", "demo", "learn", "training"],
    content: `## A guided walkthrough of the whole app
The Product Tour is a step-by-step tour that highlights every major area — the Dashboard, AI tools, leads, sales pipeline, field operations, scheduling, documents, and reports.

## How to start it
Open the **Help Center** and click **Product Tour** at the bottom. New accounts are offered the tour automatically, but you can replay it any time.

## Good to know
- The tour remembers when you've finished it, so it won't keep nagging you.
- It's the fastest way to get a new hire comfortable — have them run it on day one.`,
  },
  {
    id: "guide-add-team",
    title: "Add your team members",
    category: "Getting Started",
    route: "StaffManagement",
    builtin: true,
    keywords: ["staff", "team", "employee", "invite", "add user", "seat", "salesperson", "crew member", "hire"],
    content: `## Add the people who work with you
Go to **Staff Management** to add salespeople, office staff, and crew. Each person gets their own login so you can assign leads, jobs, and tasks to them — and track who did what.

## How to add someone
1. Open **Staff Management**.
2. Click **Add Staff** (or the + button).
3. Enter their name, email, and role.
4. Save — they'll be able to sign in and see their assigned work.

## Roles & permissions
A person's **role** controls what they can see and do. Set fine-grained permissions under **Roles Management** — for example, let sales reps see their own leads but keep accounting for admins only.

## Tip
Assign every lead and job to a real person. Unassigned records are the #1 reason things slip through the cracks — the Sales Pipeline's Team Health view will flag them for you.`,
  },
  {
    id: "guide-roles",
    title: "Set permissions & roles",
    category: "Getting Started",
    route: "RolesManagement",
    builtin: true,
    keywords: ["roles", "permissions", "access", "admin", "restrict", "who can see", "security"],
    content: `## Control who can see and do what
Roles Management lets you decide exactly what each type of employee can access. A sales rep, an office manager, and an owner should not all see the same things.

## How it works
1. Open **Roles Management**.
2. Pick a role (or create one like "Sales Rep" or "Office").
3. Turn features on or off for that role — leads, financials, settings, and more.
4. Assign the role to people in Staff Management.

## Common setup
- **Owner/Admin** — full access, including accounting and settings.
- **Office** — leads, scheduling, invoicing; no company settings.
- **Sales Rep** — their own leads, estimates, and commissions only.`,
  },
  {
    id: "guide-branding",
    title: "Set up company branding & settings",
    category: "Getting Started",
    route: "GeneralSettings",
    builtin: true,
    keywords: ["settings", "branding", "logo", "company info", "setup", "address", "phone", "business hours"],
    content: `## Make it look like your company
Head to **General Settings** to enter your business name, address, phone, and upload your logo. This info appears on estimates, invoices, and customer emails, so it's worth doing early.

## What to fill in
- **Company name, address, phone, email** — shown to customers.
- **Logo** — appears on PDFs and the customer portal.
- **Business hours** — used by scheduling and the AI phone assistant.

## Going further
- Customize how your PDFs look under **PDF Branding**.
- Connect other tools (Google, QuickBooks, and more) under Integrations.`,
  },

  // ─────────────────────────────── Leads & Prospecting ───────────────────────────────
  {
    id: "guide-leads",
    title: "Managing your leads",
    category: "Leads & Prospecting",
    route: "Leads",
    builtin: true,
    keywords: ["leads", "lead", "prospect", "new lead", "pipeline", "follow up", "contact", "status"],
    content: `## Your pipeline of potential jobs
The **Leads** page tracks every potential customer from first contact to signed contract. Each lead has a status (New, Contacted, Inspection Scheduled, and so on) so you always know what's next.

## Add a lead
1. Open **Leads** and click **Add Lead**.
2. Enter their name, address, phone, and where they came from (the lead source).
3. Assign it to a salesperson so someone owns the follow-up.

## Keep leads moving
- Update the **status** as things progress — this drives your reports and automations.
- Add **notes** after every call or visit; they show up in the customer's history automatically.
- When a lead becomes a real job, **convert** it — this creates a customer record and keeps the history.

## Don't let leads go cold
The Sales Pipeline's **Team Health** view highlights leads no one has touched in 7+ days and any that have no owner. Check it weekly.`,
  },
  {
    id: "guide-lead-finder",
    title: "Find new leads with Lead Finder",
    category: "Leads & Prospecting",
    route: "LeadFinder",
    builtin: true,
    keywords: ["lead finder", "prospecting", "find customers", "canvassing", "new business", "prospect", "generate leads"],
    content: `## Go get new business
**Lead Finder** helps you discover new prospects in the areas you want to work. Instead of waiting for the phone to ring, you can target neighborhoods and add promising properties straight into your pipeline.

## How to use it
1. Open **Lead Finder**.
2. Search or focus on an area you want to work.
3. Review the properties that come back.
4. Add the good ones as leads — they drop into your Leads pipeline ready for follow-up.

## Pairs well with
- **Storm Tracking** — target neighborhoods that just got hit by hail or wind.
- **Field Sales Tracker** — send reps door-knocking in the same area.`,
  },
  {
    id: "guide-storm",
    title: "Storm Tracking & alerts",
    category: "Leads & Prospecting",
    route: "StormTracking",
    builtin: true,
    keywords: ["storm", "hail", "wind", "weather", "alerts", "damage", "map", "recent storms"],
    content: `## Be first after the storm
**Storm Tracking** shows recent hail and wind events on a map, pulling from official weather sources. It's built for post-storm sales — go where the damage is, fast.

## What you can do
- See recent and active storms plotted on a map.
- Focus on the states and areas you serve.
- Use the storm areas to guide your canvassing and Lead Finder searches.

## Get notified automatically
Set up **storm alerts** so you (and your team) get an email or text when a qualifying storm hits your area. If you haven't listed alert recipients, the system falls back to your active admins so alerts still go out. Configure recipients in the storm alert settings.`,
  },
  {
    id: "guide-field-sales",
    title: "Field Sales Tracker (door knocking)",
    category: "Leads & Prospecting",
    route: "FieldSalesTracker",
    builtin: true,
    keywords: ["field", "door knock", "canvass", "territory", "map", "turf", "reps", "gps", "route"],
    content: `## Run your door-knocking teams
The **Field Sales Tracker** is a map-based tool for canvassing. Reps can see their territory, log which doors they've hit, and mark the outcome — so you get real coverage data instead of guesswork.

## How it works
1. Open **Field Sales Tracker**.
2. See your assigned area on the map.
3. Log each door: not home, not interested, callback, or new lead.
4. New leads flow straight into your pipeline.

## For managers
Use **Territory Manager** to draw areas and assign them to reps, so two people never knock the same block. Combine with Storm Tracking to send teams to fresh damage.`,
  },
  {
    id: "guide-sales-pipeline",
    title: "Sales Pipeline & Team Health",
    category: "Leads & Prospecting",
    route: "SalesTracking",
    builtin: true,
    keywords: ["sales", "pipeline", "team health", "rep", "follow up", "stale leads", "scorecard", "tracker", "neglected", "unassigned"],
    content: `## See your whole pipeline — and who's dropping the ball
The **Sales Pipeline Tracker** has two tabs:

- **Pipeline** — a board of every deal by stage, so you can see what's moving.
- **Team Health** — a follow-up monitor that catches leads slipping through the cracks.

## What Team Health shows you
- A red badge with the number of **stale leads** (untouched 7+ days).
- A **Needs Attention** list of the most neglected leads, worst first.
- A red banner for **unassigned leads** (no owner = guaranteed drop-off).
- Per-rep **scorecards**: open leads, stale (7d+), neglected (14d+), overdue action items, and last active date — with a health status of On Track, Needs Attention, or Critical.

## How to use it
Check Team Health weekly (or daily during storm season). Click **View Full Activity** on any rep to see exactly what they've been doing. Reassign or clear out anything red.`,
  },

  // ─────────────────────────────── Estimates & AI ───────────────────────────────
  {
    id: "guide-estimates",
    title: "Creating an estimate",
    category: "Estimates & AI",
    route: "Estimates",
    builtin: true,
    keywords: ["estimate", "quote", "bid", "price", "line items", "create estimate", "proposal"],
    content: `## Build a professional quote
The **Estimates** page is where you price a job. Add line items (materials and labor), set quantities and prices, and CompanySync totals it up with tax.

## How to create one
1. Open **Estimates** and click **New Estimate** (or start from a lead/customer).
2. Add line items — pull from your price list (Items) or type them in.
3. Review the total, tax, and any profit/overhead.
4. Save, then **send** it to the customer.

## Speed it up
- Use the **AI Estimator** to measure the roof and pre-fill quantities.
- Save common jobs as templates so you're not rebuilding every time.
- Offer **financing** options right on the estimate so customers can say yes on the spot.

## After you send
The customer can view and approve online. You'll get a follow-up Action Item so the estimate doesn't get forgotten.`,
  },
  {
    id: "guide-ai-estimator",
    title: "Using the AI Estimator",
    category: "Estimates & AI",
    route: "AIEstimator",
    builtin: true,
    keywords: ["ai estimator", "roof measure", "satellite", "eagleview", "measurement", "measure roof", "solar", "squares", "waste"],
    content: `## Measure a roof without climbing it
The **AI Estimator** measures a roof from satellite and aerial data, then classifies the roof type and calculates squares, linear features (ridges, valleys, eaves), and a waste factor — turning a measurement into a ready-to-price estimate.

## How to use it
1. Open the **AI Estimator**.
2. Enter the property address — it pulls up the satellite view.
3. Let it measure, or fine-tune the roof outline.
4. Review the measurements and roof type, then generate line items into an estimate.

## Make it even more accurate
If you have an outside report (EagleView, Hover, GAF), you can compare it against the AI's numbers. CompanySync remembers the difference and **calibrates** future estimates to your real-world results.

## Tip
For insurance jobs, the AI leans toward safer coverage assumptions (like ice & water shield) so you don't under-scope a claim.`,
  },
  {
    id: "guide-proposals",
    title: "Sending proposals",
    category: "Estimates & AI",
    route: "Proposals",
    builtin: true,
    keywords: ["proposal", "present", "send estimate", "sign", "customer facing", "presentation", "approve"],
    content: `## Present a bid customers can approve
**Proposals** turn your estimate into a clean, customer-facing document. The homeowner can review the scope and price, then approve — no printing required.

## How it works
1. Build your estimate.
2. Share it as a proposal — the customer gets a secure link (by email or text).
3. They review it online and approve or ask questions.
4. Approved proposals move the job forward and can flow into a contract for signature.

## Good to know
- The share link is **secure** — an estimate ID alone won't open it.
- You'll see when the customer views and approves it.
- From an approved proposal you can generate a contract for e-signature.`,
  },
  {
    id: "guide-insurance",
    title: "Insurance & Xactimate estimates",
    category: "Estimates & AI",
    route: "Estimates",
    builtin: true,
    keywords: ["insurance", "xactimate", "claim", "carrier", "adjuster", "acv", "rcv", "depreciation", "supplement", "symbility"],
    content: `## Handle insurance jobs the right way
CompanySync supports insurance-style estimates so your numbers line up with what carriers and adjusters expect — including RCV, ACV, and depreciation.

## What to know
- Build the scope like any estimate, but include the code items and coverage insurers require.
- The AI Estimator leans toward safe coverage (ice & water on eaves/valleys) so claims aren't under-scoped.
- Export in the formats carriers use (for example Xactimate/Symbility-style outputs) when needed.

## Tip
Keep the roof measurement report (EagleView/Hover) attached to the job. It backs up your scope if the adjuster pushes back, and helps justify supplements.`,
  },

  // ─────────────────────────────── Invoicing & Payments ───────────────────────────────
  {
    id: "guide-invoices",
    title: "Creating & sending invoices",
    category: "Invoicing & Payments",
    route: "Invoices",
    builtin: true,
    keywords: ["invoice", "bill", "balance", "send invoice", "billing", "amount due", "outstanding"],
    content: `## Bill for the work
The **Invoices** page is where you request payment. You can turn an approved estimate straight into an invoice, or create one from scratch.

## How to create one
1. Open **Invoices** and click **New Invoice** (or convert an estimate).
2. Confirm the line items and total.
3. Save and **send** it to the customer by email or text.

## Track what you're owed
- Each invoice shows its **balance** (total minus what's been paid) and a status.
- The Dashboard rolls up everything outstanding so you can chase overdue balances.

## Tip
Always work from the invoice's real total and payments — not an old saved amount. If a balance ever looks wrong, open the invoice and CompanySync will re-check it against the actual payments recorded.`,
  },
  {
    id: "guide-record-payment",
    title: "Recording a payment",
    category: "Invoicing & Payments",
    route: "Payments",
    builtin: true,
    keywords: ["payment", "record payment", "mark paid", "deposit", "cash", "check", "collect", "paid", "received"],
    content: `## Log money you've collected
When a customer pays — cash, check, or card — record it so the invoice balance and your reports stay accurate.

## How to record a payment
1. Open the invoice (or the **Payments** page).
2. Click **Record Payment**.
3. Enter the amount, date, and method (cash, check, card).
4. Save — the invoice balance updates automatically and the invoice marks itself paid or partially paid.

## Deposits & partial payments
You can record a partial payment (like a deposit). The invoice shows the remaining balance until it's fully paid.

## Where the totals come from
"Paid" amounts and the Dashboard's revenue are added up from the **actual payments** you record — never a typed-in number — so what you see always matches reality.`,
  },
  {
    id: "guide-stripe",
    title: "Getting paid online (Stripe)",
    category: "Invoicing & Payments",
    route: "Payments",
    builtin: true,
    keywords: ["stripe", "credit card", "online payment", "pay link", "card", "checkout", "get paid online"],
    content: `## Let customers pay by card
CompanySync connects to **Stripe** so customers can pay an invoice online with a credit or debit card. The payment records itself automatically — no manual entry.

## How to set it up
1. Connect your Stripe account in the payment/integration settings.
2. Send an invoice — the customer gets a secure **Pay Now** link.
3. When they pay, the invoice updates and the payment is logged for you.

## Good to know
- Online payments are matched to the right invoice automatically.
- The system guards against accidental **double charges**, so a customer won't get billed twice for the same invoice.`,
  },
  {
    id: "guide-fix-payment",
    title: "Fixing a wrong payment or balance",
    category: "Invoicing & Payments",
    route: "Invoices",
    builtin: true,
    keywords: ["fix", "wrong balance", "partially paid", "refund", "relink", "recalculate", "incorrect", "mistake", "adjust", "unpaid"],
    content: `## When the numbers don't look right
Sometimes an invoice shows the wrong status — for example "Partially Paid" when no payment is actually attached, or a balance that doesn't match what you collected.

## First: let it self-check
Open the invoice. CompanySync automatically re-adds the real payments linked to it and corrects the balance and status if they've drifted. Often the number fixes itself the moment you open it.

## If it's still off
- Check the **payments** listed on the invoice — is a payment linked to the wrong invoice, or missing?
- Record a missing payment, or remove/re-link one that's attached to the wrong job.
- The balance is always **total minus real payments**, so once the payments are right, the balance is right.

## Refunds
Record a refund against the payment so your totals and reports reflect the money that actually went back to the customer.`,
  },

  // ─────────────────────────────── Customers ───────────────────────────────
  {
    id: "guide-customers",
    title: "Customer profiles",
    category: "Customers",
    route: "Customers",
    builtin: true,
    keywords: ["customer", "homeowner", "profile", "contact", "history", "client", "property"],
    content: `## Everything about a customer in one place
A **Customer** profile holds their contact info, property details, and full history — estimates, invoices, payments, jobs, photos, and notes.

## How you get customers
Most customers are created when you **convert a lead** that turns into a job — this keeps all the lead history. You can also add a customer directly.

## What you'll find on a profile
- Contact and property info
- Every estimate, invoice, and payment
- Jobs and build schedule entries
- A unified **Notes** feed (see the Notes guide)
- Any open **Action Items** for that customer

## Tip
Keep the address accurate — the Map and AI Estimator both rely on it, and good addresses mean pins load instantly on the map.`,
  },
  {
    id: "guide-notes",
    title: "Notes feed — every note in one place",
    category: "Customers",
    route: "Customers",
    builtin: true,
    keywords: ["notes", "note", "activity", "history", "comment", "log", "record note"],
    content: `## No more notes scattered everywhere
Any note written anywhere in CompanySync automatically shows up on the customer's (or lead's) **Notes** feed — with a colored badge showing where it came from and who wrote it.

## What flows into the feed
- Notes you type on the profile
- Task comments (when the task is linked to that customer or lead)
- Build/job notes from the Build Schedule
- Inspection and project notes

## How to add one
Open the customer or lead, go to **Notes**, type your note, and save. It appears instantly for the whole team.

## Good to know
You can edit or delete the notes you typed by hand. Notes that came from other places (like a task) stay as a record of what happened.`,
  },

  // ─────────────────────────────── Projects & Field ───────────────────────────────
  {
    id: "guide-build-schedule",
    title: "Build Schedule & Scope of Work",
    category: "Projects & Field",
    route: "BuildSchedule",
    builtin: true,
    keywords: ["build", "schedule", "crew", "install", "scope of work", "checklist", "job", "production", "completion"],
    content: `## Plan and run the actual work
The **Build Schedule** tracks installs and repairs — when each job happens and who's on it. Each build can carry a **Scope of Work** checklist so nothing gets missed.

## The Scope of Work checklist
For every job you can generate a checklist from two sources at once:
- The **line items** on the linked estimate
- Standard **templates** for that job type (Roof Install, Repair, etc.)

They're merged and de-duplicated, so the crew has one clear list. Roof jobs even include a reminder to cover *all* structures on the property (house + garage + additions) — because a real job once missed the garage.

## Working the checklist
- Check off each item as it's done; every row shows a done/total progress badge.
- Add a **photo** as proof for any item.
- Marking a build **Completed** with unchecked items pops a warning (and a "Complete anyway" confirm) so nothing slips.

## Tip
Regenerating the checklist keeps your completed items, photos, and notes — it only drops work that's no longer part of the job.`,
  },
  {
    id: "guide-crewcam",
    title: "PhotoSync photo inspections",
    category: "Projects & Field",
    route: "InspectionsDashboard",
    builtin: true,
    keywords: ["photosync", "crewcam", "photo", "inspection", "damage", "ai analysis", "pictures", "roof photos", "capture", "drone"],
    content: `## Document the roof — and let AI read it
**PhotoSync** organizes job-site photos and runs AI analysis on them to identify materials and spot damage, so your inspections are faster and better documented.

## How to run an inspection
1. Start a **New Inspection** for a job.
2. Capture or upload photos from the field.
3. The AI reviews them for material type and damage.
4. Everything is saved to the job and visible on the Inspections Dashboard.

## Why it helps
- A clear photo record backs up your estimates and insurance claims.
- AI damage detection catches things easy to miss.
- Drone imagery can be analyzed the same way for hard-to-reach roofs.`,
  },
  {
    id: "guide-tasks",
    title: "Tasks & to-dos",
    category: "Projects & Field",
    route: "Tasks",
    builtin: true,
    keywords: ["task", "todo", "to-do", "assignment", "reminder", "assign", "checklist", "work"],
    content: `## Keep everyone on track
**Tasks** are to-dos you assign to yourself or your team — call this customer, order material, follow up on that estimate.

## How to use it
1. Open **Tasks** and click **Add Task**.
2. Write what needs doing, set a due date, and assign it to someone.
3. Link it to a customer or lead so the context travels with it.
4. Mark it done when it's complete.

## Nice touches
- Task comments post to the linked customer's **Notes** feed automatically.
- Overdue tasks get gentle reminders so they don't disappear.
- Each person can see just their work under **My Assignments**.`,
  },
  {
    id: "guide-action-items",
    title: "Action Items & follow-up queue",
    category: "Projects & Field",
    route: "ActionItems",
    builtin: true,
    keywords: ["action items", "follow up", "reminder", "overdue", "queue", "escalation", "snooze", "due"],
    content: `## The safety net for follow-ups
**Action Items** are reminders CompanySync creates for you automatically at the moments that matter — so important follow-ups never get forgotten.

## What creates them
- **Estimate sent** → a 48-hour follow-up reminder
- **New lead** → a 1-hour follow-up
- **Stale lead** (sitting in New too long) → a nudge to reach out

## How to work the queue
Open **Action Items** to see Active, Snoozed, Completed, and Dismissed tabs. For each item you can **Complete**, **Snooze**, or **Dismiss** it. Pending items also show right on the lead/customer profile and as a badge in the sidebar.

## Escalation
If an item goes overdue, CompanySync escalates — first an in-app notification, then email, then text — so it gets seen.`,
  },

  // ─────────────────────────────── AI Assistant ───────────────────────────────
  {
    id: "guide-lexi",
    title: "Chat with Lexi (your AI assistant)",
    category: "AI Assistant",
    route: "AIAssistant",
    builtin: true,
    keywords: ["lexi", "ai assistant", "chat", "ask", "help", "assistant", "ai", "question"],
    content: `## Your assistant that can actually do things
**Lexi** is a built-in AI assistant that not only answers questions but can take action in your CRM — hands-free.

## What Lexi can do
- Look up your leads, customers, estimates, invoices, tasks, and projects
- Create leads, customers, tasks, and calendar events
- Send a text or email
- Answer questions about storms and your data
- Help draft messages and summaries

## How to use it
Open **Chat with Lexi** from the Help Center or the AI Assistant page. Type a request in plain language — for example, "Add a lead for John at 123 Main St" or "What estimates did I send this week?"

## Tip
For quick "how do I…" questions about the app, the **Quick AI Answer** in the Help Center is faster. Use Lexi when you want it to actually do the work or hold a back-and-forth conversation.`,
  },
  {
    id: "guide-lexi-voice",
    title: "Talk to Lexi by voice",
    category: "AI Assistant",
    route: "AIAssistant",
    builtin: true,
    keywords: ["voice", "talk", "hey lexi", "speak", "hands free", "microphone", "call", "dictate"],
    content: `## Go hands-free in the field
Lexi supports voice, so you can talk instead of type — perfect when you're driving between jobs or up on a ladder.

## How to use voice
1. Open the AI Assistant.
2. Switch on **voice mode** and allow microphone access.
3. Speak your request naturally — Lexi listens, replies out loud, and can take action.

## Great for the field
- "Add a note to the Johnson job that the deck needs replacing."
- "What's my next appointment?"
- "Text the customer that we're running 30 minutes late."

## Tip
Voice uses the same abilities as chat, so anything Lexi can do by text it can do by voice.`,
  },

  // ─────────────────────────────── Communication ───────────────────────────────
  {
    id: "guide-communication",
    title: "Texting & emailing customers",
    category: "Communication",
    route: "Communication",
    builtin: true,
    keywords: ["sms", "text", "email", "message", "communication", "inbox", "reply", "contact customer"],
    content: `## One inbox for every conversation
The **Communication** hub keeps your customer texts and emails together, tied to the right customer or lead — so anyone on the team can pick up a conversation.

## How to use it
1. Open **Communication**.
2. Pick a customer or start a new message.
3. Send a text or email; replies come back into the same thread.

## Behind the scenes
- Texting and calling run through Twilio; email goes out through your connected email service.
- Messages are logged to the customer's history so nothing is lost.

## Tip
Use saved **templates** for common messages (appointment reminders, "we're on our way," follow-ups) to save typing and stay consistent.`,
  },
  {
    id: "guide-campaigns",
    title: "Marketing campaigns (bulk outreach)",
    category: "Communication",
    route: "Campaigns",
    builtin: true,
    keywords: ["campaign", "marketing", "blast", "bulk", "outreach", "mass text", "mass email", "promotion"],
    content: `## Reach a lot of people at once
**Campaigns** let you send bulk text or email to a group — past customers, cold leads, or a storm-affected neighborhood.

## How to run one
1. Open **Campaigns** and create a new campaign.
2. Choose who it goes to (a list or segment of leads/customers).
3. Write your message (templates help).
4. Send now or schedule it for later.

## Good uses
- "Seasonal maintenance" reminders to past customers
- Post-storm outreach to a hit area
- Re-engaging leads that went quiet

## Tip
Keep lists targeted and messages relevant — a well-aimed campaign to the right neighborhood beats a giant blast every time.`,
  },
  {
    id: "guide-workflows",
    title: "Automations (Workflows)",
    category: "Communication",
    route: "Workflows",
    builtin: true,
    keywords: ["workflow", "automation", "trigger", "auto", "automate", "when this then that", "rules"],
    content: `## Let the system do the busywork
**Workflows** automate repetitive steps. You set up a rule — "when this happens, do that" — and CompanySync handles it for you.

## Examples
- When a lead's status changes to "Inspection Scheduled," **text** the customer a confirmation.
- When an estimate is sent, **create a follow-up task**.
- When a job is marked complete, **email** the customer a thank-you.

## How to set one up
1. Open **Workflows** and create a new one.
2. Pick the **trigger** (the event that starts it).
3. Add the **actions** (send a message, create a task/notification, update a status).
4. Turn it on.

## Good to know
Steps can be delayed (for example, "wait 2 days, then follow up"), and a background process runs the delayed steps on schedule.`,
  },

  // ─────────────────────────────── Reports & Settings ───────────────────────────────
  {
    id: "guide-analytics",
    title: "Analytics & reports",
    category: "Reports & Settings",
    route: "Analytics",
    builtin: true,
    keywords: ["analytics", "report", "metrics", "roi", "performance", "numbers", "data", "insights", "revenue"],
    content: `## Know what's working
**Analytics** turns your day-to-day activity into a picture of business health — where leads come from, how well you close, and how revenue is trending.

## What you can see
- Lead sources and which ones actually produce jobs (ROI)
- Close rates and pipeline value
- Revenue and outstanding balances over time

## Going further
- Build custom exports with the **Report Builder**.
- Track competitors and pricing under Competitor Analysis.

## Tip
Watch your lead-source ROI. If one source costs a lot but rarely closes, move that money to what's working.`,
  },
  {
    id: "guide-commissions",
    title: "Commission tracking",
    category: "Reports & Settings",
    route: "CommissionTracking",
    builtin: true,
    keywords: ["commission", "payout", "rep pay", "earnings", "sales rep", "pay", "split", "override"],
    content: `## Pay your reps the right amount
**Commission Tracking** calculates what each salesperson has earned based on your rules, so payouts are accurate and drama-free.

## How it works
1. Set your **commission rules** (how much, on what — profit, sale price, splits).
2. As deals close, CompanySync tallies each rep's commission.
3. Review the report and pay out.

## Good to know
- Reps can be sent a weekly commission summary automatically.
- Rules can handle splits and overrides for team-sold deals.

## Tip
Set the rules up front and keep deal amounts accurate — clean numbers mean the commission math takes care of itself.`,
  },
  {
    id: "guide-knowledge-base",
    title: "Add your own guides (Knowledge Base)",
    category: "Reports & Settings",
    route: "KnowledgeBase",
    builtin: true,
    keywords: ["knowledge base", "article", "upload", "sop", "custom guide", "documents", "training", "procedures"],
    content: `## Your company's own playbook
CompanySync ships with built-in guides for using the app (the ones you're reading now). The **Knowledge Base** is where *you* add your own company material — pricing cheat-sheets, SOPs, warranty info, and training docs.

## How to add content
1. Open the **Knowledge Base**.
2. Create an article, or **upload** a PDF or image — the AI can pull the text out and turn it into an article.
3. Save it. Your articles show up in Help Center search right alongside the built-in guides.

## Why it's worth it
- The **Quick AI Answer** and Lexi use your articles to answer questions specific to *your* business.
- New hires get one place to learn your way of doing things.

## Tip
Start with your pricing cheat-sheet and your most-asked questions — those pay off immediately.`,
  },
  {
    id: "guide-gmail-lexi-setup",
    title: "Connect Gmail so Lexi can read and reply to emails",
    category: "AI Assistant",
    route: "Settings",
    builtin: true,
    keywords: ["gmail", "email", "lexi email", "connect gmail", "google oauth", "inbox", "redirect uri", "gmail api", "cloud console", "check my email"],
    content: `## What this unlocks
Once Gmail is connected, Lexi can read your inbox, find emails by sender or subject, and reply to threads — all from the chat window. Ask her things like "Any emails from John today?" or "Did we hear back about the claim on Oak Street?"

## One-time Google Cloud Console setup
These steps only need to be done once, by the account owner.

**Step 1 — Enable the Gmail API**
1. Go to [Google Cloud Console → Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
2. Search for "Gmail API" and click **Enable**
   (This is the same Google Cloud project that powers Google Calendar — no new project needed)

**Step 2 — Add the redirect URI to your OAuth client**
1. Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click your existing **OAuth 2.0 Client ID** (the one used for Calendar)
3. Under **Authorized redirect URIs**, click **Add URI** and paste:
   \`https://getcompanysync.com/api/gmail-callback\`
4. Click **Save**

**Step 3 — Add yourself as a test user**
1. Go to [OAuth consent screen → Test users](https://console.cloud.google.com/apis/credentials/consent)
2. Click **Add Users** and enter **io.companysync@gmail.com**
3. Save — this is required while the app is in Testing mode (up to 100 test users are allowed)

## Connect Gmail in the app
After completing the steps above:
1. Go to **Settings → Integrations**
2. Scroll to **Lexi Gmail Integration**
3. Click **Connect Gmail** — you'll be redirected to Google to approve access
4. After approving, you'll land back in Settings with a green "Gmail Connected" badge

## Test it
Open the Lexi chat and ask: *"Check my email"* — she should respond with your most recent inbox messages.

## Troubleshooting
- **redirect_uri_mismatch** — the redirect URI in Step 2 wasn't saved, or has a typo. Copy it exactly.
- **Access blocked: app not verified** — you haven't been added as a test user (Step 3).
- **Gmail API not enabled** — revisit Step 1 and confirm the API shows as "Enabled" (not "Enable").`,
  },
  {
    id: "guide-integrations",
    title: "Connecting other tools",
    category: "Reports & Settings",
    route: "IntegrationManager",
    builtin: true,
    keywords: ["integration", "connect", "google", "quickbooks", "ghl", "gohighlevel", "slack", "calendar", "sync", "abc supply"],
    content: `## Plug CompanySync into your other tools
The **Integrations** area connects CompanySync to the services you already use, so data flows instead of being re-typed.

## Common connections
- **Google Calendar** — sync appointments both ways.
- **QuickBooks** — keep your books in step with invoices and payments.
- **GoHighLevel (GHL)** — sync leads back and forth.
- **Stripe** — take card payments online.
- **ABC Supply** — order materials for a job.

## How to connect
Open the integration you want and follow the prompts to sign in and authorize it. Once connected, syncing runs automatically in the background.

## Tip
Connect your calendar first — it removes a huge amount of double-entry for scheduling.`,
  },
  {
    id: "guide-migrate-jobnimbus",
    title: "Switching from JobNimbus (or AccuLynx, ServiceTitan, Buildertrend)",
    category: "Reports & Settings",
    route: "DataImport",
    builtin: true,
    keywords: ["jobnimbus", "job nimbus", "acculynx", "servicetitan", "service titan", "buildertrend", "migrate", "migration", "switch", "import", "csv", "bring over my data", "old crm", "previous software"],
    content: `## Bring your data over from your old system
CompanySync has a built-in **Migration Hub** to help you move your contacts, jobs, estimates, and invoices from JobNimbus, AccuLynx, ServiceTitan, or Buildertrend — no manual re-typing.

## Option 1: Connect JobNimbus directly (fastest)
JobNimbus is the only platform with a live, direct connection today.
1. Go to **Data Import** and click "Yes, help me migrate" on the banner at the top.
2. Pick **JobNimbus**, then click **"Or connect JobNimbus directly."**
3. In JobNimbus, go to **Settings → API** and copy your API key.
4. Paste the key into CompanySync and click **Connect**.
5. Click **Sync Now** — your JobNimbus contacts come in as Leads or Customers, and your jobs come in as Projects.

Sync is safe to re-run any time — it updates existing records instead of creating duplicates. If it says not everything came over yet, just click **Sync Now** again to pull the rest.

## Option 2: Upload a CSV export (works for any of the 4 platforms)
Use this for AccuLynx, ServiceTitan, or Buildertrend, or if you want to bring over Estimates/Invoices from JobNimbus too (the direct connect only brings contacts and jobs).
1. In your old system, export Contacts/Leads, Jobs, Estimates, and Invoices to CSV.
2. In CompanySync, open **Data Import**, pick your old platform as the source, and upload each CSV.
3. CompanySync recognizes the platform's column headers automatically and pre-matches them to the right fields — just review and confirm before importing.

## Tip
You can use both options together: connect JobNimbus directly for contacts/jobs, then upload CSVs for your historical estimates and invoices.`,
  },
];

export default PRODUCT_GUIDES;
