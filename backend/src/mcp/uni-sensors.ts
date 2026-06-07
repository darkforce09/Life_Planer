#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { triggerSync, getUpcomingExams } from '../agents/tools.js';

/**
 * mcp-uni-sensors: lets an agent trigger sensor syncs and read sensor-derived
 * data (e.g. upcoming exams). Wraps the sensor services in agents/tools.ts.
 */
export function buildUniSensorsServer(): McpServer {
  const server = new McpServer({ name: 'mcp-uni-sensors', version: '1.0.0' });

  server.registerTool(
    'trigger_sync',
    {
      description: 'Trigger a sync for a specific sensor: timeedit | canvas | ladok | outlook.',
      inputSchema: { sensor: z.enum(['timeedit', 'canvas', 'ladok', 'outlook']) },
    },
    async ({ sensor }) => ({
      content: [{ type: 'text', text: JSON.stringify(await triggerSync(sensor)) }],
    }),
  );

  server.registerTool(
    'get_upcoming_exams',
    {
      description: 'List upcoming exams the user has not yet signed up for.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(await getUpcomingExams()) }],
    }),
  );

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = buildUniSensorsServer();
  await server.connect(new StdioServerTransport());
}
