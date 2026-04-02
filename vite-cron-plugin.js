import { Pool } from 'pg';

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
    name: 'sendScheduledDailyReports',
    schedule: '*/15 * * * *',
    description: 'Send morning (5am) and EOD (8pm) reports per company timezone every 15 minutes',
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
    description: 'Flag leads stuck in New status for 24+ hours and notify assigned staff daily at 8am',
    intervalMs: 24 * 60 * 60 * 1000,
    runAtHour: 8,
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
    const resp = await fetch('http://localhost:5000/api/functions/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
