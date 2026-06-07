import { useCallback, useEffect, useState } from 'react';
import { Bot, Play } from 'lucide-react';
import { apiFetch, apiGet } from './api';

interface AgentTrace {
  id: string;
  runId: string;
  agent: string;
  kind: string;
  content: string;
  createdAt: string;
}

/**
 * Agent trace log + manual Orchestrator trigger for debugging autonomous workflows.
 */
export function AgentsPanel() {
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ traces: AgentTrace[] }>('/api/agents/traces');
      setTraces(data.traces || []);
    } catch {
      setTraces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const runOrchestrator = async () => {
    setRunning(true);
    try {
      await apiFetch('/api/agents/orchestrate', { method: 'POST' });
      setTimeout(load, 2000);
    } catch {
      alert('Failed to start orchestrator. Is the backend running?');
    }
    setRunning(false);
  };

  if (loading) {
    return <div className="panel"><div className="muted">Loading agent traces…</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="panel">
        <h2 className="panel-title"><Bot size={18} /> Orchestrator</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 0 }}>
          Manually run the Orchestrator agent. Destructive actions still require approval in the Approvals tab.
        </p>
        <button className="btn-primary" onClick={runOrchestrator} disabled={running}>
          <Play size={16} /> {running ? 'Starting…' : 'Run Orchestrator'}
        </button>
      </div>

      <div className="panel">
        <h2 className="panel-title"><Bot size={18} /> Agent Traces</h2>
        {traces.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No agent activity recorded yet.</p>
        ) : (
          <div className="logs-container">
            {traces.map((t) => (
              <div key={t.id} className="log-entry">
                <span className="timestamp">{new Date(t.createdAt).toLocaleTimeString()}</span>
                <span className="INFO">[{t.agent}/{t.kind}]</span>{' '}
                {t.content.length > 300 ? `${t.content.slice(0, 300)}…` : t.content}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
