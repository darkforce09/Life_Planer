import type { CalendarEvent } from './types';

/** Week starts on Monday (European / Swedish convention). */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function formatDayHeader(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dayNameShort(date: Date): string {
  const day = date.getDay();
  return DAY_NAMES[day === 0 ? 6 : day - 1];
}

/** Build a 6-row month grid (42 cells) starting from the Monday before/on the 1st. */
export function monthGridDays(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function detectAllDay(start: Date, end: Date): boolean {
  const durationMs = end.getTime() - start.getTime();
  const startsMidnight = start.getHours() === 0 && start.getMinutes() === 0;
  return durationMs >= 23 * 60 * 60 * 1000 || (startsMidnight && durationMs >= 12 * 60 * 60 * 1000);
}

export function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((e) => isSameDay(e.start, day) || (e.allDay && e.start <= day && e.end >= day));
}

export function eventsInRange(events: CalendarEvent[], from: Date, to: Date): CalendarEvent[] {
  return events.filter((e) => e.end >= from && e.start <= to);
}

/** Layout timed events in columns to avoid overlap (simplified Google-style). */
export interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  column: number;
  columnCount: number;
}

export function layoutDayEvents(
  dayEvents: CalendarEvent[],
  dayStartHour: number,
  hourHeight: number,
): PositionedEvent[] {
  const timed = dayEvents.filter((e) => !e.allDay);
  if (timed.length === 0) return [];

  const sorted = [...timed].sort((a, b) => a.start.getTime() - b.start.getTime());
  const positioned: PositionedEvent[] = [];
  const columns: { end: number }[] = [];

  for (const event of sorted) {
    const startMin = event.start.getHours() * 60 + event.start.getMinutes();
    const endMin = event.end.getHours() * 60 + event.end.getMinutes();
    const dayStartMin = dayStartHour * 60;
    const top = ((startMin - dayStartMin) / 60) * hourHeight;
    const height = Math.max(((endMin - startMin) / 60) * hourHeight, 22);

    let col = columns.findIndex((c) => c.end <= startMin);
    if (col === -1) {
      col = columns.length;
      columns.push({ end: endMin });
    } else {
      columns[col].end = endMin;
    }

    positioned.push({ event, top, height, column: col, columnCount: 1 });
  }

  const colCount = Math.max(columns.length, 1);
  return positioned.map((p) => ({ ...p, columnCount: colCount }));
}

export const HOUR_START = 7;
export const HOUR_END = 22;
export const HOUR_HEIGHT = 48;

export function hoursRange(): number[] {
  return Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
}
