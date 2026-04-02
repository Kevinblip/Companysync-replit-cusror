import { base44 } from '../src/api/base44Client';

const ARTICLES = [
  {
    title: "Roof Install - Cheat Sheet (Line Items)",
    category: "Pricing",
    tags: ["roof cheat sheet"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Roof Install - Cheat Sheet (Line Items)

🔨 Tear-Off / Removal
- Tear-off asphalt shingles – 1 layer (RFG300)
- Additional layers (if applicable)
- Tear-off ridge cap (RFG306)
- Tear-off starter course shingles (RFG305)
- Remove roof felt / underlayment (RFG295)
- Dumpster fee or debris removal (DUMP)

🧱 Decking
- Replace roof sheathing / decking – per sheet (RFG239)
- Re-nail decking (code upgrade if applicable)

🧰 Installation - Roofing System
- Asphalt architectural shingles – per SQ (RFG220)
- Starter course shingles (RFG221)
- Ridge cap shingles (RFG222)
- Roof felt – 15 lb or synthetic underlayment (RFG295 or RFG295SYN)
- Ice & water shield (RFG295IWS) – eaves, valleys, penetrations
- Drip edge metal (RFG253)
- Valley metal (RFG262)
- Step flashing (RFG261)
- Chimney flashing (RFG263)
- Wall flashing (RFG264)
- Pipe jack flashing / plumbing vents (RFG248)
- Vent boots or lead jacks (RFG245)
- Roof vents – turtle, box, ridge, or power vent (RFG250/RFG251)
- Ridge vent – shingle-over or metal (RFG247)
- Roof turbine vents (RFG252)
- Bathroom / kitchen exhaust caps (RFG249)
- Paint roof accessories (RFG396)

🧯 Code & Accessories
- Starter strip (if not included in shingles)
- High-wind nailing (if applicable)
- Additional fasteners / nails
- H-clips (decking support if replacing decking)
- Ice & water barrier in valleys or eaves per local code
- OSHA Safety Setup (if steep roof or >2 stories) (GEN203)

📐 Labor & Overhead
- General labor (LAB)
- Supervisor or project management
- Sales commission
- Overhead & profit (O&P) if applied (typically 10/10)

📝 Other Common Add-Ons
- Satellite dish removal/reset (ELE112)
- Reconnect A/C line or electrical conduit on roof (ELE)
- Interior ceiling stain repairs (for leaks)
- Gutter detach & reset (GUT382R)
- Fascia/soffit repair (FAS / SOF line items)`
  },
  {
    title: "AI Estimator Quick Reference Guide",
    category: "Processes",
    tags: ["estimator", "quick reference"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `# AI Estimator Quick Reference

## 📐 Ice & Water Shield Calculation Rules

### Eaves Coverage:
- **Overhang ≤ 12 inches:** Apply 3 feet of ice & water from edge
- **Overhang > 12 inches:** Apply 6 feet of ice & water from edge
- **Default assumption (satellite):** 6 feet (safer for insurance)

### Valley Coverage:
- Apply ice & water shield for **full length** of all valleys
- Typically 36" wide rolls

### Calculation Formula:
- Ice & Water (eaves) = Eave LF × (Coverage Width ÷ 3)
- Example: 100 LF eave × (6 ft ÷ 3) = 200 LF ice & water
- Ice & Water (valleys) = Valley LF
- Total Ice & Water = Eaves + Valleys

## 💬 Common Commands

### Material Adjustments
- **"add 10% waste"** - Increases material quantities by 10%
- **"add 15% waste"** - Increases material quantities by 15%

### Surcharges
- **"apply steep roof"** - Adds 20% steep roof surcharge
- **"apply high roof"** - Adds 15% high roof surcharge (2-3 stories)
- **"add O&P"** or **"add overhead and profit"** - Adds 15% O&P

### Adding Items
- **"add 5 LF of valley flashing"** - Adds specific item with quantity
- **"add ice and water shield"** - Adds item from price list

### Pricing Changes
- Just switch the dropdown - AI will recalculate everything

## 🛰️ Satellite Mode Tips

### Best Practices
✅ Enter complete address with city and state
✅ Wait 30-60 seconds for analysis
✅ Check confidence scores - above 85% is good
⚠️ Below 85% confidence? Upload actual report instead

### Common Issues
- **No measurements showing?** Check browser console (F12) for errors
- **Low confidence?** Try document upload mode instead
- **Wrong address?** Click "New Property" to start over

## 📄 Document Upload Tips

### Supported Files
✅ GAF QuickMeasure PDFs
✅ Hover reports
✅ EagleView reports
✅ Xactimate ESX files
✅ Any PDF with measurements

### Upload Process
1. Click paperclip icon 📎
2. Select file
3. Click "Analyze"
4. Wait 10-20 seconds
5. Review line items

## 🎯 Pro Tips

### For Roofing Jobs
- Always add 10% waste for shingles (gable roofs) or 15% (hip roofs)
- Add steep surcharge for any pitch over 6/12
- Include O&P (10/10) on all insurance claims
- Document every line item with a Xactimate code`
  },
  {
    title: "Roofing Line Items - Standard Order & Codes",
    category: "Processes",
    tags: ["line items", "xactimate", "standard order"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `🏠 ROOF INSTALL - STANDARD LINE ITEMS (ALWAYS FOLLOW THIS ORDER)

🔨 TEAR-OFF / REMOVAL (ALWAYS INCLUDE FOR REPLACEMENT JOBS):
1. Tear-off asphalt shingles – 1 layer (RFG300) - Price per SQ
2. Additional layers (if applicable)
3. Tear-off ridge cap (RFG306)
4. Tear-off starter course shingles (RFG305)
5. Remove roof felt / underlayment (RFG295)
6. Dumpster fee or debris removal (DUMP)

🧱 DECKING (IF NEEDED):
7. Replace roof sheathing / decking – per sheet (RFG239)
8. Re-nail decking (code upgrade if applicable)

🧰 INSTALLATION - ROOFING SYSTEM (REQUIRED ITEMS):
9. **Asphalt architectural shingles – per SQ (RFG220)** ← MUST BE FIRST INSTALLATION ITEM
10. Starter course shingles (RFG221)
11. Ridge cap shingles (RFG222)
12. Roof felt – 15 lb or synthetic underlayment (RFG295 or RFG295SYN)
13. Ice & water shield (RFG295IWS) – eaves, valleys, penetrations
14. Drip edge metal (RFG253)
15. Valley metal (RFG262)
16. Step flashing (RFG261)
17. Chimney flashing (RFG263)
18. Wall flashing (RFG264)
19. Pipe jack flashing / plumbing vents (RFG248)
20. Vent boots or lead jacks (RFG245)
21. Roof vents – turtle, box, ridge, or power vent (RFG250/RFG251)
22. Ridge vent – shingle-over or metal (RFG247)
23. Roof turbine vents (RFG252)
24. Bathroom / kitchen exhaust caps (RFG249)
25. Paint roof accessories (RFG396)

🧯 CODE & ACCESSORIES:
26. Starter strip (if not included in shingles)
27. High-wind nailing (if applicable)
28. Additional fasteners / nails
29. H-clips (decking support if replacing decking)
30. Ice & water barrier in valleys or eaves per local code
31. OSHA Safety Setup (if steep roof or >2 stories) (GEN203)

📐 LABOR & OVERHEAD:
32. General labor (LAB)
33. Supervisor or project management
34. Sales commission
35. Overhead & profit (O&P) if applied (typically 10/10)

📝 OTHER COMMON ADD-ONS:
36. Satellite dish removal/reset (ELE112)
37. Reconnect A/C line or electrical conduit on roof (ELE)
38. Interior ceiling stain repairs (for leaks)
39. Gutter detach & reset (GUT382R)
40. Fascia/soffit repair (FAS / SOF line items)`
  },
  {
    title: "When to Add Steep/High Roof Charges",
    category: "Policies",
    tags: ["steep", "high roof", "surcharge"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `When to Add Steep/High Roof Charges

Introduction: Steep or high-pitch roof charges should be applied only when certain conditions are met, to ensure safety, code compliance, and labor time are properly factored in.

**Steep Charge — Slope Over 6/12**
- Any roof with a pitch greater than 6/12 qualifies.
- Use Xactimate or insurance carrier guidelines for surcharge percentage.
- Surcharge Percentage Range: 10-15%

**High Charge — Over 2 Stories or 25 Feet**
- Roofs with eaves or ridge height over 25 ft from the ground require extra safety gear and setup time.
- Additional costs include: labor, harnessing, and equipment.

**Access Limitations**
- Charge applies if access to load materials or install is difficult (e.g., narrow driveways, steep hills, obstacles).
- Include: delivery upcharges or hand-carry time.

**Multiple Sections or Complex Roofs**
- Multiple steep sections, dormers, or intersecting slopes may qualify even under 6/12 if ladder setup is repeated often.
- Factors to consider: ladder moves, fall protection, and install difficulty.

**Insurance Approval**
- Document pitch via photo or pitch gauge app.
- Always note pitch in EagleView, Hover, or roof report.
- Include steep/high charges as separate line items.`
  },
  {
    title: "Siding Job Standard Components",
    category: "Policies",
    tags: ["siding", "line items", "standard"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Siding Job Standard Components

Every siding job must include the following core components to ensure a professional, code-compliant install:

1. **Tear-Off / Prep**
   - Removal and disposal of all existing siding materials.
   - Inspection of sheathing for rot or damage.

2. **House Wrap / Moisture Barrier**
   - Installation of Tyvek or equivalent.
   - Taped and sealed at seams and windows.

3. **Flashing Tape**
   - Used around windows, doors, and other openings.
   - Required under all Z-flashing and trim.

4. **Starter Strip** (Vinyl or fiber cement, installed at base level)

5. **Panels / Planks**
   - Types: Vinyl, LP SmartSide, Hardie, or other siding type.
   - Specify: Color, Texture, Exposure size (e.g., 6", 8" reveal)

6. **Trim Boards**
   - Inside and outside corners, window/door trim, and freeze boards.
   - Materials: PVC, wood, composite, or aluminum-wrapped.

7. **J-Channels & Utility Trim**
   - Required around windows, doors, soffits, and transition points.
   - Color-matched to siding.

8. **Vents & Penetrations**
   - Dryer vents, hose bibs, electrical outlets trimmed out cleanly.
   - Boxes may need to be extended.

9. **Caulking**
   - All seams, joints, and trim edges.
   - Color-matched sealant.

10. **Fasteners**
    - Corrosion-resistant nails or screws.
    - Proper spacing and fastening depth per material specs.

11. **Cleanup & Inspection**
    - Yard cleanup, nail sweep, homeowner walk-through and punch list.`
  },
  {
    title: "Xactimate Line Items List (YICN)",
    category: "Pricing",
    tags: ["xactimate", "pricing", "line items"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Comprehensive Xactimate pricing list for roofing materials and labor for YICN Roofing.

General Information:
- Client: YICN Line Items
- Property: Cleveland, OH 44105
- Operator: YICNTEAM
- Estimator: Kevin Stone
- Business: 675 Alpha Dr Highland Hts, OH
- Cellular: (216) 331-8123
- Email: yicnteam@gmail.com
- Type of Estimate: Hail
- Price List: OHCLXX_JUN23
- Labor Efficiency: Restoration/Service/Remodel

Key Roofing Line Item Codes:
- RFG300: Remove asphalt shingles – 1 layer (per SQ)
- RFG306: Tear-off ridge cap
- RFG305: Tear-off starter course shingles
- RFG295: Remove roof felt / underlayment
- RFG295SYN: Synthetic underlayment
- RFG295IWS: Ice & water shield
- RFG239: Replace roof sheathing / decking (per sheet)
- RFG220: Asphalt architectural shingles (per SQ)
- RFG221: Starter course shingles
- RFG222: Ridge cap shingles
- RFG253: Drip edge metal
- RFG262: Valley metal
- RFG261: Step flashing
- RFG263: Chimney flashing
- RFG264: Wall flashing
- RFG248: Pipe jack flashing / plumbing vents
- RFG245: Vent boots or lead jacks
- RFG250/RFG251: Roof vents (turtle, box, ridge, or power)
- RFG247: Ridge vent (shingle-over or metal)
- RFG252: Roof turbine vents
- RFG249: Bathroom / kitchen exhaust caps
- RFG396: Paint roof accessories
- GEN203: OSHA Safety Setup
- LAB: General labor
- DUMP: Dumpster fee or debris removal
- ELE112: Satellite dish removal/reset
- GUT382R: Gutter detach & reset

Note: Prices vary by region and price list version. Always reference the current OHCLXX price list for Ohio claims.`
  },
  {
    title: "Sample Insurance Estimates",
    category: "FAQ",
    tags: ["insurance", "estimate", "sample", "progressive", "allstate"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Sample Insurance Estimates — Reference Guide

These sample estimates demonstrate proper formatting, line items, and calculation methods for roofing claims from major insurance carriers.

**Progressive Insurance — Sample Claim (TAMIKA LITTLE)**
- Property: 25270 Ronan Rd, Bedford Heights, OH 44146
- Type of Loss: Hail
- Claim Number: 1059563-223638-025700
- Price List: OHCL8X_JUN22
- Service Type: Restoration/Service/Remodel

Key Takeaways from Insurance Estimates:
1. Always include the claim number and policy number on your estimate
2. Match the insurance carrier's price list version (OHCL8X, OHCLXX, etc.)
3. Use Xactimate codes that match the carrier's line items exactly
4. Include O&P (10/10) — most carriers allow this for GC work
5. Document depreciation separately from the base estimate
6. Note: ACV (Actual Cash Value) vs RCV (Replacement Cost Value) — always pursue RCV

Carriers We Work With:
- Progressive Insurance
- Farmers Insurance
- Allstate
- State Farm
- Safeco
- American Strategic Insurance (ASI)

Common Claim Process:
1. Customer files claim → gets claim number
2. Adjuster inspects property
3. Carrier issues initial estimate (often low)
4. We submit our supplemental estimate with all proper line items
5. Negotiate to reach agreed scope
6. Work is completed and final payment issued`
  },
  {
    title: "Bidengine Aerial Report — Sample",
    category: "Processes",
    tags: ["roof measurement", "aerial report", "bidengine", "roofgraf"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Sample Bidlist/Roofgraf Premium Roof Report

Property: 1423 E 39th St, Cleveland, OH, US
Prepared by: Bidlist (roofgraf.com)

Summary & Key Metrics:
- SQ before waste: 25.15
- Predominant pitch: 11/12
- Facets: 16
- Chimneys: 0
- Skylights: 0
- Other Penetrations: 0

Waste Calculation Table:
| Waste % | Area (sq.ft) | Squares |
|---------|-------------|---------|
| 5%      | 2640.54     | 26.41   |
| 10%     | 2766.28     | 27.66   |
| 12%     | 2816.57     | 28.17   |
| 15%     | 2892.02     | 28.92   |
| 17%     | 2942.31     | 29.42   |
| 20%     | 3017.76     | 30.18   |

Detailed Length Measurements:
- Ridge: 95.50 ln.ft
- Rake: 147.75 ln.ft
- Hip: 13.92 ln.ft
- Eave: 151.83 ln.ft
- Valley: 62.08 ln.ft
- Apron Flashing: 26.25 ln.ft
- Step Flashing: 34.33 ln.ft

How to Use This Report:
1. Use "SQ before waste" as your base measurement
2. Add appropriate waste % based on roof complexity (hip = 15%, gable = 10%)
3. Use the length measurements for flashing, drip edge, ridge vent calculations
4. Valley LF × 2 = linear feet of ice & water for valleys
5. Eave LF = linear feet of drip edge needed`
  },
  {
    title: "EagleView Report — Sample",
    category: "Processes",
    tags: ["eagleview", "roof measurement", "aerial"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `EagleView Extended Coverage 3D Report — Sample

Property: 4408 Turney, Cleveland, OH 44105
Date: 5/20/2021
Contact: Virgil Stone — Your Insurance Claims Network

Roof Details Summary:
- Total Roof Area: 2,439 sq ft (24.39 SQ)
- Total Roof Facets: 15
- Predominant Pitch: 10/12
- Number of Stories: >1
- Total Ridges/Hips: 101 ft
- Total Valleys: 36 ft
- Total Rakes: 236 ft
- Total Eaves: 180 ft

How to Read an EagleView Report:
1. **Total Roof Area** → Your base squares before waste
2. **Predominant Pitch** → Determines steep charge (over 6/12 = steep surcharge)
3. **Stories** → Over 2 stories = high roof surcharge
4. **Valleys** → Each valley LF needs ice & water shield
5. **Eaves** → Determines drip edge and ice & water at eaves

Waste Factor Guidelines (based on pitch):
- 4/12 or less: 10% waste
- 5/12 to 8/12: 12% waste
- 9/12 to 12/12: 15% waste
- Over 12/12: 17-20% waste

Important Notes:
- EagleView is NOT 100% accurate — always field verify steep or complex areas
- For insurance claims, EagleView measurements are generally accepted by adjusters
- If measurements differ significantly from actual, note it and use actual measurements`
  },
  {
    title: "Using the Customer Portal",
    category: "Services",
    tags: ["portal", "customer service", "payments"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Using the Customer Portal: Client Guide

The Customer Portal is a dedicated, secure webpage for your clients to manage their relationship with your business.

1. How Customers Access the Portal
- Magic Link: Customers do not need to create a username or password. They access via a secure, unique "Magic Link".
- Go to any Customer Profile → Click "Portal Link" to copy the URL → Send via email or SMS.
- Automation: Set up a Workflow to automatically email this link when a new customer is created.

2. What Customers See & Do
Dashboard: Summary of open projects, total balance due, upcoming appointments.

Documents:
- Estimates: View and digitally sign to approve. Can select upgrade options.
- Invoices: View PDF invoices. If Stripe connected, "Pay Now" button appears for Credit Card or ACH.
- Contracts: Review and sign contracts securely.

Photos & Files:
- View photo galleries from inspections.
- See "Before" and "After" photos.
- Download shared documents (warranties, insurance scope).

Communication:
- Send messages directly to their sales rep.
- View the project timeline and status updates.

3. Troubleshooting
- Link Expiration: Magic links may expire. Generate a new one from the customer profile.
- Mobile Friendly: Fully responsive on iPhone and Android.`
  },
  {
    title: "Family Commissions: Setup & Payouts",
    category: "Team",
    tags: ["commissions", "family", "payouts"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Family Commissions: Setup & Payouts

This feature automates profit-sharing with family members or silent partners.

1. Adding Members
- Navigate to Sales > Family Commissions.
- Click "Add Member".
- Split %: This is their share of the allocated pool, NOT gross revenue.
- Example: If the Family Pool is 10% of Revenue, and Mom has a 50% split, she gets 5% of total Revenue.

2. The Monthly Process
- Review: At the end of the month, check the "Pending Pool" amount.
- Process: Click "Process This Month". This snapshots the revenue and creates "Unpaid" commission records for each member.
- Payout:
  - Click the "Pay" button next to a record.
  - Select "Mark as Paid" (writing a check) or "Test Payout" (simulation).
  - Enter the Transaction/Check Reference number for your records.`
  },
  {
    title: "Training the AI Estimator",
    category: "Processes",
    tags: ["estimator", "training", "ai"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Training the AI Estimator: A Comprehensive Guide

The AI Estimator learns from your specific business data. Here is how to teach it effectively.

1. Uploading Past Estimates (The Foundation)
- Format: PDF files are best.
- Quantity: Aim for 5-10 approved estimates covering different job types.
- What the AI Learns:
  - Line Item Order: It notices patterns in how you structure estimates.
  - Pricing: It learns your base labor rates and material markups.
  - Language: It adopts your specific naming conventions.
- How to Upload: Go to Knowledge Base, click "Add Article", use the file upload section.

2. "Instructions-Only" Articles (The Rules)
Create Knowledge Base articles with explicit rules:
- Waste Factors: "For all asphalt shingle roofs, calculate 10% waste for gable roofs and 15% for hip roofs."
- Upgrades: "Always offer a 'Good, Better, Best' option for full replacements."
- Fees: "Always include a $450 dumpster fee line item for any job over 20 squares."
- Minimums: "Our minimum repair charge is $350. If line items total less, add a 'Minimum Service Charge'."

3. The Feedback Loop (Continuous Improvement)
- Edit Estimates: When the AI generates an estimate, fix any errors. The AI observes corrections.
- Rate Output: Give "thumbs up" for great results, "thumbs down" with explanation for errors.

4. Advanced Tips
- Regional Pricing: Create articles for "Ohio Pricing" vs other states.
- Seasonal Rules: "From November to March, add a 'Winter Safety Surcharge' of 5%."`,
  },
  {
    title: "Lead Finder & Storm Tracking",
    category: "Services",
    tags: ["leads", "storm", "canvassing", "map"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Lead Finder & Storm Tracking: Advanced Usage

1. Storm Tracking
- Navigate to Lead Manager > Storm Tracking.
- Filters: Date Range, Storm Type (Hail/Wind/Tornado), Severity (hail size or wind speed).
- Click any colored swath on the map for details: Date/Time, Max hail size or wind speed, NOAA source.

2. Lead Finder & Property Data
- Zoom into a neighborhood hit by a storm.
- Click "Search Area" to scan for residential properties.
- Property Cards show: Owner Name, Square footage, Year built, Roof age, Last sale date & price.
- Bulk Import: Use "Select Mode" to select multiple pins, then click "Import Selected as Leads".

3. Mobile Canvassing Mode
- Location Tracking: Current location shown as blue dot.
- Pin Statuses:
  🔴 Not Home: Left a flyer.
  🟡 Interested: They want an inspection.
  🟢 Appointment Set: Inspection scheduled.
  ⚫ No Soliciting/Not Interested: Do not knock again.
- Team Sync: All pin statuses update real-time for the whole team, preventing double-knocking.`
  },
  {
    title: "Setting Up Workflows",
    category: "Processes",
    tags: ["automation", "workflows", "efficiency"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Setting Up Workflows: Automation Masterclass

Workflows allow you to build "If This, Then That" logic to automate your business processes.

1. The Basics
- Triggers: The event that starts the automation (e.g., "New Lead Created", "Status Changed", "Tag Added").
- Conditions: Filters to limit when the workflow runs.
- Actions: What the system does (e.g., "Send Email", "Create Task", "Update Field", "Send SMS").

2. Creating a "New Lead Welcome" Workflow
1. Go to Communication > Workflow Automation → click "New Workflow".
2. Trigger: "Entity Created" → "Lead".
3. Action 1 (Email): Send "Welcome Email" — "Thanks for contacting [Company Name]!"
4. Action 2 (Notification): Alert Sales Manager — "New lead assigned: {{lead.name}}"
5. Action 3 (Task): Create task "Call new lead {{lead.name}}" due in 1 hour.

3. Popular Workflow Recipes
- Estimate Follow-up: Trigger on "Estimate Sent" → wait 2 days → if still Sent → send follow-up email.
- Review Request: Trigger on "Job Completed" → wait 1 hour → send SMS with Google Review link.
- Stalled Lead Re-engagement: Trigger on "Lead = Contacted" → wait 14 days → no activity → send re-engagement email.

4. Testing
Always test workflows! Use "Test Workflow" to simulate with a dummy lead.`
  },
  {
    title: "Accounting Dashboard: Financial Mastery",
    category: "Processes",
    tags: ["accounting", "finance", "dashboard"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Accounting Dashboard: Financial Mastery

Your financial command center.

1. Understanding the Metrics
- Total Revenue: Sum of all Payments with status 'Received'. Does NOT include pending invoices.
- Net Profit: (Total Revenue) - (Expenses + Payouts + Commissions). Real take-home.
- Accounts Receivable (A/R): Money owed to you. Sum of all 'Sent' or 'Overdue' invoices.
- Accounts Payable (A/P): Money you owe. Sum of pending Payouts and Bills.

2. Recording Expenses
- Receipt Scanner: On mobile, click "Scan Receipt" to auto-extract vendor and amount.
- Recurring Expenses: Check "Recurring" for software or rent to auto-create each month.
- Job Costing: Select a "Customer" or "Project" to calculate true job profitability.

3. The Journal Entry Tool
- Depreciation: Debit "Depreciation Expense", Credit "Assets".
- Owner's Equity: If you put personal money into the business, Credit "Owner's Equity", Debit "Cash".
- Opening Balances: When migrating from QuickBooks, use Journal Entry to set starting account balances.`
  },
  {
    title: "Sarah AI Sales Assistant: Configuration Guide",
    category: "Services",
    tags: ["ai", "sarah", "sales", "phone"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Sarah AI Sales Assistant: Configuration Guide

Sarah is your front-line defense for handling leads.

1. Behavior Settings
- Business Hours: Set your "Open" and "Closed" hours in Sarah Settings.
  - During Hours: Sarah tries to book appointments.
  - After Hours: Sarah takes messages and marks urgency.
- Emergency Triage: Enable "Emergency Mode" to patch calls to your cell if caller mentions "Leak", "Flooding", or "Emergency".

2. Voice & Personality
- Voice Selection: Choose a voice that matches your brand (Professional, Friendly, Energetic).
- Script Customization: Edit her "System Prompt" to change how she greets people.

3. Monitoring
- Go to the Communication Hub to see transcripts of every call Sarah handles.
- You can intervene via text if she gets stuck.`
  },
  {
    title: "Calendar Integration Guide",
    category: "Other",
    tags: ["calendar", "google", "scheduling"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Calendar Integration Guide: Sync & Scheduling

1. Connecting Google Calendar
- Navigate to Settings > Integrations > Google Calendar.
- Click "Connect" and allow the requested permissions.
- Calendar Selection:
  - Primary Calendar: Choose which Google Calendar to sync to.
  - Check for Conflicts: Select multiple calendars to check (Work, Personal, Family). The CRM will block those times.

2. How Sync Works
- CRM to Google (Outbound): Inspections/meetings created in CRM appear instantly on Google Calendar.
- Google to CRM (Inbound): Google events are pulled into the CRM as "Busy" blocks (private unless changed).
- Updates: Changes in either system sync to the other.

3. Appointment Booking Logic
The system checks:
1. CRM Calendar for existing jobs
2. Synced Google Calendars for external conflicts
3. Working Hours (set in Staff Profile)
Only times free across all sources are offered.

4. Troubleshooting
- "Events not showing up": Sync runs every 5-10 minutes. Click "Sync Now" for instant refresh.
- "Double Booking": Ensure ALL relevant calendars are selected in "Check for Conflicts".`
  },
  {
    title: "Field Operations: Territory & App Guide",
    category: "Processes",
    tags: ["field operations", "territory", "mobile"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Field Operations: Territory & App Guide

1. Drawing Territories
- Go to Operations > Territory Manager.
- Use "Draw Polygon" tool to outline a neighborhood.
- Assign: Click the shape → select a Sales Rep (only they see leads in that area on mobile).
- Color Coding:
  🔵 Blue: Assigned / Working
  🟢 Green: High Performance Area
  🔴 Red: Do Not Knock / Restricted

2. The Field App Experience
Instruct your reps to:
- Check In: Tap "Start Day" when arriving at their territory to log location.
- Pin Dropping: Drop a pin for every house knocked.
- Statuses: "Not Home", "Pitch Given", "Appointment Set".
- Offline Mode: The app works offline and syncs when connection is restored.`
  },
  {
    title: "Subscription & Billing: Managing Your Plan",
    category: "Pricing",
    tags: ["billing", "subscription", "plans"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Subscription & Billing: Managing Your Plan

1. Understanding Plans
- Starter ($97/mo): Best for solos. 1 User, 100 Customers.
- Professional ($197/mo): For growing teams. 5 Users, Unlimited Customers, AI Estimator included.
- Enterprise ($497/mo): Full power. Unlimited Users, Advanced API access, Dedicated Support.

2. Managing Seats
If you hit your user limit:
- Go to Subscription.
- Click "Manage Seats".
- Add additional user seats for $29/mo each without upgrading the full plan.

3. Failed Payments
If a payment fails, we retry 3 times over 5 days. Your account will enter a "Grace Period". Update your card in the Billing Portal to avoid service interruption.`
  },
  {
    title: "Standard Roof Replacement Checklist",
    category: "FAQ",
    tags: ["checklist", "roof replacement", "standard"],
    ai_assistant_targets: ["lexi", "estimator"],
    content: `Standard Roof Replacement Checklist

Pre-Job:
□ Signed contract / insurance approval in hand
□ Material order confirmed (shingles, underlayment, flashing, accessories)
□ Dumpster delivery scheduled
□ Permits pulled (if required by local code)
□ Homeowner notified of start date and estimated duration
□ Utility lines / A/C units noted on property

Tear-Off:
□ Remove all old shingles, ridge cap, and starter
□ Remove old underlayment / felt
□ Inspect decking — mark damaged sheets
□ Replace damaged decking sheets
□ Re-nail decking to code if required

Installation:
□ Install drip edge at eaves (before underlayment)
□ Install ice & water shield at eaves (3ft or 6ft based on overhang)
□ Install ice & water shield in valleys
□ Install synthetic underlayment
□ Install drip edge at rakes (over underlayment)
□ Install starter strip at eaves and rakes
□ Install field shingles per manufacturer specs
□ Install valley flashing / open valley
□ Install all flashings: step, chimney, wall, pipe jacks, vents
□ Install ridge vent or box vents
□ Install ridge cap shingles

Cleanup & Closeout:
□ Magnetic roller sweep for nails
□ Clean gutters of granules and debris
□ Remove dumpster
□ Walk property with homeowner
□ Take completion photos
□ Upload to customer profile
□ Submit invoice / final supplement to insurance`
  }
];

export default async function seedKnowledgeBase({ companyId }: { companyId: string }) {
  if (!companyId) {
    return { success: false, error: 'Company ID is required' };
  }

  // Check if articles already exist
  const existing = await (base44.entities as any).KnowledgeBaseArticle.filter({ company_id: companyId });
  if (existing.length > 0) {
    return { success: false, error: `Knowledge base already has ${existing.length} articles. Delete them first to re-seed.`, existing: existing.length };
  }

  const created = [];
  const failed = [];

  for (const article of ARTICLES) {
    try {
      const record = await (base44.entities as any).KnowledgeBaseArticle.create({
        company_id: companyId,
        title: article.title,
        content: article.content,
        category: article.category,
        tags: article.tags,
        is_ai_training: true,
        ai_assistant_targets: article.ai_assistant_targets,
        view_count: 0,
        rating_count: 0,
        rating_average: 0,
      });
      created.push(record.id);
    } catch (err: any) {
      failed.push({ title: article.title, error: err.message });
    }
  }

  return {
    success: true,
    created: created.length,
    failed: failed.length,
    failedItems: failed,
    total: ARTICLES.length,
  };
}
