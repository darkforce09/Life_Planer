import express from 'express';
import cors from 'cors';
import { db } from '../db/index.js';
import { users, courses, courseModules, sensorConfigs, tasks, exams, documentChunks, events } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { desc, eq, sql } from 'drizzle-orm';
import { syncTimeEdit, TimeEditConfig, checkTimeEditHealth } from '../sensors/TimeEditService.js';
import { syncCanvas, CanvasConfig, checkCanvasHealth } from '../sensors/CanvasService.js';
import { syncLadok, scrapeLadokExams, signUpForLadokExam } from '../sensors/LadokBot.js';
import { syncOutlook, checkOutlookHealth } from '../sensors/OutlookIntegrationService.js';
import { CanvasBot } from '../sensors/CanvasBot.js';
import { recalculateAllTasksPriorities } from '../engine/PrioritizationRepository.js';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { TranscriptionEngine } from '../engine/TranscriptionEngine.js';
import { DocumentParsingEngine } from '../engine/DocumentParsingEngine.js';
import { EmbeddingEngine } from '../engine/EmbeddingEngine.js';
import { ReorganizationEngine } from '../engine/ReorganizationEngine.js';
import { ContentRefinementEngine } from '../engine/ContentRefinementEngine.js';
import { ExternalScraper } from '../sensors/ExternalScraper.js';
import { RAGQueryEngine } from '../engine/RAGQueryEngine.js';
import { getSensorConfig, setSensorConfig } from '../db/sensorConfigStore.js';
import { authMiddleware } from './auth.js';
import { PipelineRun, PipelineLockedError, getRecentPipelineRuns } from '../engine/PipelineRunService.js';
import { getRecentAlerts, recordAlert } from '../utils/alerts.js';
import { alerts as alertsTable } from '../db/schema.js';
import { getPendingApprovals, getRecentApprovals, resolveApproval } from '../agents/approvals.js';
import { getRecentTraces, getTracesForRun } from '../agents/trace.js';
import { runOrchestrator } from '../agents/Orchestrator.js';

export const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// In-memory log buffer for the admin UI
export const adminLogs: any[] = [];
const originalInfo = logger.info;
logger.info = (msg: any, ...args: any[]) => {
  adminLogs.unshift({ timestamp: new Date().toISOString(), level: 'INFO', message: msg });
  if (adminLogs.length > 50) adminLogs.pop();
  originalInfo.call(logger, msg, ...args);
};

// Admin Dashboard Routes
app.get('/api/admin/logs', (req, res) => {
  res.json(adminLogs);
});

app.post('/api/admin/sync', async (req, res) => {
  logger.info('--- MANUAL SYNC TRIGGERED FROM ADMIN UI ---');
  try {
    const userList = await db.select().from(users);
    let dbUser = userList[0];
    if (!dbUser) {
        throw new Error('No user found in database');
    }

    // Fetch timeedit config from the database
    const configResult = await db.select().from(sensorConfigs).where(eq(sensorConfigs.id, 'timeedit'));
    
    let timeEditUrl = 'https://cloud.timeedit.net/miun/web/student/ri62l1vQ7140Y3QQZ1Zw1d795o5tZ21Z5y6YQYQ6n2560X10k6800Z51555Et7FB087010C65o227BCQ6410EDB0449moD9F93B6.ics';
    
    if (configResult.length > 0) {
      const parsedConfig = JSON.parse(configResult[0].config);
      if (parsedConfig.url) {
        timeEditUrl = parsedConfig.url;
      }
    } else {
      // Seed default
      await db.insert(sensorConfigs).values({ id: 'timeedit', config: JSON.stringify({ url: timeEditUrl }) });
    }

    const config: TimeEditConfig = {
      name: 'timeedit',
      icsUrl: timeEditUrl,
      userId: dbUser.id
    };
    await syncTimeEdit(config);

    // Canvas Sync
    const canvasConfigResult = await db.select().from(sensorConfigs).where(eq(sensorConfigs.id, 'canvas'));
    if (canvasConfigResult.length > 0) {
      const parsedCanvasConfig = JSON.parse(canvasConfigResult[0].config);
      if (parsedCanvasConfig.url) {
        const config: CanvasConfig = {
          name: 'canvas',
          icsUrl: parsedCanvasConfig.url
        };
        await syncCanvas(config);
      }
    }

    // 3. LADOK BOT (Playwright)
    const ladokConfig = await getSensorConfig<{ username?: string; password?: string }>('ladok');
    if (ladokConfig?.username && ladokConfig?.password) {
      // Run Playwright Headless Bot
      await syncLadok(ladokConfig.username, ladokConfig.password);
    }

    // 4. OUTLOOK (MS Graph)
    const outlookConfig = await getSensorConfig<{ graphApiToken?: string }>('outlook');
    if (outlookConfig?.graphApiToken) {
      await syncOutlook({ name: 'outlook', graphApiToken: outlookConfig.graphApiToken });
    }

    // Finally, prioritize tasks
    await recalculateAllTasksPriorities();
    res.json({ success: true, message: 'Sensors synchronized.' });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

// API: Canvas Deep Sync
app.post('/api/canvas/deep-sync', async (req, res) => {
  try {
    const ladokConfig = await getSensorConfig<{ username?: string; password?: string }>('ladok');
    if (!ladokConfig?.username || !ladokConfig?.password) {
      return res.status(400).json({ error: 'Ladok/Miun credentials not configured.' });
    }
    const { username, password } = ladokConfig;
    
    // Optional course filter (substrings/codes) read from the 'canvas_scrape' config.
    const scrapeConfig = await getSensorConfig<{ courseFilters?: string[] }>('canvas_scrape');
    const courseFilters = Array.isArray(scrapeConfig?.courseFilters) ? scrapeConfig!.courseFilters : [];

    // Acquire the run-lock before kicking off background work so overlapping
    // deep-sync / cron runs cannot clobber each other (especially Playwright bots).
    let run: PipelineRun;
    try {
      run = await PipelineRun.start('deep-sync');
    } catch (error) {
      if (error instanceof PipelineLockedError) {
        return res.status(409).json({ error: error.message });
      }
      throw error;
    }

    // Run in background
    res.json({ success: true, message: 'Canvas deep sync started.' });

    (async () => {
      try {
        await run.stage('scrape-canvas', async () => {
          const bot = new CanvasBot();
          await bot.runScraper(username, password, courseFilters);
        });
        await run.stage('transcribe', async () => {
          if (!process.env.GROQ_API_KEY) {
            logger.warn('[API] GROQ_API_KEY not set; skipping transcription stage.');
            await recordAlert('Transcription skipped: GROQ_API_KEY not configured.', 'info', 'pipeline');
            return;
          }
          await new TranscriptionEngine().transcribeAll();
        });
        await run.stage('parse-documents', async () => {
          await new DocumentParsingEngine().parseAll();
        });
        await run.stage('external-scrape', async () => {
          await new ExternalScraper().run();
        });
        await run.stage('reorganize', async () => {
          await new ReorganizationEngine().reorganizeAll();
        });
        await run.stage('refine', async () => {
          await new ContentRefinementEngine().refineAll();
        });
        await run.stage('embed', async () => {
          await new EmbeddingEngine().processAll();
        });
        await run.finish();
      } catch (error) {
        await run.fail(error);
      }
    })();
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to start canvas sync.' });
  }
});

// API: Open Local Canvas Folder
app.post('/api/canvas/open-folder', (req, res) => {
  try {
    const baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
    const command = process.platform === 'win32' ? 'explorer' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`"${command}" "${baseDir}"`);
    res.json({ success: true });
  } catch (err) {
    logger.error(err as any);
    res.status(500).json({ error: 'Failed to open directory' });
  }
});

// API: Update Ladok Config (encrypted at rest)
app.post('/api/config/ladok', async (req, res) => {
  const { username, password } = req.body;
  await setSensorConfig('ladok', { username, password });
  res.json({ success: true });
});

// API: Get Ladok Config
app.get('/api/config/ladok', async (req, res) => {
  const config = await getSensorConfig<{ username?: string; password?: string }>('ladok');
  res.json({ username: config?.username || '', password: config?.password || '' });
});

// API: Get Ladok Data (for UI)
app.get('/api/ladok/data', async (req, res) => {
  const allCourses = await db.select().from(courses);
  const allModules = await db.select().from(courseModules);
  res.json({ courses: allCourses, modules: allModules });
});

// API: Get Ladok Exams
app.get('/api/ladok/exams', async (req, res) => {
  const allExams = await db.select().from(exams);
  res.json({ exams: allExams });
});

// API: Scrape Ladok Exams
app.post('/api/ladok/exams/scrape', async (req, res) => {
  try {
    const ladokConfig = await getSensorConfig<{ username?: string; password?: string }>('ladok');
    if (!ladokConfig?.username || !ladokConfig?.password) {
      return res.status(400).json({ error: 'Ladok credentials not configured.' });
    }
    const { username, password } = ladokConfig;

    // Run in background so the request returns immediately. Errors are logged and
    // raised as an alert (the response has already been sent, so we must not touch res).
    res.json({ success: true, message: 'Exam scrape started.' });
    scrapeLadokExams(username, password).catch(async (error) => {
      logger.error({ err: error }, '[API] Ladok exam scrape failed');
      await recordAlert(
        `Ladok exam scrape failed: ${error instanceof Error ? error.message : String(error)}`,
        'critical',
        'ladok',
      );
    });
  } catch (error) {
    logger.error(error as any);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to start exam scrape.' });
  }
});

// API: Sign up for a Ladok Exam
app.post('/api/ladok/exams/:id/signup', async (req, res) => {
  try {
    const { id } = req.params;
    const ladokConfig = await getSensorConfig<{ username?: string; password?: string }>('ladok');
    if (!ladokConfig?.username || !ladokConfig?.password) {
      return res.status(400).json({ error: 'Ladok credentials not configured.' });
    }
    const { username, password } = ladokConfig;

    // Run in background. Errors are logged + alerted (response already sent).
    res.json({ success: true, message: 'Exam sign-up started.' });
    signUpForLadokExam(id, username, password).catch(async (error) => {
      logger.error({ err: error }, '[API] Ladok exam sign-up failed');
      await recordAlert(
        `Ladok exam sign-up failed: ${error instanceof Error ? error.message : String(error)}`,
        'critical',
        'ladok',
      );
    });
  } catch (error) {
    logger.error(error as any);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to start exam sign-up.' });
  }
});


// API: Get Sensor Config
app.get('/api/sensors/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const config = await getSensorConfig(id);
    res.json(config ?? {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// API: Update Sensor Config
app.put('/api/sensors/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    await setSensorConfig(id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// API: Get Prioritized Tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const source = req.query.source as string;
    let query = db.select().from(tasks);
    
    if (source) {
      query = query.where(eq(tasks.source, source)) as any;
    }
    
    const prioritizedTasks = await query.orderBy(desc(tasks.priorityScore));
    res.json(prioritizedTasks);
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// API: Update Task (partial update; supports edit + completion toggle)
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, deadline, priorityScore, status, isCompleted } = req.body;

    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (deadline !== undefined) update.deadline = new Date(deadline);
    if (priorityScore !== undefined) update.priorityScore = parseInt(priorityScore);
    if (status !== undefined) update.status = status;
    if (isCompleted !== undefined) {
      update.isCompleted = !!isCompleted;
      update.status = isCompleted ? 'completed' : 'pending';
      update.completedAt = isCompleted ? new Date() : null;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    await db.update(tasks).set(update).where(eq(tasks.id, id));
    res.json({ success: true });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// API: Get Events (calendar/schedule)
app.get('/api/events', async (req, res) => {
  try {
    const allEvents = await db.select().from(events).orderBy(events.startTime);
    res.json({ events: allEvents });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// API: System Health Check & Telemetry
app.get('/api/health', async (req, res) => {
  const [timeedit, canvas, ladok, outlook] = await Promise.all([
    getSensorConfig<{ url?: string }>('timeedit'),
    getSensorConfig<{ url?: string }>('canvas'),
    getSensorConfig('ladok'),
    getSensorConfig<{ graphApiToken?: string }>('outlook'),
  ]);

  let timeeditStatus: string = 'pending';
  if (timeedit?.url) {
    timeeditStatus = (await checkTimeEditHealth({ name: 'timeedit', icsUrl: timeedit.url, userId: '' }))
      ? 'ok'
      : 'error';
  }

  let canvasStatus: string = 'pending';
  if (canvas?.url) {
    canvasStatus = (await checkCanvasHealth({ name: 'canvas', icsUrl: canvas.url })) ? 'ok' : 'error';
  }

  let outlookStatus: string = outlook?.graphApiToken ? 'configured' : 'pending';
  if (outlook?.graphApiToken) {
    outlookStatus = (await checkOutlookHealth({ name: 'outlook', graphApiToken: outlook.graphApiToken }))
      ? 'ok'
      : 'error';
  }

  const [runs, recentAlerts] = await Promise.all([getRecentPipelineRuns(5), getRecentAlerts(10)]);
  const activeRun = runs.find((r) => r.status === 'running') ?? null;

  res.json({
    status: 'healthy',
    timestamp: new Date(),
    sensors: {
      timeedit: timeeditStatus,
      canvas: canvasStatus,
      ladok: ladok ? 'configured' : 'pending',
      outlook: outlookStatus,
    },
    pipeline: {
      active: activeRun
        ? { id: activeRun.id, type: activeRun.type, currentStage: activeRun.currentStage }
        : null,
      recent: runs.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        currentStage: r.currentStage,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    },
    alerts: recentAlerts.filter((a) => !a.acknowledged),
    recentLogs: adminLogs.slice(0, 50),
  });
});

// API: Pipeline run history (per-stage progress + failures)
app.get('/api/pipeline/runs', async (req, res) => {
  try {
    const runs = await getRecentPipelineRuns(20);
    res.json({
      runs: runs.map((r) => ({ ...r, stages: JSON.parse(r.stages || '[]') })),
    });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch pipeline runs' });
  }
});

// API: User-facing alerts (scraper breaks, auto-heal events, etc.)
app.get('/api/alerts', async (req, res) => {
  try {
    res.json({ alerts: await getRecentAlerts(50) });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// API: Acknowledge an alert
app.post('/api/alerts/:id/ack', async (req, res) => {
  try {
    await db.update(alertsTable).set({ acknowledged: true }).where(eq(alertsTable.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// --- Phase E: AI Agents (approvals, traces, orchestrator) ---

// API: Pending human-in-the-loop approvals (exam signup, email send, 2FA)
app.get('/api/approvals', async (req, res) => {
  try {
    const all = req.query.all === 'true';
    const rows = all ? await getRecentApprovals(50) : await getPendingApprovals();
    res.json({
      approvals: rows.map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : {} })),
    });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

// API: Resolve an approval (approve/reject) - the human-in-the-loop gate
app.post('/api/approvals/:id/resolve', async (req, res) => {
  try {
    const approved = req.body?.approved === true;
    await resolveApproval(req.params.id, approved);
    res.json({ success: true, status: approved ? 'approved' : 'rejected' });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to resolve approval' });
  }
});

// API: Agent trace log (prompts, tool calls, decisions)
app.get('/api/agents/traces', async (req, res) => {
  try {
    const runId = req.query.runId as string | undefined;
    const traces = runId ? await getTracesForRun(runId) : await getRecentTraces(100);
    res.json({ traces });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to fetch agent traces' });
  }
});

// API: Manually trigger the Orchestrator agent
app.post('/api/agents/orchestrate', async (req, res) => {
  try {
    res.json({ success: true, message: 'Orchestrator started.' });
    runOrchestrator('manual').catch((error) => logger.error({ err: error }, '[AGENT] Orchestrator failed'));
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to start orchestrator' });
  }
});

function findAllVideos(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findAllVideos(fullPath));
    } else if (file.endsWith('.mp4') || file.endsWith('.webm')) {
      results.push(fullPath);
    }
  }
  return results;
}

app.post('/api/transcribe', async (req, res) => {
  try {
    res.json({ success: true, message: 'Transcription started.' });
    const engine = new TranscriptionEngine();
    const result = await engine.transcribeAll();
    logger.info({ result }, '[TRANSCRIPTION] Batch complete.');
  } catch (error) {
    logger.error(error as any);
  }
});

app.get('/api/transcribe/status', (req, res) => {
  try {
    const engine = new TranscriptionEngine();
    const pendingPaths = engine.scanForUntranscribedVideos();
    const baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
    const allVideos = findAllVideos(baseDir);
    const pending = pendingPaths.map(v => path.basename(v));
    const done = allVideos
      .map(v => path.basename(v))
      .filter(v => !pending.includes(v));

    res.json({
      total: allVideos.length,
      done,
      pending
    });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

function findAllDocs(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findAllDocs(fullPath));
    } else {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.pdf' || ext === '.docx') {
            results.push(fullPath);
        }
    }
  }
  return results;
}

app.post('/api/parse-documents', async (req, res) => {
  try {
    res.json({ success: true, message: 'Document parsing started.' });
    const engine = new DocumentParsingEngine();
    const result = await engine.parseAll();
    logger.info({ result }, '[DOCUMENT-PARSING] Batch complete.');
  } catch (error) {
    logger.error(error as any);
  }
});

app.get('/api/parse-documents/status', (req, res) => {
  try {
    const engine = new DocumentParsingEngine();
    const pendingPaths = engine.scanForUnparsedDocuments();
    const baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
    const allDocs = findAllDocs(baseDir);
    const pending = pendingPaths.map(v => path.basename(v));
    const done = allDocs
      .map(v => path.basename(v))
      .filter(v => !pending.includes(v));

    res.json({
      total: allDocs.length,
      done,
      pending
    });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

function findAllParsedDocs(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findAllParsedDocs(fullPath));
    } else {
        if (file.endsWith('_parsed.md')) {
            results.push(fullPath);
        }
    }
  }
  return results;
}

app.post('/api/embeddings/sync', async (req, res) => {
  try {
    res.json({ success: true, message: 'Embedding engine started.' });
    const reorgEngine = new ReorganizationEngine();
    await reorgEngine.reorganizeAll();
    const refineEngine = new ContentRefinementEngine();
    await refineEngine.refineAll();
    const engine = new EmbeddingEngine();
    const result = await engine.processAll();
    logger.info({ result }, '[EMBEDDING-ENGINE] Batch complete.');
  } catch (error) {
    logger.error(error as any);
  }
});

// API: Content Refinement (AI cleaning + index generation)
app.post('/api/refine', async (req, res) => {
  try {
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    if (dryRun) {
      const engine = new ContentRefinementEngine();
      const estimate = engine.estimate();
      return res.json({ success: true, dryRun: true, ...estimate });
    }
    res.json({ success: true, message: 'Content refinement started.' });
    const engine = new ContentRefinementEngine();
    const result = await engine.refineAll();
    logger.info({ result }, '[REFINE] Batch complete.');
  } catch (error) {
    logger.error(error as any);
  }
});

// API: Refinement status / cost estimate (no tokens spent)
app.get('/api/refine/status', (req, res) => {
  try {
    const engine = new ContentRefinementEngine();
    res.json(engine.estimate());
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to get refinement status' });
  }
});

app.get('/api/embeddings/status', async (req, res) => {
  try {
    const baseDir = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase');
    
    function findAllMdFiles(dir: string): string[] {
      let results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      const list = fs.readdirSync(dir);
      for (const file of list) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat && stat.isDirectory()) {
              results = results.concat(findAllMdFiles(fullPath));
          } else if (file.endsWith('.md')) {
              results.push(fullPath);
          }
      }
      return results;
    }
    const allParsed = findAllMdFiles(baseDir);

    const stateFile = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase_State.json');
    let state: any = {};
    if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }

    const pending = [];
    const done = [];

    for (const file of allParsed) {
        const text = fs.readFileSync(file, 'utf-8');
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        if (state[file] !== hash) {
            pending.push(path.basename(file));
        } else {
            done.push(path.basename(file));
        }
    }

    res.json({
      total: allParsed.length,
      done,
      pending
    });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// API: RAG similarity search (returns matching chunks)
app.post('/api/rag/query', async (req, res) => {
  try {
    const { query, topK, courseFolder } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'A "query" string is required.' });
    }
    const engine = new RAGQueryEngine();
    const results = await engine.search(query, { topK, courseFolder });
    res.json({ results });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'RAG query failed' });
  }
});

// API: RAG answer (retrieval + Gemini synthesis with citations)
app.post('/api/rag/answer', async (req, res) => {
  try {
    const { query, topK, courseFolder } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'A "query" string is required.' });
    }
    const engine = new RAGQueryEngine();
    const result = await engine.answer(query, { topK, courseFolder });
    res.json(result);
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'RAG answer failed' });
  }
});

app.get('/api/embeddings/stats', async (req, res) => {
  try {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(documentChunks);
    const totalChunks = result[0]?.count || 0;
    res.json({ totalChunks });
  } catch (error) {
    logger.error(error as any);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export function startApiServer(port: number = 3000) {
  app.listen(port, () => {
    logger.info(`[API] REST Server listening on port ${port}`);
  });
}
