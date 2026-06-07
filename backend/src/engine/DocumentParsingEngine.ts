import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { logger } from '../utils/logger.js';

export class DocumentParsingEngine {
    private baseDir: string;
    private ai: GoogleGenAI;

    constructor() {
        this.baseDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
        if (!process.env.GEMINI_API_KEY) {
            logger.warn('[DOCUMENT-PARSING] GEMINI_API_KEY is not set. Document parsing will fail.');
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    /**
     * Recursively find all supported documents in the base directory
     */
    private findFilesRecursive(dir: string, fileList: string[] = []): string[] {
        if (!fs.existsSync(dir)) return fileList;
        
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                this.findFilesRecursive(filePath, fileList);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (ext === '.pdf' || ext === '.docx') {
                    fileList.push(filePath);
                }
            }
        }
        return fileList;
    }

    /**
     * Scans for documents that don't have a parsed markdown version yet.
     */
    public scanForUnparsedDocuments(): string[] {
        const allDocs = this.findFilesRecursive(this.baseDir);
        const unparsed: string[] = [];

        for (const docPath of allDocs) {
            const dir = path.dirname(docPath);
            const basename = path.basename(docPath, path.extname(docPath));
            const parsedPath = path.join(dir, `${basename}_parsed.md`);

            if (!fs.existsSync(parsedPath)) {
                unparsed.push(docPath);
            }
        }

        // Sort by size ascending (parse smaller files first)
        return unparsed.sort((a, b) => {
            const sizeA = fs.statSync(a).size;
            const sizeB = fs.statSync(b).size;
            return sizeA - sizeB;
        });
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.pdf') return 'application/pdf';
        if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        return 'application/octet-stream';
    }

    /**
     * Parses a single document using the Gemini API
     */
    public async parseDocument(docPath: string): Promise<void> {
        const filename = path.basename(docPath);
        const ext = path.extname(docPath).toLowerCase();
        
        if (ext === '.docx') {
            logger.info(`[DOCUMENT-PARSING] Extracting DOCX locally: ${filename}`);
            const result = await mammoth.convertToHtml({ path: docPath });
            const turndownService = new TurndownService({ headingStyle: 'atx' });
            const markdown = turndownService.turndown(result.value);
            
            const dir = path.dirname(docPath);
            const basename = path.basename(docPath, path.extname(docPath));
            const parsedPath = path.join(dir, `${basename}_parsed.md`);
            fs.writeFileSync(parsedPath, markdown, 'utf-8');
            logger.info(`[DOCUMENT-PARSING] Successfully saved parsed docx: ${parsedPath}`);
            return;
        }

        logger.info(`[DOCUMENT-PARSING] Uploading to Gemini: ${filename}`);
        let uploadedFile: any = null;

        try {
            let uploadRetries = 0;
            while (uploadRetries < 3) {
                try {
                    uploadedFile = await this.ai.files.upload({
                        file: docPath,
                        config: { mimeType: this.getMimeType(docPath) },
                    });
                    break;
                } catch (uploadErr: any) {
                    if (uploadErr.status === 429 || uploadErr.status === 503) {
                        uploadRetries++;
                        logger.warn(`[DOCUMENT-PARSING] Upload Rate limit (status ${uploadErr.status}). Retrying ${uploadRetries}/3 in 30s...`);
                        await new Promise(r => setTimeout(r, 30000));
                        if (uploadRetries >= 3) throw uploadErr;
                    } else {
                        throw uploadErr;
                    }
                }
            }

            logger.info(`[DOCUMENT-PARSING] Parsing content for: ${filename}`);

            // Generate content with simple retry logic
            let response;
            let retries = 0;
            while (retries < 3) {
                try {
                    response = await this.ai.models.generateContent({
                        model: 'gemini-3.1-flash-lite',
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    { fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } },
                                    { text: 'Extract and transcribe all text, tables, and image contents from this document into clean Markdown.' }
                                ]
                            }
                        ]
                    });
                    break;
                } catch (apiErr: any) {
                    if (apiErr.status === 429 || apiErr.status === 503) {
                        retries++;
                        logger.warn(`[DOCUMENT-PARSING] Rate limit/Overload (status ${apiErr.status}). Retrying ${retries}/3 in 30s...`);
                        await new Promise(r => setTimeout(r, 30000));
                        if (retries >= 3) throw apiErr;
                    } else {
                        throw apiErr;
                    }
                }
            }

            const parsedText = response?.text || '';

            // Save the output
            const dir = path.dirname(docPath);
            const basename = path.basename(docPath, path.extname(docPath));
            const parsedPath = path.join(dir, `${basename}_parsed.md`);

            const finalContent = `# Parsed Document: ${filename}\n\n**Source:** ./${encodeURIComponent(filename)}\n**Parsed:** ${new Date().toISOString()}\n\n---\n\n${parsedText}`;
            fs.writeFileSync(parsedPath, finalContent, 'utf-8');

            logger.info(`[DOCUMENT-PARSING] Successfully saved parsed doc: ${parsedPath}`);
        } catch (error: any) {
            logger.error({ err: error }, `[DOCUMENT-PARSING] Failed to parse ${filename}`);
            throw error;
        } finally {
            // Cleanup cloud storage
            if (uploadedFile && uploadedFile.name) {
                try {
                    await this.ai.files.delete({ name: uploadedFile.name });
                    logger.info(`[DOCUMENT-PARSING] Deleted cloud file: ${uploadedFile.name}`);
                } catch (cleanupErr) {
                    logger.error({ err: cleanupErr }, `[DOCUMENT-PARSING] Failed to delete cloud file: ${uploadedFile.name}`);
                }
            }
        }
    }

    /**
     * Parses all unparsed documents sequentially.
     */
    public async parseAll(): Promise<{ done: number, failed: number, skipped: number }> {
        const pending = this.scanForUnparsedDocuments();
        
        if (pending.length === 0) {
            logger.info('[DOCUMENT-PARSING] All documents already parsed.');
            return { done: 0, failed: 0, skipped: 0 };
        }

        logger.info(`[DOCUMENT-PARSING] Found ${pending.length} documents to parse.`);

        let done = 0;
        let failed = 0;

        for (const doc of pending) {
            try {
                await this.parseDocument(doc);
                done++;
            } catch (err) {
                failed++;
            }
            
            // Respect the 15 RPM rate limit. Each document triggers 3 requests (upload, parse, delete).
            // 3 requests every 15 seconds = 12 requests per minute (Safely under 15 RPM).
            await new Promise(r => setTimeout(r, 15000));
        }

        return { done, failed, skipped: 0 };
    }
}
