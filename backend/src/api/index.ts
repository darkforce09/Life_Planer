import express from 'express';
import cors from 'cors';
import { db } from '../db/index.js';
import { tasks, sensorConfigs } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { desc, eq } from 'drizzle-orm';
import { TimeEditService } from '../sensors/TimeEditService.js';

export const app = express();
app.use(cors());
app.use(express.json());

// In-memory log buffer for the admin UI
export const adminLogs: any[] = [];
const originalInfo = logger.info;
logger.info = (msg, ...args) => {
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

    const scraper = new TimeEditService(timeEditUrl, 'demo-user-id');
    await scraper.sync();
    res.json({ success: true, message: 'Sensors synchronized.' });
  } catch (error) {
    logger.error('Sync failed', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// API: Get Sensor Config
app.get('/api/sensors/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const configResult = await db.select().from(sensorConfigs).where(eq(sensorConfigs.id, id));
    if (configResult.length > 0) {
      res.json(JSON.parse(configResult[0].config));
    } else {
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// API: Update Sensor Config
app.put('/api/sensors/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const configStr = JSON.stringify(req.body);
    
    // Upsert logic
    const existing = await db.select().from(sensorConfigs).where(eq(sensorConfigs.id, id));
    if (existing.length > 0) {
      await db.update(sensorConfigs).set({ config: configStr, updatedAt: new Date() }).where(eq(sensorConfigs.id, id));
    } else {
      await db.insert(sensorConfigs).values({ id, config: configStr });
    }
    
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
    logger.error('Failed to fetch tasks', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// API: Update Task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, deadline, priorityScore } = req.body;
    
    await db.update(tasks)
      .set({ 
        title, 
        description, 
        deadline: new Date(deadline), 
        priorityScore: parseInt(priorityScore) 
      })
      .where(eq(tasks.id, id));
      
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update task', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// API: System Health Check & Telemetry
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    sensors: {
      canvas: 'ok',
      timeedit: 'ok',
      outlook: 'pending'
    },
    recentLogs: []
  });
});

export function startApiServer(port: number = 3000) {
  app.listen(port, () => {
    logger.info(`[API] REST Server listening on port ${port}`);
  });
}
