import React, { useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

const EMOJIS = ['👥','🏋️','🎲','🎮','🎵','🏖️','🍕','☕','🎭','🎬','📚','🚴','⚽','🏄','🧗','🎯','🌿','🎸','🏕️','🤿','🎪','🎡','🌮','🍻'];

export default function NewCircleScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!user || name.trim().length < 2) return;
    try {
      setLoading(true);

      // Generate UUID client-side so we never need RETURNING (avoids RLS timing issue)
      const circleId = Crypto.randomUUID();

      const { error: e1 } = await supabase
        .from('circles')
        .insert({ id: circleId, name: name.trim(), description: description.trim() || null, emoji, created_by: user.id });
      if (e1) {
        console.error('Circle insert error:', e1.code, e1.message, e1.details, e1.hint);
        throw e1;
      }

      const { error: e2 } = await supabase
        .from('circle_members').insert({ circle_id: circleId, user_id: user.id, role: 'admin' });
      if (e2) {
        console.error('Circle member insert error:', e2.code, e2.message, e2.details, e2.hint);
        throw e2;
      }

      router.replace(`/(app)/circle/${circleId}`);
    } catch (error: any) {
      console.error('Create circle failed:', error);
      Alert.alert('Error', `${error.code ?? ''} ${error.message ?? 'Could not create circle.'}`.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="New Circle" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.label}>Pick an emoji</Text>
          <View style={styles.emojiGrid}>
            {EMOJIS.map(e => (
              <TouchableOpacity
                key={e}
                style={[styles.emojiOption, emoji === e && styles.emojiOptionSelected]}
                onPress={() => setEmoji(e)}
              >
                <Text style={styles.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Circle name *</Text>
          <TextInput
            style={styles.input} value={name} onChangeText={setName}
            placeholder="e.g. Beach crew, Board game night…"
            placeholderTextColor={Colors.textSecondary} maxLength={50} autoFocus
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription}
            placeholder="What's this circle for?" placeholderTextColor={Colors.textSecondary}
            maxLength={200} multiline numberOfLines={3} textAlignVertical="top"
          />
        </View>

        <View style={styles.preview}>
          <View style={styles.previewEmoji}><Text style={styles.previewEmojiText}>{emoji}</Text></View>
          <View style={styles.previewInfo}>
            <Text style={styles.previewName}>{name || 'Circle name'}</Text>
            <Text style={styles.previewDesc} numberOfLines={1}>{description || 'Description…'}</Text>
          </View>
        </View>

        <Button label="Create Circle" onPress={handleCreate} loading={loading} disabled={name.trim().length < 2} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emojiOption: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  emojiOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  emojiText: { fontSize: 24 },
  input: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: Colors.text },
  textArea: { minHeight: 80, paddingTop: 12 },
  preview: { backgroundColor: Colors.surface, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 24 },
  previewEmoji: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  previewEmojiText: { fontSize: 28 },
  previewInfo: { flex: 1 },
  previewName: { fontSize: 17, fontWeight: '700', color: Colors.text },
  previewDesc: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
