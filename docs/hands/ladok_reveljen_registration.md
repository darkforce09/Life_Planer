# Hands: Ladok & Reveljen Exam Registration

## Goal
To automate the multi-step, high-friction process of registering for an exam. This is one of the most stressful administrative tasks because missing a deadline has severe consequences.

## The Human Workflow (What we are automating)
1. **Notification:** The student realizes an exam is coming up.
2. **Ladok Step 1:** Log into Ladok.
3. **Ladok Step 2:** Navigate to upcoming exams and click "Register" for the specific course.
4. **MIUN Check:** Ensure the registration synced with MIUN's internal systems.
5. **Reveljen Request:** Because the student is decentralized in Sollefteå, they must fill out a request form on Reveljen to write the exam locally.
6. **Confirmation:** Wait for an email from Reveljen confirming the seat.

## The Agent Automation Strategy
Since Ladok and Reveljen do not have open APIs for students, the AI Execution Agent will need to use Browser Automation (e.g., Puppeteer or Playwright via MCP).

### Agent Execution Steps:
1. **Trigger:** The Brain detects a new exam registration period has opened and creates an `AgentTask`.
2. **User Approval:** The Face widget shows: "Exam registration open for OM1234. Click to automate."
3. **Execution (The 2FA Handoff):**
   - The Agent spins up a visible or semi-headless browser.
   - It navigates to the Ladok login page (SWAMID).
   - **CRITICAL:** If a saved session cookie is expired, the Agent pauses execution and pings the Face widget: "Action Required: Please approve SWAMID login on your device."
   - Once the user approves the 2FA, the Agent resumes, finds the target exam, and clicks register.
   - It then navigates to Reveljen. 
   - **CRITICAL:** Reveljen uses BankID. The Agent fills in the personal number and pings the Face widget: "Action Required: Open BankID to approve Reveljen login."
   - Once approved, the Agent fills out the web form (Course Code, Exam Date, Location: Sollefteå) and submits it.
4. **Result:** The Agent updates the task status to "COMPLETED".

## Implementation & Engineering Notes
- **Programming Method:** The automation script must be encapsulated within an OOP Class (`LadokAutomationAgent`). It should use dependency injection to receive the headless browser instance.
- **Code Documentation:** Because web scraping is brittle, extensive inline comments must explain *why* specific DOM selectors are being targeted, and JSDoc must document the expected state of the page before and after each action.
