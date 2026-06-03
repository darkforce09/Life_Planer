# Outlook Integration

## Goal
To scan university emails for important updates that aren't posted on Canvas (e.g., sudden schedule changes, direct messages from professors).

## Data Required
- **Emails:** Sender, subject, body text, timestamp.

## API / Access Strategy
- Microsoft Graph API using the university email credentials.
- Need to check if IMAP access is enabled as a fallback if the university restricts Graph API apps.

## Polling Frequency
- Every 1-2 hours.
