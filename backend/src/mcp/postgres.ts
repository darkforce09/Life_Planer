#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  getPendingTasks,
  updateTaskStatus,
  logSystemEvent,
  searchKnowledgeBase,
} from '../agents/tools.js';

/**
 * mcp-postgres: gives an agent controlled read/write access to the Brain
 * database plus RAG knowledge-base search. Exposes only the curated tools in
 * agents/tools.ts - never arbitrary SQL.
 */
export function buildPostgresServer(): McpServer {
  const server = new McpServer({ name: 'mcp-postgres', version: '1.0.0' });

  server.registerTool(
    'get_pending_tasks',
    {
      description: 'List non-completed tasks ordered by priority score (highest first).',
      inputSchema: { limit: z.number().int().positive().max(100).optional() },
    },
    async ({ limit }) => ({
      content: [{ type: 'text', text: JSON.stringify(await getPendingTasks(limit ?? 10)) }],
    }),
  );

  server.registerTool(
    'update_task_status',
    {
      description: "Update a task's status (e.g. 'pending', 'in_progress', 'completed').",
      inputSchema: { taskId: z.string(), status: z.string() },
    },
    async ({ taskId, status }) => ({
      content: [{ type: 'text', text: JSON.stringify(await updateTaskStatus(taskId, status)) }],
    }),
  );

  server.registerTool(
    'log_system_event',
    {
      description: 'Record an informational system event/alert.',
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: JSON.stringify(await logSystemEvent(message)) }],
    }),
  );

  server.registerTool(
    'search_knowledge_base',
    {
      description: 'Semantic search over the embedded medical/course knowledge base.',
      inputSchema: { query: z.string(), topK: z.number().int().positive().max(20).optional() },
    },
    async ({ query, topK }) => ({
      content: [{ type: 'text', text: JSON.stringify(await searchKnowledgeBase(query, topK ?? 5)) }],
    }),
  );

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = buildPostgresServer();
  await server.connect(new StdioServerTransport());
}
