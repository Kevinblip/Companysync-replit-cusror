import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const authHeader = req.headers.get('Authorization');
    const expectedToken = Deno.env.get('CRON_SECRET_TOKEN');
    const isCronAuth = authHeader === `Bearer ${expectedToken}`;

    if (!isCronAuth) {
      const user = await base44.auth.me();
      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('⏰ sendScheduledDailyReports: checking timezone-aware windows...');

    const now = new Date();

    const getLocalHourAndMinute = (timezone: string): { hour: number; minute: number; dateStr: string } => {
      try {
        // Use TWO separate formatters to avoid any quirks from combining
        // hour12:false with date parts (can produce "24" for midnight in some engines)
        const timeFmt = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const dateFmt = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });

        const timeParts = timeFmt.formatToParts(now);
        const dateParts = dateFmt.formatToParts(now);

        let hour = parseInt(timeParts.find(p => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(timeParts.find(p => p.type === 'minute')?.value || '0', 10);
        // Some engines return 24 for midnight — normalise to 0
        if (hour === 24) hour = 0;

        const year = dateParts.find(p => p.type === 'year')?.value || '';
        const month = dateParts.find(p => p.type === 'month')?.value || '';
        const day = dateParts.find(p => p.type === 'day')?.value || '';
        const dateStr = `${year}-${month}-${day}`;

        console.log(`[TZ] ${timezone}: local time ${hour}:${String(minute).padStart(2,'0')}, date ${dateStr}`);
        return { hour, minute, dateStr };
      } catch (e) {
        console.warn(`[TZ] Failed to parse timezone "${timezone}", falling back to UTC:`, e);
        const utcHour = now.getUTCHours();
        const utcMinute = now.getUTCMinutes();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        return { hour: utcHour, minute: utcMinute, dateStr: `${y}-${m}-${d}` };
      }
    };

    const companies = await base44.asServiceRole.entities.Company.list();
    console.log(`Found ${companies.length} companies to check`);

    const results = {
      morning_triggered: [] as string[],
      morning_skipped: [] as string[],
      eod_triggered: [] as string[],
      eod_skipped: [] as string[],
    };

    for (const company of companies) {
      if (company.is_deleted) continue;

      const timezone = company.settings?.time_zone || company.timezone || 'America/New_York';
      const { hour, minute, dateStr } = getLocalHourAndMinute(timezone);

      const WINDOW_MINUTES = 30;

      if (hour === 5 && minute < WINDOW_MINUTES) {
        const existingReports = await base44.asServiceRole.entities.DailyReport.filter({
          company_id: company.id,
          report_date: dateStr,
          report_type: 'morning_briefing',
        });

        if (existingReports && existingReports.length > 0) {
          console.log(`⏭️ Morning report already exists for ${company.company_name} (${dateStr}), skipping`);
          results.morning_skipped.push(company.company_name);
        } else {
          console.log(`🌅 Triggering morning report for ${company.company_name} (${timezone}, local ${hour}:${String(minute).padStart(2,'0')})`);
          try {
            await base44.asServiceRole.functions.invoke('generateMorningReport', {
              companyId: company.id,
            });
            results.morning_triggered.push(company.company_name);
          } catch (err) {
            console.error(`❌ Failed morning report for ${company.company_name}:`, err);
          }
        }
      }

      if (hour === 20 && minute < WINDOW_MINUTES) {
        const existingReports = await base44.asServiceRole.entities.DailyReport.filter({
          company_id: company.id,
          report_date: dateStr,
          report_type: 'end_of_day',
        });

        if (existingReports && existingReports.length > 0) {
          console.log(`⏭️ EOD report already exists for ${company.company_name} (${dateStr}), skipping`);
          results.eod_skipped.push(company.company_name);
        } else {
          console.log(`📊 Triggering EOD report for ${company.company_name} (${timezone}, local ${hour}:${String(minute).padStart(2,'0')})`);
          try {
            await base44.asServiceRole.functions.invoke('generateDailyReport', {
              companyId: company.id,
              reportDate: dateStr,
            });
            results.eod_triggered.push(company.company_name);
          } catch (err) {
            console.error(`❌ Failed EOD report for ${company.company_name}:`, err);
          }
        }
      }
    }

    console.log('✅ sendScheduledDailyReports complete:', JSON.stringify(results));

    return Response.json({
      success: true,
      checked_at: now.toISOString(),
      results,
    });
  } catch (error) {
    console.error('❌ sendScheduledDailyReports error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});
