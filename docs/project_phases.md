# Project Development Phases

With the architectural map complete (Phase 0), we will execute the build in four distinct, testable phases. This step-by-step approach ensures we don't build a massive system that breaks all at once.

**Core Philosophy: Continuous Testing**
We will not wait until the end to write tests. Every single phase includes strict unit and integration testing requirements to prevent technical debt and silent failures from building up.

## Phase 1: The Brain Foundation (Infrastructure & Database)
**Goal:** Establish the core project and the PostgreSQL database so we have a place to store data.
- Initialize the Node.js/TypeScript backend project with strict ESM and ESLint configs.
- Initialize the structured logger (Pino) so all subsequent phases have a standardized debugging tool from Day 1.
- Set up **Docker**, GitHub Actions for **CI/CD**, and the PostgreSQL database (including the **`pgvector`** extension for RAG).
- Write schema migrations using Drizzle ORM (`data_structures.md`).
- Build the Prioritization Engine logic to calculate the `priority_score` of tasks.
- **Testing & Debugging:** Write Unit Tests (Vitest) for the Prioritization Engine to definitively prove it sorts and weighs dummy tasks correctly. Ensure GitHub Actions runs these tests on every commit.
- **Milestone:** We can manually insert a Task into the database and watch the tested Prioritization Engine rank it correctly.

## Phase 2: Activating the Sensors (Data Ingestion)
**Goal:** Automate the data flow from the university into the Brain.
- Build the base `IntegrationService` interface.
- Build the `TimeEditService` to automatically fetch and parse your specific `.ics` link.
- Build the `CanvasLMSService` using Playwright to log in and scrape assignments. Implement **Auto-Healing** Vision AI fallbacks for when the UI changes.
- Automatically chunk and embed Canvas syllabi/reading materials into `pgvector` for the **RAG** system.
- Build the `OutlookIntegrationService`.
- Set up a background Cron Job to run these sensors.
- **Testing & Debugging:** Write automated Integration Tests for the Canvas Playwright scraper. Build specific debug scripts (e.g., `npm run debug:canvas`) to run the scrapers visibly when they break so we can quickly diagnose UI changes. All data must pass Zod validation in tests. 
- **Milestone:** Your database automatically populates with real assignments, and tests prove the data is parsed flawlessly.

## Phase 3: Designing the Face (The UI Widget)
**Goal:** Build the cross-platform application so you can actually see and interact with your prioritized data.
- Initialize the cross-platform application (React Native / Expo).
- Implement the **Offline-First** local database (WatermelonDB / Expo SQLite).
- Build the REST/GraphQL API routes in the Node.js backend.
- Implement the UI components (as defined in `ui_requirements.md`).
- Build the "System Health" view to display the structured logs and scraper errors.
- **Testing & Debugging:** Write frontend component tests. Ensure the System Health view acts as a first-class UI debugging tool that correctly catches and displays simulated backend errors so we know it will warn you if Canvas breaks.
- **Milestone:** You have a working, bug-tested widget that shows your task list and functions perfectly even when offline.

## Phase 4: Empowering the Hands (AI Agents & MCP)
**Goal:** Automate complex multi-step tasks using the AI.
- Integrate the Google Antigravity SDK into the backend.
- Build the 3 local MCP servers (`mcp-postgres`, `mcp-uni-sensors`, `mcp-actions`).
- Implement the **Strict Data Sanitization** utility to strip PII before any data hits an LLM.
- Program the Orchestrator and Execution Agents.
- Wire up the Face widget for 2FA human-in-the-loop approvals (SWAMID/BankID).
- **Testing & Debugging:** Write End-to-End (E2E) tests using a mocked Ladok server. Build an "Agent Trace" logging system so if the AI hallucinate or fails, we can see its exact thought process, prompt, and tool calls in the System Health view.
- **Milestone:** The widget asks you to approve an exam registration, you click yes, and the AI securely executes the process in the background.
