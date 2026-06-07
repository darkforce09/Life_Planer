import { logger } from '../utils/logger.js';

// Current GA Gemini text-embedding model. Defaults to 3072 dims, so we request
// 768 to match the `document_chunks.embedding` vector(768) column.
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * L2-normalizes an embedding vector (reduced-dim Gemini embeddings are not
 * pre-normalized, which would otherwise distort cosine similarity).
 */
export function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

/**
 * Embeds a single piece of text and returns a normalized 768-dim vector.
 * Used by the RAG query path (the bulk ingestion path batches separately).
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`[EMBED] embedContent failed ${res.status}: ${body.slice(0, 200)}`);
    throw new Error(`Embedding request failed: ${res.status}`);
  }

  const data = (await res.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error('Embedding response contained no values.');
  }
  return l2normalize(values);
}
