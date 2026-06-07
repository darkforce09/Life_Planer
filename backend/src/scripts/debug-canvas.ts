import 'dotenv/config';
import { CanvasBot } from '../sensors/CanvasBot.js';
import { getSensorConfig } from '../db/sensorConfigStore.js';
import { logger } from '../utils/logger.js';

async function runDebug() {
  logger.level = 'debug';
  logger.info('--- RUNNING CANVAS DEEP SCRAPER IN DEBUG MODE ---');

  try {
    const config = await getSensorConfig<{ username?: string; password?: string }>('ladok');
    if (!config?.username || !config?.password) {
      logger.error('No Ladok/Miun credentials configured. Set them via the admin UI first.');
      return;
    }
    const { username, password } = config;
    const bot = new CanvasBot();
    await bot.runScraper(username, password);
    logger.info('--- DEBUG RUN SUCCESSFUL ---');
  } catch (err) {
    logger.error({ err }, '--- DEBUG RUN FAILED ---');
  }
}

runDebug();
