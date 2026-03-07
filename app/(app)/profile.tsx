import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

export default function ProfileScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);

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
  signOutButton: { marginTop: 4 },
});
