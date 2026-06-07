import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getSensorConfig } from '../db/sensorConfigStore.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Represents a single video discovered on a Canvas page.
 */
interface KalturaVideoInfo {
    entryId: string;
    name: string;
    duration: number;       // seconds
    downloadUrl: string;    // direct MP4 download URL
    hlsUrl: string;         // HLS m3u8 URL (fallback)
}

/**
 * VideoBot v2 — Kaltura API Interception Engine
 *
 * Instead of trying to click play buttons and intercept stream requests,
 * this bot intercepts the Kaltura `multirequest` API responses which contain
 * all video metadata and direct download URLs *before* any playback starts.
 *
 * Flow:
 *   1. Authenticate with Canvas via Playwright (ADFS SSO)
 *   2. Navigate to a Canvas page containing embedded Kaltura videos
 *   3. Handle any ADFS re-auth prompts inside iframes
 *   4. Intercept the `api_v3/service/multirequest` responses
 *   5. Parse the JSON to extract video name, entryId, and direct MP4 URL
 *   6. Download videos using the authenticated browser session cookies
 */
export class VideoBot {
    private username = '';
    private password = '';
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private isAuthenticated = false;

    /**
     * Load credentials from the database.
     */
    public async initialize() {
        const config = await getSensorConfig<{ username?: string; password?: string }>('ladok');
        if (!config?.username || !config?.password) {
            throw new Error("Ladok credentials not found, cannot authenticate VideoBot.");
        }
        this.username = config.username;
        this.password = config.password;
    }

    /**
     * Launch browser and authenticate with Canvas/ADFS.
     * The session is kept alive for batch processing.
     */
    public async authenticate(): Promise<boolean> {
        if (this.isAuthenticated && this.page) return true;

        logger.info('[VIDEO-BOT] Launching browser...');
        this.browser = await chromium.launch({
            headless: true,
            args: [
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();

        logger.info('[VIDEO-BOT] Authenticating with Canvas...');
        await this.page.goto('https://miun.instructure.com/login/canvas');
        await this.page.waitForTimeout(2000);

        if (this.page.url().includes('fs.miun.se')) {
            await this.page.fill('#userNameInput', this.username);
            await this.page.fill('#passwordInput', this.password);
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(4000);
        }

        // Verify we're on Canvas
        if (this.page.url().includes('instructure.com')) {
            this.isAuthenticated = true;
            logger.info('[VIDEO-BOT] Authentication successful.');
            return true;
        }

        logger.error('[VIDEO-BOT] Authentication failed. URL: ' + this.page.url());
        return false;
    }

    /**
     * Navigate to a Canvas page and extract all Kaltura video info
     * by intercepting the multirequest API responses.
     */
    public async extractVideosFromPage(pageUrl: string): Promise<KalturaVideoInfo[]> {
        if (!this.page) throw new Error('VideoBot not authenticated. Call authenticate() first.');

        const videos: KalturaVideoInfo[] = [];
        const seenEntryIds = new Set<string>();

        // Set up response interceptor for Kaltura API
        const responseHandler = async (response: any) => {
            try {
                const url = response.url();
                if (!url.includes('api_v3/service/multirequest')) return;

                const contentType = response.headers()['content-type'] || '';
                if (!contentType.includes('json') && !contentType.includes('text')) return;

                const text = await response.text();
                if (!text.includes('KalturaMediaEntry')) return;

                // Parse the JSON response
                let data: any[];
                try {
                    data = JSON.parse(text);
                } catch {
                    return;
                }

                if (!Array.isArray(data)) return;

                // Walk through the response array looking for KalturaMediaEntry and KalturaPlaybackContext
                let currentEntry: { entryId: string; name: string; duration: number } | null = null;

                for (const item of data) {
                    // Find the media entry metadata
                    if (item?.objectType === 'KalturaBaseEntryListResponse' && item.objects) {
                        for (const obj of item.objects) {
                            if (obj?.objectType === 'KalturaMediaEntry') {
                                currentEntry = {
                                    entryId: obj.id,
                                    name: obj.name || `Video_${obj.id}`,
                                    duration: obj.duration || 0
                                };
                            }
                        }
                    }

                    // Find the playback sources and flavors
                    if (item?.objectType === 'KalturaPlaybackContext' && item.sources && currentEntry) {
                        if (seenEntryIds.has(currentEntry.entryId)) {
                            currentEntry = null;
                            continue;
                        }

                        // Determine the best video flavor (highest width)
                        let bestFlavorId = '';
                        let maxWidth = -1;

                        if (item.flavorAssets && Array.isArray(item.flavorAssets)) {
                            for (const flavor of item.flavorAssets) {
                                const w = flavor.width || 0;
                                if (w > maxWidth) {
                                    maxWidth = w;
                                    bestFlavorId = flavor.id;
                                }
                            }
                        }

                        let mp4Url = '';
                        let hlsUrl = '';

                        for (const source of item.sources) {
                            let url = source.url || '';
                            
                            // If we found a specific high-res flavor, force the URL to only use that flavor
                            // The URL usually looks like .../flavorIds/id1,id2/...
                            if (bestFlavorId && url.includes('/flavorIds/')) {
                                url = url.replace(/\/flavorIds\/[^\/]+/, `/flavorIds/${bestFlavorId}`);
                            }

                            if (source.format === 'url') {
                                mp4Url = url;
                            } else if (source.format === 'applehttp') {
                                hlsUrl = url;
                            }
                        }

                        if (mp4Url || hlsUrl) {
                            seenEntryIds.add(currentEntry.entryId);
                            videos.push({
                                entryId: currentEntry.entryId,
                                name: currentEntry.name,
                                duration: currentEntry.duration,
                                downloadUrl: mp4Url,
                                hlsUrl: hlsUrl
                            });
                            logger.info(`[VIDEO-BOT] Discovered video: "${currentEntry.name}" (${currentEntry.entryId}) (Best Flavor: ${bestFlavorId || 'default'})`);
                        }

                        currentEntry = null;
                    }
                }
            } catch (e) {
                // Silently ignore response parsing errors
            }
        };

        this.page.on('response', responseHandler);

        try {
            logger.info(`[VIDEO-BOT] Navigating to: ${pageUrl}`);
            await this.page.goto(pageUrl);
            await this.page.waitForTimeout(8000);

            // Handle ADFS auth inside iframes
            await this.handleIframeAuth();

            // Wait for API responses to arrive
            logger.info('[VIDEO-BOT] Waiting for Kaltura API responses...');
            await this.page.waitForTimeout(8000);
        } finally {
            this.page.off('response', responseHandler);
        }

        logger.info(`[VIDEO-BOT] Extracted ${videos.length} video(s) from page.`);
        return videos;
    }

    /**
     * Download a single video to the specified file path using the browser session cookies.
     */
    public async downloadVideo(video: KalturaVideoInfo, outputFilePath: string): Promise<boolean> {
        if (!this.context) throw new Error('VideoBot not authenticated.');

        const url = video.downloadUrl || video.hlsUrl;
        if (!url) {
            logger.error(`[VIDEO-BOT] No download URL for video: ${video.name}`);
            return false;
        }

        // If file already exists, skip
        if (fs.existsSync(outputFilePath)) {
            logger.info(`[VIDEO-BOT] Already downloaded, skipping: ${outputFilePath}`);
            return true;
        }

        // Ensure parent directory exists
        const dir = path.dirname(outputFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        try {
            logger.info(`[VIDEO-BOT] Downloading "${video.name}" → ${outputFilePath}`);

            // Get cookies for authenticated download
            const cookies = await this.context.cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            // Use direct MP4 URL — this is a redirect that leads to the actual video file
            const response = await fetch(url, {
                headers: {
                    'Cookie': cookieString,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            fs.writeFileSync(outputFilePath, Buffer.from(buffer));

            const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(1);
            logger.info(`[VIDEO-BOT] ✅ Downloaded "${video.name}" (${sizeMB} MB)`);
            return true;

        } catch (error: any) {
            logger.error(`[VIDEO-BOT] ❌ Failed to download "${video.name}": ${error.message}`);
            return false;
        }
    }

    /**
     * High-level method: discover and download ALL videos from a Canvas page.
     */
    public async downloadAllFromPage(pageUrl: string, outputDir: string): Promise<{ downloaded: string[]; failed: string[] }> {
        const downloaded: string[] = [];
        const failed: string[] = [];

        const videos = await this.extractVideosFromPage(pageUrl);

        if (videos.length === 0) {
            logger.info('[VIDEO-BOT] No videos found on page.');
            return { downloaded, failed };
        }

        for (const video of videos) {
            const safeName = video.name.replace(/[/\\?%*:|"<>]/g, '-').trim();
            const fileName = `${safeName}.mp4`;
            const filePath = path.join(outputDir, fileName);

            const success = await this.downloadVideo(video, filePath);
            if (success) {
                downloaded.push(filePath);
            } else {
                failed.push(video.name);
            }
        }

        return { downloaded, failed };
    }

    /**
     * Handle ADFS authentication prompts that appear inside Kaltura player iframes.
     */
    private async handleIframeAuth() {
        if (!this.page) return;

        for (const frame of this.page.frames()) {
            if (frame.url().includes('fs.miun.se')) {
                logger.info('[VIDEO-BOT] Found ADFS auth in iframe, logging in...');
                try {
                    await frame.fill('#userNameInput', this.username);
                    await frame.fill('#passwordInput', this.password);
                    await frame.locator('#passwordInput').press('Enter');
                    await this.page.waitForTimeout(10000);
                } catch (e) {
                    logger.warn('[VIDEO-BOT] Failed to fill iframe ADFS form (may already be resolved).');
                }
                break; // Only need to handle one ADFS redirect
            }
        }
    }

    /**
     * Clean up browser resources.
     */
    public async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isAuthenticated = false;
        }
    }
}
