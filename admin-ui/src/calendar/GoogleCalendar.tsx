import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Clock } from 'lucide-react';
import type { CalendarEvent, CalendarView } from './types';
import { sourceColor } from './types';
import {
  addDays,
  addMonths,
  dayNameShort,
  eventsForDay,
  formatMonthYear,
  formatTimeRange,
  HOUR_END,
  HOUR_HEIGHT,
  HOUR_START,
  hoursRange,
  isSameDay,
  isToday,
  layoutDayEvents,
  monthGridDays,
  weekDays,
} from './utils';
import './calendar.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MINI_HEAD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface Props {
  events: CalendarEvent[];
  loading?: boolean;
}

export function GoogleCalendar({ events, loading }: Props) {
  const [view, setView] = useState<CalendarView>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const [, tick] = useState(0);

  // Refresh current-time indicator every minute.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const goToday = () => setCursor(new Date());

  const navigate = (dir: -1 | 1) => {
    if (view === 'month') setCursor((c) => addMonths(c, dir));
    else if (view === 'week') setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => addDays(c, dir));
  };

  const title = useMemo(() => {
    if (view === 'month') return formatMonthYear(cursor);
    if (view === 'week') {
      const days = weekDays(cursor);
      const start = days[0];
      const end = days[6];
      if (start.getMonth() === end.getMonth()) {
        return `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
      }
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [view, cursor]);

  const openEvent = (e: MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverPos({ x: Math.min(rect.left, window.innerWidth - 320), y: rect.bottom + 8 });
    setSelected(event);
  };

  const closePopover = () => setSelected(null);

  const jumpToDay = (day: Date) => {
    setCursor(day);
    setView('day');
  };

  const nowLineTop = useMemo(() => {
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    const start = HOUR_START * 60;
    if (min < start || min > HOUR_END * 60) return null;
    return ((min - start) / 60) * HOUR_HEIGHT;
  }, [tick]);

  const renderMiniMonth = () => {
    const days = monthGridDays(cursor);
    const month = cursor.getMonth();
    return (
      <div className="gcal-mini">
        <div className="gcal-mini-month">{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</div>
        <div className="gcal-mini-grid">
          {MINI_HEAD.map((d, i) => (
            <div key={i} className="gcal-mini-head">{d}</div>
          ))}
          {days.map((day) => {
            const other = day.getMonth() !== month;
            const today = isToday(day);
            const sel = isSameDay(day, cursor);
            return (
              <button
                key={day.toISOString()}
                type="button"
                className={`gcal-mini-day${other ? ' other-month' : ''}${today ? ' today' : ''}${sel ? ' selected' : ''}`}
                onClick={() => jumpToDay(day)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <div className="gcal-legend">
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>Calendars</div>
          {['timeedit', 'outlook', 'canvas', 'ladok'].map((src) => (
            <div key={src} className="gcal-legend-item">
              <span className="gcal-legend-dot" style={{ background: sourceColor(src) }} />
              {src.charAt(0).toUpperCase() + src.slice(1)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMonth = () => {
    const days = monthGridDays(cursor);
    const month = cursor.getMonth();
    return (
      <div className="gcal-month">
        <div className="gcal-month-head">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="gcal-month-head-cell">{d}</div>
          ))}
        </div>
        <div className="gcal-month-grid">
          {days.map((day) => {
            const dayEvents = eventsForDay(events, day);
            const other = day.getMonth() !== month;
            const visible = dayEvents.slice(0, 3);
            const more = dayEvents.length - visible.length;
            return (
              <div
                key={day.toISOString()}
                className={`gcal-month-cell${other ? ' other-month' : ''}${isToday(day) ? ' today' : ''}`}
                onClick={() => jumpToDay(day)}
              >
                <span className="gcal-month-day-num">{day.getDate()}</span>
                {visible.map((ev) => (
                  <div
                    key={ev.id}
                    className="gcal-month-event"
                    style={{ background: sourceColor(ev.source) }}
                    onClick={(e) => openEvent(e, ev)}
                    title={ev.title}
                  >
                    {!ev.allDay && <span style={{ opacity: 0.85 }}>{ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} </span>}
                    {ev.title}
                  </div>
                ))}
                {more > 0 && <div className="gcal-month-more">+{more} more</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTimeGrid = (days: Date[]) => {
    const colCount = days.length;
    const gridHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
    return (
      <div className="gcal-time-grid">
        <div className="gcal-time-head">
          <div className="gcal-time-gutter" />
          <div className="gcal-time-head-days" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
            {days.map((day) => (
              <div key={day.toISOString()} className={`gcal-time-head-day${isToday(day) ? ' today' : ''}`}>
                <div className="gcal-time-head-dow">{dayNameShort(day)}</div>
                <div className="gcal-time-head-num">{day.getDate()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* All-day row */}
        <div className="gcal-allday-row">
          <div className="gcal-allday-label">all-day</div>
          <div className="gcal-allday-cols" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
            {days.map((day) => {
              const allDay = eventsForDay(events, day).filter((e) => e.allDay);
              return (
                <div key={day.toISOString()} className="gcal-allday-col">
                  {allDay.map((ev) => (
                    <div
                      key={ev.id}
                      className="gcal-allday-event"
                      style={{ background: sourceColor(ev.source) }}
                      onClick={(e) => openEvent(e, ev)}
                    >
                      {ev.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="gcal-time-scroll">
          <div className="gcal-time-body" style={{ height: gridHeight }}>
            <div className="gcal-time-labels">
              {hoursRange().map((h) => (
                <div key={h} className="gcal-time-label">
                  {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
                </div>
              ))}
            </div>
            <div className="gcal-time-cols" style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}>
              {days.map((day) => {
                const positioned = layoutDayEvents(eventsForDay(events, day), HOUR_START, HOUR_HEIGHT);
                return (
                  <div key={day.toISOString()} className="gcal-time-col" style={{ height: gridHeight }}>
                    {hoursRange().map((h, i) => (
                      <div key={h} className="gcal-hour-line" style={{ top: i * HOUR_HEIGHT }} />
                    ))}
                    {isToday(day) && nowLineTop !== null && (
                      <div className="gcal-now-line" style={{ top: nowLineTop }} />
                    )}
                    {positioned.map(({ event, top, height, column, columnCount }) => {
                      const widthPct = 100 / columnCount;
                      const leftPct = column * widthPct;
                      return (
                        <div
                          key={event.id}
                          className="gcal-timed-event"
                          style={{
                            top,
                            height,
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                            background: sourceColor(event.source),
                          }}
                          onClick={(e) => openEvent(e, event)}
                        >
                          <div className="gcal-timed-event-title">{event.title}</div>
                          {height > 30 && (
                            <div className="gcal-timed-event-time">{formatTimeRange(event.start, event.end)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="gcal"><div className="gcal-empty">Loading calendar…</div></div>;
  }

  return (
    <>
      <div className="gcal">
        <div className="gcal-toolbar">
          <div className="gcal-toolbar-left">
            <button type="button" className="gcal-btn" onClick={goToday}>Today</button>
            <button type="button" className="gcal-btn gcal-btn-icon" onClick={() => navigate(-1)} aria-label="Previous">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="gcal-btn gcal-btn-icon" onClick={() => navigate(1)} aria-label="Next">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="gcal-toolbar-center">{title}</div>
          <div className="gcal-toolbar-right">
            {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={`gcal-view-btn${view === v ? ' active' : ''}`}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="gcal-body">
          {renderMiniMonth()}
          <div className="gcal-main">
            {events.length === 0 ? (
              <div className="gcal-empty">
                No events yet. Sync TimeEdit or Outlook from the sidebar, then click Trigger Sync.
              </div>
            ) : view === 'month' ? (
              renderMonth()
            ) : view === 'week' ? (
              renderTimeGrid(weekDays(cursor))
            ) : (
              renderTimeGrid([cursor])
            )}
          </div>
        </div>
      </div>

      {selected && (
        <>
          <div className="gcal-popover-backdrop" onClick={closePopover} />
          <div className="gcal-popover" style={{ left: popoverPos.x, top: popoverPos.y }}>
            <div className="gcal-popover-title" style={{ borderColor: sourceColor(selected.source) }}>
              {selected.title}
            </div>
            <div className="gcal-popover-row">
              <Clock size={14} />
              <span>
                {selected.allDay
                  ? selected.start.toLocaleDateString()
                  : `${selected.start.toLocaleDateString()} · ${formatTimeRange(selected.start, selected.end)}`}
              </span>
            </div>
            {selected.location && (
              <div className="gcal-popover-row">
                <MapPin size={14} />
                <span>{selected.location}</span>
              </div>
            )}
            <div className="gcal-popover-row">
              <span className="gcal-legend-dot" style={{ background: sourceColor(selected.source), marginTop: 4 }} />
              <span>{selected.source}</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
