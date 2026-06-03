import React, { useEffect, useState } from 'react';
import { Activity, Database, Terminal, RefreshCw, Clock, Calendar, Hash, X, Save, Settings } from 'lucide-react';
import './index.css';

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
  const [currentView, setCurrentView] = useState<'DASHBOARD' | 'TIMEEDIT'>('DASHBOARD');
  
  const [health, setHealth] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  
  const [timeEditConfig, setTimeEditConfig] = useState<any>({ url: '' });
  const [savingConfig, setSavingConfig] = useState(false);
  
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
      const hRes = await fetch('http://localhost:3000/api/health');
      if(hRes.ok) setHealth(await hRes.json());

      const tRes = await fetch('http://localhost:3000/api/tasks');
      if(tRes.ok) setTasks(await tRes.json());

      const lRes = await fetch('http://localhost:3000/api/admin/logs');
      if(lRes.ok) setLogs(await lRes.json());
    } catch (e) {
      console.error('Failed to fetch backend data', e);
    }
  };
  
  const fetchConfig = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/sensors/timeedit/config');
      if(res.ok) setTimeEditConfig(await res.json());
    } catch (e) {
      console.error('Failed to fetch config', e);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await fetch('http://localhost:3000/api/sensors/timeedit/config', {
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

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await fetch('http://localhost:3000/api/admin/sync', { method: 'POST' });
      await fetchData();
      await fetchConfig();
    } catch(e) {
      alert('Sync failed. Backend might be offline.');
    }
    setSyncing(false);
  };

  const openEditor = (task: any) => {
    setSelectedTask(task);
    setEditTask({ ...task });
  };

  const saveChanges = async () => {
    if (!editTask) return;
    setSaving(true);
    try {
      const res = await fetch(`http://localhost:3000/api/tasks/${editTask.id}`, {
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
          <div className="telemetry-item">
            <span>Canvas Sensor</span>
            <span className={`status-badge status-${health?.sensors.canvas || 'pending'}`}>
              {health?.sensors.canvas || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item" onClick={() => { setCurrentView('TIMEEDIT'); fetchConfig(); }} style={{cursor: 'pointer', background: currentView === 'TIMEEDIT' ? 'rgba(255,255,255,0.05)' : ''}}>
            <span>TimeEdit Sensor</span>
            <span className={`status-badge status-${health?.sensors.timeedit || 'pending'}`}>
              {health?.sensors.timeedit || 'UNKNOWN'}
            </span>
          </div>
          <div className="telemetry-item">
            <span>Outlook Integration</span>
            <span className={`status-badge status-${health?.sensors.outlook || 'pending'}`}>
              {health?.sensors.outlook || 'UNKNOWN'}
            </span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="app-main">
        <div className="topbar" style={{justifyContent: 'space-between', display: 'flex', width: '100%'}}>
          <h2 style={{margin: 0}}>{currentView === 'TIMEEDIT' ? 'TimeEdit Integration settings' : 'Global Dashboard'}</h2>
          <button className="btn-primary" onClick={triggerSync} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
            {syncing ? 'Synchronize All Sensors' : 'Trigger Sync'}
          </button>
        </div>

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

        <div className={currentView === 'DASHBOARD' ? "content-grid" : ""}>
          {currentView === 'DASHBOARD' && (
            <div className="panel">
              <h2 className="panel-title"><Terminal size={18} /> Agent Logs</h2>
              <div className="logs-container">
                {logs.map((log, i) => (
                  <div key={i} className="log-entry">
                    <span className="timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={log.level}>[{log.level}]</span> {log.message}
                  </div>
                ))}
                {logs.length === 0 && <div className="log-entry">Waiting for agent activity...</div>}
              </div>
            </div>
          )}

          <div className="panel" style={{flex: 1}}>
            <div className="list-header">
              <h2 className="panel-title" style={{marginBottom: 0}}>
                <Database size={18} /> 
                {currentView === 'TIMEEDIT' ? 'TimeEdit Actions' : 'Prioritized Actions'}
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
                return (
                  <div key={task.id} className="task-card" onClick={() => openEditor(task)}>
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
                );
              })}
              {filteredTasks.length === 0 && (
                <p style={{color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0'}}>
                  No actions found in this view.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SLIDE-OUT EDITOR DRAWER */}
      <div className={`drawer-backdrop ${selectedTask ? 'open' : ''}`} onClick={() => setSelectedTask(null)} />
      <div className={`drawer ${selectedTask ? 'open' : ''}`}>
        <div className="drawer-header">
          <h2>Edit Task Data</h2>
          <button className="close-btn" onClick={() => setSelectedTask(null)}>
            <X size={20} />
          </button>
        </div>
        
        {editTask && (
          <>
            <div className="drawer-content">
              <div className="drawer-section">
                <label className="input-label">Task Title</label>
                <textarea 
                  className="drawer-input"
                  rows={3}
                  value={editTask.title} 
                  onChange={e => setEditTask({...editTask, title: e.target.value})}
                />
              </div>

              <div className="drawer-section">
                <label className="input-label">Description (Optional)</label>
                <textarea 
                  className="drawer-input"
                  rows={4}
                  placeholder="No description provided..."
                  value={editTask.description || ''} 
                  onChange={e => setEditTask({...editTask, description: e.target.value})}
                />
              </div>
              
              <div className="drawer-meta-grid" style={{marginBottom: 24}}>
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
              
              <div className="drawer-section">
                <h3>Raw Telemetry Data</h3>
                <div className="log-entry" style={{whiteSpace: 'pre-wrap', fontFamily: 'SFMono-Regular, monospace', fontSize: 12}}>
                  {JSON.stringify(selectedTask, null, 2)}
                </div>
              </div>
            </div>
            
            <div className="drawer-footer">
              <button className="btn-secondary" onClick={() => setSelectedTask(null)}>Cancel</button>
              <button 
                className="btn-success" 
                onClick={saveChanges}
                disabled={saving}
                style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}
              >
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
