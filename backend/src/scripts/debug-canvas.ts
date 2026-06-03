import { CanvasLMSService } from '../sensors/CanvasLMSService.js';
import { logger } from '../utils/logger.js';

async function runDebug() {
  logger.level = 'debug';
  logger.info('--- RUNNING CANVAS SCRAPER IN DEBUG MODE ---');
  
  // Create an instance of the Canvas scraper
  const service = new CanvasLMSService('https://miun.instructure.com/login/canvas');
  
  try {
    await service.sync();
    logger.info('--- DEBUG RUN SUCCESSFUL ---');
  } catch (err) {
    logger.error('--- DEBUG RUN FAILED ---', err);
  }
}

runDebug();
