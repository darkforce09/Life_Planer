import { useCallback, useEffect, useState } from 'react';
import { apiGet } from './api';
import { GoogleCalendar } from './calendar/GoogleCalendar';
import type { CalendarEvent } from './calendar/types';
import { detectAllDay } from './calendar/utils';

interface ApiEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  source: string;
}

interface ApiExam {
  id: string;
  title: string;
  examDateTime: string | null;
  examDate: string | null;
  place: string | null;
  courseCode: string | null;
  courseName: string | null;
}

function toCalendarEvent(
  id: string,
  title: string,
  start: Date,
  end: Date,
  location: string | null,
  source: string,
): CalendarEvent {
  return { id, title, start, end, location, source, allDay: detectAllDay(start, end) };
}

function parseExamStart(exam: ApiExam): Date | null {
  if (exam.examDateTime) {
    const d = new Date(exam.examDateTime);
    if (!isNaN(d.getTime())) return d;
  }
  if (exam.examDate) {
    const iso = exam.examDate.match(/\d{4}-\d{2}-\d{2}/);
    if (iso) {
      const d = new Date(iso[0]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Full calendar view (Google Calendar–style) for TimeEdit, Outlook, and Ladok exams.
 */
export function CalendarPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Each source fails independently so a broken endpoint doesn't blank the calendar.
    const [eventsRes, examsRes] = await Promise.all([
      apiGet<{ events: ApiEvent[] }>('/api/events').catch(() => ({ events: [] as ApiEvent[] })),
      apiGet<{ exams: ApiExam[] }>('/api/ladok/exams').catch(() => ({ exams: [] as ApiExam[] })),
    ]);

    const fromEvents = (eventsRes.events || []).map((e) => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return toCalendarEvent(e.id, e.title, start, end, e.location, e.source);
    });

    const fromExams = (examsRes.exams || [])
      .map((exam) => {
        const start = parseExamStart(exam);
        if (!start) return null;
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
        const title = exam.courseCode
          ? `[Exam] ${exam.title} (${exam.courseCode})`
          : `[Exam] ${exam.title}`;
        return toCalendarEvent(`exam-${exam.id}`, title, start, end, exam.place, 'ladok');
      })
      .filter((e): e is CalendarEvent => e !== null);

    setEvents([...fromEvents, ...fromExams]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  return <GoogleCalendar events={events} loading={loading} />;
}
