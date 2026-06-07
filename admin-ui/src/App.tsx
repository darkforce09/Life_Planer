import { useEffect, useState } from 'react';
import { Activity, Database, Terminal, RefreshCw, Clock, Calendar, Hash, Save, Settings, Search, AlertTriangle, ShieldCheck, Bot, Mail } from 'lucide-react';
import './index.css';
import { RagPanel } from './RagPanel';
import { CalendarPanel } from './CalendarPanel';
import { PipelineAlertsPanel } from './PipelineAlertsPanel';
import { ApprovalsPanel } from './ApprovalsPanel';
import { AgentsPanel } from './AgentsPanel';
import { apiFetch } from './api';

type AppView = 'DASHBOARD' | 'TIMEEDIT' | 'CANVAS' | 'LADOK' | 'RAG' | 'CALENDAR' | 'OPERATIONS' | 'APPROVALS' | 'AGENTS' | 'OUTLOOK';

function getRelativeTimeString(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `In ${diffDays} days`;
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  
  return date.toLocaleDateString();
}

function parseTaskTitle(rawTitle: string) {
  let title = rawTitle.replace(/^Attend:\s*/, '');
  let tags: {label: string, type: string}[] = [];

  // Extract Course Code
  const courseMatch = title.match(/Kurs:\s*([^,]+)/i);
  if (courseMatch) {
    tags.push({ label: courseMatch[1].trim(), type: 'course' });
    title = title.replace(courseMatch[0], '').replace(/^,\s*/, '');
  }

  // Activity Types
  if (/tentamen|exam/i.test(title)) {
    tags.push({ label: 'Exam', type: 'exam' });
  } else if (/omexamination/i.test(title)) {
    tags.push({ label: 'Re-exam', type: 'exam-alert' });
  } else if (/seminarium/i.test(title)) {
    tags.push({ label: 'Seminar', type: 'lecture' });
  } else if (/egna studier/i.test(title)) {
    tags.push({ label: 'Self Study', type: 'study' });
  } else if (/föreläsning/i.test(title)) {
    tags.push({ label: 'Lecture', type: 'lecture' });
  }

  // Format Types
  if (/inspera/i.test(title)) {
    tags.push({ label: 'Inspera', type: 'format' });
  }
  if (/zoom/i.test(title)) {
    tags.push({ label: 'Zoom', type: 'format' });
  }
  
  // Clean up "Moment: " prefix in title
  title = title.replace(/Moment:\s*/i, '');
  // Clean up leading commas
  title = title.replace(/^,\s*/, '').trim();

  // Fallback
  if (tags.length === 0) {
    tags.push({ label: 'Event', type: 'default' });
  }

  return { tags, title };
}

function getPriorityClass(score: number) {
  if (score >= 80) return 'priority-high';
  if (score >= 40) return 'priority-med';
  return 'priority-low';
}

function formatForInput(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function App() {
  const [currentView, setCurrentView] = useState<AppView>('DASHBOARD');
  
  const [health, setHealth] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [ragStats, setRagStats] = useState<any>(null);
  
  const [timeEditConfig, setTimeEditConfig] = useState<any>({ url: '' });
  const [savingConfig, setSavingConfig] = useState(false);
  
  const [canvasConfig, setCanvasConfig] = useState<any>({ url: '' });
  const [canvasScrapeConfig, setCanvasScrapeConfig] = useState<{ courseFilters: string }>({ courseFilters: '' });
  const [savingCanvasConfig, setSavingCanvasConfig] = useState(false);
  const [outlookConfig, setOutlookConfig] = useState<{ graphApiToken: string }>({ graphApiToken: '' });
  const [savingOutlookConfig, setSavingOutlookConfig] = useState(false);
  
  const [ladokCreds, setLadokCreds] = useState({ username: '', password: '' });
  const [savingLadokCreds, setSavingLadokCreds] = useState(false);
  const [ladokData, setLadokData] = useState<any>({ courses: [], modules: [] });
  const [ladokTab, setLadokTab] = useState<'ONGOING' | 'COMPLETED' | 'EXAMS'>('ONGOING');
  const [examData, setExamData] = useState<any[]>([]);
  const [scrapingExams, setScrapingExams] = useState(false);
  const [signingUpExam, setSigningUpExam] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState<any>(null);
  const [parsingDocs, setParsingDocs] = useState(false);
  const [docParseStatus, setDocParseStatus] = useState<any>(null);
  const [embedding, setEmbedding] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<any>(null);
  
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [editTask, setEditTask] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'HIGH' | 'UPCOMING'>('ALL');

  useEffect(() => {
    fetchData();
    fetchConfig();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const hRes = await apiFetch('/api/health');
      if(hRes.ok) setHealth(await hRes.json());

      const tRes = await apiFetch('/api/tasks');
      if(tRes.ok) setTasks(await tRes.json());

      const lRes = await apiFetch('/api/admin/logs');
      if(lRes.ok) setLogs(await lRes.json());
      
      await fetchTranscriptionStatus();
      await fetchDocParseStatus();
      await fetchEmbeddingStatus();
      
      const rRes = await apiFetch('/api/embeddings/stats');
      if (rRes.ok) setRagStats(await rRes.json());
    } catch (e) {
      console.error('Failed to fetch backend data', e);
    }
  };
  
  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/api/sensors/timeedit/config');
      if(res.ok) setTimeEditConfig(await res.json());
    } catch (e) {
      console.error('Failed to fetch config', e);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await apiFetch('/api/sensors/timeedit/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timeEditConfig)
      });
      alert('TimeEdit Configuration Saved!');
    } catch (e) {
      alert('Failed to save config.');
    }
    setSavingConfig(false);
  };

  const fetchCanvasConfig = async () => {
    try {
      const res = await apiFetch('/api/sensors/canvas/config');
      if(res.ok) setCanvasConfig(await res.json());
      const scrapeRes = await apiFetch('/api/sensors/canvas_scrape/config');
      if (scrapeRes.ok) {
        const data = await scrapeRes.json();
        const filters = Array.isArray(data.courseFilters) ? data.courseFilters.join(', ') : '';
        setCanvasScrapeConfig({ courseFilters: filters });
      }
    } catch (e) {
      console.error('Failed to fetch Canvas config', e);
    }
  };

  const saveCanvasScrapeConfig = async () => {
    setSavingCanvasConfig(true);
    try {
      const courseFilters = canvasScrapeConfig.courseFilters
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiFetch('/api/sensors/canvas_scrape/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseFilters }),
      });
      alert('Deep sync course filters saved!');
    } catch {
      alert('Failed to save course filters.');
    }
    setSavingCanvasConfig(false);
  };

  const fetchOutlookConfig = async () => {
    try {
      const res = await apiFetch('/api/sensors/outlook/config');
      if (res.ok) {
        const data = await res.json();
        setOutlookConfig({ graphApiToken: data.graphApiToken || '' });
      }
    } catch (e) {
      console.error('Failed to fetch Outlook config', e);
    }
  };

  const saveOutlookConfig = async () => {
    setSavingOutlookConfig(true);
    try {
      await apiFetch('/api/sensors/outlook/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outlookConfig),
      });
      alert('Outlook configuration saved!');
    } catch {
      alert('Failed to save Outlook config.');
    }
    setSavingOutlookConfig(false);
  };

  const saveCanvasConfig = async () => {
    setSavingCanvasConfig(true);
    try {
      await apiFetch('/api/sensors/canvas/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canvasConfig)
      });
      alert('Canvas Configuration Saved!');
    } catch (e) {
      alert('Failed to save Canvas config.');
    }
    setSavingCanvasConfig(false);
  };

  const fetchLadokConfig = async () => {
    try {
      const res = await apiFetch('/api/config/ladok');
      const data = await res.json();
      setLadokCreds({ username: data.username || '', password: data.password || '' });
    } catch(e) {}
  };

  const fetchLadokData = async () => {
    try {
      const res = await apiFetch('/api/ladok/data');
      const data = await res.json();
      setLadokData(data);
    } catch(e) {}
  };

  const fetchExamData = async () => {
    try {
      const res = await apiFetch('/api/ladok/exams');
      const data = await res.json();
      setExamData(data.exams || []);
    } catch(e) {}
  };

  const scrapeExams = async () => {
    setScrapingExams(true);
    try {
      await apiFetch('/api/ladok/exams/scrape', { method: 'POST' });
      // Poll for results after a delay
      setTimeout(async () => {
        await fetchExamData();
        setScrapingExams(false);
      }, 30000);
    } catch(e) {
      setScrapingExams(false);
    }
  };
  const triggerCanvasDeepSync = async () => {
    setScrapingExams(true); // Reusing the loading state variable for convenience
    try {
      await apiFetch('/api/canvas/deep-sync', { method: 'POST' });
      alert('Canvas Deep Sync started in the background. Check logs for progress.');
    } catch(e) {
      alert('Failed to start Canvas Deep Sync.');
    }
    setScrapingExams(false);
  };

  const openCanvasFolder = async () => {
    try {
      await apiFetch('/api/canvas/open-folder', { method: 'POST' });
    } catch(e) {
      alert('Failed to open local folder.');
    }
  };

  const fetchTranscriptionStatus = async () => {
    try {
      const res = await apiFetch('/api/transcribe/status');
      if (res.ok) setTranscriptionStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch transcription status', e);
    }
  };

  const triggerTranscription = async () => {
    setTranscribing(true);
    try {
      await apiFetch('/api/transcribe', { method: 'POST' });
      alert('Transcription started in the background. It will process all pending videos.');
    } catch (e) {
      alert('Failed to start transcription.');
    }
    setTranscribing(false);
  };

  const fetchDocParseStatus = async () => {
    try {
      const res = await apiFetch('/api/parse-documents/status');
      if (res.ok) setDocParseStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch doc parse status', e);
    }
  };

  const triggerDocParsing = async () => {
    setParsingDocs(true);
    try {
      await apiFetch('/api/parse-documents', { method: 'POST' });
      alert('Document parsing started in the background. It will process all pending documents.');
    } catch (e) {
      alert('Failed to start document parsing.');
    }
    setParsingDocs(false);
  };

  const fetchEmbeddingStatus = async () => {
    try {
      const res = await apiFetch('/api/embeddings/status');
      if (res.ok) setEmbeddingStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch embedding status', e);
    }
  };

  const triggerEmbedding = async () => {
    setEmbedding(true);
    try {
      await apiFetch('/api/embeddings/sync', { method: 'POST' });
      alert('Embedding started in the background. It will process all pending documents.');
    } catch (e) {
      alert('Failed to start embedding.');
    }
    setEmbedding(false);
  };


  const signUpForExam = async (examId: string) => {
    if (!confirm('Are you sure you want to sign up for this exam? This action is irreversible.')) return;
    setSigningUpExam(examId);
    try {
      await apiFetch(`/api/ladok/exams/${examId}/signup`, { method: 'POST' });
      setTimeout(async () => {
        await fetchExamData();
        setSigningUpExam(null);
      }, 30000);
    } catch(e) {
      setSigningUpExam(null);
    }
  };


  const saveLadokCreds = async () => {
    setSavingLadokCreds(true);
    try {
      await apiFetch('/api/config/ladok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ladokCreds)
      });
      alert('Ladok credentials saved securely.');
    } catch(e) {
      alert('Failed to save Ladok credentials.');
    }
    setSavingLadokCreds(false);
  };
  const triggerSync = async () => {
    setSyncing(true);
    try {
      await apiFetch('/api/admin/sync', { method: 'POST' });
      await fetchData();
      await fetchConfig();
      await fetchCanvasConfig();
      if (currentView === 'LADOK') {
        await fetchLadokData();
      }
    } catch(e) {
      alert('Sync failed. Backend might be offline.');
    }
    setSyncing(false);
  };

  const toggleEditor = (task: any) => {
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
      setEditTask(null);
    } else {
      setSelectedTask(task);
      setEditTask({ ...task });
    }
  };

  const saveChanges = async () => {
    if (!editTask) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/tasks/${editTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTask)
      });
      if (res.ok) {
        await fetchData();
        setSelectedTask(null);
        setEditTask(null);
      } else {
        alert('Failed to save changes.');
      }
    } catch (e) {
      alert('Network error while saving.');
    }
    setSaving(false);
  };

  // View Filtering
  let visibleTasks = tasks;
  if (currentView === 'TIMEEDIT') {
    visibleTasks = visibleTasks.filter(t => t.source === 'timeedit');
  } else if (currentView === 'CANVAS') {
    visibleTasks = visibleTasks.filter(t => t.source === 'canvas');
  }
  
  const filteredTasks = visibleTasks.filter(task => {
    if (filter === 'HIGH') return task.priorityScore >= 80;
    if (filter === 'UPCOMING') {
      const diffTime = new Date(task.deadline).getTime() - new Date().getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 7;
    }
    return true;
  });

  return (
    <div className="app-shell">
      {/* LEFT SIDEBAR */}
      <div className="app-sidebar">
        <div className="sidebar-header" style={{cursor: 'pointer'}} onClick={() => setCurrentView('DASHBOARD')}>
          <h1>Mission Control</h1>
          <p>Automated Uni Tracker</p>
        </div>

        <div className="telemetry-section">
          <h2 className="section-title"><Activity size={16} /> System Telemetry</h2>
          <div className="telemetry-item" onClick={() => setCurrentView('DASHBOARD')} style={{cursor: 'pointer', background: currentView === 'DASHBOARD' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span>PostgreSQL Brain</span>
            <span className={`status-badge ${health ? 'status-ok' : 'status-pending'}`}>
              {health ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => { setCurrentView('CANVAS'); fetchCanvasConfig(); }} style={{cursor: 'pointer', background: currentView === 'CANVAS' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span>Canvas Sensor</span>
            <span className={`status-badge status-${health?.sensors.canvas || 'pending'}`}>
              {health?.sensors.canvas || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => { setCurrentView('LADOK'); fetchLadokConfig(); fetchLadokData(); fetchExamData(); }} style={{cursor: 'pointer', background: currentView === 'LADOK' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span>Ladok Auto-Bot</span>
            <span className={`status-badge status-${health?.sensors.ladok || 'pending'}`}>
              {health?.sensors.ladok || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => { setCurrentView('TIMEEDIT'); fetchConfig(); }} style={{cursor: 'pointer', background: currentView === 'TIMEEDIT' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span>TimeEdit Sensor</span>
            <span className={`status-badge status-${health?.sensors.timeedit || 'pending'}`}>
              {health?.sensors.timeedit || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => { setCurrentView('OUTLOOK'); fetchOutlookConfig(); }} style={{cursor: 'pointer', background: currentView === 'OUTLOOK' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><Mail size={14} /> Outlook Integration</span>
            <span className={`status-badge status-${health?.sensors.outlook || 'pending'}`}>
              {health?.sensors.outlook || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => setCurrentView('OPERATIONS')} style={{cursor: 'pointer', background: currentView === 'OPERATIONS' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><AlertTriangle size={14} /> Pipeline & Alerts</span>
            <span className={`status-badge status-${health?.pipeline?.active ? 'pending' : 'ok'}`}>
              {health?.pipeline?.active ? 'RUNNING' : 'IDLE'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => setCurrentView('APPROVALS')} style={{cursor: 'pointer', background: currentView === 'APPROVALS' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><ShieldCheck size={14} /> Approvals</span>
            <span className="status-badge status-ok">REVIEW</span>
          </div>
          <div className="telemetry-item" onClick={() => setCurrentView('AGENTS')} style={{cursor: 'pointer', background: currentView === 'AGENTS' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><Bot size={14} /> Agents</span>
            <span className="status-badge status-ok">TRACE</span>
          </div>
          <div className="telemetry-item" onClick={() => setCurrentView('RAG')} style={{cursor: 'pointer', background: currentView === 'RAG' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><Search size={14} /> Knowledge Base</span>
            <span className="status-badge status-ok">SEARCH</span>
          </div>
          <div className="telemetry-item" onClick={() => setCurrentView('CALENDAR')} style={{cursor: 'pointer', background: currentView === 'CALENDAR' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span><Calendar size={14} /> Calendar</span>
            <span className="status-badge status-ok">VIEW</span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="app-main">
        <div className="topbar" style={{justifyContent: 'space-between', display: 'flex', width: '100%'}}>
          <h2 style={{margin: 0}}>{
            currentView === 'TIMEEDIT' ? 'TimeEdit Integration settings' :
            currentView === 'CANVAS' ? 'Canvas Integration settings' :
            currentView === 'LADOK' ? 'Ladok Course Sync' :
            currentView === 'RAG' ? 'Knowledge Base' :
            currentView === 'CALENDAR' ? 'Calendar' :
            currentView === 'OPERATIONS' ? 'Pipeline & Alerts' :
            currentView === 'APPROVALS' ? 'Approvals' :
            currentView === 'AGENTS' ? 'Agents' :
            currentView === 'OUTLOOK' ? 'Outlook Integration' :
            'Global Dashboard'
          }</h2>
          <button className="btn-primary" onClick={triggerSync} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
            {syncing ? 'Synchronize All Sensors' : 'Trigger Sync'}
          </button>
        </div>

        {currentView === 'RAG' && <RagPanel />}
        {currentView === 'CALENDAR' && <CalendarPanel />}
        {currentView === 'OPERATIONS' && <PipelineAlertsPanel />}
        {currentView === 'APPROVALS' && <ApprovalsPanel />}
        {currentView === 'AGENTS' && <AgentsPanel />}

        {currentView === 'OUTLOOK' && (
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> Outlook Configuration</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <div>
                <label className="input-label">Microsoft Graph API Token</label>
                <textarea
                  className="drawer-input"
                  rows={4}
                  placeholder="Paste a valid Graph access token..."
                  value={outlookConfig.graphApiToken}
                  onChange={(e) => setOutlookConfig({ graphApiToken: e.target.value })}
                />
                <p style={{fontSize: 12, color: 'var(--text-secondary)', marginTop: 8}}>
                  Used to sync flagged emails and calendar events into tasks. Acquire via the MS identity platform.
                </p>
              </div>
              <button className="btn-success" onClick={saveOutlookConfig} disabled={savingOutlookConfig}>
                {savingOutlookConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        )}

        {currentView === 'TIMEEDIT' && (
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> TimeEdit Configuration</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <div>
                <label className="input-label">University ICS Feed URL</label>
                <textarea 
                  className="drawer-input" 
                  rows={3}
                  placeholder="https://cloud.timeedit.net/..."
                  value={timeEditConfig.url || ''}
                  onChange={e => setTimeEditConfig({...timeEditConfig, url: e.target.value})}
                />
                <p style={{fontSize: 12, color: 'var(--text-secondary)', marginTop: 8}}>
                  This URL is used by the background agent to pull your lectures and seminars.
                </p>
              </div>
              <div>
                <button className="btn-success" onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </div>
        )}

        {currentView === 'CANVAS' && (
          <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
            <div className="panel" style={{marginBottom: 0}}>
            <h2 className="panel-title"><Settings size={18} /> Canvas Configuration</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <div>
                <label className="input-label">Canvas ICS Calendar URL</label>
                <textarea 
                  className="drawer-input" 
                  rows={3}
                  placeholder="https://canvas.miun.se/feeds/calendars/user_...ics"
                  value={canvasConfig.url || ''}
                  onChange={e => setCanvasConfig({...canvasConfig, url: e.target.value})}
                />
                <p style={{fontSize: 12, color: 'var(--text-secondary)', marginTop: 8}}>
                  Since the university blocked the Canvas REST API, we use this generic Calendar Feed to extract your assignments without requiring a token. You can add multiple links here in the future if your teachers use study groups!
                </p>
              </div>
              <div>
                <button className="btn-success" onClick={saveCanvasConfig} disabled={savingCanvasConfig}>
                  {savingCanvasConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </div>
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> Canvas Deep Sync</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <p style={{fontSize: 14, color: 'var(--text-secondary)'}}>
                Instead of just extracting assignments from the calendar feed, the <strong>Deep Sync</strong> uses your Miun credentials (configured in the Ladok tab) to log into Canvas natively. It will scrape all active courses, download PDFs/PowerPoints, and convert Canvas text pages into Markdown files.
              </p>
              <div>
                <label className="input-label">Course filters (optional, comma-separated)</label>
                <input
                  className="drawer-input"
                  placeholder="e.g. MV038G, MV039G"
                  value={canvasScrapeConfig.courseFilters}
                  onChange={(e) => setCanvasScrapeConfig({ courseFilters: e.target.value })}
                />
                <p style={{fontSize: 12, color: 'var(--text-secondary)', marginTop: 8}}>
                  Leave blank to scrape all courses. Filters match course codes or name substrings.
                </p>
              </div>
              <button className="btn-success" onClick={saveCanvasScrapeConfig} disabled={savingCanvasConfig}>
                {savingCanvasConfig ? 'Saving...' : 'Save Course Filters'}
              </button>
              <div style={{display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={triggerCanvasDeepSync} disabled={scrapingExams} style={{backgroundColor: '#2196f3'}}>
                  {scrapingExams ? 'Starting...' : 'Run Deep Sync'}
                </button>
                <button className="btn-secondary" onClick={openCanvasFolder}>
                  Open Local Folder
                </button>
              </div>
            </div>
          </div>
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> Video Transcription Engine</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <p style={{fontSize: 14, color: 'var(--text-secondary)'}}>
                Use the Groq Whisper API to transcribe all downloaded Canvas videos. Free tier supports 14,400 requests per day.
              </p>
              {transcriptionStatus && (
                <div style={{backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8}}>
                  <p style={{margin: '0 0 8px 0', fontSize: 14}}><strong>Status:</strong> {transcriptionStatus.done.length} completed, {transcriptionStatus.pending.length} pending.</p>
                  {transcriptionStatus.pending.length > 0 && (
                    <p style={{margin: 0, fontSize: 12, color: 'var(--text-secondary)'}}>Next in queue: {transcriptionStatus.pending[0]}</p>
                  )}
                </div>
              )}
              <div style={{display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={triggerTranscription} disabled={transcribing || transcriptionStatus?.pending?.length === 0} style={{backgroundColor: '#4caf50'}}>
                  {transcribing ? 'Transcribing...' : 'Transcribe Pending Videos'}
                </button>
              </div>
            </div>
          </div>
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> Document Parsing Engine</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <p style={{fontSize: 14, color: 'var(--text-secondary)'}}>
                Use the Gemini 1.5 API to extract text and tables from downloaded PDFs, PowerPoints, and Word documents using native multimodal OCR.
              </p>
              {docParseStatus && (
                <div style={{backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8}}>
                  <p style={{margin: '0 0 8px 0', fontSize: 14}}><strong>Status:</strong> {docParseStatus.done.length} completed, {docParseStatus.pending.length} pending.</p>
                  {docParseStatus.pending.length > 0 && (
                    <p style={{margin: 0, fontSize: 12, color: 'var(--text-secondary)'}}>Next in queue: {docParseStatus.pending[0]}</p>
                  )}
                </div>
              )}
              <div style={{display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={triggerDocParsing} disabled={parsingDocs || docParseStatus?.pending?.length === 0} style={{backgroundColor: '#9c27b0'}}>
                  {parsingDocs ? 'Parsing...' : 'Parse Pending Documents'}
                </button>
              </div>
            </div>
          </div>
          <div className="panel" style={{marginBottom: 24}}>
            <h2 className="panel-title"><Settings size={18} /> Vector RAG Database</h2>
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <p style={{fontSize: 14, color: 'var(--text-secondary)'}}>
                Use the gemini-embedding-2 API to split your parsed Canvas documents into chunks and store them in the pgvector database for semantic search.
              </p>
              {embeddingStatus && (
                <div style={{backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 8}}>
                  <p style={{margin: '0 0 8px 0', fontSize: 14}}><strong>Status:</strong> {embeddingStatus.done.length} completed, {embeddingStatus.pending.length} pending.</p>
                  {embeddingStatus.pending.length > 0 && (
                    <p style={{margin: 0, fontSize: 12, color: 'var(--text-secondary)'}}>Next in queue: {embeddingStatus.pending[0]}</p>
                  )}
                </div>
              )}
              <div style={{display: 'flex', gap: 12}}>
                <button className="btn-primary" onClick={triggerEmbedding} disabled={embedding || embeddingStatus?.pending?.length === 0} style={{backgroundColor: '#e91e63'}}>
                  {embedding ? 'Embedding...' : 'Embed Pending Documents'}
                </button>
              </div>
            </div>
          </div>
          </div>
        )}

        {currentView === 'LADOK' && (
          <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
            <div className="panel">
              <h2 className="panel-title"><Settings size={18} /> Ladok Auto-Bot Credentials</h2>
              <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                <div>
                  <label className="input-label">Miun Username</label>
                  <input 
                    className="drawer-input" 
                    placeholder="e.g. sado2400"
                    value={ladokCreds.username}
                    onChange={e => setLadokCreds({...ladokCreds, username: e.target.value})}
                  />
                </div>
                <div>
                  <label className="input-label">Miun Password</label>
                  <input 
                    className="drawer-input" 
                    type="password"
                    placeholder="Your university password"
                    value={ladokCreds.password}
                    onChange={e => setLadokCreds({...ladokCreds, password: e.target.value})}
                  />
                  <p style={{fontSize: 12, color: 'var(--text-secondary)', marginTop: 8}}>
                    Your credentials never leave your machine. They are used securely by the headless browser to scrape your grades.
                  </p>
                </div>
                <div>
                  <button className="btn-success" onClick={saveLadokCreds} disabled={savingLadokCreds}>
                    {savingLadokCreds ? 'Saving...' : 'Save Credentials'}
                  </button>
                </div>
              </div>
            </div>

            <div className="panel">
              <h2 className="panel-title" style={{marginBottom: 16}}>
                Live Ladok Progress
                {ladokData.courses.length > 0 && (
                  <span style={{marginLeft: 12, fontSize: 14, color: 'var(--primary)', backgroundColor: 'rgba(33, 150, 243, 0.1)', padding: '4px 8px', borderRadius: 12}}>
                    Total Earned: {ladokData.modules.reduce((sum: number, m: any) => {
                      if (!m.grade || !m.grade.includes('Pass')) return sum;
                      const val = parseFloat(m.credits?.replace('hp', '')?.trim() || '0');
                      return sum + (isNaN(val) ? 0 : val);
                    }, 0).toFixed(1)} hp
                  </span>
                )}
              </h2>
              {ladokData.courses.length === 0 ? (
                <p style={{color: 'var(--text-secondary)', fontSize: 14}}>No courses tracked yet. Click Trigger Sync.</p>
              ) : (
                <>
                  <div style={{display: 'flex', gap: 16, borderBottom: '1px solid var(--border-color)', marginBottom: 24, paddingBottom: 8}}>
                    <button 
                      onClick={() => setLadokTab('ONGOING')}
                      style={{background: 'none', border: 'none', color: ladokTab === 'ONGOING' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: ladokTab === 'ONGOING' ? 'bold' : 'normal', cursor: 'pointer', fontSize: 16}}
                    >
                      Ongoing Courses
                    </button>
                    <button 
                      onClick={() => setLadokTab('COMPLETED')}
                      style={{background: 'none', border: 'none', color: ladokTab === 'COMPLETED' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: ladokTab === 'COMPLETED' ? 'bold' : 'normal', cursor: 'pointer', fontSize: 16}}
                    >
                      Completed Courses
                    </button>
                    <button 
                      onClick={() => setLadokTab('EXAMS')}
                      style={{background: 'none', border: 'none', color: ladokTab === 'EXAMS' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: ladokTab === 'EXAMS' ? 'bold' : 'normal', cursor: 'pointer', fontSize: 16}}
                    >
                      Exams
                    </button>
                  </div>
                  
                  {ladokTab === 'EXAMS' && (
                    <div>
                      <div style={{marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center'}}>
                        <button className="btn-primary" onClick={scrapeExams} disabled={scrapingExams}>
                          {scrapingExams ? 'Scraping Ladok...' : 'Scrape Available Exams'}
                        </button>
                      </div>
                      
                      {examData.length === 0 ? (
                        <p style={{color: 'var(--text-secondary)'}}>No exams found. Try scraping.</p>
                      ) : (
                        examData.map((exam: any) => (
                          <div key={exam.id} style={{marginBottom: 16, border: '1px solid var(--border-color)', borderRadius: 8, padding: 16}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                              <div>
                                <h3 style={{marginTop: 0, marginBottom: 8, color: 'var(--primary)'}}>{exam.courseCode} - {exam.courseName}</h3>
                                <p style={{margin: '0 0 8px 0', fontWeight: 'bold'}}>{exam.title}</p>
                                <div style={{display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12}}>
                                  <span style={{fontSize: 12, color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 8}}>Date: {exam.examDate}</span>
                                  <span style={{fontSize: 12, color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 8}}>Place: {exam.place}</span>
                                  {exam.signUpPeriod && <span style={{fontSize: 12, color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 8}}>Sign Up: {exam.signUpPeriod}</span>}
                                </div>
                              </div>
                              <div>
                                {exam.signUpStatus === 'signed_up' ? (
                                  <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                                    <span style={{fontSize: 12, fontWeight: 'bold', color: '#4caf50', backgroundColor: 'rgba(76, 175, 80, 0.2)', padding: '6px 12px', borderRadius: 12}}>Signed Up</span>
                                    <a href="https://www.miun.se/student/minastudier/tentamen/tentamensanmalan/tentamen-pa-annan-ort/" target="_blank" rel="noreferrer" style={{fontSize: 12, fontWeight: 'bold', color: 'var(--text-primary)', backgroundColor: 'rgba(255, 255, 255, 0.1)', padding: '6px 12px', borderRadius: 8, textDecoration: 'none'}} title="Click here to book your physical exam location (e.g., Sollefteå) on Miun.se">
                                      Book Location (Miun.se) ↗
                                    </a>
                                  </div>
                                ) : (
                                  <button 
                                    className="btn-primary" 
                                    onClick={() => signUpForExam(exam.id)}
                                    disabled={signingUpExam === exam.id}
                                    style={{backgroundColor: '#2196f3'}}
                                  >
                                    {signingUpExam === exam.id ? 'Signing up...' : 'Sign Up on Ladok'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {ladokTab !== 'EXAMS' && ladokData.courses.filter((course: any) => {
                    const modules = ladokData.modules.filter((m: any) => m.courseId === course.id);
                    const isCompleted = modules.length > 0 && modules.every((m: any) => m.grade && m.grade.includes('Pass'));
                    return ladokTab === 'COMPLETED' ? isCompleted : !isCompleted;
                  }).map((course: any) => {
                  const modules = ladokData.modules.filter((m: any) => m.courseId === course.id);
                  const courseCredits = modules.reduce((sum: number, m: any) => {
                    const val = parseFloat(m.credits?.replace('hp', '')?.trim() || '0');
                    return sum + (isNaN(val) ? 0 : val);
                  }, 0);
                  
                  const earnedCredits = modules.reduce((sum: number, m: any) => {
                    if (!m.grade || !m.grade.includes('Pass')) return sum;
                    const val = parseFloat(m.credits?.replace('hp', '')?.trim() || '0');
                    return sum + (isNaN(val) ? 0 : val);
                  }, 0);
                  
                  const isCompleted = modules.length > 0 && modules.every((m: any) => m.grade && m.grade.includes('Pass'));
                  
                  return (
                    <div key={course.id} style={{marginBottom: 24, border: '1px solid var(--border-color)', borderRadius: 8, padding: 16}}>
                      <div style={{marginBottom: 16}}>
                        <h3 style={{marginTop: 0, marginBottom: 8, color: 'var(--primary)'}}>{course.courseCode} - {course.name}</h3>
                        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                          {isCompleted && <span style={{fontSize: 12, fontWeight: 'bold', color: '#4caf50', backgroundColor: 'rgba(76, 175, 80, 0.2)', padding: '4px 8px', borderRadius: 12}}>Completed</span>}
                          <span style={{fontSize: 12, fontWeight: 'bold', color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 8}}>Earned: {earnedCredits.toFixed(1)} hp</span>
                          <span style={{fontSize: 12, fontWeight: 'bold', color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 8}}>Total: {courseCredits.toFixed(1)} hp</span>
                        </div>
                      </div>
                      <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 14, tableLayout: 'fixed'}}>
                        <thead>
                          <tr style={{borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)'}}>
                            <th style={{paddingBottom: 8, width: '55%'}}>Module</th>
                            <th style={{paddingBottom: 8, width: '10%'}}>Credits</th>
                            <th style={{paddingBottom: 8, width: '15%'}}>Exam Date</th>
                            <th style={{paddingBottom: 8, width: '20%'}}>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modules.map((m: any) => (
                            <tr key={m.id} style={{borderBottom: '1px solid rgba(255,255,255,0.05)'}}>
                              <td style={{padding: '8px 0'}}>{m.moduleCode} - {m.name}</td>
                              <td style={{padding: '8px 0'}}>{m.credits}</td>
                              <td style={{padding: '8px 0'}}>{m.examinationDate}</td>
                              <td style={{padding: '8px 0'}}>
                                <span style={{
                                  display: 'inline-block', whiteSpace: 'nowrap',
                                  padding: '4px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                                  backgroundColor: m.grade === 'Pass (G)' ? 'rgba(76, 175, 80, 0.2)' : 
                                                  m.grade === 'Pass with distinction (VG)' ? 'rgba(33, 150, 243, 0.2)' :
                                                  m.grade === 'Fail (U)' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                                  color: m.grade === 'Pass (G)' ? '#4caf50' : 
                                         m.grade === 'Pass with distinction (VG)' ? '#2196f3' :
                                         m.grade === 'Fail (U)' ? '#f44336' : 'var(--text-secondary)'
                                }}>
                                  {m.grade}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
                }
                </>
              )}
            </div>
          </div>
        )}

        <div className={currentView === 'DASHBOARD' ? "content-grid" : ""}>
          {currentView === 'DASHBOARD' && (
            <>
              <div className="panel" style={{marginBottom: 24, background: 'linear-gradient(135deg, rgba(233, 30, 99, 0.1), rgba(156, 39, 176, 0.1))', border: '1px solid rgba(233, 30, 99, 0.3)'}}>
                <h2 className="panel-title" style={{color: '#e91e63'}}><Database size={18} /> Vector RAG Memory Bank</h2>
                <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
                  <div style={{fontSize: 48, fontWeight: 'bold', color: '#fff'}}>{ragStats ? ragStats.totalChunks : '...'}</div>
                  <div style={{color: 'var(--text-secondary)'}}>
                    <p style={{margin: '0 0 4px 0', fontSize: 16}}><strong>Knowledge Chunks Stored</strong></p>
                    <p style={{margin: 0, fontSize: 14}}>Successfully embedded into pgvector and ready for semantic search retrieval.</p>
                  </div>
                </div>
              </div>

              <div className="panel">
                <h2 className="panel-title"><Terminal size={18} /> Agent Logs</h2>
                <div className="logs-container">
                {logs.map((log, i) => (
                  <div key={i} className="log-entry">
                    <span className="timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={log.level}>[{log.level}]</span> {typeof log.message === 'object' ? JSON.stringify(log.message) : log.message}
                  </div>
                ))}
                {logs.length === 0 && <div className="log-entry">Waiting for agent activity...</div>}
              </div>
            </div>
            </>
          )}

          {currentView !== 'LADOK' && currentView !== 'OPERATIONS' && currentView !== 'APPROVALS' && currentView !== 'AGENTS' && currentView !== 'OUTLOOK' && currentView !== 'RAG' && currentView !== 'CALENDAR' && (
            <div className="panel" style={{flex: 1}}>
              <div className="list-header">
              <h2 className="panel-title" style={{marginBottom: 0}}>
                <Database size={18} /> 
                {currentView === 'TIMEEDIT' ? 'TimeEdit Actions' : currentView === 'CANVAS' ? 'Canvas Assignments' : 'Prioritized Actions'}
              </h2>
              <div className="filter-tabs">
                <button className={`filter-tab ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>All</button>
                <button className={`filter-tab ${filter === 'HIGH' ? 'active' : ''}`} onClick={() => setFilter('HIGH')}>High Priority</button>
                <button className={`filter-tab ${filter === 'UPCOMING' ? 'active' : ''}`} onClick={() => setFilter('UPCOMING')}>Due Soon</button>
              </div>
            </div>
            
            <div className="task-list">
              {filteredTasks.map(task => {
                const { tags, title } = parseTaskTitle(task.title);
                const isEditing = selectedTask?.id === task.id;

                return (
                  <div key={task.id} className={`task-card ${isEditing ? 'editing' : ''}`}>
                    <div className="task-card-header" onClick={() => toggleEditor(task)}>
                      <div className="task-card-main" style={{flexDirection: 'column'}}>
                        <div className="tags-container" style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4}}>
                          {tags.map((t, idx) => (
                            <span key={idx} className={`task-tag tag-${t.type}`}>{t.label}</span>
                          ))}
                        </div>
                        <span className="task-title" title={title} style={{marginTop: 0}}>{title}</span>
                      </div>
                      <div className="task-card-meta">
                        <span className="task-deadline">
                          <Clock size={14} /> {getRelativeTimeString(task.deadline)}
                        </span>
                        <span className={`priority-pill ${getPriorityClass(task.priorityScore)}`}>
                          {task.priorityScore}
                        </span>
                      </div>
                    </div>
                    
                    {/* INLINE ACCORDION EDITOR */}
                    {isEditing && editTask && (
                      <div className="inline-editor">
                        <div className="drawer-section">
                          <label className="input-label">Task Title</label>
                          <textarea 
                            className="drawer-input"
                            rows={2}
                            value={editTask.title} 
                            onChange={e => setEditTask({...editTask, title: e.target.value})}
                          />
                        </div>

                        <div className="drawer-section">
                          <label className="input-label">Description (Optional)</label>
                          <textarea 
                            className="drawer-input"
                            rows={3}
                            placeholder="No description provided..."
                            value={editTask.description || ''} 
                            onChange={e => setEditTask({...editTask, description: e.target.value})}
                          />
                        </div>
                        
                        <div className="drawer-section">
                          <label className="input-label" style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}>
                            <input
                              type="checkbox"
                              checked={!!editTask.isCompleted}
                              onChange={(e) => setEditTask({ ...editTask, isCompleted: e.target.checked, status: e.target.checked ? 'completed' : 'pending' })}
                            />
                            Mark as completed
                          </label>
                        </div>

                        <div className="drawer-meta-grid" style={{marginBottom: 16}}>
                          <div className="meta-block">
                            <label className="input-label"><Hash size={14}/> Priority Score</label>
                            <input 
                              type="number"
                              className="drawer-input"
                              style={{marginTop: 8}}
                              value={editTask.priorityScore}
                              onChange={e => setEditTask({...editTask, priorityScore: parseInt(e.target.value) || 0})}
                            />
                          </div>
                          <div className="meta-block">
                            <label className="input-label"><Calendar size={14}/> Deadline</label>
                            <input 
                              type="datetime-local"
                              className="drawer-input"
                              style={{marginTop: 8}}
                              value={formatForInput(editTask.deadline)}
                              onChange={e => setEditTask({...editTask, deadline: e.target.value})}
                            />
                          </div>
                        </div>
                        
                        <div className="drawer-footer" style={{padding: 0, background: 'transparent', borderTop: 'none', justifyContent: 'flex-start'}}>
                          <button 
                            className="btn-success" 
                            onClick={saveChanges}
                            disabled={saving}
                            style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}
                          >
                            <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button className="btn-secondary" onClick={() => setSelectedTask(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredTasks.length === 0 && (
                <p style={{color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0'}}>
                  No actions found in this view.
                </p>
              )}
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
