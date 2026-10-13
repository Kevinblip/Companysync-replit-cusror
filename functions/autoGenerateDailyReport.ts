import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Runs daily at 9 PM to auto-generate EOD reports (unless manually created earlier)
Deno.serve(async (req) => {
    console.log('📊 ========== AUTO DAILY REPORT GENERATOR ==========');
    console.log('⏰ Time:', new Date().toISOString());
    
    try {
        // Auth check removed to allow internal scheduler execution
        const base44 = createClientFromRequest(req);

        // Get all companies
        const companies = await base44.asServiceRole.entities.Company.list();
        console.log(`🏢 Found ${companies.length} companies`);

        let reportsGenerated = 0;
        let reportsSkipped = 0;

        for (const company of companies) {
            try {
                // Calculate YESTERDAY's date for THIS company based on their timezone
                const companyTimezone = company.settings?.time_zone || 'America/New_York';
                
                // Get yesterday's date in company timezone
                // We construct a date object, subtract 24 hours, then format to timezone
                // Ideally we'd use a library, but sticking to native:
                const now = new Date();
                const yesterdayMs = now.getTime() - (24 * 60 * 60 * 1000);
                const yesterdayDate = new Date(yesterdayMs);

                const options = { timeZone: companyTimezone, year: 'numeric', month: '2-digit', day: '2-digit' };
                const formatter = new Intl.DateTimeFormat('en-US', options);
                const parts = formatter.formatToParts(yesterdayDate);
                const year = parts.find(p => p.type === 'year').value;
                const month = parts.find(p => p.type === 'month').value;
                const day = parts.find(p => p.type === 'day').value;
                const reportDate = `${year}-${month}-${day}`;

                // Check if report already exists for YESTERDAY
                const existingReports = await base44.asServiceRole.entities.DailyReport.filter({
                    company_id: company.id,
                    report_date: reportDate,
                    report_type: { $ne: 'morning_briefing' } // Ensure we don't count morning briefings as EOD reports
                });

                if (existingReports.length > 0) {
                    console.log(`⏭️ Skipping ${company.company_name} (${reportDate}) - EOD report already exists`);
                    reportsSkipped++;
                    continue;
                }

                console.log(`📊 Generating EOD report for: ${company.company_name} on ${reportDate}`);

                // Generate the report using the existing function
                await base44.asServiceRole.functions.invoke('generateDailyReport', {
                    reportDate: reportDate,
                    companyId: company.id
                });

                reportsGenerated++;
                console.log(`✅ Report generated for: ${company.company_name}`);

            } catch (companyError) {
                console.error(`❌ Error generating report for ${company.company_name}:`, companyError.message);
            }
        }

        console.log(`📊 Auto-generation complete: ${reportsGenerated} generated, ${reportsSkipped} skipped`);

        return Response.json({
            success: true,
            reports_generated: reportsGenerated,
            reports_skipped: reportsSkipped,
            total_companies: companies.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Auto Daily Report Error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
});