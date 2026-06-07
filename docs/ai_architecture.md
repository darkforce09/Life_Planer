# AI & MCP Architecture

## Goal
To define exactly how the Google Antigravity SDK and Model Context Protocol (MCP) servers interact with our custom TypeScript backend to create a secure, autonomous multi-agent system.

## The Multi-Agent System (Antigravity SDK)
Instead of using a single monolithic AI that tries to do everything, we will use the Antigravity SDK to define specialized subagents:

### 1. The Orchestrator Agent (The Brain)
- **Role:** The manager. 
- **Behavior:** Wakes up on a cron schedule or when pinged by the Face widget. It evaluates the current database state, checks for high-priority items, and decides if any actions need to be taken.
- **Delegation:** If an action is required (e.g., drafting an email), the Orchestrator spawns an Execution Agent to handle it.

### 2. The Execution Agent (The Hands)
- **Role:** The worker.
- **Behavior:** Spawned by the Orchestrator to handle single, complex workflows (like the Ladok Exam Registration). It is given a specific prompt and access to specific MCP tools. Once the task is complete, it reports back and terminates.

## Model Context Protocol (MCP) Servers
To safely give the agents access to our backend without hardcoding logic into the agent prompt, we will build custom local MCP servers. These servers expose our pure functional TypeScript modules as callable tools.

### 1. Database MCP Server (`mcp-postgres`)
- **Purpose:** Gives the Orchestrator Agent controlled access to read/write the PostgreSQL database.
- **Exposed Tools (Examples):**
  - `get_pending_tasks(limit, course_id)`
  - `update_task_status(task_id, new_status)`
  - `log_system_event(message)`

### 2. University Sensor MCP Server (`mcp-uni-sensors`)
- **Purpose:** Exposes the methods of `CanvasLMSService`, `TimeEditService`, etc., so the Orchestrator Agent can manually trigger syncs or search for specific data.
- **Exposed Tools (Examples):**
  - `force_canvas_sync()`
  - `search_recent_emails(query)`
  - `get_teams_announcements(course_code)`

### 3. Execution Action MCP Server (`mcp-actions`)
- **Purpose:** Exposes the tools required for the Execution Agent to perform web scraping and communication.
- **Exposed Tools (Examples):**
  - `start_browser_session(target_url)`
  - `click_dom_element(selector)`
  - `fill_web_form(selector, value)`
  - `send_outlook_email(to, subject, body)`
  - `request_user_2fa_approval(platform)`: Pings the Face widget to ask the user to open BankID/SWAMID.

## Security & Human-in-the-Loop Rules
- **No Unapproved Actions:** All destructive actions (e.g., submitting an exam registration, sending an email) MUST require explicit user approval via the Face widget before the MCP tool executes the final commit.
- **Strict Scoping:** The agents cannot run arbitrary bash commands. They can *only* call the specific tools exposed by the MCP servers, ensuring they only interact with the exact pure functional logic we write.
