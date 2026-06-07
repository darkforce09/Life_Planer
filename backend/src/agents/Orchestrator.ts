import { Type } from '@google/genai';
import { randomUUID } from 'crypto';
import { runAgent, type AgentTool, type AgentResult } from './runtime.js';
import { getPendingTasks, searchKnowledgeBase, getUpcomingExams, triggerSync, logSystemEvent } from './tools.js';
import { runExecutionAgent } from './ExecutionAgent.js';
import { recordTrace } from './trace.js';

const SYSTEM_PROMPT = `You are the Orchestrator Agent ("the Brain") of an autonomous university assistant.
You wake on a schedule (or on demand), inspect the current state of the system, and decide whether any
action is warranted. You do NOT perform destructive actions yourself - instead you delegate a single,
clearly-scoped goal to the Execution Agent via delegate_to_execution.
Guidelines:
- Inspect pending tasks and upcoming exams before deciding.
- Only delegate when there is a clear, high-value action (e.g. an exam sign-up window is open, or a
  critical missed deadline needs an apology email).
- Keep delegated goals specific and self-contained (include ids).
- When nothing needs doing, say so briefly and stop.`;

export async function runOrchestrator(trigger = 'scheduled'): Promise<AgentResult> {
  const runId = randomUUID();

  const tools: AgentTool[] = [
    {
      declaration: {
        name: 'get_pending_tasks',
        description: 'List non-completed tasks ordered by priority (highest first).',
        parameters: {
          type: Type.OBJECT,
          properties: { limit: { type: Type.NUMBER } },
        },
      },
      handler: async (args) => getPendingTasks(args.limit ? Number(args.limit) : 10),
    },
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
        name: 'search_knowledge_base',
        description: 'Semantic search over the embedded knowledge base.',
        parameters: {
          type: Type.OBJECT,
          properties: { query: { type: Type.STRING }, topK: { type: Type.NUMBER } },
          required: ['query'],
        },
      },
      handler: async (args) => searchKnowledgeBase(String(args.query), args.topK ? Number(args.topK) : 5),
    },
    {
      declaration: {
        name: 'trigger_sync',
        description: 'Trigger a sensor sync: timeedit | canvas | ladok | outlook.',
        parameters: {
          type: Type.OBJECT,
          properties: { sensor: { type: Type.STRING, enum: ['timeedit', 'canvas', 'ladok', 'outlook'] } },
          required: ['sensor'],
        },
      },
      handler: async (args) => triggerSync(args.sensor as 'timeedit' | 'canvas' | 'ladok' | 'outlook'),
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
    {
      declaration: {
        name: 'delegate_to_execution',
        description:
          'Delegate one concrete, self-contained workflow to the Execution Agent (e.g. "Sign up for exam <id>"). Returns its summary.',
        parameters: {
          type: Type.OBJECT,
          properties: { goal: { type: Type.STRING } },
          required: ['goal'],
        },
      },
      handler: async (args) => {
        await recordTrace(runId, 'orchestrator', 'decision', `Delegating: ${args.goal}`);
        const result = await runExecutionAgent(String(args.goal), runId);
        return { summary: result.finalText, steps: result.steps };
      },
    },
  ];

  return runAgent({
    agentName: 'orchestrator',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Trigger: ${trigger}. Inspect the system and decide what (if anything) to do now.`,
    tools,
    runId,
    maxSteps: 10,
  });
}
