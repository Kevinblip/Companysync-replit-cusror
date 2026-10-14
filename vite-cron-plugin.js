import { Pool } from 'pg';
import crypto from 'crypto';

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

let cronInterval = null;
let lastRunTimes = {};

const CRON_JOBS = [
  {
    name: 'checkReminders',
    schedule: '*/5 * * * *',
    description: 'Check calendar event reminders every 5 minutes',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'processLeadConfirmationOutreach',
    schedule: '*/5 * * * *',
    description: 'Send queued lead confirmations and call unreplied homeowners every 5 minutes',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'processWorkflowQueue',
    schedule: '* * * * *',
    description: 'Process scheduled workflow executions every minute',
    intervalMs: 60 * 1000,
  },
  {
    name: 'checkInvoiceReminders',
    schedule: '0 9 * * *',
    description: 'Check overdue invoice reminders daily at 9am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 9,
  },
  {
    name: 'checkTaskReminders',
    schedule: '0 9 * * *',
    description: 'Check task reminders daily at 9am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 9,
  },
  {
    name: 'createDailyBackup',
    schedule: '0 2 * * *',
    description: 'Create daily backup at 2am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 2,
  },
  {
    name: 'cronCleanupBackups',
    schedule: '0 3 * * *',
    description: 'Auto-delete expired backups + send 7-day expiry warnings at 3am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 3,
  },
  {
    name: 'sendScheduledDailyReports',
    schedule: '*/15 * * * *',
    description: 'Send morning (7am) and EOD (7pm) reports per company timezone every 15 minutes',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'decayLeadScores',
    schedule: '0 3 * * *',
    description: 'Decay lead scores daily at 3am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 3,
  },
  {
    name: 'checkStormAlerts',
    schedule: '*/30 * * * *',
    description: 'Check NWS active alerts + recent storms every 30 minutes, send email/SMS alerts',
    intervalMs: 30 * 60 * 1000,
  },
  {
    name: 'ghlAutoSyncCron',
    schedule: '*/30 * * * *',
    description: 'Auto-sync GoHighLevel contacts every 30 minutes for enabled companies',
    intervalMs: 30 * 60 * 1000,
  },
  {
    name: 'processScheduledCampaigns',
    schedule: '*/5 * * * *',
    description: 'Send scheduled campaigns every 5 minutes',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'checkStaleLeads',
    schedule: '0 8 * * *',
    description: 'Flag leads stuck in New status for 24+ hours and create follow-up Action Items daily at 8am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 8,
  },
  {
    name: 'sendStaleLeadDigest',
    schedule: '*/5 7 * * *',
    description: 'Send one stale-lead digest email per assigned rep at 7am America/New_York',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'processActionItemEscalation',
    schedule: '*/15 * * * *',
    description: 'Escalate overdue action items with in-app reminders and one daily email/SMS digest per recipient',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'reconcileEmailDeliveryEvents',
    schedule: '*/10 * * * *',
    description: 'Re-apply delivery/bounce callbacks that could not be matched when they arrived',
    intervalMs: 10 * 60 * 1000,
  },
  {
    name: 'scanBuildReminders',
    schedule: '0 * * * *',
    description: 'Draft approval-gated build/install reminders into Action Items every hour (idempotent)',
    intervalMs: 60 * 60 * 1000,
  },
  {
    name: 'sendFridayPortalRecap',
    schedule: '*/15 * * * 5',
    description: 'Send Friday 5pm homeowner portal recap emails per company timezone',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'scanBuildProgressUpdates',
    schedule: '*/15 * * * 4',
    description: 'Send weekly customer progress texts (Thursday 10am per company timezone) when a build advanced a stage',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'scanStuckJobs',
    schedule: '0 */8 * * *',
    description: 'Alert the team about builds stuck in the same stage past the configured threshold, every 8 hours (idempotent)',
    intervalMs: 8 * 60 * 60 * 1000,
  },
  {
    name: 'scanPunchListReminders',
    schedule: '0 * * * *',
    description: 'Keep one open Action Item per build with unfinished punch items, re-armed every 3 days and escalated to an admin/owner after 7 days (idempotent)',
    intervalMs: 60 * 60 * 1000,
  },
  {
    name: 'nagPersonalTodos',
    schedule: '*/30 * * * *',
    description: 'Nag users with in-app notifications about overdue and due-today personal to-dos every 30 minutes',
    intervalMs: 30 * 60 * 1000,
  },
  {
    name: 'purgeOldStormEvents',
    schedule: '0 4 * * *',
    description: 'Delete StormEvents older than 365 days daily at 4am (retention must cover the 365-day UI search window)',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 4,
  },
  {
    name: 'purgeOldDailyReports',
    schedule: '0 4 * * *',
    description: 'Delete DailyReports older than 90 days daily at 4am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 4,
  },
  {
    name: 'sendWeeklyCommissionDigest',
    schedule: '*/15 * * * *',
    description: 'Send weekly commission summary email to each sales rep on Friday at 4pm per company timezone',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'sendWeeklyLeaderboardDigest',
    schedule: '*/15 * * * *',
    description: "Send last week's staff leaderboard (top 3 + biggest mover) to all active staff on Monday at 8am per company timezone",
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'checkOverdueInvoices',
    schedule: '0 8 * * *',
    description: 'Create Action Items for invoices 7+ days past due, daily at 8am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 8,
  },
  {
    name: 'processReviewRequests',
    schedule: '0 */6 * * *',
    description: 'Send due review request emails/SMS (up to 4 sends, every 10 days over 30 days)',
    intervalMs: 6 * 60 * 60 * 1000,
  },
  {
    name: 'processTrialLifecycle',
    schedule: '0 10 * * *',
    description: 'Send 14-day trial nurture emails/SMS and expire trials past their end date, daily at 10am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 10,
  },
  {
    name: 'sendMorningDigest',
    schedule: '*/5 * * * *',
    description: 'Send morning digest to staff/reps with Twilio numbers when their work hours start (every 5 minutes, self-gated per staff)',
    intervalMs: 5 * 60 * 1000,
  },
  {
    name: 'bulkSyncAllCalendars',
    schedule: '*/15 * * * *',
    description: 'Two-way Google Calendar sync for every connected user every 15 minutes (events created in Google reach CS without anyone opening the Calendar page)',
    intervalMs: 15 * 60 * 1000,
  },
  {
    name: 'refreshAllQBTokens',
    schedule: '0 3 * * *',
    description: 'Proactively refresh all connected QuickBooks OAuth tokens nightly at 3am to prevent 100-day refresh token expiry; marks is_connected=false and notifies admins on auth failure',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 3,
  },
  {
    name: 'syncQBExpensesNightly',
    schedule: '0 4 * * *',
    description: 'Pull the last 30 days of QuickBooks expense (Purchase) transactions into CS Expenses for every connected company. Duplicate-safe — already-imported transactions are skipped.',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 4,
  },
  {
    name: 'geocodeMissingPins',
    schedule: '0 */4 * * *',
    description: 'Proactively geocode leads/customers still missing lat/lng so Map pins are fresh even for companies that rarely open the Map page (50 addresses per company per run)',
    intervalMs: 4 * 60 * 60 * 1000,
  },
  {
    name: 'cronCleanupLexiPendingSchedules',
    schedule: '0 * * * *',
    description: 'Delete used/expired Lexi scheduling confirmations older than 1 hour, every hour (storage hygiene — the tokens carry a 10-minute TTL)',
    intervalMs: 60 * 60 * 1000,
  },
  {
    // Mirrors prod-server.cjs daily-at-9am registration.
    // Scans every active paid tenant's month-to-date platform-key API costs.
    // Fires a bell + email to super-admin accounts when a tenant crosses 50%
    // of their plan price. Idempotent — stamps a CostAlert entity so the same
    // tenant is never alerted twice in the same calendar month.
    name: 'checkTenantCostAlerts',
    schedule: '0 9 * * *',
    description: 'Check per-tenant platform-key API costs daily at 9am; alert super-admins when a tenant exceeds 50% of their plan price (BYOK nudge)',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 9,
  },
];

function shouldRunNow(job) {
  const now = new Date();
  const lastRun = lastRunTimes[job.name] || 0;
  const elapsed = now.getTime() - lastRun;

  if (job.runAtHour !== undefined) {
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    if (currentHour === job.runAtHour && currentMinute <= 1 && elapsed >= 55 * 60 * 1000) {
      return true;
    }
    return false;
  }

  return elapsed >= job.intervalMs;
}

async function invokeLocalFunction(functionName, params = {}) {
  try {
    const cronToken = process.env.SESSION_SECRET
      ? crypto.createHmac('sha256', process.env.SESSION_SECRET).update('internal-cron-2026').digest('hex')
      : '';
    const resp = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/functions/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-token': cronToken },
      body: JSON.stringify({ functionName, params }),
    });
    const result = await resp.json();
    if (result.error && !result.warning) {
      console.error(`[Cron] ${functionName} error:`, result.error);
    }
    return result;
  } catch (err) {
    console.error(`[Cron] Failed to invoke ${functionName}:`, err.message);
    return { error: err.message };
  }
}

async function runCronTick() {
  for (const job of CRON_JOBS) {
    if (job.name === 'ghlAutoSyncCron') {
      const ghlId = String(process.env.GHL_CLIENT_ID || '').trim();
      const ghlSecret = String(process.env.GHL_CLIENT_SECRET || '').trim();
      if (!ghlId || !ghlSecret) continue;
    }
    if (shouldRunNow(job)) {
      lastRunTimes[job.name] = Date.now();
      console.log(`[Cron] Running: ${job.name} (${job.description})`);
      try {
        const result = await invokeLocalFunction(job.name);
        if (result.warning) {
          console.warn(`[Cron] ${job.name}: ${result.warning}`);
        } else if (result.data) {
          console.log(`[Cron] ${job.name} completed successfully`);
        }
      } catch (err) {
        console.error(`[Cron] ${job.name} failed:`, err.message);
      }
    }
  }
}

async function saveCronStatus() {
  try {
    const p = getPool();
    const statusData = {
      last_run_times: lastRunTimes,
      jobs: CRON_JOBS.map(j => ({
        name: j.name,
        description: j.description,
        schedule: j.schedule,
        last_run: lastRunTimes[j.name] ? new Date(lastRunTimes[j.name]).toISOString() : null,
      })),
      updated_at: new Date().toISOString(),
    };
    const existing = await p.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'CronStatus' LIMIT 1`
    );
    if (existing.rows.length > 0) {
      await p.query(
        `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2`,
        [JSON.stringify(statusData), existing.rows[0].id]
      );
    } else {
      const id = `cron_status_${Date.now().toString(36)}`;
      await p.query(
        `INSERT INTO generic_entities (id, entity_type, data, created_date, updated_date)
         VALUES ($1, 'CronStatus', $2, NOW(), NOW())`,
        [id, JSON.stringify(statusData)]
      );
    }
  } catch (err) {
    console.error('[Cron] Failed to save status:', err.message);
  }
}

export default function viteCronPlugin() {
  return {
    name: 'vite-cron-plugin',
    configureServer(server) {
      setTimeout(() => {
        console.log('[Cron] Starting local cron scheduler...');
        console.log(`[Cron] ${CRON_JOBS.length} jobs registered:`);
        for (const job of CRON_JOBS) {
          console.log(`[Cron]   - ${job.name}: ${job.description}`);
        }

        cronInterval = setInterval(async () => {
          try {
            await runCronTick();
          } catch (err) {
            console.error('[Cron] Tick error:', err.message);
          }
        }, 60 * 1000);

        console.log('[Cron] Scheduler running (checking every 60 seconds)');
      }, 10000);

      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/cron/status' && req.method === 'GET') {
          const status = CRON_JOBS.map(j => ({
            name: j.name,
            description: j.description,
            schedule: j.schedule,
            last_run: lastRunTimes[j.name] ? new Date(lastRunTimes[j.name]).toISOString() : null,
            next_run_approx: j.runAtHour !== undefined
              ? `Daily at ${j.runAtHour}:00`
              : `Every ${Math.round(j.intervalMs / 60000)} minutes`,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, jobs: status, server_time: new Date().toISOString() }));
          return;
        }

        if (req.url?.startsWith('/api/cron/trigger/') && req.method === 'POST') {
          const jobName = req.url.replace('/api/cron/trigger/', '');
          const job = CRON_JOBS.find(j => j.name === jobName);
          if (!job) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Job '${jobName}' not found` }));
            return;
          }
          console.log(`[Cron] Manual trigger: ${jobName}`);
          lastRunTimes[jobName] = Date.now();
          const result = await invokeLocalFunction(jobName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, job: jobName, result }));
          return;
        }

        next();
      });
    }
  };
}
