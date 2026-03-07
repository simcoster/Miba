import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { importContacts, markImportOffered } from '@/lib/contactImport';
import Colors from '@/constants/Colors';

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

export function ContactImportModal({ visible, onDismiss }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { count, error: err } = await importContacts(user.id);
      await markImportOffered();
      if (err) {
        setError(err);
      } else {
        onDismiss();
      }
    } catch (e: any) {
      setError(e.message ?? 'Could not import contacts.');
    } finally {
      setLoading(false);
    }
  };

  const handleNotNow = async () => {
    await markImportOffered();
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleNotNow}
      >
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={40} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Find friends on Miba</Text>
          <Text style={styles.body}>
            Import your contacts to see when they join. We'll notify you so you can add them to your circles.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
              onPress={handleImport}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>Import contacts</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleNotNow} disabled={loading}>
              <Text style={styles.btnSecondaryText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    maxWidth: 340,
    width: '100%',
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  error: { fontSize: 14, color: Colors.danger, marginBottom: 12, textAlign: 'center' },
  buttons: { gap: 12, width: '100%' },
  btn: { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnSecondaryText: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  btnDisabled: { opacity: 0.7 },
});
