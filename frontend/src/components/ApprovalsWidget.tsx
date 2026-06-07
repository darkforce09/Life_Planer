import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { apiFetch } from '../config';

interface Approval {
  id: string;
  action: string;
  title: string;
  details?: Record<string, unknown>;
}

/**
 * Human-in-the-loop approval surface. The agent layer creates pending approvals
 * for destructive actions (exam signup, sending email, 2FA/BankID) and blocks
 * until the user approves or rejects them here.
 */
export function ApprovalsWidget() {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/approvals');
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals || []);
      }
    } catch {
      // Backend offline; leave list as-is.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const resolve = useCallback(
    async (id: string, approved: boolean) => {
      setApprovals((prev) => prev.filter((a) => a.id !== id));
      try {
        await apiFetch(`/api/approvals/${id}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ approved }),
        });
      } catch {
        load();
      }
    },
    [load],
  );

  if (approvals.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚠ Action Required ({approvals.length})</Text>
      {approvals.map((a) => (
        <View key={a.id} style={styles.card}>
          <Text style={styles.actionLabel}>{a.action.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text style={styles.cardTitle}>{a.title}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.approve]} onPress={() => resolve(a.id, true)}>
              <Text style={styles.buttonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.reject]} onPress={() => resolve(a.id, false)}>
              <Text style={styles.buttonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    margin: 16,
    borderWidth: 1,
    backgroundColor: '#2a1a00',
    borderColor: '#ffb300',
  },
  title: { color: '#ffb300', fontWeight: 'bold', fontSize: 14, marginBottom: 10 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  actionLabel: { color: '#ffb300', fontSize: 11, fontWeight: '700', marginBottom: 4, opacity: 0.8 },
  cardTitle: { color: '#fff', fontSize: 14, marginBottom: 10 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  approve: { backgroundColor: '#1b5e20' },
  reject: { backgroundColor: '#7f1d1d' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
