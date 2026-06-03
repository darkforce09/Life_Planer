import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

export async function getDatabase(): Promise<any> {
  if (Platform.OS === 'web') {
    // Return a mock DB for Web since local SQLite requires WASM config
    return {
      execAsync: async () => {},
      getAllAsync: async () => [],
      runAsync: async () => {}
    };
  }

  const db = await SQLite.openDatabaseAsync('life_planner.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL,
      priorityScore INTEGER DEFAULT 0
    );
  `);
  return db;
}

/**
 * Offline-First Sync Logic
 */
export async function syncTasksFromServer() {
  try {
    const response = await fetch('http://localhost:3000/api/tasks');
    if (!response.ok) throw new Error('Network error');
    
    const tasks = await response.json();
    
    if (Platform.OS !== 'web') {
      const db = await getDatabase();
      await db.execAsync('DELETE FROM local_tasks;');
      for (const task of tasks) {
        await db.runAsync(
          'INSERT INTO local_tasks (id, title, deadline, priorityScore) VALUES (?, ?, ?, ?)',
          [task.id, task.title, task.deadline, task.priorityScore]
        );
      }
    }
    
    return tasks; // Return tasks for web compatibility
  } catch (error) {
    console.warn('[OFFLINE MODE] Could not reach Node.js server. Using local SQLite cache.');
    return null;
  }
}
