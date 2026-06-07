import { GoogleGenAI } from '@google/genai';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { embedText } from './embed.js';

const ANSWER_MODEL = 'gemini-2.5-flash';

export interface RagMatch {
  content: string;
  filePath: string;
  courseFolder: string | null;
  score: number;
}

export interface RagAnswer {
  answer: string;
  sources: RagMatch[];
}

/**
 * RAGQueryEngine — read side of the RAG system.
 *
 * Embeds a query with the same model/dimensionality used during ingestion,
 * runs a pgvector cosine-similarity search over `document_chunks`, and
 * optionally synthesizes a grounded answer with Gemini.
 */
export class RAGQueryEngine {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  /**
   * Returns the top-k most similar chunks. Cosine similarity = 1 - cosine distance.
   */
  async search(query: string, opts: { topK?: number; courseFolder?: string } = {}): Promise<RagMatch[]> {
    const topK = Math.min(Math.max(opts.topK ?? 8, 1), 50);
    const queryVec = await embedText(query);
    const vecLiteral = `[${queryVec.join(',')}]`;

    const courseFilter = opts.courseFolder
      ? sql`AND course_folder = ${opts.courseFolder}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT content, file_path, course_folder,
             1 - (embedding <=> ${vecLiteral}::vector) AS score
      FROM document_chunks
      WHERE embedding IS NOT NULL ${courseFilter}
      ORDER BY embedding <=> ${vecLiteral}::vector
      LIMIT ${topK}
    `);

    const result = rows as unknown as Array<{
      content: string;
      file_path: string;
      course_folder: string | null;
      score: number;
    }>;

    return result.map((r) => ({
      content: r.content,
      filePath: r.file_path,
      courseFolder: r.course_folder,
      score: Number(r.score),
    }));
  }

  /**
   * Retrieves context and synthesizes a grounded, citation-bearing answer.
   */
  async answer(query: string, opts: { topK?: number; courseFolder?: string } = {}): Promise<RagAnswer> {
    const sources = await this.search(query, opts);

    if (sources.length === 0) {
      return { answer: 'No relevant information found in the knowledge base.', sources: [] };
    }

    if (!process.env.GEMINI_API_KEY) {
      logger.warn('[RAG] No GEMINI_API_KEY; returning raw matches without synthesis.');
      return { answer: 'AI synthesis unavailable (no API key). See sources below.', sources };
    }

    const context = sources
      .map((s, i) => `[${i + 1}] (${s.filePath})\n${s.content}`)
      .join('\n\n---\n\n');

    const prompt = `You are a medical study assistant. Answer the question using ONLY the context below.
- Cite sources inline as [1], [2], etc. matching the numbered context blocks.
- If the context does not contain the answer, say so plainly. Do NOT invent medical facts.
- Answer in the same language as the question.

QUESTION: ${query}

CONTEXT:
${context}`;

    try {
      const response = await this.ai.models.generateContent({ model: ANSWER_MODEL, contents: prompt });
      return { answer: response.text || 'No answer generated.', sources };
    } catch (error) {
      logger.error({ err: error }, '[RAG] Answer synthesis failed');
      return { answer: 'Failed to synthesize an answer; see sources below.', sources };
    }
  }
}
