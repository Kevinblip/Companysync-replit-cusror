import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's company
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        const myCompany = companies[0];
        
        if (!myCompany) {
            return Response.json({ error: 'No company found' }, { status: 404 });
        }

        // Create the article with proper company_id
        const article = await base44.entities.KnowledgeBaseArticle.create({
            company_id: myCompany.id,
            title: "CrewCam AI Damage Analysis - Complete Workflow",
            category: "Operations",
            tags: ["crewcam", "ai", "inspections", "workflow", "damage-analysis"],
            content: `# CrewCam AI Damage Analysis - Complete Workflow

## Overview
This guide walks you through the complete CrewCam inspection process, from sending assignments to creating AI-powered estimates.

---

## Step 1: Send Inspector Assignment

### From CrewCam Dashboard:
1. Click **"Send Assignment"** button
2. **Link to CRM** (Critical First Step):
   - **New Contact**: Creates a new Lead + Customer automatically
   - **Existing Lead**: Select from your pipeline - auto-fills contact info
   - **Existing Customer**: Select existing client - auto-fills all details

3. Fill in details:
   - Site Address (use Google autocomplete)
   - Property Type (Residential/Commercial)
   - Inspector Selection
   - Schedule Date & Time
   - Access Instructions

4. Click **"Send Assignment"**
   - Creates InspectionJob record
   - Sends email + SMS to inspector
   - Sends confirmation to customer
   - Auto-creates Task (if scheduled)
   - Auto-creates Calendar Event (if date/time set)

---

## Step 2: Inspector Receives & Starts Job

1. Inspector gets notification with all details pre-loaded
2. Opens CrewCam from their dashboard
3. All property info, contact details, and access instructions are ready

---

## Step 3: Photo Capture with Real-Time AI Analysis

### Live Camera:
- Tap camera button to capture photos
- Photos auto-upload in background
- **AI analyzes each photo automatically**:
  - Counts hail hits
  - Counts wind damage marks
  - Identifies shingle type
  - Flags discontinued materials
  - Generates inspector notes

### Voice Captions:
- Tap **"Voice"** before or after capturing
- Speak your notes (e.g., "4 hail hits visible on front slope")
- Caption auto-attaches to last photo taken

### AI Results Display:
- Each photo shows overlay: **"4 Hail • 3 Wind"**
- Red flag if **"Likely Discontinued"** material detected
- AI notes appear below each photo

---

## Step 4: Post-Inspection Actions

### Reanalyze Button:
- Re-runs AI analysis on all photos
- Useful if you want updated damage counts
- Updates all AI overlays automatically

### Link Storm Button:
- Associates inspection with StormEvent from Storm Tracker
- Adds weather context (hail size, wind speed, date)
- Shows in final report

### Link Estimate Button:
- Connect existing Xactimate estimate
- Estimate summary included in PDF report
- Tracks inspection → estimate relationship

---

## Step 5: Generate & Send Report

### Click **"Send Report"**:
1. Select recipients:
   - ✅ Client (auto if email on file)
   - Insurance Adjuster (optional)
   - Production Manager
   - Sales Rep
   - Custom team members

2. Report includes:
   - All photos organized by section
   - Voice captions below each photo
   - AI damage counts overlaid on photos
   - Storm data (if linked)
   - Estimate summary (if linked)
   - Inspector signature

3. Email tracking:
   - See when recipient opens report
   - Track view count

---

## Step 6: Create Estimate from Inspection

### Click **"Create"** next to estimate:
1. System auto-calculates AI summary:
   - Total hail hits across all photos
   - Average hail per square
   - Total wind marks
   - Material matching flags

2. Opens AI Estimator with:
   - Customer contact info pre-filled
   - Property address populated
   - Claim number included
   - **AI damage data attached** to help generate line items

3. AI Estimator uses inspection data to:
   - Suggest accurate quantities
   - Recommend materials
   - Flag discontinued items
   - Speed up estimate creation

---

## Key Benefits

✅ **Zero Data Entry**: CRM link auto-fills everything
✅ **Real-Time AI**: Damage detected as you capture
✅ **Voice Workflow**: Hands-free documentation
✅ **One-Click Estimates**: AI pre-populates from photos
✅ **Email Tracking**: Know when adjuster views report
✅ **Storm Context**: Links weather data automatically

---

## Tips for Best Results

1. **Always link to CRM first** - prevents duplicate data entry
2. **Use voice captions liberally** - faster than typing
3. **Take multiple close-ups per section** - more accurate AI counts
4. **Link storm events** - adds credibility to reports
5. **Review AI counts** - use Reanalyze if needed
6. **Send reports immediately** - track adjuster engagement

---

## Troubleshooting

**Camera won't start**: Reload page with HTTPS enabled
**Voice not working**: Enable microphone permissions in browser
**AI not analyzing**: Check photo format (JPG/PNG work best)
**Email not sending**: Check daily Resend limit (100 emails/day on free plan)

---

Need help? Contact support or check the training videos.`,
            is_published: true,
            is_ai_training: true,
            ai_assistant_targets: ["lexi", "estimator"],
            priority: 8,
        });

        return Response.json({ 
            success: true, 
            article_id: article.id,
            message: 'CrewCam workflow instructions added to Knowledge Base'
        });
    } catch (error) {
        console.error('Error creating article:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});