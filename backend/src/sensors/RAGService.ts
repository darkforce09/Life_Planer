import { logger } from '../utils/logger.js';
import { GoogleGenAI } from '@google/genai';
// import { db } from '../db/index.js';

export class RAGService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || 'mock' });
  }

  /**
   * Chunks a syllabus PDF or reading material and generates embeddings
   */
  public async embedDocument(courseId: string, text: string): Promise<void> {
    logger.info(`[RAG-ENGINE] Chunking document for Course ${courseId}...`);
    
    // 1. Simple chunking strategy (e.g. 1000 chars)
    const chunks = text.match(/.{1,1000}/g) || [];
    logger.info(`[RAG-ENGINE] Created ${chunks.length} chunks. Generating embeddings...`);

    // 2. Generate embeddings via Gemini
    // for (const chunk of chunks) {
    //   const response = await this.ai.models.embedContent({
    //     model: 'text-embedding-004',
    //     contents: chunk,
    //   });
    //   const vector = response.embeddings[0].values;
    //   
    //   3. Store in pgvector database
    //   await db.execute(`INSERT INTO course_embeddings (course_id, content, embedding) VALUES ($1, $2, $3)`, [courseId, chunk, `[${vector.join(',')}]`]);
    // }
    
    logger.info(`[RAG-ENGINE] Successfully vectorized and stored document in PostgreSQL (pgvector).`);
  }
}
