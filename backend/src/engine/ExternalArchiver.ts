import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { chromium, Browser, BrowserContext } from 'playwright';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { logger } from '../utils/logger.js';

const execAsync = util.promisify(exec);

export class ExternalArchiver {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;

    async initialize() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
            this.context = await this.browser.newContext();
        }
    }

    async close() {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
    }

    private sanitizeName(name: string): string {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
    }

    /**
     * Downloads YouTube or Vimeo videos using yt-dlp.
     */
    async downloadVideo(url: string, targetDir: string, title?: string): Promise<string | null> {
        try {
            const fileNameTemplate = title ? `${this.sanitizeName(title)}.%(ext)s` : '%(title)s.%(ext)s';
            const outputPath = path.join(targetDir, fileNameTemplate);
            
            logger.info(`[EXTERNAL-ARCHIVER] Downloading external video: ${url}`);
            
            const ytDlpPath = path.resolve(process.cwd(), 'yt-dlp');
            const cmd = `"${ytDlpPath}" --no-warnings -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${outputPath}" "${url}"`;
            
            await execAsync(cmd);
            
            // Try to find the downloaded file
            const files = fs.readdirSync(targetDir);
            // Since we don't know the exact resolved title if we didn't provide one, 
            // we might have to do some fuzzy matching. But wait, if we provided a title, we know it's .mp4.
            if (title) {
                const expectedPath = path.join(targetDir, `${this.sanitizeName(title)}.mp4`);
                if (fs.existsSync(expectedPath)) {
                    return `${this.sanitizeName(title)}.mp4`;
                }
            }
            // If we didn't provide a title, return the most recently created mp4? 
            // Let's just assume yt-dlp outputs something.
            return null; // Return null so the calling code keeps the URL if we can't find local name
        } catch (err) {
            logger.error({ err, url }, `[EXTERNAL-ARCHIVER] Failed to download external video`);
            return null;
        }
    }

    /**
     * Scrapes an external article and saves it as Markdown.
     */
    async scrapeArticle(url: string, targetDir: string): Promise<string | null> {
        try {
            if (!this.context) await this.initialize();
            
            logger.info(`[EXTERNAL-ARCHIVER] Scraping external article: ${url}`);
            
            const page = await this.context!.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            const content = await page.content();
            await page.close();

            const doc = new JSDOM(content, { url }).window.document;
            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article || !article.textContent) {
                return null;
            }

            const title = this.sanitizeName(article.title || 'External_Article');
            
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            const markdownContent = article.content ? turndownService.turndown(article.content) : '';
            
            const markdown = `# ${article.title}\n\n**Source:** ${url}\n\n${markdownContent}`;
            
            const fileName = `${title}.md`;
            const filePath = path.join(targetDir, fileName);
            fs.writeFileSync(filePath, markdown);
            
            logger.info(`[EXTERNAL-ARCHIVER] Saved article: ${fileName}`);
            return fileName;

        } catch (err) {
            logger.error({ err, url }, `[EXTERNAL-ARCHIVER] Failed to scrape external article`);
            return null;
        }
    }
}
