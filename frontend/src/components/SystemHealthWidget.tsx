import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { apiFetch } from '../config';

const SENSOR_LABELS: Record<string, string> = {
  timeedit: 'TimeEdit',
  canvas: 'Canvas',
  ladok: 'Ladok',
  outlook: 'Outlook',
};

export function SystemHealthWidget() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await apiFetch('/api/health');
        if (response.ok) {
          setHealth(await response.json());
        } else {
          throw new Error('Server error');
        }
      } catch (e) {
        setHealth({ status: 'offline', sensors: { canvas: 'offline' } });
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  if (!health) return null;

  const isHealthy = health.status === 'healthy';
  const sensors: Record<string, string> = health.sensors || {};
  const activeRun = health.pipeline?.active ?? null;
  const alerts: Array<{ id: string; severity: string; message: string }> = health.alerts || [];

  return (
    <View style={[styles.container, isHealthy ? styles.ok : styles.error]}>
      <Text style={styles.title}>System Telemetry</Text>
      <Text style={styles.text}>
        BRAIN: {isHealthy ? 'ONLINE' : 'OFFLINE (Using Local SQLite)'}
      </Text>
      {Object.keys(SENSOR_LABELS).map((key) => (
        <Text key={key} style={styles.text}>
          {SENSOR_LABELS[key]} Sensor: {(sensors[key] || 'unknown').toUpperCase()}
        </Text>
      ))}
      {activeRun && (
        <Text style={styles.running}>
          ⚙ Pipeline running: {activeRun.type} → {activeRun.currentStage || 'starting'}
        </Text>
      )}
      {alerts.length > 0 && (
        <View style={styles.alertBox}>
          {alerts.slice(0, 3).map((a) => (
            <Text key={a.id} style={styles.warn}>
              ⚠ {a.message}
            </Text>
          ))}
        </View>
      )}
      {!isHealthy && <Text style={styles.warn}>Check Node.js Backend Logs or start 'npm run dev'</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, borderRadius: 12, margin: 16, borderWidth: 1 },
  ok: { backgroundColor: '#002500', borderColor: '#005500' },
  error: { backgroundColor: '#3b0000', borderColor: '#880000' },
  title: { color: '#fff', fontWeight: 'bold', fontSize: 12, opacity: 0.7, marginBottom: 8 },
  text: { color: '#fff', fontWeight: '600', fontSize: 14, marginBottom: 4 },
  running: { color: '#4fc3f7', marginTop: 8, fontWeight: '600', fontSize: 13 },
  alertBox: { marginTop: 8 },
  warn: { color: '#ffb300', marginTop: 8, fontStyle: 'italic', fontSize: 12 }
});
