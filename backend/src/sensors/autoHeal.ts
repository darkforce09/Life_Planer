import type { Page } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import { recordAlert } from '../utils/alerts.js';

const VISION_MODEL = 'gemini-2.5-flash';

/**
 * Vision-AI auto-healing for Playwright scrapers (per engineering_standards.md).
 *
 * When a rigid CSS selector breaks because a site changed its UI, we screenshot
 * the page and ask a Gemini Vision model for the pixel coordinates of the target
 * element, then click there. This keeps scrapers working across minor UI changes.
 *
 * @returns true if the heal attempt clicked something, false otherwise.
 */
export async function visionHealClick(page: Page, targetDescription: string): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('[AUTO-HEAL] No GEMINI_API_KEY; cannot run Vision-AI fallback.');
    return false;
  }

  logger.warn(`[AUTO-HEAL] Selector failed for "${targetDescription}". Engaging Vision-AI...`);
  try {
    const screenshot = await page.screenshot();
    const viewport = page.viewportSize() || { width: 1280, height: 720 };

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `The screenshot is ${viewport.width}x${viewport.height} pixels. ` +
                `Find the UI element best described as: "${targetDescription}". ` +
                `Respond with ONLY strict JSON: {"x": <number>, "y": <number>, "found": <boolean>} ` +
                `giving the pixel coordinates of the element center.`,
            },
            { inlineData: { mimeType: 'image/png', data: screenshot.toString('base64') } },
          ],
        },
      ],
    });

    const text = response.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.error('[AUTO-HEAL] Vision model returned no JSON.');
      return false;
    }
    const coords = JSON.parse(match[0]) as { x: number; y: number; found: boolean };
    if (!coords.found || typeof coords.x !== 'number' || typeof coords.y !== 'number') {
      logger.error('[AUTO-HEAL] Vision model could not locate the element.');
      return false;
    }

    logger.info(`[AUTO-HEAL] Vision located element at (${coords.x}, ${coords.y}). Clicking.`);
    await page.mouse.click(coords.x, coords.y);
    await recordAlert(
      `Auto-healing engaged for "${targetDescription}" - a scraper selector may be stale and should be reviewed.`,
      'warning',
      'auto-heal',
    );
    return true;
  } catch (error) {
    logger.error({ err: error }, '[AUTO-HEAL] Vision-AI fallback failed.');
    return false;
  }
}

/**
 * Clicks a selector, falling back to Vision-AI auto-healing if it is missing.
 * Raises an alert (inside visionHealClick) when healing is used.
 */
export async function resilientClick(
  page: Page,
  selector: string,
  description: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.click();
    return true;
  } catch {
    return visionHealClick(page, description);
  }
}
