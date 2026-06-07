import { chromium, Page, Browser } from 'playwright';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { FileSyncEngine } from '../engine/FileSyncEngine.js';
import { VideoBot } from './VideoBot.js';
import path from 'path';
import os from 'os';

export class CanvasBot {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private fileSync: FileSyncEngine;
    private videoBot: VideoBot | null = null;

    constructor() {
        this.fileSync = new FileSyncEngine();
    }

    private async authenticate(username?: string, password?: string): Promise<boolean> {
        if (!username || !password) {
            logger.warn('[SENSOR-CANVAS] No credentials provided.');
            return false;
        }

        this.browser = await chromium.launch({ headless: true });
        const context = await this.browser.newContext({ locale: 'en-GB' });
        this.page = await context.newPage();

        logger.info('[SENSOR-CANVAS] Navigating to Canvas...');
        await this.page.goto('https://miun.instructure.com/');
        await this.page.waitForTimeout(3000);

        const currentUrl = this.page.url();
        if (currentUrl.includes('fs.miun.se/adfs/ls/')) {
            logger.info('[SENSOR-CANVAS] Entering credentials at Miun IdP...');
            await this.page.waitForSelector('#userNameInput', { state: 'visible', timeout: 15000 });
            await this.page.fill('#userNameInput', username);
            await this.page.fill('#passwordInput', password);
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(3000);
        } else {
            logger.warn('[SENSOR-CANVAS] Unrecognized login page: ' + currentUrl);
        }

        logger.info('[SENSOR-CANVAS] Waiting for Canvas Dashboard...');
        try {
            await this.page.waitForURL(/instructure\.com/, { timeout: 30000 });
            return true;
        } catch (e) {
            logger.warn('[SENSOR-CANVAS] Could not confirm login success. URL: ' + this.page.url());
            return false;
        }
    }

    /**
     * Runs the deep scrape.
     * @param courseFilters Optional list of substrings (e.g. course codes like
     *   'MV038G'). When provided, only courses whose name contains one of these
     *   are scraped. When empty, all active courses are scraped.
     */
    public async runScraper(username?: string, password?: string, courseFilters: string[] = []) {
        logger.info('[SENSOR-CANVAS] Starting Deep Scrape...');
        if (courseFilters.length > 0) {
            logger.info(`[SENSOR-CANVAS] Course filter active: ${courseFilters.join(', ')}`);
        }

        const success = await this.authenticate(username, password);
        if (!success || !this.page) {
            logger.error('[SENSOR-CANVAS] Authentication failed.');
            if (this.browser) await this.browser.close();
            return;
        }

        try {
            logger.info('[SENSOR-CANVAS] Navigating to active courses...');
            // In Canvas, the dashboard usually lists active courses
            await this.page.goto('https://miun.instructure.com/courses');
            await this.page.waitForLoadState('networkidle');

            // Find all course links
            const courses = await this.page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tr.course-list-table-row'));
                return rows.map(row => {
                    const nameSpan = row.querySelector('.name');
                    const link = nameSpan ? nameSpan.closest('a') as HTMLAnchorElement : null;
                    const name = nameSpan ? nameSpan.textContent?.trim() || '' : '';
                    const href = link ? link.href : '';
                    return { name, href };
                }).filter(c => c.href !== '');
            });

            logger.info(`[SENSOR-CANVAS] Found ${courses.length} courses.`);

            for (const course of courses) {
                if (
                    courseFilters.length > 0 &&
                    !courseFilters.some((f) => course.name.includes(f))
                ) {
                    logger.info(`[SENSOR-CANVAS] Skipping course ${course.name} (not in course filter)`);
                    continue;
                }

                logger.info(`[SENSOR-CANVAS] Scraping course: ${course.name}`);
                await this.scrapeCourse(course.name, course.href);
            }

        } catch (error) {
            logger.error({ err: error }, '[SENSOR-CANVAS] Scraper error');
        } finally {
            if (this.browser) await this.browser.close();
        }
    }

    private async scrapeCourse(courseName: string, courseHref: string) {
        if (!this.page) return;

        // Go to course homepage
        await this.page.goto(courseHref);
        await this.page.waitForLoadState('networkidle');

        // Extract sidebar navigation
        const navItems = await this.page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('#section-tabs a'));
            return links.map(link => ({
                title: link.textContent?.trim() || '',
                href: (link as HTMLAnchorElement).href
            }));
        });

        for (const item of navItems) {
            if (item.title === 'IgniteAI Search') {
                logger.info(`[SENSOR-CANVAS] Skipping section ${item.title}`);
                continue;
            }

            logger.info(`[SENSOR-CANVAS] Scraping section: ${item.title}`);
            try {
                if (item.title === 'Moduler') {
                    await this.scrapeModules(courseName, item.title, item.href);
                } else if (item.title === 'Anslag' || item.title === 'Uppgifter' || item.title === 'Diskussioner') {
                    await this.scrapeListSection(courseName, item.title, item.href);
                } else if (item.title === 'Kursöversikt' || item.title === 'Start' || item.title === 'Startsida') {
                    await this.scrapeSinglePage(courseName, item.title, item.href);
                } else {
                    // Zoom meeting, Kursvärdering, Personer, Omdömen etc.
                    this.fileSync.saveLinkAsMarkdown(courseName, item.title, item.title, item.href);
                }
            } catch (err) {
                logger.error({ err }, `[SENSOR-CANVAS] Failed to scrape section: ${item.title}`);
            }
        }
    }

    private async scrapeSinglePage(courseName: string, sectionName: string, sectionHref: string) {
        if (!this.page) return;
        await this.page.goto(sectionHref);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);

        const context = this.page.context();
        const cookies = await context.cookies();

        const htmlContent = await this.page.evaluate(() => {
            const frontPage = document.querySelector('.show-content.user_content') || document.querySelector('#wiki_page_show .user_content');
            if (frontPage) return frontPage.innerHTML;
            
            const contentElements = Array.from(document.querySelectorAll('.user_content')).filter(el => !el.closest('.ic-announcement-row'));
            return contentElements.length > 0 ? contentElements[contentElements.length - 1].innerHTML : '';
        });

        if (htmlContent) {
            await this.fileSync.saveAsMarkdown(courseName, sectionName, null, 'index', htmlContent, cookies);
        } else {
            logger.warn(`[SENSOR-CANVAS] No user_content found for single page section ${sectionName}`);
            this.fileSync.saveLinkAsMarkdown(courseName, sectionName, sectionName, sectionHref);
        }
    }

    private async scrapeListSection(courseName: string, sectionName: string, sectionHref: string) {
        if (!this.page) return;
        await this.page.goto(sectionHref);
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        const context = this.page.context();
        const cookies = await context.cookies();

        // We try to find common list items depending on the view
        const itemLinks = await this.page.evaluate(() => {
            // For Assignments
            let links = Array.from(document.querySelectorAll('.ig-title'));
            if (links.length === 0) {
                // For Announcements and Discussions
                links = Array.from(document.querySelectorAll('.discussion-title'));
            }
            if (links.length === 0) {
                // Fallback generic link search inside content area
                links = Array.from(document.querySelectorAll('.item-group-container a'));
            }

            return links.map(link => ({
                title: link.textContent?.trim() || 'Untitled',
                href: (link as HTMLAnchorElement).href
            })).filter(i => i.href && !i.href.includes('#'));
        });

        logger.info(`[SENSOR-CANVAS] Found ${itemLinks.length} items in ${sectionName}`);

        for (const item of itemLinks) {
            try {
                await this.page.goto(item.href);
                await this.page.waitForLoadState('domcontentloaded');
                await this.page.waitForTimeout(1000);

                const htmlContent = await this.page.evaluate(() => {
                    const contentEl = document.querySelector('.user_content');
                    return contentEl ? contentEl.innerHTML : '';
                });

                if (htmlContent) {
                    await this.fileSync.saveAsMarkdown(courseName, sectionName, null, item.title, htmlContent, cookies);
                } else {
                    this.fileSync.saveLinkAsMarkdown(courseName, sectionName, item.title, item.href);
                }
            } catch (err) {
                logger.error({ err }, `[SENSOR-CANVAS] Failed to scrape list item: ${item.title}`);
            }
        }
    }

    private async scrapeModules(courseName: string, sectionName: string, sectionHref: string) {
        if (!this.page) return;

        await this.page.goto(sectionHref);
        await this.page.waitForLoadState('networkidle');

        const hasModules = await this.page.locator('.item-group-condensed').count() > 0;
        if (!hasModules) return;

        const context = this.page.context();
        const cookies = await context.cookies();

        const moduleItems = await this.page.evaluate(() => {
            const items: { moduleName: string; title: string; href: string; type: string }[] = [];
            const moduleGroups = Array.from(document.querySelectorAll('.item-group-condensed'));
            for (const group of moduleGroups) {
                const moduleHeader = group.querySelector('.ig-header-title')?.textContent?.trim() || 'Untitled Module';
                const links = Array.from(group.querySelectorAll('li.context_module_item'));
                for (const li of links) {
                    const titleEl = li.querySelector('.ig-title') as HTMLAnchorElement;
                    if (!titleEl || !titleEl.href) continue;

                    let type = 'unknown';
                    if (li.classList.contains('attachment')) type = 'file';
                    else if (li.classList.contains('wiki_page')) type = 'page';
                    else if (li.classList.contains('assignment')) type = 'assignment';
                    else if (li.classList.contains('quiz')) type = 'quiz';

                    items.push({
                        moduleName: moduleHeader,
                        title: titleEl.textContent?.trim() || 'Untitled Item',
                        href: titleEl.href,
                        type
                    });
                }
            }
            return items;
        });

        for (const item of moduleItems) {
            try {
                if (item.type === 'page' || item.type === 'assignment') {
                    await this.page.goto(item.href);
                    await this.page.waitForLoadState('domcontentloaded');
                    await this.page.waitForTimeout(1000);

                    const htmlContent = await this.page.evaluate(() => {
                        const contentEl = document.querySelector('.user_content');
                        return contentEl ? contentEl.innerHTML : '';
                    });

                    if (htmlContent) {
                        // Check if the page has Kaltura video iframes
                        const hasKalturaVideos = htmlContent.includes('play.miun.se') && htmlContent.includes('external_tools');
                        
                        if (hasKalturaVideos) {
                            // Download videos via VideoBot before processing HTML
                            await this.downloadVideosForPage(item.href, courseName, sectionName, item.moduleName, item.title);
                        }

                        await this.fileSync.saveAsMarkdown(courseName, sectionName, item.moduleName, item.title, htmlContent, cookies);
                    }
                } else if (item.type === 'file') {
                    let downloadUrl = item.href;
                    if (downloadUrl.includes('/files/') && !downloadUrl.includes('download')) {
                        await this.page.goto(item.href);
                        await this.page.waitForLoadState('domcontentloaded');
                        await this.page.waitForTimeout(1000);
                        const directLink = await this.page.evaluate(() => {
                            const a = document.querySelector('a.auto_download_link') as HTMLAnchorElement;
                            return a ? a.href : '';
                        });
                        if (directLink) downloadUrl = directLink;
                    }
                    if (downloadUrl) {
                        await this.fileSync.downloadFile(courseName, sectionName, item.moduleName, item.title, downloadUrl, cookies);
                    }
                }
            } catch (err) {
                logger.error({ err }, `[SENSOR-CANVAS] Failed to process module item: ${item.title}`);
            }
        }
    }

    /**
     * Uses VideoBot v2 to download all videos from a Canvas page.
     * Videos are saved into the target directory that matches the page's location in the file tree.
     */
    private async downloadVideosForPage(pageUrl: string, courseName: string, sectionName: string, moduleName: string, itemTitle: string) {
        try {
            if (!this.videoBot) {
                this.videoBot = new VideoBot();
                await this.videoBot.initialize();
                await this.videoBot.authenticate();
            }

            const baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
            const sanitize = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim();
            const targetDir = path.join(
                baseDir,
                sanitize(courseName),
                sanitize(sectionName),
                sanitize(moduleName),
                sanitize(itemTitle)
            );

            const result = await this.videoBot.downloadAllFromPage(pageUrl, targetDir);
            logger.info(`[SENSOR-CANVAS] Video download complete for "${itemTitle}": ${result.downloaded.length} downloaded, ${result.failed.length} failed`);
        } catch (err) {
            logger.error({ err }, `[SENSOR-CANVAS] Failed to download videos for page: ${itemTitle}`);
        }
    }
}
