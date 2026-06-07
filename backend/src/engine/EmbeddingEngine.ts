import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { documentChunks } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, l2normalize } from './embed.js';

interface Chunk {
    filePath: string;
    courseFolder: string;
    content: string;
}

export class EmbeddingEngine {
    private baseDir: string;
    private stateFile: string;
    private ai: GoogleGenAI;
    private MAX_TOKENS_PER_MINUTE = 29500; // Safely under 30K TPM
    private TARGET_CHUNK_SIZE = 4000; // ~1000 tokens per chunk

    constructor() {
        this.baseDir = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase');
        this.stateFile = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase_State.json');
        if (!process.env.GEMINI_API_KEY) {
            logger.warn('[EMBEDDING-ENGINE] GEMINI_API_KEY is not set. Embeddings will fail.');
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    private getState(): Record<string, string> {
        if (fs.existsSync(this.stateFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            } catch (e) {
                return {};
            }
        }
        return {};
    }

    private saveState(state: Record<string, string>) {
        fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    }

    private hashContent(text: string): string {
        return crypto.createHash('sha256').update(text).digest('hex');
    }

    private findAllMdFiles(dir: string, fileList: string[] = []): string[] {
        if (!fs.existsSync(dir)) return fileList;
        
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                this.findAllMdFiles(filePath, fileList);
            } else {
                if (file.endsWith('.md')) {
                    fileList.push(filePath);
                }
            }
        }
        return fileList;
    }

    private getCourseFolder(filePath: string): string {
        const basename = path.basename(filePath);
        const match = basename.match(/^\[(.*?)\]/);
        return match ? match[1] : 'Unknown Course';
    }

    private chunkMarkdown(filePath: string, text: string): Chunk[] {
        const chunks: Chunk[] = [];
        const courseFolder = this.getCourseFolder(filePath);

        const rawParagraphs = text.split('\n\n');
        let currentContent = '';
        
        for (const para of rawParagraphs) {
            const trimmed = para.trim();
            if (!trimmed) continue;

            if (currentContent.length + trimmed.length > this.TARGET_CHUNK_SIZE) {
                if (currentContent.length > 0) {
                    chunks.push({ filePath, courseFolder, content: currentContent.trim() });
                    currentContent = '';
                }
            }
            
            currentContent += (currentContent ? '\n\n' : '') + trimmed;
        }

        if (currentContent.length > 0) {
            chunks.push({ filePath, courseFolder, content: currentContent.trim() });
        }

        return chunks;
    }

    public async processAll(): Promise<{ doneFiles: number, totalChunks: number, failedFiles: number }> {
        if (!fs.existsSync(this.baseDir)) {
            logger.info('[EMBEDDING-ENGINE] Vector_KnowledgeBase directory does not exist yet. Run reorganizer first.');
            return { doneFiles: 0, totalChunks: 0, failedFiles: 0 };
        }

        const allMdDocs = this.findAllMdFiles(this.baseDir);
        const state = this.getState();

        logger.info(`[EMBEDDING-ENGINE] Checking ${allMdDocs.length} files against Delta-Sync tracker...`);

        // Clean up tracker and DB: if file no longer exists, delete its chunks
        const existingPaths = new Set(allMdDocs);
        for (const trackedPath of Object.keys(state)) {
            if (!existingPaths.has(trackedPath)) {
                logger.info(`[EMBEDDING-ENGINE] Deleting removed file vectors: ${path.basename(trackedPath)}`);
                await db.delete(documentChunks).where(eq(documentChunks.filePath, trackedPath));
                delete state[trackedPath];
            }
        }

        const filesToEmbed: { path: string, content: string, hash: string }[] = [];

        for (const docPath of allMdDocs) {
            const text = fs.readFileSync(docPath, 'utf-8');
            const hash = this.hashContent(text);
            
            if (state[docPath] !== hash) {
                filesToEmbed.push({ path: docPath, content: text, hash });
            }
        }

        if (filesToEmbed.length === 0) {
            logger.info('[EMBEDDING-ENGINE] All documents are up to date. (0 tokens spent)');
            this.saveState(state); // just in case we deleted some
            return { doneFiles: 0, totalChunks: 0, failedFiles: 0 };
        }

        logger.info(`[EMBEDDING-ENGINE] Found ${filesToEmbed.length} changed or new files to embed.`);

        let doneFiles = 0;
        let failedFiles = 0;
        let totalChunksInserted = 0;

        let minuteTokenCount = 0;
        let minuteStartTime = Date.now();

        for (const { path: filePath, content: text, hash } of filesToEmbed) {
            try {
                // Pre-delete any existing chunks for this file before re-embedding
                await db.delete(documentChunks).where(eq(documentChunks.filePath, filePath));

                const chunks = this.chunkMarkdown(filePath, text);
                
                if (chunks.length === 0) {
                    state[filePath] = hash;
                    doneFiles++;
                    continue;
                }

                logger.info(`[EMBEDDING-ENGINE] Embedding ${chunks.length} chunks for: ${path.basename(filePath)}`);

                const BATCH_SIZE = 50;
                for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                    const batch = chunks.slice(i, i + BATCH_SIZE);
                    const batchTexts = batch.map(c => c.content);
                    
                    const batchCharCount = batchTexts.reduce((sum, text) => sum + text.length, 0);
                    const batchTokenCount = Math.ceil(batchCharCount / 4);

                    if (minuteTokenCount + batchTokenCount > this.MAX_TOKENS_PER_MINUTE) {
                        const elapsed = Date.now() - minuteStartTime;
                        if (elapsed < 60000) {
                            const delay = 60000 - elapsed + 1000;
                            logger.warn(`[EMBEDDING-ENGINE] Nearing TPM limit. Pausing for ${Math.round(delay/1000)}s...`);
                            await new Promise(r => setTimeout(r, delay));
                        }
                        minuteTokenCount = 0;
                        minuteStartTime = Date.now();
                    }

                    let retries = 0;
                    let embeddings: number[][] = [];
                    while (retries < 3) {
                        try {
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=` + process.env.GEMINI_API_KEY;
                            const res = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    requests: batchTexts.map(text => ({
                                        model: `models/${EMBEDDING_MODEL}`,
                                        content: { parts: [{ text }] },
                                        outputDimensionality: EMBEDDING_DIMENSIONS
                                    }))
                                })
                            });
                            
                            const data = await res.json();
                            if (!res.ok) {
                                throw Object.assign(new Error(data.error?.message || 'Unknown error'), { status: res.status });
                            }
                            
                            embeddings = data.embeddings?.map((e: any) => e.values || []) || [];
                            break;
                        } catch (err: any) {
                            if (err.status === 429 && err.message && (err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('exhausted'))) {
                                throw new Error('QUOTA_EXHAUSTED');
                            }
                            if (err.status === 429 || err.status === 503 || err.status === 500) {
                                retries++;
                                logger.warn(`[EMBEDDING-ENGINE] Rate limit/Server error (status ${err.status}). Retrying ${retries}/3 in 60s...`);
                                await new Promise(r => setTimeout(r, 60000));
                                if (retries >= 3) throw err;
                            } else {
                                throw err;
                            }
                        }
                    }

                    minuteTokenCount += batchTokenCount;

                    if (embeddings.length === batch.length) {
                        const dbRows = batch.map((chunk, idx) => ({
                            filePath: chunk.filePath,
                            courseFolder: chunk.courseFolder,
                            content: chunk.content,
                            embedding: sql`${JSON.stringify(l2normalize(embeddings[idx]))}::vector`
                        }));

                        await db.insert(documentChunks).values(dbRows);
                        totalChunksInserted += batch.length;
                    } else {
                        throw new Error(`Embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`);
                    }
                }

                // Mark successful hash in state
                state[filePath] = hash;
                this.saveState(state); // save incrementally to survive crashes
                doneFiles++;
            } catch (error: any) {
                if (error.message === 'QUOTA_EXHAUSTED') {
                    logger.warn('[EMBEDDING-ENGINE] Daily quota reached. Pausing engine until tomorrow.');
                    break;
                }
                logger.error({ err: error }, `[EMBEDDING-ENGINE] Failed to embed file: ${filePath}`);
                failedFiles++;
            }
        }

        logger.info(`[EMBEDDING-ENGINE] Finished. Embedded ${totalChunksInserted} chunks from ${doneFiles} files.`);
        return { doneFiles, totalChunks: totalChunksInserted, failedFiles };
    }
}
