import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';

const REFINE_MODEL = 'gemini-2.5-flash';

// Files whose content is raw and benefits from AI cleaning.
const REFINABLE_MARKERS = ['_transcript', '_parsed', '_external'];

interface RefineOptions {
  /** When true, only report what would be processed without spending tokens. */
  dryRun?: boolean;
  /** Approximate token budget for a single run (rough estimate: chars / 4). */
  maxTokens?: number;
}

interface RefineEstimate {
  totalRefinable: number;
  changed: number;
  estimatedTokens: number;
  files: string[];
}

/**
 * ContentRefinementEngine — bridges Reorganization and Embedding.
 *
 * 1. Cleans raw `_transcript` / `_parsed` / `_external` markdown with Gemini,
 *    applying proper headers and bullets while strictly preserving medical facts.
 * 2. Generates rich `00_AI_Index.md` files per course with a category summary and
 *    a 1-2 sentence description for every file.
 * 3. Uses a `RefinementState.json` hash tracker to skip unchanged files, and
 *    supports a dry-run mode and a per-run token budget as cost guardrails.
 */
export class ContentRefinementEngine {
  private baseDir: string;
  private stateFile: string;
  private ai: GoogleGenAI;
  // Per-run token budget; overridable via REFINE_MAX_TOKENS env var.
  private DEFAULT_MAX_TOKENS = Number(process.env.REFINE_MAX_TOKENS) || 200_000;

  constructor() {
    this.baseDir = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase');
    this.stateFile = path.join(os.homedir(), 'Documents', 'RefinementState.json');
    if (!process.env.GEMINI_API_KEY) {
      logger.warn('[REFINE] GEMINI_API_KEY is not set. Refinement will be skipped.');
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  private getState(): Record<string, string> {
    if (fs.existsSync(this.stateFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  private saveState(state: Record<string, string>) {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  private hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private findRefinableFiles(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs
      .readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => REFINABLE_MARKERS.some((m) => f.includes(m)))
      .map((f) => path.join(this.baseDir, f));
  }

  private coursePrefix(fileName: string): string {
    const match = fileName.match(/^\[([^\]]+)\]/);
    return match ? match[1] : 'GLOBAL';
  }

  /**
   * Reports how many files would be refined and the rough token cost, without
   * calling the API. Powers the dry-run cost guardrail.
   */
  public estimate(): RefineEstimate {
    const state = this.getState();
    const files = this.findRefinableFiles();
    const changed: string[] = [];
    let estimatedTokens = 0;

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf-8');
      if (state[file] !== this.hash(text)) {
        changed.push(path.basename(file));
        // Input + output (assume output ~ input size).
        estimatedTokens += this.estimateTokens(text) * 2;
      }
    }

    return {
      totalRefinable: files.length,
      changed: changed.length,
      estimatedTokens,
      files: changed,
    };
  }

  private async cleanOne(content: string): Promise<string | null> {
    const prompt = `You are a meticulous medical study assistant. Reformat the following course material into clean, well-structured Markdown.

STRICT RULES:
- Preserve ALL medical facts, numbers, dosages, and terminology EXACTLY. Do not invent, omit, or alter any fact.
- Fix obvious OCR/transcription errors only when unambiguous.
- Add logical Markdown headers (##, ###) and bullet points for readability.
- Do NOT add commentary, summaries, or content that was not present.
- Keep the original language (Swedish or English).

MATERIAL:
${content}`;

    const response = await this.ai.models.generateContent({
      model: REFINE_MODEL,
      contents: prompt,
    });
    return response.text || null;
  }

  private async cleanDocuments(options: RefineOptions): Promise<number> {
    const state = this.getState();
    const files = this.findRefinableFiles();
    const maxTokens = options.maxTokens ?? this.DEFAULT_MAX_TOKENS;

    let spentTokens = 0;
    let cleaned = 0;

    for (const file of files) {
      const original = fs.readFileSync(file, 'utf-8');
      if (state[file] === this.hash(original)) continue; // unchanged

      const cost = this.estimateTokens(original) * 2;
      if (spentTokens + cost > maxTokens) {
        logger.warn(`[REFINE] Token budget (${maxTokens}) reached; deferring remaining files.`);
        break;
      }

      if (options.dryRun) {
        logger.info(`[REFINE] (dry-run) Would clean: ${path.basename(file)} (~${cost} tokens)`);
        spentTokens += cost;
        continue;
      }

      try {
        const cleanedText = await this.cleanOne(original);
        if (cleanedText && cleanedText.trim().length > 0) {
          fs.writeFileSync(file, cleanedText);
          state[file] = this.hash(cleanedText);
          this.saveState(state);
          cleaned++;
          spentTokens += cost;
          logger.info(`[REFINE] Cleaned: ${path.basename(file)}`);
        }
      } catch (error) {
        logger.error({ err: error }, `[REFINE] Failed to clean ${path.basename(file)}`);
      }
    }

    return cleaned;
  }

  private async generateIndexes(options: RefineOptions): Promise<number> {
    if (!fs.existsSync(this.baseDir)) return 0;

    const allFiles = fs
      .readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.md') && !f.includes('00_AI_Index'));

    // Group by course prefix.
    const byCourse = new Map<string, string[]>();
    for (const f of allFiles) {
      const code = this.coursePrefix(f);
      if (!byCourse.has(code)) byCourse.set(code, []);
      byCourse.get(code)!.push(f);
    }

    let generated = 0;
    for (const [code, files] of byCourse.entries()) {
      // Build a compact catalog (filename + excerpt) for the model.
      const catalog = files
        .map((f) => {
          const excerpt = fs
            .readFileSync(path.join(this.baseDir, f), 'utf-8')
            .replace(/\s+/g, ' ')
            .slice(0, 400);
          return `FILE: ${f}\nEXCERPT: ${excerpt}`;
        })
        .join('\n\n');

      if (options.dryRun) {
        logger.info(`[REFINE] (dry-run) Would generate AI index for [${code}] (${files.length} files)`);
        continue;
      }

      const prompt = `You are creating a study index for course "${code}". Given the files below, produce a Markdown index that:
1. Starts with a 2-3 sentence overview of what this course folder covers.
2. Lists every file as a Markdown link "- [FILENAME](./URL-ENCODED-FILENAME): one or two sentence description".
Base descriptions ONLY on the excerpts. Do not invent content.

FILES:
${catalog}`;

      try {
        const response = await this.ai.models.generateContent({
          model: REFINE_MODEL,
          contents: prompt,
        });
        if (response.text) {
          const indexPath = path.join(this.baseDir, `[${code}] 00_AI_Index.md`);
          fs.writeFileSync(indexPath, `# AI Index: ${code}\n\n${response.text}`);
          generated++;
          logger.info(`[REFINE] Generated AI index for [${code}]`);
        }
      } catch (error) {
        logger.error({ err: error }, `[REFINE] Failed to generate index for [${code}]`);
      }
    }

    return generated;
  }

  /**
   * Runs the full refinement pass: clean raw documents, then generate rich indexes.
   */
  public async refineAll(options: RefineOptions = {}): Promise<{ cleaned: number; indexes: number }> {
    logger.info(`[REFINE] Starting content refinement${options.dryRun ? ' (dry-run)' : ''}...`);

    if (!process.env.GEMINI_API_KEY) {
      logger.warn('[REFINE] No GEMINI_API_KEY; skipping refinement.');
      return { cleaned: 0, indexes: 0 };
    }

    const cleaned = await this.cleanDocuments(options);
    const indexes = await this.generateIndexes(options);

    logger.info(`[REFINE] Finished. Cleaned ${cleaned} files, generated ${indexes} indexes.`);
    return { cleaned, indexes };
  }
}
