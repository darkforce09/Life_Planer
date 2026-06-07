# Agent SDK Decision Record (Phase E spike)

## Context

`docs/ai_architecture.md` references the "Google Antigravity SDK" for the
Orchestrator and Execution agents. Antigravity is the **development environment**
previously used to build parts of this project, not a runtime agent SDK that can
be installed into this Node/TypeScript backend. We needed to choose a concrete,
installable runtime before wiring up the agents and MCP servers.

## Options considered

1. **Gemini function-calling (`@google/genai`) as the agent runtime.** Already a
   dependency, used elsewhere (embeddings, refinement, vision auto-heal). Native
   multi-tool function calling, no extra service to run.
2. **A third-party agent framework** (LangChain / LlamaIndex / autogen-style).
   Heavier dependency surface, another abstraction to learn, and most still call
   Gemini under the hood anyway.
3. **A hosted/agent-orchestration SaaS.** Rejected: this is a self-hosted,
   privacy-sensitive box; we do not want agent control flow leaving the machine.

## Decision

- **Agent runtime:** Gemini function-calling via `@google/genai`, wrapped in a
  small in-house loop (`backend/src/agents/runtime.ts`). The loop handles the
  tool-call cycle, PII sanitization, the step budget, and agent-trace logging.
- **Capability layer:** A single curated tools module
  (`backend/src/agents/tools.ts`) is the only way agents touch the system. There
  is no arbitrary code/SQL execution.
- **MCP servers:** The same curated tools are also published as three local MCP
  servers over stdio using `@modelcontextprotocol/sdk`, so external MCP clients
  (Cursor, Claude Desktop, etc.) can drive the same capabilities:
  - `mcp-postgres` (`npm run mcp:postgres`) - DB read/write + RAG search.
  - `mcp-uni-sensors` (`npm run mcp:uni-sensors`) - trigger syncs, read exams.
  - `mcp-actions` (`npm run mcp:actions`) - draft/send email, exam signup, 2FA.

This gives one capability definition with two front-ends (in-process agents and
MCP), avoiding logic duplication in prompts.

## Guardrails (enforced in code, not just prompts)

- **PII boundary:** `backend/src/utils/piiSanitizer.ts` runs on every prompt and
  system instruction before it leaves the box (personnummer, secrets, keys,
  emails, phone numbers).
- **Human-in-the-loop:** every destructive action (exam signup, email send, 2FA)
  creates a pending row in `approvals` and blocks until the user approves it in
  the Face widget (`backend/src/agents/approvals.ts`).
- **Strict scoping:** agents can only call the declared tools; no shell access.
- **Observability:** every prompt / tool call / tool result / decision is written
  to `agent_traces` and exposed at `GET /api/agents/traces`.

## Agents

- **Orchestrator** (`backend/src/agents/Orchestrator.ts`) - inspects DB state and
  delegates one concrete goal at a time to the Execution agent. Triggerable via
  `POST /api/agents/orchestrate`.
- **Execution** (`backend/src/agents/ExecutionAgent.ts`) - performs a single
  workflow (e.g. Ladok exam registration), routing destructive steps through the
  approval gate.

## Configuring an external MCP client

```jsonc
{
  "mcpServers": {
    "uni-postgres": { "command": "npm", "args": ["run", "mcp:postgres"], "cwd": "backend" },
    "uni-sensors":  { "command": "npm", "args": ["run", "mcp:uni-sensors"], "cwd": "backend" },
    "uni-actions":  { "command": "npm", "args": ["run", "mcp:actions"], "cwd": "backend" }
  }
}
```
