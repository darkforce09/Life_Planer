import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import { sanitize } from '../utils/piiSanitizer.js';
import { getSensorConfig } from '../db/sensorConfigStore.js';
import { createOutlookDraft, type OutlookConfig } from '../sensors/OutlookIntegrationService.js';

const EMAIL_MODEL = 'gemini-2.5-flash';

export type EmailAgentContext = Readonly<{
  apiKey?: string;
}>;

export interface DraftedEmail {
  subject: string;
  body: string;
  draftId: string | null;
}

/**
 * Drafts a context-aware email with Gemini (replacing the old static template),
 * runs every prompt fragment through the PII sanitizer first, and saves the
 * result as an Outlook draft for manual review. Sending is never automatic.
 */
export async function draftApologyEmail(
  context: EmailAgentContext,
  professorEmail: string,
  taskTitle: string,
  studentName: string,
): Promise<DraftedEmail> {
  logger.info(`[AGENT-EMAIL] Drafting context-aware email for missed task: "${taskTitle}"`);

  const apiKey = context.apiKey || process.env.GEMINI_API_KEY;
  const safeTask = sanitize(taskTitle);
  const safeName = sanitize(studentName);

  let subject = `Update regarding ${safeTask}`;
  let body =
    `Dear Professor,\n\nI am writing to sincerely apologize. I have missed the deadline for ` +
    `"${safeTask}". I take full responsibility and will submit the required materials as soon as possible.\n\n` +
    `Best regards,\n${safeName}`;

  if (apiKey && apiKey !== 'mock-key') {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = sanitize(
        `You are drafting a polite, concise, professional apology email from a university student ` +
          `to their professor about a missed deadline for the task "${safeTask}". ` +
          `The student's name is "${safeName}". ` +
          `Respond with strict JSON: {"subject": string, "body": string}. Do not invent excuses or facts.`,
      );
      const response = await ai.models.generateContent({ model: EMAIL_MODEL, contents: prompt });
      const match = (response.text || '').match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
        if (parsed.subject) subject = parsed.subject;
        if (parsed.body) body = parsed.body;
      }
    } catch (error) {
      logger.error({ err: error }, '[AGENT-EMAIL] Gemini drafting failed; falling back to template.');
    }
  }

  // Save as an Outlook draft (never auto-send).
  let draftId: string | null = null;
  try {
    const outlook = await getSensorConfig<{ graphApiToken?: string }>('outlook');
    if (outlook?.graphApiToken) {
      const cfg: OutlookConfig = { name: 'outlook', graphApiToken: outlook.graphApiToken };
      draftId = await createOutlookDraft(cfg, professorEmail, subject, body);
    } else {
      logger.warn('[AGENT-EMAIL] Outlook not configured; draft kept in-memory only.');
    }
  } catch (error) {
    logger.error({ err: error }, '[AGENT-EMAIL] Failed to save Outlook draft.');
  }

  logger.info(`[AGENT-EMAIL] Drafted email to ${professorEmail} (subject: "${subject}").`);
  return { subject, body, draftId };
}
