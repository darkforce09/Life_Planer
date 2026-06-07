import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch, apiGet } from './api';

interface Approval {
  id: string;
  action: string;
  title: string;
  details?: Record<string, unknown>;
  status: string;
  createdAt: string;
}

/**
 * Human-in-the-loop approvals for destructive agent actions (exam signup, email send, 2FA).
 */
export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ approvals: Approval[] }>('/api/approvals');
      setApprovals(data.approvals || []);
    } catch {
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const resolve = async (id: string, approved: boolean) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    try {
      await apiFetch(`/api/approvals/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      });
    } catch {
      load();
    }
  };

  if (loading) {
    return <div className="panel"><div className="muted">Loading approvals…</div></div>;
  }

  return (
    <div className="panel">
      <h2 className="panel-title"><ShieldCheck size={18} /> Pending Approvals</h2>
      {approvals.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No actions waiting for your approval.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {approvals.map((a) => (
            <div key={a.id} style={{ padding: 14, borderRadius: 8, background: 'rgba(255, 179, 0, 0.08)', border: '1px solid rgba(255, 179, 0, 0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ffb300', marginBottom: 6 }}>
                {a.action.replace(/_/g, ' ').toUpperCase()}
              </div>
              <div style={{ marginBottom: 10 }}>{a.title}</div>
              {a.details && Object.keys(a.details).length > 0 && (
                <pre style={{ fontSize: 11, opacity: 0.8, margin: '0 0 10px 0', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(a.details, null, 2)}
                </pre>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-success" onClick={() => resolve(a.id, true)}>Approve</button>
                <button className="btn-secondary" onClick={() => resolve(a.id, false)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
