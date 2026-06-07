#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { draftEmail, requestEmailSend, requestUser2faApproval, signupExam } from '../agents/tools.js';

/**
 * mcp-actions: communication + destructive actions. Every destructive tool
 * routes through the human-in-the-loop approval queue (approvals.ts) and only
 * commits after the user approves it in the Face widget.
 */
export function buildActionsServer(): McpServer {
  const server = new McpServer({ name: 'mcp-actions', version: '1.0.0' });

  server.registerTool(
    'draft_email',
    {
      description: 'Draft a context-aware email (saved to Outlook Drafts, never sent automatically).',
      inputSchema: {
        to: z.string(),
        taskTitle: z.string(),
        studentName: z.string().optional(),
      },
    },
    async ({ to, taskTitle, studentName }) => ({
      content: [{ type: 'text', text: JSON.stringify(await draftEmail(to, taskTitle, studentName)) }],
    }),
  );

  server.registerTool(
    'request_email_send',
    {
      description: 'Request human approval to SEND an email. Blocks until the user decides.',
      inputSchema: { to: z.string(), subject: z.string() },
    },
    async ({ to, subject }) => ({
      content: [{ type: 'text', text: JSON.stringify(await requestEmailSend(to, subject)) }],
    }),
  );

  server.registerTool(
    'request_user_2fa_approval',
    {
      description: 'Ping the Face widget to ask the user to complete a 2FA/BankID step. Blocks until confirmed.',
      inputSchema: { platform: z.string() },
    },
    async ({ platform }) => ({
      content: [{ type: 'text', text: JSON.stringify(await requestUser2faApproval(platform)) }],
    }),
  );

  server.registerTool(
    'signup_exam',
    {
      description: 'Sign up for a Ladok exam by id. Requires explicit human approval before committing.',
      inputSchema: { examId: z.string() },
    },
    async ({ examId }) => ({
      content: [{ type: 'text', text: JSON.stringify(await signupExam(examId)) }],
    }),
  );

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = buildActionsServer();
  await server.connect(new StdioServerTransport());
}
