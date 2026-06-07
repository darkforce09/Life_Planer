import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { apiPost } from './api';

interface RagMatch {
  content: string;
  filePath: string;
  courseFolder: string | null;
  score: number;
}

/**
 * Knowledge-base query panel: runs a pgvector similarity search and an optional
 * Gemini-synthesized answer over the ingested RAG content.
 */
export function RagPanel() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<RagMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: 'search' | 'answer') => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      if (mode === 'answer') {
        const data = await apiPost('/api/rag/answer', { query, topK: 8 });
        setAnswer(data.answer);
        setSources(data.sources || []);
      } else {
        const data = await apiPost('/api/rag/query', { query, topK: 8 });
        setSources(data.results || []);
      }
    } catch (e) {
      setError('Query failed. Is the backend running and the knowledge base embedded?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 style={{ margin: 0 }}>Knowledge Base Search</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="config-input"
          style={{ flex: 1 }}
          placeholder="Ask a question about your course material..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run('answer')}
        />
        <button className="btn" onClick={() => run('search')} disabled={loading}>
          <Search size={16} /> Search
        </button>
        <button className="btn btn-primary" onClick={() => run('answer')} disabled={loading}>
          <Sparkles size={16} /> Ask AI
        </button>
      </div>

      {loading && <div className="muted">Searching the knowledge base...</div>}
      {error && <div className="error-text">{error}</div>}

      {answer && (
        <div className="rag-answer" style={{ marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {answer}
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Sources</h3>
          {sources.map((s, i) => (
            <div key={i} className="rag-source" style={{ marginBottom: 12, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
                <span>[{i + 1}] {s.filePath.split('/').pop()}</span>
                <span>score {s.score.toFixed(3)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                {s.content.slice(0, 400)}{s.content.length > 400 ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
