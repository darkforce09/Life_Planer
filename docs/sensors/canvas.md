# Canvas LMS Integration

## Goal
To automatically monitor Canvas for new assignments, announcements, and shifting deadlines so the student never misses a critical update.

## Data Required
- **Courses:** List of currently active courses.
- **Assignments:** Titles, descriptions, due dates, submission status.
- **Announcements:** Urgent messages from professors.

## API / Access Strategy
- **CONFIRMED:** The university has disabled self-generated API tokens.
- **Strategy:** We must use a headless browser automation tool (Puppeteer/Playwright) via MCP to log into Canvas using the student's credentials and scrape the dashboard and assignment pages.
- **Session Management:** The agent must save session cookies locally so it doesn't trigger 2FA on every single sync.

## Polling Frequency
- Check for updates every 1-2 hours during the day.

## Implementation & Engineering Notes
- **Programming Method:** Must be implemented as a strict OOP Class (`CanvasLMSService`) that implements the `IntegrationService` interface.
- **Code Documentation:** All methods calling the Canvas API must have thorough JSDoc comments (`@param`, `@returns`) explaining the expected payload and error states.
