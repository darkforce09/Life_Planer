import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { apiFetch, apiGet } from './api';

interface PipelineRun {
  id: string;
  type: string;
  status: string;
  currentStage: string | null;
  startedAt: string;
  finishedAt: string | null;
  error?: string | null;
  stages?: Array<{ name: string; status: string; error?: string }>;
}

interface Alert {
  id: string;
  severity: string;
  source: string | null;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

/**
 * Pipeline run history + system alerts surfaced from the backend reliability layer.
 */
export function PipelineAlertsPanel() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [healthRes, runsRes, alertsRes] = await Promise.all([
        apiFetch('/api/health'),
        apiGet<{ runs: PipelineRun[] }>('/api/pipeline/runs'),
        apiGet<{ alerts: Alert[] }>('/api/alerts'),
      ]);
      if (healthRes.ok) {
        const health = await healthRes.json();
        setActiveRun(health.pipeline?.active ?? null);
      }
      setRuns(runsRes.runs || []);
      setAlerts((alertsRes.alerts || []).filter((a) => !a.acknowledged));
    } catch {
      // Backend offline; keep last known state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const ackAlert = async (id: string) => {
    try {
      await apiFetch(`/api/alerts/${id}/ack`, { method: 'POST' });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      load();
    }
  };

  if (loading) {
    return <div className="panel"><div className="muted">Loading pipeline status…</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {activeRun && (
        <div className="panel" style={{ border: '1px solid rgba(33, 150, 243, 0.4)' }}>
          <h2 className="panel-title"><Activity size={18} /> Active Pipeline</h2>
          <p style={{ margin: '0 0 8px 0' }}>
            <strong>{activeRun.type}</strong> — stage: <code>{activeRun.currentStage || 'starting'}</code>
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
            Started {new Date(activeRun.startedAt).toLocaleString()}
          </p>
        </div>
      )}

      <div className="panel">
        <h2 className="panel-title"><AlertTriangle size={18} /> Alerts</h2>
        {alerts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No active alerts.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  borderLeft: `3px solid ${a.severity === 'critical' ? '#f44336' : a.severity === 'warning' ? '#ffb300' : '#4caf50'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                      {a.severity.toUpperCase()}{a.source ? ` · ${a.source}` : ''} · {new Date(a.createdAt).toLocaleString()}
                    </div>
                    <div>{a.message}</div>
                  </div>
                  <button className="btn-secondary" onClick={() => ackAlert(a.id)}>Ack</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title"><Activity size={18} /> Recent Pipeline Runs</h2>
        {runs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No pipeline runs yet. Trigger Canvas deep-sync to start one.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runs.map((r) => (
              <div key={r.id} style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{r.type}</strong>
                  <span className={`status-badge status-${r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'error' : 'pending'}`}>
                    {r.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {r.currentStage && <>Stage: {r.currentStage} · </>}
                  {new Date(r.startedAt).toLocaleString()}
                  {r.finishedAt && <> → {new Date(r.finishedAt).toLocaleString()}</>}
                </div>
                {r.error && (
                  <div style={{ fontSize: 12, color: '#f44336', marginTop: 6 }}>{r.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
