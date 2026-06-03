import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class StudyGuideAgent {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || 'mock-key' });
  }

  public async generateGuide(courseName: string, topic: string): Promise<void> {
    logger.info(`[AGENT-STUDYGUIDE] Beginning synthesis for ${courseName}: ${topic}`);
    
    // In production, this would query the RAGService/pgvector for syllabus context
    const prompt = `Act as an elite university tutor. Generate a comprehensive Markdown study guide for the course ${courseName} on the topic of "${topic}". Include key concepts, practice questions, and summary points.`;

    let content = '';

    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'mock-key') {
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: prompt
        });
        content = response.text || 'Failed to generate content.';
      } catch (e) {
        logger.error('[AGENT-STUDYGUIDE] Gemini API Failed. Using fallback.', e);
        content = this.getMockGuide(courseName, topic);
      }
    } else {
      logger.warn('[AGENT-STUDYGUIDE] No Google API Key found in environment. Generating intelligent fallback guide.');
      content = this.getMockGuide(courseName, topic);
    }

    const filename = `${courseName.replace(/[^a-zA-Z0-9]/g, '_')}_${topic.replace(/[^a-zA-Z0-9]/g, '_')}_Guide.md`;
    
    // Go up from src/agents to the root docs folder
    const docsDir = path.resolve(__dirname, '../../../docs/guides');
    const outputPath = path.resolve(docsDir, filename);
    
    // Ensure directory exists
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(outputPath, content);
    
    logger.info(`[AGENT-STUDYGUIDE] Successfully wrote Markdown study guide to ${outputPath}`);
  }

  private getMockGuide(course: string, topic: string): string {
    return `# Study Guide: ${course} - ${topic}

## Overview
This is an auto-generated, highly prioritized study guide created by the Autonomous Agent module.

## Core Directives
1. **Focus:** Review the central thesis of ${topic}.
2. **Action:** Complete the practice exercises outlined in the syllabus.

> "Discipline equals freedom. Execute the plan." - The Brain
`;
  }
}
