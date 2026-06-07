import { useEffect, useState } from 'react';
import { Calendar, MapPin } from 'lucide-react';
import { apiGet } from './api';

interface EventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  source: string;
}

/**
 * Calendar/schedule surface for the ingested `events` table (TimeEdit, Outlook).
 * Groups upcoming events by day.
 */
export function CalendarPanel() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ events: EventItem[] }>('/api/events')
      .then((data) => setEvents(data.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="panel"><div className="muted">Loading calendar…</div></div>;

  if (events.length === 0) {
    return (
      <div className="panel">
        <div className="muted">No events yet. Sync TimeEdit or Outlook to populate your schedule.</div>
      </div>
    );
  }

  // Group by date (YYYY-MM-DD).
  const groups = new Map<string, EventItem[]>();
  for (const e of [...events].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))) {
    const day = new Date(e.startTime).toLocaleDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 style={{ margin: 0 }}><Calendar size={18} /> Upcoming Schedule</h2>
      </div>
      {[...groups.entries()].map(([day, dayEvents]) => (
        <div key={day} style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8, opacity: 0.8 }}>{day}</h3>
          {dayEvents.map((e) => (
            <div key={e.id} className="event-row" style={{ padding: 10, marginBottom: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', gap: 12, marginTop: 4 }}>
                <span>
                  {new Date(e.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {new Date(e.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {e.location && <span><MapPin size={12} /> {e.location}</span>}
                <span className="status-badge status-ok">{e.source}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
