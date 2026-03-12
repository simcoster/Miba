import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClearTabHighlightOnFocus } from '@/contexts/TabHighlightContext';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { resetTutorial } from '@/lib/tutorial';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

const pkg = require('../../package.json');

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={styles.aboutValue} selectable numberOfLines={3}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  useClearTabHighlightOnFocus();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const { start } = useTutorial();
  const insets = useSafeAreaInsets();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const manifest = Updates.manifest as Record<string, unknown> | undefined;
  const meta = manifest?.metadata as Record<string, unknown> | undefined;
  const extra = manifest?.extra as Record<string, unknown> | undefined;
  const updateMessage = (meta?.message ?? extra?.message ?? null) as string | null;

  const handleSave = async () => {
    if (!user) return;
    const trimmedUsername = username.trim().toLowerCase();
    if (trimmedUsername && !/^[a-z0-9_]{2,30}$/.test(trimmedUsername)) {
      Alert.alert('Invalid username', 'Use 2–30 characters: letters, numbers, underscores only.');
      return;
    }
    try {
      setSaving(true);
      const { error } = await supabase.from('profiles').update({
        full_name: fullName.trim() || null,
        username: trimmedUsername || null,
        phone: phone.trim() || null,
      }).eq('id', user.id);

      if (error) {
        if (error.code === '23505') Alert.alert('Username taken', 'Choose a different username.');
        else throw error;
        return;
      }
      await refreshProfile();
      setEditing(false);
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew && !result.isRollBackToEmbedded) {
        await Updates.reloadAsync();
      } else {
        Alert.alert('Updates', 'You\'re up to date.');
      }
    } catch {
      Alert.alert('Updates', 'You\'re up to date.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient
          colors={[Colors.gradientStart, Colors.gradientEnd]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.profileCard}
        >
          <Avatar uri={profile?.avatar_url} name={profile?.full_name} size={80} />
          <Text style={styles.profileName}>{profile?.full_name ?? 'Your Name'}</Text>
          {profile?.username && <Text style={styles.profileUsername}>@{profile.username}</Text>}
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </LinearGradient>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile info</Text>
            <TouchableOpacity
              onPress={() => editing ? (setFullName(profile?.full_name ?? ''), setUsername(profile?.username ?? ''), setPhone(profile?.phone ?? ''), setEditing(false)) : setEditing(true)}
              style={styles.editButton}
            >
              {!editing && <Ionicons name="pencil-outline" size={16} color={Colors.primary} />}
              <Text style={styles.editButtonText}>{editing ? 'Cancel' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Name</Text>
              {editing
                ? <TextInput style={styles.fieldInput} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
                : <Text style={styles.fieldValue}>{profile?.full_name ?? '—'}</Text>
              }
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Username</Text>
              {editing
                ? <View style={styles.usernameRow}><Text style={styles.atSign}>@</Text><TextInput style={styles.fieldInput} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={30} /></View>
                : <Text style={styles.fieldValue}>{profile?.username ? `@${profile.username}` : '—'}</Text>
              }
            </View>
            <View style={[styles.fieldRow, styles.fieldRowLast]}>
              <Text style={styles.fieldLabel}>Phone</Text>
              {editing
                ? <TextInput style={styles.fieldInput} value={phone} onChangeText={setPhone} placeholder="Optional, for discoverability" placeholderTextColor={Colors.textSecondary} keyboardType="phone-pad" />
                : <Text style={styles.fieldValue}>{profile?.phone ?? '—'}</Text>
              }
            </View>
          </View>
          {editing && <Button label="Save changes" onPress={handleSave} loading={saving} style={styles.saveButton} />}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Email</Text>
              <Text style={styles.fieldValue} numberOfLines={1}>{user?.email}</Text>
            </View>
            <View style={[styles.fieldRow, styles.fieldRowLast]}>
              <Text style={styles.fieldLabel}>Provider</Text>
              <View style={styles.providerBadge}><Text style={styles.providerText}>Google</Text></View>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.aboutButton}
          onPress={async () => {
            await resetTutorial();
            start();
          }}
        >
          <Ionicons name="help-circle-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.aboutButtonText}>Show tutorial again</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.aboutButton} onPress={() => setShowAbout(true)}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.aboutButtonText}>About</Text>
        </TouchableOpacity>

        <Button
          label="Sign out"
          onPress={() => Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])}
          variant="danger"
          style={styles.signOutButton}
        />
        <View style={{ height: 40 }} />

        <Modal visible={showAbout} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setShowAbout(false)}>
            <Pressable style={styles.aboutModal} onPress={(e) => e.stopPropagation()}>
              <View style={styles.aboutHeader}>
                <Text style={styles.aboutTitle}>About</Text>
                <TouchableOpacity onPress={() => setShowAbout(false)} hitSlop={12}>
                  <Ionicons name="close" size={24} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={styles.aboutContent}>
                <AboutRow label="Version" value={pkg.version} />
                <AboutRow label="Build" value={Application.nativeBuildVersion ?? '—'} />
                <AboutRow label="Update ID" value={Updates.updateId ?? 'embedded'} />
                <AboutRow label="Channel" value={Updates.channel ?? '—'} />
                <AboutRow label="Created" value={Updates.createdAt?.toISOString() ?? '—'} />
                <AboutRow label="Message" value={updateMessage ?? '—'} />
                <AboutRow label="Source" value={Updates.isEmbeddedLaunch ? 'Embedded in build' : 'OTA update'} />
                <Button
                  label={checkingUpdate ? 'Checking…' : 'Check for updates'}
                  onPress={handleCheckForUpdates}
                  loading={checkingUpdate}
                  disabled={checkingUpdate}
                  style={styles.checkUpdateButton}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  profileCard: {
    borderRadius: 24, padding: 28, alignItems: 'center', gap: 6, marginBottom: 28,
    shadowColor: Colors.primaryDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  profileName: { fontSize: 22, fontWeight: '800', color: '#fff', marginTop: 8 },
  profileUsername: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  profileEmail: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  editButtonText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  fieldRowLast: { borderBottomWidth: 0 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, width: 90, flexShrink: 0 },
  fieldValue: { flex: 1, fontSize: 15, color: Colors.text, textAlign: 'right' },
  fieldInput: { flex: 1, fontSize: 15, color: Colors.text, textAlign: 'right', padding: 0 },
  usernameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  atSign: { fontSize: 15, color: Colors.textSecondary, marginRight: 2 },
  saveButton: { marginTop: 12 },
  providerBadge: { backgroundColor: Colors.accentLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  providerText: { fontSize: 13, fontWeight: '600', color: Colors.primaryDark },
  aboutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 8,
  },
  aboutButtonText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  signOutButton: { marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  aboutModal: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  aboutTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  aboutContent: { padding: 20 },
  aboutRow: { marginBottom: 14 },
  aboutLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 2 },
  aboutValue: { fontSize: 14, color: Colors.text },
  checkUpdateButton: { marginTop: 16 },
});
