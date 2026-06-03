# Face: UI Requirements

## Goal
To build a "dead simple," zero-clutter interface that tells the student exactly what to do next without overwhelming them with options.

## Core Philosophy
- **No Navigation Bars:** There shouldn't be 5 different tabs to click through.
- **Action-Oriented:** Every item on the screen should be something you can act upon.
- **Dark Mode Default:** For aesthetics and reduced eye strain.
- **Platform Agnostic:** It must be a "normal app" with native widget support on both Desktop and Mobile. We will likely use a cross-platform framework like React Native (Expo) or Tauri.
- **Offline-First (Local Sync):** The app must function flawlessly even with zero internet connection (e.g., on a train). It will use a local database like WatermelonDB or Expo SQLite, which quietly syncs with your self-hosted PostgreSQL server in the background when a connection is available.

## The Widget Design

### 1. "The Next Right Thing" (Top Section)
The single most critical task right now, as determined by the Brain's Prioritization Engine.
*   **Example:** "Register for Anatomy Exam."
*   **Action Button:** [ Automate ] (Triggers the Ladok/Reveljen Hands agent).

### 2. "Upcoming Tasks" (Middle Section)
A short, scrollable list of the next 3-5 tasks. Nothing further out than 1 week is shown unless it's a massive project.
*   **Example:** "Read Chapter 4 (Due tomorrow)".
*   **Action Button:** [ Mark Done ] or [ Need Help/Extension ].

### 3. "Today's Schedule" (Bottom Section)
A simple timeline pulled from the TimeEdit sensor.
*   **Example:** 10:00 - 12:00: Seminar (Zoom Link attached).

## Push Notifications
- The system should be completely silent unless a critical deadline is approaching within 24 hours and the task is still PENDING.
- Push notifications should have action buttons embedded if the platform allows it.
