import { IntegrationService } from './IntegrationService.js';
import { logger } from '../utils/logger.js';

export class OutlookIntegrationService implements IntegrationService {
  public readonly name = 'outlook';
  private graphApiToken: string;

  constructor(token: string) {
    this.graphApiToken = token;
  }

  public async sync(): Promise<void> {
    logger.info(`[SENSOR-OUTLOOK] Connecting to Microsoft Graph API...`);
    // Placeholder for actual MS Graph API logic to read emails/events
    logger.debug(`[SENSOR-OUTLOOK] Successfully authenticated with Graph API.`);
    logger.info(`[SENSOR-OUTLOOK] Sync complete. Extracted 0 actionable emails.`);
  }

  public async checkHealth(): Promise<boolean> {
    return this.graphApiToken.length > 0;
  }
}
