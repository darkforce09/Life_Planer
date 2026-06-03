import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Platform } from 'react-native';
import { getDatabase, syncTasksFromServer } from '../db/database';

export function TaskWidget() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      // 1. Load instantly from local SQLite (Offline First - Mobile Only)
      if (Platform.OS !== 'web') {
        const db = await getDatabase();
        const localTasks = await db.getAllAsync('SELECT * FROM local_tasks ORDER BY priorityScore DESC');
        setTasks(localTasks);
      }

      // 2. Sync with server in background
      const serverTasks = await syncTasksFromServer();
      
      // 3. Refresh view with new data
      if (serverTasks) {
         setTasks(serverTasks);
      } else if (Platform.OS !== 'web') {
         const db = await getDatabase();
         const syncedTasks = await db.getAllAsync('SELECT * FROM local_tasks ORDER BY priorityScore DESC');
         setTasks(syncedTasks);
      }
    }
    loadData();
    const interval = setInterval(loadData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Prioritized Actions</Text>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.taskCard}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.meta}>
              <Text style={styles.score}>Priority Score: {item.priorityScore}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No tasks pending. You are caught up!</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#121212' },
  header: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  taskCard: { backgroundColor: '#1e1e1e', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  meta: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  score: { color: '#ff5252', fontSize: 14, fontWeight: 'bold' },
  empty: { color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: 40 }
});
