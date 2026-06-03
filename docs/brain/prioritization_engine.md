# Brain: Prioritization Engine

## Goal
To calculate what the student actually needs to see *right now*, factoring in upcoming deadlines and attempting to minimize cognitive load.

## The Problem
Seeing 50 pending tasks is overwhelming. The Prioritization Engine hides tasks that aren't relevant yet and highlights those that are critical.

## Priority Score Calculation
Each `Task` receives a `priority_score` (0-100).

### Factors:
1. **Urgency (Time to Deadline):**
   - Due today: +50 pts
   - Due tomorrow: +30 pts
   - Due next week: +10 pts
   - Overdue: +80 pts
2. **Impact (Weight of Task):**
   - Exam registration: +40 pts
   - Final Assignment: +30 pts
   - Reading material: +10 pts
3. **Cognitive Load Modifier (Optional Future Feature):**
   - If the user reports high stress, the engine might break down large tasks into smaller ones or temporarily hide low-impact tasks entirely.

## Output
The Face (UI widget) will query the Brain for tasks sorted by `priority_score` descending.
