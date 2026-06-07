import { Type } from '@google/genai';
import { runAgent, type AgentTool, type AgentResult } from './runtime.js';
import {
  getUpcomingExams,
  signupExam,
  requestUser2faApproval,
  draftEmail,
  requestEmailSend,
  updateTaskStatus,
  logSystemEvent,
} from './tools.js';

const SYSTEM_PROMPT = `You are the Execution Agent ("the Hands") of an autonomous university assistant.
You handle ONE concrete workflow at a time (e.g. registering for a Ladok exam, drafting/sending an email).
Rules:
- Destructive actions (exam signup, sending email) REQUIRE human approval. Always call the relevant
  approval/signup tool, which blocks for the user's decision; never assume approval.
- If a 2FA / BankID step is needed, call request_user_2fa_approval and wait.
- Be concise. When the workflow is complete (or was rejected), stop and summarize what happened.`;

const TOOLS: AgentTool[] = [
  {
    declaration: {
      name: 'get_upcoming_exams',
      description: 'List upcoming exams the user has not yet signed up for.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => getUpcomingExams(),
  },
  {
    declaration: {
      name: 'signup_exam',
      description: 'Sign up for a Ladok exam by id (requires human approval; blocks until decided).',
      parameters: {
        type: Type.OBJECT,
        properties: { examId: { type: Type.STRING } },
        required: ['examId'],
      },
    },
    handler: async (args) => signupExam(String(args.examId)),
  },
  {
    declaration: {
      name: 'request_user_2fa_approval',
      description: 'Ask the user (via the Face widget) to complete a 2FA/BankID step. Blocks until confirmed.',
      parameters: {
        type: Type.OBJECT,
        properties: { platform: { type: Type.STRING } },
        required: ['platform'],
      },
    },
    handler: async (args) => requestUser2faApproval(String(args.platform)),
  },
  {
    declaration: {
      name: 'draft_email',
      description: 'Draft a context-aware email saved to Outlook Drafts (never sent automatically).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          to: { type: Type.STRING },
          taskTitle: { type: Type.STRING },
          studentName: { type: Type.STRING },
        },
        required: ['to', 'taskTitle'],
      },
    },
    handler: async (args) =>
      draftEmail(String(args.to), String(args.taskTitle), args.studentName ? String(args.studentName) : undefined),
  },
  {
    declaration: {
      name: 'request_email_send',
      description: 'Request human approval to SEND a drafted email. Blocks until the user decides.',
      parameters: {
        type: Type.OBJECT,
        properties: { to: { type: Type.STRING }, subject: { type: Type.STRING } },
        required: ['to', 'subject'],
      },
    },
    handler: async (args) => requestEmailSend(String(args.to), String(args.subject)),
  },
  {
    declaration: {
      name: 'update_task_status',
      description: "Update a task's status.",
      parameters: {
        type: Type.OBJECT,
        properties: { taskId: { type: Type.STRING }, status: { type: Type.STRING } },
        required: ['taskId', 'status'],
      },
    },
    handler: async (args) => updateTaskStatus(String(args.taskId), String(args.status)),
  },
  {
    declaration: {
      name: 'log_system_event',
      description: 'Record an informational system event.',
      parameters: {
        type: Type.OBJECT,
        properties: { message: { type: Type.STRING } },
        required: ['message'],
      },
    },
    handler: async (args) => logSystemEvent(String(args.message)),
  },
];

/**
 * Runs the Execution Agent against a single, concrete goal. Returns when the
 * workflow finishes or is rejected. Shares the parent runId for a unified trace.
 */
export async function runExecutionAgent(goal: string, runId?: string): Promise<AgentResult> {
  return runAgent({
    agentName: 'execution',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: goal,
    tools: TOOLS,
    runId,
  });
}
