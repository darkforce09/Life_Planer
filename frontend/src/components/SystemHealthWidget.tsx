import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function SystemHealthWidget() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await fetch('http://localhost:3000/api/health');
        if (response.ok) {
          setHealth(await response.json());
        } else {
          throw new Error('Server error');
        }
      } catch (e) {
        setHealth({ status: 'offline', sensors: { canvas: 'ERROR (Offline)' } });
      }
    }
    
    checkHealth();
    const interval = setInterval(checkHealth, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  if (!health) return null;

  const isHealthy = health.status === 'healthy';

  return (
    <View style={[styles.container, isHealthy ? styles.ok : styles.error]}>
      <Text style={styles.title}>System Telemetry</Text>
      <Text style={styles.text}>
        BRAIN: {isHealthy ? 'ONLINE' : 'OFFLINE (Using Local SQLite)'}
      </Text>
      <Text style={styles.text}>Canvas Sensor: {health.sensors.canvas}</Text>
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
  warn: { color: '#ffb300', marginTop: 8, fontStyle: 'italic', fontSize: 12 }
});
