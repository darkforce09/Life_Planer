import fs from 'fs';
import path from 'path';
import os from 'os';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { ExternalArchiver } from './ExternalArchiver.js';

export class FileSyncEngine {
    private baseDir: string;
    private turndownService: TurndownService;
    private externalArchiver: ExternalArchiver;

    constructor() {
        // Default to ~/Documents/CanvasSync
        this.baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });

        this.externalArchiver = new ExternalArchiver();
        this.ensureDir(this.baseDir);
    }

    /**
     * Helper to recursively create a directory if it doesn't exist
     */
    private ensureDir(dirPath: string) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            logger.info(`[FILE-SYNC] Created directory: ${dirPath}`);
        }
    }

    /**
     * Sanitizes a string to be used as a valid filename/folder name
     */
    private sanitizeName(name: string): string {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
    }

    /**
     * Saves a Canvas page/assignment HTML content as a Markdown file
     */
    public async saveAsMarkdown(courseName: string, sectionName: string, folderName: string | null, itemName: string, htmlContent: string, cookies: any[]) {
        try {
            const courseDir = path.join(this.baseDir, this.sanitizeName(courseName));
            let targetDir = path.join(courseDir, this.sanitizeName(sectionName));
            if (folderName) {
                targetDir = path.join(targetDir, this.sanitizeName(folderName));
            }
            const safeItemName = this.sanitizeName(itemName);
            
            // If the item has a specific name, create a dedicated folder for it
            // so its markdown file and inline assets are neatly grouped together.
            if (safeItemName && safeItemName !== 'index') {
                targetDir = path.join(targetDir, safeItemName);
            }
            
            this.ensureDir(targetDir);

            // Use index.md if we're in a dedicated folder, or if the name itself is index
            const mdFileName = (safeItemName && safeItemName !== 'index') ? 'index.md' : `${safeItemName}.md`;
            const mdFilePath = path.join(targetDir, mdFileName);

            // NEW: Process inline assets like images, files, and preserve iframes
            const processedHtml = await this.processInlineAssets(htmlContent, targetDir, cookies);

            // Convert HTML to Markdown
            const markdownContent = this.turndownService.turndown(processedHtml);
            
            // Add a title header
            const finalContent = `# ${itemName}\n\n${markdownContent}`;

            fs.writeFileSync(mdFilePath, finalContent, 'utf-8');
            logger.info(`[FILE-SYNC] Saved markdown: ${mdFilePath}`);
        } catch (error) {
            logger.error({ err: error }, `[FILE-SYNC] Failed to save markdown for ${itemName}`);
        }
    }

    /**
     * Saves a simple markdown file with a link to an external tool or page
     */
    public saveLinkAsMarkdown(courseName: string, sectionName: string, itemName: string, linkHref: string) {
        try {
            const courseDir = path.join(this.baseDir, this.sanitizeName(courseName));
            const targetDir = path.join(courseDir, this.sanitizeName(sectionName));
            
            this.ensureDir(targetDir);

            const safeItemName = this.sanitizeName(itemName);
            const mdFilePath = path.join(targetDir, `${safeItemName}.md`);

            const finalContent = `# ${itemName}\n\n[Open in Canvas](${linkHref})`;

            fs.writeFileSync(mdFilePath, finalContent, 'utf-8');
            logger.info(`[FILE-SYNC] Saved link markdown: ${mdFilePath}`);
        } catch (error) {
            logger.error({ err: error }, `[FILE-SYNC] Failed to save link markdown for ${itemName}`);
        }
    }

    /**
     * Downloads an actual file (PDF, PPT, etc.) to the local sync directory
     */
    public async downloadFile(courseName: string, sectionName: string, folderName: string | null, fileName: string, downloadUrl: string, cookies: any[]) {
        try {
            const courseDir = path.join(this.baseDir, this.sanitizeName(courseName));
            let targetDir = path.join(courseDir, this.sanitizeName(sectionName));
            if (folderName) {
                targetDir = path.join(targetDir, this.sanitizeName(folderName));
            }
            
            this.ensureDir(targetDir);

            const safeFileName = this.sanitizeName(fileName);
            const filePath = path.join(targetDir, safeFileName);

            // If file already exists, don't re-download it to save bandwidth (basic check)
            if (fs.existsSync(filePath)) {
                logger.info(`[FILE-SYNC] File already exists, skipping: ${filePath}`);
                return;
            }

            // Convert Playwright cookies to a string for fetch
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            logger.info(`[FILE-SYNC] Downloading file: ${fileName} from ${downloadUrl}`);
            const response = await fetch(downloadUrl, {
                headers: {
                    'Cookie': cookieString,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to download file, status: ${response.status}`);
            }

            const buffer = await response.arrayBuffer();
            fs.writeFileSync(filePath, Buffer.from(buffer));
            
            logger.info(`[FILE-SYNC] Saved file: ${filePath}`);
        } catch (error) {
            logger.error({ err: error }, `[FILE-SYNC] Failed to download file ${fileName}`);
        }
    }

    /**
     * Processes inline assets inside HTML before converting to markdown.
     */
    private async processInlineAssets(html: string, targetDir: string, cookies: any[]): Promise<string> {
        const $ = cheerio.load(html);
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        const downloadAsset = async (url: string, prefix: string, suggestedName: string): Promise<string | null> => {
            if (!url.startsWith('http') && !url.startsWith('/')) return null;
            if (url.startsWith('/')) url = `https://miun.instructure.com${url}`;

            try {
                let fileName = suggestedName || `${prefix}_${Date.now()}`;
                if (!fileName.includes('.')) {
                    fileName += prefix === 'img' ? '.png' : '.pdf'; // crude fallback
                }
                
                let safeFileName = this.sanitizeName(fileName);
                let filePath = path.join(targetDir, safeFileName);

                logger.info(`[FILE-SYNC] Downloading inline asset: ${url}`);
                const response = await fetch(url, {
                    headers: {
                        'Cookie': cookieString,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.ok) throw new Error(`Status ${response.status}`);

                // Try to get actual filename from headers
                const contentDisposition = response.headers.get('content-disposition');
                if (contentDisposition && contentDisposition.includes('filename=')) {
                    const match = contentDisposition.match(/filename="?([^";]+)"?/);
                    if (match && match[1]) {
                        safeFileName = this.sanitizeName(match[1]);
                        filePath = path.join(targetDir, safeFileName);
                    }
                }

                if (!fs.existsSync(filePath)) {
                    const buffer = await response.arrayBuffer();
                    fs.writeFileSync(filePath, Buffer.from(buffer));
                }

                // Return a relative path for the markdown link
                return `./${encodeURIComponent(safeFileName)}`;
            } catch (err) {
                logger.error({ err }, `[FILE-SYNC] Failed to download inline asset: ${url}`);
                return null;
            }
        };

        // 1. Process images
        const images = $('img').toArray();
        for (const img of images) {
            const src = $(img).attr('src');
            if (!src) continue;
            
            const localName = await downloadAsset(src, 'img', src.split('/').pop()?.split('?')[0] || '');
            if (localName) {
                $(img).attr('src', localName);
            }
        }

        // 2. Process File links and External Web Links
        const links = $('a').toArray();
        for (const link of links) {
            let href = $(link).attr('href');
            if (!href) continue;
            
            if ($(link).hasClass('instructure_file_link') || href.includes('/files/')) {
                if (href.includes('/files/') && !href.includes('download')) {
                     href += href.includes('?') ? '&download=1' : '?download=1';
                }
                
                const linkText = $(link).text().trim() || 'Document';
                const localName = await downloadAsset(href, 'file', linkText);
                if (localName) {
                    $(link).attr('href', localName);
                }
            } else if (href.startsWith('http') && !href.includes('instructure.com')) {
                // External link - check if it's YouTube/Vimeo or PDF, or regular article
                const linkText = $(link).text().trim() || 'External Link';
                
                if (href.includes('youtube.com') || href.includes('youtu.be') || href.includes('vimeo.com')) {
                    const localVideo = await this.externalArchiver.downloadVideo(href, targetDir, linkText);
                    if (localVideo) {
                        $(link).attr('href', `./${encodeURIComponent(localVideo)}`);
                        $(link).text(`🎥 ${linkText}`);
                    }
                } else if (href.endsWith('.pdf') || href.endsWith('.docx') || href.endsWith('.pptx')) {
                    // Try downloading external document as a regular file
                    const localDoc = await downloadAsset(href, 'file', linkText);
                    if (localDoc) {
                        $(link).attr('href', localDoc);
                    }
                } else {
                    // It's a regular web article/page, try to scrape it
                    const localArticle = await this.externalArchiver.scrapeArticle(href, targetDir);
                    if (localArticle) {
                        $(link).attr('href', `./${encodeURIComponent(localArticle)}`);
                        $(link).text(`📄 ${linkText}`);
                    }
                }
            }
        }

        // 3. Process iframes (Videos/External Tools)
        // Video downloads are now handled at the page level by VideoBot v2.
        // Here we just check if a matching video file already exists in the target directory
        // and link to it, or fall back to the original iframe URL.
        const iframes = $('iframe').toArray();

        for (const iframe of iframes) {
            const src = $(iframe).attr('src');
            const title = $(iframe).attr('title') || 'Embedded Video';
            if (src) {
                if (src.includes('external_tools') && src.includes('play.miun.se')) {
                    // Check if a matching video was already downloaded to targetDir
                    const existingVideos = fs.existsSync(targetDir) 
                        ? fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4'))
                        : [];
                    
                    if (existingVideos.length > 0) {
                        // Try to find a video matching the title
                        const safeTitle = this.sanitizeName(title);
                        const match = existingVideos.find(f => f.includes(safeTitle));
                        const videoFile = match || existingVideos[0];
                        $(iframe).replaceWith(`<a href="./${encodeURIComponent(videoFile)}">🎥 ${title}</a>`);
                        continue;
                    }
                } else if (src.includes('youtube.com') || src.includes('vimeo.com')) {
                    const localVideo = await this.externalArchiver.downloadVideo(src, targetDir, title);
                    if (localVideo) {
                        $(iframe).replaceWith(`<a href="./${encodeURIComponent(localVideo)}">🎥 ${title}</a>`);
                        continue;
                    }
                }
                
                // Fallback for non-Kaltura or non-downloaded videos
                $(iframe).replaceWith(`<a href="${src}">🎥 ${title}</a>`);
            }
        }

        return $.html();
    }
}
