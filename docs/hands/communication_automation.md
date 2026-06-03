# Hands: Communication Automation

## Goal
To reduce the executive dysfunction barrier of initiating contact with professors or study groups.

## The Human Workflow
1. The student needs an extension on an assignment or wants to organize a group meeting.
2. The student stares at a blank email/Teams message for 20 minutes trying to formulate a professional sounding request.
3. The student finally sends it.

## The Agent Automation Strategy
The system uses the LLM to draft context-aware messages on the student's behalf.

### Example: Requesting an Extension
1. **Trigger:** User clicks "I need an extension" on an assignment in the Face widget.
2. **Agent Action:** 
   - Reads the assignment details from the Brain.
   - Drafts a polite, professional email requesting a 24-hour extension due to high workload.
3. **User Approval:** The draft is shown in the Face widget. The user clicks "Send".
4. **Execution:** The Agent uses the Outlook Integration MCP to actually send the email.
