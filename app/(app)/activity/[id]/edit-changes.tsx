import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';
import type { EditMetadata, EditableFields } from '@/lib/types';

const FIELD_LABELS: Record<keyof EditableFields, string> = {
  title: 'Title',
  description: 'Description',
  location: 'Location',
  activity_time: 'Time',
  splash_art: 'Cover image',
};

function formatFieldValue(field: keyof EditableFields, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '(none)';
  if (field === 'activity_time') {
    const d = new Date(value);
    if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`;
    if (isTomorrow(d)) return `Tomorrow at ${format(d, 'h:mm a')}`;
    return format(d, 'EEEE, MMMM d · h:mm a');
  }
  return value;
}

export default function EditChangesScreen() {
  const { id, messageId, fromTab } = useLocalSearchParams<{ id: string; messageId: string; fromTab?: string }>();
  useSetTabHighlight(fromTab);

  const [metadata, setMetadata] = useState<EditMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!messageId) { setLoading(false); setError(true); return; }

    supabase
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data?.metadata) { setError(true); }
        else { setMetadata(data.metadata as EditMetadata); }
        setLoading(false);
      });
  }, [messageId]);

  const changedFields = metadata
    ? (Object.keys(metadata.original_values) as (keyof EditableFields)[])
    : [];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Event changes" showBack />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : error || !metadata ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.border} />
          <Text style={styles.errorText}>Could not load changes.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>What changed</Text>
          <Text style={styles.subheading}>
            Values marked with a strikethrough are the previous values.
          </Text>

          {changedFields.map((field) => {
            const fromVal = formatFieldValue(field, metadata.original_values[field] as string | null);
            const toVal = formatFieldValue(field, metadata.current_values[field] as string | null);

            return (
              <View key={field} style={styles.changeRow}>
                <Text style={styles.fieldLabel}>{FIELD_LABELS[field]}</Text>
                <View style={styles.diffRow}>
                  <View style={styles.valueBox}>
                    <Text style={styles.oldValue}>{fromVal}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={16} color={Colors.textSecondary} style={styles.arrow} />
                  <View style={styles.valueBox}>
                    <Text style={styles.newValue}>{toVal}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: { fontSize: 15, color: Colors.textSecondary },

  content: { padding: 20, gap: 6 },

  heading: {
    fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 4,
  },
  subheading: {
    fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 20,
  },

  changeRow: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  diffRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  valueBox: { flexShrink: 1 },
  oldValue: {
    fontSize: 15, color: Colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  arrow: { flexShrink: 0 },
  newValue: {
    fontSize: 15, fontWeight: '600', color: Colors.text,
  },
});
