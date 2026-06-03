# Brain: Data Structures

## Goal
To define the central data models that will store everything the student needs to keep track of, normalizing data from various sensors into a single source of truth.

## Core Models

### 1. Task
Represents an actionable item.
- `id`: Unique identifier
- `title`: Short description of what needs to be done
- `description`: Full details or instructions
- `due_date`: When it must be completed
- `status`: PENDING, IN_PROGRESS, COMPLETED
- `source`: CANVAS, OUTLOOK, USER_CREATED, etc.
- `priority_score`: Calculated integer (higher = more urgent)

### 2. Event
Represents a scheduled block of time.
- `id`: Unique identifier
- `title`: Name of the event (e.g., Lecture, Seminar)
- `start_time`: Datetime
- `end_time`: Datetime
- `location`: Zoom link or physical room
- `course_code`: Associated course

### 3. Course
Represents a university course.
- `code`: Course code (e.g., OM1234)
- `name`: Full course name
- `term`: E.g., Fall 2026

## Relationships
- A `Task` can be linked to a `Course`.
- An `Event` is linked to a `Course`.
- The Prioritization Engine uses these relationships to determine context.

## Knowledge Embeddings (RAG)
To enable the AI to intelligently answer questions (e.g., "What chapters are on the anatomy exam?"), the database will utilize the `pgvector` PostgreSQL extension.
- Syllabus PDFs and reading materials scraped by the Sensors will be chunked, converted to vector embeddings, and stored.
- This creates a Retrieval-Augmented Generation (RAG) system directly tied to your courses.
