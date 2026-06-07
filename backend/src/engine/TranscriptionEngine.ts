import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import Groq from 'groq-sdk';
import { logger } from '../utils/logger.js';

export class TranscriptionEngine {
    private groq: Groq;

    constructor() {
        if (!process.env.GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY is missing from environment variables.');
        }
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }

    /**
     * Recursively walks baseDir to find all .mp4 and .webm files.
     * Skips files that already have a [basename_without_ext]_transcript.md sibling.
     * Returns a list of video paths sorted by file size ascending.
     */
    public scanForUntranscribedVideos(baseDir: string = path.join(os.homedir(), 'Documents', 'CanvasSync')): string[] {
        const pendingVideos: string[] = [];

        const walk = (dir: string) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    walk(fullPath);
                } else if (file.endsWith('.mp4') || file.endsWith('.webm')) {
                    const ext = path.extname(file);
                    const basename = path.basename(file, ext);
                    const transcriptPath = path.join(dir, `${basename}_transcript.md`);
                    
                    if (!fs.existsSync(transcriptPath)) {
                        pendingVideos.push(fullPath);
                    }
                }
            }
        };

        if (fs.existsSync(baseDir)) {
            walk(baseDir);
        }

        // Sort by file size ascending
        pendingVideos.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
        return pendingVideos;
    }

    /**
     * Extracts audio from the video using ffmpeg.
     * Returns the path to the temporary .mp3 file.
     */
    private extractAudio(videoPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const ext = path.extname(videoPath);
            const basename = path.basename(videoPath, ext);
            const audioPath = path.join(path.dirname(videoPath), `${basename}_temp_audio.mp3`);

            logger.info(`[TRANSCRIPTION] Extracting audio for: ${basename}`);

            ffmpeg(videoPath)
                .output(audioPath)
                .noVideo()
                .audioChannels(1) // Mono
                .audioFrequency(16000) // 16kHz
                .format('mp3')
                .on('end', () => resolve(audioPath))
                .on('error', (err) => {
                    logger.error({ err }, `[TRANSCRIPTION] Failed to extract audio from ${videoPath}`);
                    reject(err);
                })
                .run();
        });
    }

    /**
     * Checks audio file size. If over maxSizeMB, splits it using ffmpeg.
     * Returns an array of chunk file paths.
     */
    private async splitAudioIfNeeded(audioPath: string, maxSizeMB: number = 20): Promise<string[]> {
        const stats = fs.statSync(audioPath);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB <= maxSizeMB) {
            return [audioPath];
        }

        logger.info(`[TRANSCRIPTION] Audio file is ${sizeMB.toFixed(2)}MB, splitting into chunks.`);

        // Determine total duration of the audio file to calculate chunks
        const getDuration = (): Promise<number> => {
            return new Promise((resolve, reject) => {
                ffmpeg.ffprobe(audioPath, (err, metadata) => {
                    if (err) return reject(err);
                    resolve(metadata.format.duration || 0);
                });
            });
        };

        const durationSecs = await getDuration();
        if (durationSecs === 0) {
            throw new Error(`Could not determine duration for ${audioPath}`);
        }

        // Estimate chunk duration. If 20MB is roughly X seconds, split by time.
        // Assuming 16kHz mono mp3 is ~120kbps (or ~900KB/min). 20MB is ~22 minutes.
        // We'll safely split into 15-minute segments (900 seconds).
        const chunkDurationSecs = 900; 
        const numChunks = Math.ceil(durationSecs / chunkDurationSecs);
        const chunks: string[] = [];

        const dir = path.dirname(audioPath);
        const basename = path.basename(audioPath, '.mp3');

        for (let i = 0; i < numChunks; i++) {
            const chunkPath = path.join(dir, `${basename}_chunk_${String(i + 1).padStart(3, '0')}.mp3`);
            const startTime = i * chunkDurationSecs;

            await new Promise<void>((resolve, reject) => {
                ffmpeg(audioPath)
                    .setStartTime(startTime)
                    .setDuration(chunkDurationSecs)
                    .output(chunkPath)
                    .audioChannels(1)
                    .audioFrequency(16000)
                    .format('mp3')
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .run();
            });

            chunks.push(chunkPath);
        }

        return chunks;
    }

    /**
     * Sends an audio chunk to the Groq API for transcription.
     * Handles 429 rate limit retries.
     */
    private async transcribeChunk(chunkPath: string): Promise<string> {
        const buffer = fs.readFileSync(chunkPath);
        const file = new File([buffer], path.basename(chunkPath), { type: 'audio/mpeg' });

        let retries = 0;
        const maxRetries = 100; // Allow it to wait out the 1-hour ASPH limits

        while (retries < maxRetries) {
            try {
                logger.info(`[TRANSCRIPTION] Sending chunk to Groq API: ${path.basename(chunkPath)}`);
                const transcription = await this.groq.audio.transcriptions.create({
                    file: file,
                    model: 'whisper-large-v3',
                    language: 'sv',
                    response_format: 'verbose_json',
                });
                return transcription.text;
            } catch (error: any) {
                if (error.status === 429) {
                    retries++;
                    
                    let retryAfterSecs = 300; // Default to 5 minutes
                    
                    // Try to parse 'retry-after' header
                    const retryAfterStr = error.headers?.['retry-after'];
                    if (retryAfterStr) {
                        retryAfterSecs = parseInt(retryAfterStr, 10);
                    } else if (error.error?.message || error.message) {
                        // Try to parse "Please try again in 5m24.5s"
                        const msg = error.error?.message || error.message;
                        const match = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
                        if (match) {
                            const hours = parseInt(match[1] || '0', 10);
                            const minutes = parseInt(match[2] || '0', 10);
                            const seconds = parseFloat(match[3] || '0');
                            retryAfterSecs = Math.ceil((hours * 3600) + (minutes * 60) + seconds);
                        }
                    }
                    
                    logger.warn(`[TRANSCRIPTION] Rate limited (429). Retrying after ${retryAfterSecs} seconds. (Attempt ${retries}/${maxRetries})`);
                    
                    if (retries >= maxRetries) {
                        throw new Error(`Exceeded max retries for rate limits on chunk ${chunkPath}`);
                    }
                    
                    await new Promise(res => setTimeout(res, retryAfterSecs * 1000));
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Transcription failed.');
    }

    /**
     * Processes a single video from start to finish.
     */
    public async transcribeVideo(videoPath: string): Promise<void> {
        const ext = path.extname(videoPath);
        const basename = path.basename(videoPath, ext);
        const transcriptPath = path.join(path.dirname(videoPath), `${basename}_transcript.md`);
        let audioPath: string | null = null;
        let chunks: string[] = [];

        logger.info(`[TRANSCRIPTION] Processing: ${path.basename(videoPath)}`);

        try {
            audioPath = await this.extractAudio(videoPath);
            chunks = await this.splitAudioIfNeeded(audioPath, 20);

            const transcripts: string[] = [];
            for (const chunk of chunks) {
                const text = await this.transcribeChunk(chunk);
                transcripts.push(text);
            }

            const concatenatedText = transcripts.join('\n\n');
            const now = new Date().toISOString();
            
            // Note: Since we are using an absolute path for videoPath, we extract a relative path roughly based on the course structure
            // Or just use the basename to keep it simple.
            const relativeSource = `./${path.basename(videoPath)}`;

            const finalMarkdown = `# Transcript: ${path.basename(videoPath)}\n\n**Source video:** ${relativeSource}\n**Transcribed:** ${now}\n\n---\n\n${concatenatedText}`;

            fs.writeFileSync(transcriptPath, finalMarkdown, 'utf-8');
            logger.info(`[TRANSCRIPTION] Successfully saved transcript: ${transcriptPath}`);

        } finally {
            // Clean up temporary files
            if (audioPath) {
                try {
                    fs.unlinkSync(audioPath);
                } catch (e) { /* ignore */ }
            }
            for (const chunk of chunks) {
                try {
                    if (chunk !== audioPath) { // Don't try to delete audioPath twice
                        fs.unlinkSync(chunk);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    }

    /**
     * Scans for all untranscribed videos and processes them sequentially.
     */
    public async transcribeAll(): Promise<{ done: number, failed: number, skipped: number }> {
        const pending = this.scanForUntranscribedVideos();
        
        if (pending.length === 0) {
            logger.info(`[TRANSCRIPTION] All videos already transcribed.`);
            return { done: 0, failed: 0, skipped: 0 };
        }

        logger.info(`[TRANSCRIPTION] Found ${pending.length} videos to transcribe.`);
        
        let done = 0;
        let failed = 0;

        for (const videoPath of pending) {
            try {
                await this.transcribeVideo(videoPath);
                done++;
            } catch (error) {
                logger.error({ err: error, videoPath }, `[TRANSCRIPTION] Failed to process video.`);
                failed++;
            }
        }

        return { done, failed, skipped: 0 };
    }
}
