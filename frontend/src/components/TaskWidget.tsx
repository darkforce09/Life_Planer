import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Platform, Pressable } from 'react-native';
import { getDatabase, syncTasksFromServer, setTaskCompletion } from '../db/database';

export function TaskWidget() {
  const [tasks, setTasks] = useState<any[]>([]);

  const loadData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [loadData]);

  const toggleComplete = useCallback(
    async (item: any) => {
      const next = !item.isCompleted;
      // Optimistic update
      setTasks((prev) => prev.map((t) => (t.id === item.id ? { ...t, isCompleted: next } : t)));
      const ok = await setTaskCompletion(item.id, next);
      if (!ok) {
        // Revert on failure
        setTasks((prev) => prev.map((t) => (t.id === item.id ? { ...t, isCompleted: !next } : t)));
      } else {
        loadData();
      }
    },
    [loadData],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Prioritized Actions</Text>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.taskCard} onPress={() => toggleComplete(item)}>
            <View style={styles.row}>
              <View style={[styles.checkbox, item.isCompleted && styles.checkboxDone]}>
                {item.isCompleted && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={[styles.title, item.isCompleted && styles.titleDone]}>{item.title}</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.score}>Priority Score: {item.priorityScore}</Text>
            </View>
          </Pressable>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#555', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  check: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  titleDone: { textDecorationLine: 'line-through', color: '#888' },
  meta: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  score: { color: '#ff5252', fontSize: 14, fontWeight: 'bold' },
  empty: { color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: 40 }
});
