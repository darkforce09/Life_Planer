export type CalendarView = 'month' | 'week' | 'day';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  source: string;
  allDay: boolean;
}

export const SOURCE_COLORS: Record<string, string> = {
  timeedit: '#4285f4',
  outlook: '#9c27b0',
  canvas: '#e91e63',
  ladok: '#f59e0b',
  system: '#607d8b',
};

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source.toLowerCase()] ?? '#3b82f6';
}
