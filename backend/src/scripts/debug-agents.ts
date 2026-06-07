import { generateGuide } from '../agents/StudyGuideAgent.js';
import { draftApologyEmail } from '../agents/EmailAgent.js';
import { logger } from '../utils/logger.js';

async function runAgents() {
  logger.info('--- BOOTING AUTONOMOUS AGENT PROTOCOLS ---');
  
  // 1. Trigger the Study Guide Agent for a high-priority task
  await generateGuide({ apiKey: process.env.GOOGLE_API_KEY || 'mock' }, 'Anatomy 101', 'Cellular Respiration');
  
  // 2. Trigger the Email Agent for a missed task
  await draftApologyEmail({ apiKey: process.env.GOOGLE_API_KEY || 'mock' }, 'dr.smith@miun.se', 'Final Anatomy Essay', 'Test Student');
  
  logger.info('--- ALL AGENT PROTOCOLS EXECUTED SUCCESSFULLY ---');
}

runAgents().catch(err => {
  logger.error({ err }, 'Agent execution failed');
  process.exit(1);
});
