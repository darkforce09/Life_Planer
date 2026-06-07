import fs from 'fs';
import path from 'path';
import os from 'os';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { logger } from '../utils/logger.js';

export class ExternalScraper {
    private canvasDir: string;
    private turndownService: TurndownService;
    private knownDomains = ['vardhandboken.se', 'lakemedelsboken.se', '1177.se', 'kunskapsstodforvardgivare.se'];

    constructor() {
        this.canvasDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
        this.turndownService = new TurndownService({ headingStyle: 'atx' });
    }

    private findAllMdFiles(dir: string, fileList: string[] = []): string[] {
        if (!fs.existsSync(dir)) return fileList;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                this.findAllMdFiles(filePath, fileList);
            } else if (file.endsWith('.md')) {
                fileList.push(filePath);
            }
        }
        return fileList;
    }

    private extractUrls(text: string): string[] {
        // Find basic URL patterns
        const urlRegex = /(https?:\/\/[^\s<)"]+)/g;
        const matches = text.match(urlRegex) || [];
        return matches.filter(url => this.knownDomains.some(domain => url.includes(domain)));
    }

    private sanitizeName(name: string): string {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
    }

    private async scrapeUrl(url: string): Promise<{ title: string, content: string } | null> {
        try {
            logger.info(`[EXTERNAL-SCRAPER] Fetching: ${url}`);
            const response = await fetch(url);
            if (!response.ok) return null;
            const html = await response.text();
            
            const doc = new JSDOM(html, { url });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();
            
            if (!article || !article.content) return null;
            
            const markdown = this.turndownService.turndown(article.content);
            return { title: article.title || 'Untitled', content: markdown };
        } catch (error) {
            logger.error(`[EXTERNAL-SCRAPER] Failed to scrape ${url}: ${error}`);
            return null;
        }
    }

    public async run() {
        logger.info('[EXTERNAL-SCRAPER] Starting scan for external links in CanvasSync...');
        const allMdFiles = this.findAllMdFiles(this.canvasDir);
        
        const scrapedUrls = new Set<string>();

        // We also want to keep track of files already generated so we don't scrape twice if the file exists
        // However, if the file exists, we don't want to skip it if we haven't scraped the URL yet,
        // so we'll check if the target path exists.

        for (const mdFile of allMdFiles) {
            if (mdFile.includes('_external_')) continue;

            const text = fs.readFileSync(mdFile, 'utf-8');
            const urls = this.extractUrls(text);

            for (const url of urls) {
                const cleanUrl = url.replace(/[\)\]\}\.\,]+$/, '');
                
                if (scrapedUrls.has(cleanUrl)) continue;
                scrapedUrls.add(cleanUrl);

                const article = await this.scrapeUrl(cleanUrl);
                if (article && article.content.trim() !== '') {
                    const dir = path.dirname(mdFile);
                    const urlParts = cleanUrl.split('/').filter(p => p.length > 0);
                    const lastUrlPart = urlParts.slice(-2).join('-');
                    
                    const safeTitle = this.sanitizeName(article.title) || 'ExternalSource';
                    const targetPath = path.join(dir, `_external_${safeTitle} - ${this.sanitizeName(lastUrlPart)}.md`);
                    
                    // Always overwrite/save it
                    let mdContent = `# ${article.title}\n\n`;
                    mdContent += `*Source: ${cleanUrl}*\n\n`;
                    mdContent += article.content;

                    fs.writeFileSync(targetPath, mdContent);
                    logger.info(`[EXTERNAL-SCRAPER] Saved external source: ${path.basename(targetPath)}`);
                }
            }
        }
        logger.info('[EXTERNAL-SCRAPER] Finished.');
    }
}
