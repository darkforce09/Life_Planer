import { GoogleGenAI, type Content, type FunctionDeclaration } from '@google/genai';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { sanitize } from '../utils/piiSanitizer.js';
import { recordTrace } from './trace.js';

export interface AgentTool {
  declaration: FunctionDeclaration;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface RunAgentOptions {
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  model?: string;
  apiKey?: string;
  maxSteps?: number;
  runId?: string;
}

export interface AgentResult {
  runId: string;
  finalText: string;
  steps: number;
}

/**
 * Minimal tool-using agent loop on top of @google/genai function calling.
 *
 * Decision (see docs/agent_sdk_decision.md): rather than the unavailable
 * "Antigravity SDK", we use Gemini function-calling directly as the agent
 * runtime and expose backend capabilities through curated tools (also published
 * as MCP servers). Every prompt is PII-sanitized before leaving the box, and
 * every prompt / tool call / decision is written to the agent-trace log.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    agentName,
    systemPrompt,
    userPrompt,
    tools,
    model = 'gemini-2.5-flash',
    maxSteps = 8,
  } = options;
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const runId = options.runId || randomUUID();

  const safeUserPrompt = sanitize(userPrompt);
  await recordTrace(runId, agentName, 'prompt', { systemPrompt, userPrompt: safeUserPrompt });

  if (!apiKey || apiKey === 'mock-key') {
    const msg = 'No GEMINI_API_KEY configured; agent runtime is disabled.';
    logger.warn(`[AGENT:${agentName}] ${msg}`);
    await recordTrace(runId, agentName, 'error', msg);
    return { runId, finalText: msg, steps: 0 };
  }

  const ai = new GoogleGenAI({ apiKey });
  const toolByName = new Map(tools.map((t) => [t.declaration.name as string, t]));
  const contents: Content[] = [{ role: 'user', parts: [{ text: safeUserPrompt }] }];

  let steps = 0;
  let finalText = '';

  while (steps < maxSteps) {
    steps += 1;
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: sanitize(systemPrompt),
        tools: [{ functionDeclarations: tools.map((t) => t.declaration) }],
      },
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      finalText = response.text ?? '';
      await recordTrace(runId, agentName, 'response', finalText);
      break;
    }

    // Record the model's tool-call turn so the conversation stays coherent.
    contents.push({
      role: 'model',
      parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
    });

    const responseParts = [];
    for (const call of calls) {
      const name = call.name as string;
      const args = (call.args ?? {}) as Record<string, unknown>;
      await recordTrace(runId, agentName, 'tool_call', { name, args });

      const tool = toolByName.get(name);
      let result: unknown;
      if (!tool) {
        result = { error: `Unknown tool: ${name}` };
      } else {
        try {
          result = await tool.handler(args);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
          logger.error({ err: error }, `[AGENT:${agentName}] Tool "${name}" failed`);
        }
      }
      await recordTrace(runId, agentName, 'tool_result', { name, result });
      responseParts.push({ functionResponse: { name, response: { result } } });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  if (steps >= maxSteps && !finalText) {
    finalText = 'Agent reached max step budget without a final answer.';
    await recordTrace(runId, agentName, 'error', finalText);
  }

  return { runId, finalText, steps };
}
