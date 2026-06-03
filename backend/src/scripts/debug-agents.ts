import { StudyGuideAgent } from '../agents/StudyGuideAgent.js';
import { EmailAgent } from '../agents/EmailAgent.js';
import { logger } from '../utils/logger.js';

async function runAgents() {
  logger.info('--- BOOTING AUTONOMOUS AGENT PROTOCOLS ---');
  
  // 1. Trigger the Study Guide Agent for a high-priority task
  const guideAgent = new StudyGuideAgent();
  await guideAgent.generateGuide('Anatomy 101', 'Cellular Respiration');
  
  // 2. Trigger the Email Agent for a missed task
  const emailAgent = new EmailAgent();
  await emailAgent.draftApologyEmail('dr.smith@miun.se', 'Final Anatomy Essay', 'Test Student');
  
  logger.info('--- ALL AGENT PROTOCOLS EXECUTED SUCCESSFULLY ---');
}

runAgents().catch(err => {
  logger.error('Agent execution failed:', err);
  process.exit(1);
});
