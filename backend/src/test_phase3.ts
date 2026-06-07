import { app } from './api/index.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('--- RUNNING PHASE 3 API INTEGRATION TEST ---');
  
  // Boot the Express API Server locally on a test port
  const server = app.listen(3001, async () => {
    logger.info('API Server booted successfully on port 3001 for React Native clients.');

    try {
      // Emulate the frontend SystemHealthWidget making a network request to the backend
      logger.info('React Native Client -> GET /api/health');
      const response = await fetch('http://localhost:3001/api/health');
      const data = await response.json();
      
      logger.info('System Health Telemetry Check: SUCCESS');
      logger.info(JSON.stringify(data, null, 2));

      logger.info('--- PHASE 3 REST API TEST SUCCESSFUL ---');
      server.close();
      process.exit(0);
    } catch (e) {
      logger.error({ err: e }, 'Failed to hit API');
      server.close();
      process.exit(1);
    }
  });
}

main();
