import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useGlobalSearchParams, useRouter } from 'expo-router';
import { useMipo } from '@/contexts/MipoContext';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday, isTomorrow } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Post, PostComment, SurveyResponse } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LocationDisplay } from '@/components/LocationDisplay';
import { RichText } from '@/components/RichText';
import { SplashArt } from '@/components/SplashArt';
import { getActivityCoverProps } from '@/lib/activityCover';
import Colors from '@/constants/Colors';
import { checkMipoVisibleModePermissions, turnOffLocationSharingIfActiveWhenPermissionDenied } from '@/lib/mipoLocation';
import { isJoinMeNow } from '@/lib/types';
import { startLiveLocationPostWatch, turnOffLiveLocationPost } from '@/lib/liveLocationPost';
import { postSurveyPing } from '@/lib/postSurveyPing';
import * as Location from 'expo-location';
import Toast from 'react-native-toast-message';
import { addMinutes } from 'date-fns';

const DROPDOWN_WIDTH = 110;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const LIVE_LOCATION_TIME_OPTIONS = [
  { label: '20 minutes', minutes: 20 },
  { label: '1 hour', minutes: 60 },
  { label: '5 hours', minutes: 300 },
] as const;

function formatPostTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

type PostWithComments = Post & {
  comments: PostComment[];
  surveyResponses?: SurveyResponse[];
  surveyPing?: { pinged_at: string };
};

export default function ActivityBoardScreen() {
  const localParams = useLocalSearchParams<{ id: string; fromTab?: string }>();
  const globalParams = useGlobalSearchParams<{ fromTab?: string }>();
  const { id } = localParams;
  const fromTab = localParams.fromTab ?? globalParams.fromTab;
  const { user, profile: userProfile } = useAuth();
  const { setVisible } = useMipo();
  useSetTabHighlight(fromTab ?? 'chats');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activityTitle, setActivityTitle] = useState('');
  const [activityDetails, setActivityDetails] = useState<{
    title: string;
    activity_time: string;
    is_join_me?: boolean;
    location: string | null;
    description: string | null;
    splash_art?: string | null;
    place_photo_name?: string | null;
    going: Array<{ user_id: string; profile?: { full_name: string | null; avatar_url: string | null } | null }>;
  } | null>(null);
  const [showPeek, setShowPeek] = useState(false);
  const [posts, setPosts] = useState<PostWithComments[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostText, setEditPostText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentSending, setCommentSending] = useState<Record<string, boolean>>({});
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [newPostMode, setNewPostMode] = useState<'text' | 'live_location' | 'survey'>('text');
  const [showLiveLocationTimePicker, setShowLiveLocationTimePicker] = useState(false);
  const [surveyQuestion, setSurveyQuestion] = useState('');
  const [surveyOptions, setSurveyOptions] = useState<string[]>(['', '']);
  const [surveyAllowMultiple, setSurveyAllowMultiple] = useState(false);
  const [surveyPosting, setSurveyPosting] = useState(false);
  const [surveyPingLoading, setSurveyPingLoading] = useState<string | null>(null);
  const [showSurveyPingBubble, setShowSurveyPingBubble] = useState<string | null>(null);
  const [surveyChartPostId, setSurveyChartPostId] = useState<string | null>(null);
  const [expandedSurveyPostIds, setExpandedSurveyPostIds] = useState<Set<string>>(new Set());
  const [editSurveyQuestion, setEditSurveyQuestion] = useState('');
  const [editSurveyOptions, setEditSurveyOptions] = useState<string[]>([]);
  const [editSurveyAllowMultiple, setEditSurveyAllowMultiple] = useState(false);
  const [surveyResponseSending, setSurveyResponseSending] = useState<Record<string, boolean>>({});
  const [surveySelectedIndices, setSurveySelectedIndices] = useState<Record<string, number[]>>({});
  const [liveLocationPosting, setLiveLocationPosting] = useState(false);
  const [permissionError, setPermissionError] = useState<{ visible: boolean; title: string; message: string }>({
    visible: false,
    title: '',
    message: '',
  });
  const [postMenuPostId, setPostMenuPostId] = useState<string | null>(null);
  const [postMenuPosition, setPostMenuPosition] = useState<{ x: number; y: number; width: number } | null>(null);
  const [commentMenuComment, setCommentMenuComment] = useState<PostComment | null>(null);
  const [commentMenuPosition, setCommentMenuPosition] = useState<{ x: number; y: number; width: number } | null>(null);
  const postButtonRefs = useRef<Record<string, View | null>>({});
  const commentButtonRefs = useRef<Record<string, View | null>>({});
  const liveLocationExpiryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHebrew = (s: string) => /[\u0590-\u05FF]/.test(s);

  const fetchActivity = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('activities')
      .select('title, activity_time, is_join_me, location, description, splash_art, place_photo_name, rsvps(*, profile:profiles(id, full_name, avatar_url))')
      .eq('id', id)
      .single();
    if (data) {
      const rsvps = (data.rsvps ?? []) as Array<{ user_id: string; status: string; profile?: { full_name: string | null; avatar_url: string | null } | null }>;
      const going = rsvps.filter((r) => r.status === 'in');
      setActivityTitle(data.title);
      setActivityDetails({
        title: data.title,
        activity_time: data.activity_time,
        is_join_me: data.is_join_me,
        location: data.location,
        description: data.description,
        splash_art: data.splash_art ?? null,
        place_photo_name: data.place_photo_name ?? null,
        going,
      });
    }
  }, [id]);

  const fetchPosts = useCallback(async () => {
    if (!id) return;
    const { data: postsData, error: postsError } = await supabase
      .from('posts')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('activity_id', id)
      .order('created_at', { ascending: false });

    if (postsError || !postsData) {
      setPosts([]);
      return;
    }

    const postIds = (postsData as Post[]).map((p) => p.id);
    if (postIds.length === 0) {
      setPosts((postsData as Post[]).map((p) => ({ ...p, comments: [] })));
      return;
    }

    const { data: commentsData } = await supabase
      .from('post_comments')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .in('post_id', postIds)
      .order('created_at', { ascending: true });

    const surveyPostIds = (postsData as Post[]).filter((p) => p.post_type === 'survey').map((p) => p.id);
    let surveyResponsesByPost = new Map<string, SurveyResponse[]>();
    let surveyPingByPost: Record<string, string> = {};
    if (surveyPostIds.length > 0) {
      const { data: responsesData } = await supabase
        .from('survey_responses')
        .select('*, profile:profiles(id, full_name, avatar_url)')
        .in('post_id', surveyPostIds)
        .order('created_at', { ascending: true });
      for (const r of responsesData ?? []) {
        const list = surveyResponsesByPost.get(r.post_id) ?? [];
        list.push(r as SurveyResponse);
        surveyResponsesByPost.set(r.post_id, list);
      }
      const { data: pingsData } = await supabase
        .from('survey_pings')
        .select('post_id, pinged_at')
        .in('post_id', surveyPostIds);
      for (const r of pingsData ?? []) {
        surveyPingByPost[r.post_id] = r.pinged_at;
      }
    }

    const commentsByPost = new Map<string, PostComment[]>();
    for (const c of commentsData ?? []) {
      const list = commentsByPost.get(c.post_id) ?? [];
      list.push(c as PostComment);
      commentsByPost.set(c.post_id, list);
    }

    const postsWithComments: PostWithComments[] = (postsData as Post[]).map((p) => ({
      ...p,
      comments: commentsByPost.get(p.id) ?? [],
      surveyResponses: surveyResponsesByPost.get(p.id) ?? [],
      surveyPing: surveyPingByPost[p.id] ? { pinged_at: surveyPingByPost[p.id] } : undefined,
    }));
    setPosts(postsWithComments);
  }, [id]);

  const fetchInitial = useCallback(async () => {
    await Promise.all([fetchActivity(), fetchPosts()]);
  }, [fetchActivity, fetchPosts]);

  const markRead = useCallback(() => {
    if (id) AsyncStorage.setItem(`miba_board_last_read_${id}`, new Date().toISOString());
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchInitial().finally(() => {
      setLoading(false);
      markRead();
    });
  }, [fetchInitial, markRead]);

  useEffect(() => {
    return () => {
      if (liveLocationExpiryIntervalRef.current) {
        clearInterval(liveLocationExpiryIntervalRef.current);
      }
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInitial();
    setRefreshing(false);
  }, [fetchInitial]);

  // Realtime
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`activity-board-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'posts', filter: `activity_id=eq.${id}` },
        () => fetchPosts()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_comments',
          filter: `activity_id=eq.${id}`,
        },
        () => fetchPosts()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'survey_responses' },
        (payload: { new?: { user_id?: string } }) => {
          if (payload.new?.user_id === user?.id) return;
          fetchPosts();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, fetchPosts, user?.id]);

  const handlePost = async () => {
    const content = postText.trim();
    if (!content || !user || !id) return;
    try {
      setPosting(true);
      const { error } = await supabase.from('posts').insert({
        activity_id: id,
        user_id: user.id,
        content,
      });
      if (error) throw error;
      setPostText('');
      setShowNewPostModal(false);
      setNewPostMode('text');
      await fetchPosts();
    } catch (e) {
      Alert.alert('Could not post', (e as Error).message ?? 'Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const handleShareLiveLocation = async (minutes: number) => {
    if (!user || !id) return;
    const { data: activePost } = await supabase
      .from('posts')
      .select('id')
      .eq('activity_id', id)
      .eq('post_type', 'live_location')
      .is('chat_closed_at', null)
      .maybeSingle();
    if (activePost) {
      Alert.alert(
        'Live location active',
        'There is already an active live location for this event. Only one can be active at a time.'
      );
      return;
    }
    setShowLiveLocationTimePicker(false);
    const permResult = await checkMipoVisibleModePermissions();
    if (!permResult.ok) {
      const { turnedOffMipo, turnedOffLiveLocation } = await turnOffLocationSharingIfActiveWhenPermissionDenied(user.id, id);
      if (turnedOffMipo || turnedOffLiveLocation) {
        if (turnedOffMipo) setVisible(false, null);
        await fetchPosts();
        return;
      }
      setPermissionError({
        visible: true,
        title: permResult.missingPrecise ? 'Precise location required' : 'Location required',
        message: permResult.message ?? 'Please enable location access in Settings.',
      });
      return;
    }
    setLiveLocationPosting(true);
    try {
      await Location.enableNetworkProviderAsync().catch(() => {});
      let loc: Location.LocationObject | null = null;
      try {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      } catch {
        loc = await Location.getLastKnownPositionAsync();
      }
      if (!loc) {
        throw new Error('Could not get your location. Make sure GPS and location services are on.');
      }
      const now = new Date();
      const expiresAt = addMinutes(now, minutes);
      const { data: post, error: postError } = await supabase
        .from('posts')
        .insert({
          activity_id: id,
          user_id: user.id,
          content: 'Live Location',
          post_type: 'live_location',
          creator_expires_at: expiresAt.toISOString(),
        })
        .select('id')
        .single();
      if (postError || !post) throw postError ?? new Error('Could not create post');
      const { error: shareError } = await supabase.from('chat_location_shares').insert({
        activity_id: id,
        post_id: post.id,
        user_id: user.id,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        updated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });
      if (shareError) {
        await supabase.from('posts').delete().eq('id', post.id);
        throw shareError;
      }
      const sub = await startLiveLocationPostWatch(
        post.id,
        user.id,
        expiresAt,
        id,
        (err) => Alert.alert('Error', err.message)
      );
      if (!sub) {
        await supabase.from('chat_location_shares').delete().eq('post_id', post.id).eq('user_id', user.id);
        await supabase.from('posts').delete().eq('id', post.id);
        throw new Error('Could not start location tracking.');
      }
      setShowNewPostModal(false);
      setNewPostMode('text');
      await fetchPosts();
      router.push(`/(app)/activity/${id}/post-chat/${post.id}?fromTab=${encodeURIComponent(fromTab ?? 'chats')}`);
      if (liveLocationExpiryIntervalRef.current) clearInterval(liveLocationExpiryIntervalRef.current);
      liveLocationExpiryIntervalRef.current = setInterval(() => {
        if (new Date() >= expiresAt) {
          if (liveLocationExpiryIntervalRef.current) {
            clearInterval(liveLocationExpiryIntervalRef.current);
            liveLocationExpiryIntervalRef.current = null;
          }
          turnOffLiveLocationPost(post.id, user.id);
        }
      }, 30000);
    } catch (e) {
      Alert.alert('Could not share live location', (e as Error).message ?? 'Please try again.');
    } finally {
      setLiveLocationPosting(false);
    }
  };

  const handlePostSurvey = async () => {
    const question = surveyQuestion.trim();
    const trimmed = surveyOptions.map((o) => o.trim());
    const options = trimmed[trimmed.length - 1] === '' ? trimmed.slice(0, -1).filter(Boolean) : trimmed.filter(Boolean);
    if (!question || options.length < 2 || !user || !id) {
      Alert.alert('Invalid survey', 'Please enter a question and at least 2 options.');
      return;
    }
    try {
      setSurveyPosting(true);
      const { error } = await supabase.from('posts').insert({
        activity_id: id,
        user_id: user.id,
        content: question,
        post_type: 'survey',
        survey_metadata: { question, options, allow_multiple: surveyAllowMultiple },
      });
      if (error) throw error;
      setSurveyQuestion('');
      setSurveyOptions(['', '']);
      setSurveyAllowMultiple(false);
      setShowNewPostModal(false);
      setNewPostMode('text');
      await fetchPosts();
    } catch (e) {
      Alert.alert('Could not create survey', (e as Error).message ?? 'Please try again.');
    } finally {
      setSurveyPosting(false);
    }
  };

  const handleSurveyResponse = async (postId: string, selectedIndices: number[]) => {
    if (!user) return;
    try {
      setSurveyResponseSending((prev) => ({ ...prev, [postId]: true }));
      const { error } = await supabase.from('survey_responses').upsert(
        { post_id: postId, user_id: user.id, selected_indices: selectedIndices },
        { onConflict: 'post_id,user_id' }
      );
      if (error) throw error;
      // Optimistically update local state instead of refetching to avoid races that block re-selection
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== postId) return p;
          const existing = p.surveyResponses ?? [];
          const myIdx = existing.findIndex((r) => r.user_id === user.id);
          const myExisting = myIdx >= 0 ? (existing[myIdx] as SurveyResponse) : undefined;
          const newResponse: SurveyResponse = {
            id: myExisting?.id ?? '',
            post_id: postId,
            user_id: user.id,
            selected_indices: selectedIndices,
            created_at: myExisting?.created_at ?? new Date().toISOString(),
            profile: userProfile ? { id: user.id, full_name: userProfile.full_name, avatar_url: userProfile.avatar_url } : undefined,
          };
          const updated =
            myIdx >= 0 ? [...existing.slice(0, myIdx), newResponse, ...existing.slice(myIdx + 1)] : [...existing, newResponse];
          return { ...p, surveyResponses: updated };
        })
      );
    } catch (e) {
      Alert.alert('Could not submit', (e as Error).message ?? 'Please try again.');
    } finally {
      setSurveyResponseSending((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleSurveyPing = async (postId: string) => {
    try {
      setSurveyPingLoading(postId);
      const result = await postSurveyPing(postId);
      if (result.ok) {
        Toast.show({ type: 'success', text1: 'Ping sent!' });
        await fetchPosts();
      } else {
        const isRateLimit = result.error?.toLowerCase().includes('once per day') ?? false;
        if (isRateLimit) {
          await fetchPosts();
          Toast.show({ type: 'info', text1: 'You can only ping once every 24 hours. Try again tomorrow.' });
        } else {
          Toast.show({ type: 'error', text1: result.error ?? 'Could not ping' });
        }
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message ?? 'Could not ping' });
    } finally {
      setSurveyPingLoading(null);
    }
  };

  const handleEditPost = async (postId: string) => {
    const post = posts.find((p) => p.id === postId);
    if (post?.post_type === 'survey') {
      const question = editSurveyQuestion.trim();
      const trimmed = editSurveyOptions.map((o) => o.trim());
      const options = trimmed[trimmed.length - 1] === '' ? trimmed.slice(0, -1).filter(Boolean) : trimmed.filter(Boolean);
      if (!question || options.length < 2) {
        Alert.alert('Invalid survey', 'Please enter a question and at least 2 options.');
        return;
      }
      try {
        const { error } = await supabase
          .from('posts')
          .update({
            content: question,
            survey_metadata: { question, options, allow_multiple: editSurveyAllowMultiple },
          })
          .eq('id', postId);
        if (error) throw error;
        setEditingPostId(null);
        setEditSurveyQuestion('');
        setEditSurveyOptions([]);
        setEditSurveyAllowMultiple(false);
        await fetchPosts();
      } catch (e) {
        Alert.alert('Could not update', (e as Error).message ?? 'Please try again.');
      }
      return;
    }
    const content = editPostText.trim();
    if (!content) return;
    try {
      const { error } = await supabase.from('posts').update({ content }).eq('id', postId);
      if (error) throw error;
      setEditingPostId(null);
      setEditPostText('');
      await fetchPosts();
    } catch (e) {
      Alert.alert('Could not update', (e as Error).message ?? 'Please try again.');
    }
  };

  const handleDeletePost = (post: PostWithComments) => {
    Alert.alert('Delete post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('posts').delete().eq('id', post.id);
          if (!error) await fetchPosts();
        },
      },
    ]);
  };

  const handleComment = async (postId: string) => {
    const content = (commentInputs[postId] ?? '').trim();
    if (!content || !user) return;
    try {
      setCommentSending((prev) => ({ ...prev, [postId]: true }));
      const { error } = await supabase.from('post_comments').insert({
        post_id: postId,
        user_id: user.id,
        content,
      });
      if (error) throw error;
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      await fetchPosts();
    } catch (e) {
      Alert.alert('Could not comment', (e as Error).message ?? 'Please try again.');
    } finally {
      setCommentSending((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleEditComment = async (commentId: string) => {
    const content = editCommentText.trim();
    if (!content) return;
    try {
      const { error } = await supabase.from('post_comments').update({ content }).eq('id', commentId);
      if (error) throw error;
      setEditingCommentId(null);
      setEditCommentText('');
      await fetchPosts();
    } catch (e) {
      Alert.alert('Could not update', (e as Error).message ?? 'Please try again.');
    }
  };

  const handleDeleteComment = (comment: PostComment) => {
    Alert.alert('Delete comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('post_comments').delete().eq('id', comment.id);
          if (!error) await fetchPosts();
        },
      },
    ]);
  };

  const renderComment = (comment: PostComment, postId: string) => {
    const isMe = comment.user_id === user?.id;
    if (editingCommentId === comment.id) {
      return (
        <View key={comment.id} style={styles.commentEditRow}>
          <TextInput
            style={styles.commentEditInput}
            value={editCommentText}
            onChangeText={setEditCommentText}
            autoFocus
            multiline
          />
          <TouchableOpacity
            style={styles.commentEditSave}
            onPress={() => handleEditComment(comment.id)}
          >
            <Text style={styles.commentEditSaveText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.commentEditCancel}
            onPress={() => {
              setEditingCommentId(null);
              setEditCommentText('');
            }}
          >
            <Text style={styles.commentEditCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View key={comment.id} style={styles.commentRow}>
        <Avatar uri={comment.profile?.avatar_url} name={comment.profile?.full_name} size={28} />
        <View style={styles.commentContent}>
          <Text style={styles.commentAuthor}>{comment.profile?.full_name ?? 'Someone'}</Text>
          <Text style={styles.commentText}>{comment.content}</Text>
          <Text style={styles.commentTime}>{formatPostTime(comment.created_at)}</Text>
        </View>
        {isMe && (
          <View
            ref={(r) => {
              if (r) commentButtonRefs.current[comment.id] = r;
            }}
            collapsable={false}
          >
            <TouchableOpacity
              onPress={() => {
                const ref = commentButtonRefs.current[comment.id];
                ref?.measureInWindow((x, y, width, height) => {
                  setCommentMenuComment(comment);
                  setCommentMenuPosition({ x, y: y + height, width });
                });
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderPost = ({ item: post }: { item: PostWithComments }) => {
    const isMe = post.user_id === user?.id;
    const isEditing = editingPostId === post.id;
    const isLiveLocation = post.post_type === 'live_location';
    const isSurvey = post.post_type === 'survey';
    const isExpired = isLiveLocation && !!post.chat_closed_at;

    if (isLiveLocation) {
      return (
        <TouchableOpacity
          style={styles.postCard}
          onPress={() => router.push(`/(app)/activity/${id}/post-chat/${post.id}?fromTab=${encodeURIComponent(fromTab ?? 'chats')}`)}
          activeOpacity={0.85}
        >
          <View style={styles.postHeader}>
            <View style={styles.liveLocationIconWrap}>
              <Ionicons name="map" size={24} color={Colors.primary} />
            </View>
            <View style={styles.postHeaderText}>
              <Text style={styles.postAuthor}>Live Location</Text>
              <Text style={styles.postTime}>
                {post.profile?.full_name ?? 'Someone'}
                {isExpired ? ' · Expired' : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
          </View>
        </TouchableOpacity>
      );
    }

    if (isSurvey && post.survey_metadata) {
      const meta = post.survey_metadata;
      const options = meta.options ?? [];
      const allowMultiple = meta.allow_multiple ?? false;
      const myResponse = post.surveyResponses?.find((r) => r.user_id === user?.id);
      const selectedIndices = surveySelectedIndices[post.id] ?? myResponse?.selected_indices ?? [];
      const isCreator = post.user_id === user?.id;
      const lastPingAt = post.surveyPing?.pinged_at;
      const pingCooldownEnds = lastPingAt ? addMinutes(new Date(lastPingAt), 24 * 60) : null;
      const pingOnCooldown = pingCooldownEnds ? new Date() < pingCooldownEnds : false;

      const toggleOption = (idx: number) => {
        if (allowMultiple) {
          const next = selectedIndices.includes(idx)
            ? selectedIndices.filter((i) => i !== idx)
            : [...selectedIndices, idx];
          setSurveySelectedIndices((prev) => ({ ...prev, [post.id]: next }));
          handleSurveyResponse(post.id, next);
        } else {
          setSurveySelectedIndices((prev) => ({ ...prev, [post.id]: [idx] }));
          handleSurveyResponse(post.id, [idx]);
        }
      };

      const isExpanded = expandedSurveyPostIds.has(post.id);

      return (
        <View style={styles.postCard}>
          <View style={styles.postHeader}>
            <View style={[styles.liveLocationIconWrap, { backgroundColor: Colors.accentLight }]}>
              <Ionicons name="stats-chart-outline" size={24} color={Colors.primary} />
            </View>
            <View style={styles.postHeaderText}>
              <Text style={styles.postAuthor}>{post.profile?.full_name ?? 'Someone'}</Text>
              <Text style={styles.postTime}>{formatPostTime(post.created_at)}</Text>
            </View>
            <View style={styles.postHeaderRight}>
              {isCreator && (
                <>
                  <TouchableOpacity
                    onPress={() => setShowSurveyPingBubble(showSurveyPingBubble === post.id ? null : post.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="information-circle-outline" size={20} color="#3B82F6" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.pingBtn,
                      (surveyPingLoading === post.id || pingOnCooldown) && styles.pingBtnDisabled,
                    ]}
                    onPress={() => handleSurveyPing(post.id)}
                    disabled={surveyPingLoading === post.id}
                  >
                    {surveyPingLoading === post.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <>
                        <Ionicons name="notifications-outline" size={14} color={pingOnCooldown ? Colors.textSecondary : Colors.primary} />
                        <Text style={[styles.pingBtnText, pingOnCooldown && { color: Colors.textSecondary }]}>Ping</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
              {isCreator && (
                <View
                  ref={(r) => {
                    if (r) postButtonRefs.current[post.id] = r;
                  }}
                  collapsable={false}
                >
                  <TouchableOpacity
                    onPress={() => {
                      const ref = postButtonRefs.current[post.id];
                      ref?.measureInWindow((x, y, width, height) => {
                        setPostMenuPostId(post.id);
                        setPostMenuPosition({ x, y: y + height, width });
                      });
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
          {editingPostId === post.id ? (
            <View style={styles.surveyEditForm}>
              <Text style={styles.surveyCreateLabel}>Question</Text>
              <TextInput
                style={styles.surveyQuestionInput}
                value={editSurveyQuestion}
                onChangeText={setEditSurveyQuestion}
                placeholder="Ask your question…"
                placeholderTextColor={Colors.textSecondary}
                multiline
                numberOfLines={2}
                maxLength={500}
              />
              <Text style={styles.surveyCreateLabel}>Options</Text>
              <ScrollView style={styles.surveyOptionsScroll} contentContainerStyle={styles.surveyOptionsList} nestedScrollEnabled>
                {editSurveyOptions.map((opt, idx) => (
                  <View key={idx} style={styles.surveyOptionInputRow}>
                    <Text style={styles.surveyOptionNumber}>{idx + 1}.</Text>
                    <TextInput
                      style={styles.surveyOptionInput}
                      value={opt}
                      onChangeText={(t) =>
                        setEditSurveyOptions((prev) => {
                          const next = [...prev];
                          next[idx] = t;
                          if (idx === prev.length - 1 && t.trim()) {
                            next.push('');
                          }
                          return next;
                        })
                      }
                      placeholder={`Option ${idx + 1}`}
                      placeholderTextColor={Colors.textSecondary}
                      maxLength={200}
                    />
                    {editSurveyOptions.length > 2 && (
                      <TouchableOpacity
                        onPress={() => setEditSurveyOptions((prev) => prev.filter((_, i) => i !== idx))}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={22} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.surveyAllowMultipleRow}
                onPress={() => setEditSurveyAllowMultiple((v) => !v)}
              >
                <Ionicons
                  name={editSurveyAllowMultiple ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={editSurveyAllowMultiple ? Colors.primary : Colors.textSecondary}
                />
                <Text style={styles.surveyAllowMultipleText}>Allow multiple answers</Text>
              </TouchableOpacity>
              <View style={styles.postEditActions}>
                <TouchableOpacity style={styles.postEditSave} onPress={() => handleEditPost(post.id)}>
                  <Text style={styles.postEditSaveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.postEditCancel}
                  onPress={() => {
                    setEditingPostId(null);
                    setEditSurveyQuestion('');
                    setEditSurveyOptions([]);
                    setEditSurveyAllowMultiple(false);
                  }}
                >
                  <Text style={styles.postEditCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
          <Text style={styles.surveyQuestion}>{meta.question}</Text>
          {isExpanded ? (
          <View style={styles.surveyOptions}>
            {options.map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.surveyOption,
                  selectedIndices.includes(idx) && styles.surveyOptionSelected,
                ]}
                onPress={() => toggleOption(idx)}
              >
                <Text style={styles.surveyOptionNumber}>{idx + 1}.</Text>
                <Ionicons
                  name={allowMultiple ? (selectedIndices.includes(idx) ? 'checkbox' : 'square-outline') : (selectedIndices.includes(idx) ? 'radio-button-on' : 'radio-button-off')}
                  size={22}
                  color={selectedIndices.includes(idx) ? Colors.primary : Colors.textSecondary}
                />
                <Text style={[styles.surveyOptionText, selectedIndices.includes(idx) && { color: Colors.primary, fontWeight: '600' }]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
          ) : (
            <View style={styles.surveyExpandRow}>
              <TouchableOpacity
                style={styles.surveyExpandBtn}
                onPress={() => setExpandedSurveyPostIds((prev) => new Set(prev).add(post.id))}
              >
                <Ionicons name="chevron-down" size={18} color={Colors.primary} />
                <Text style={styles.surveyExpandBtnText}>Expand to show options</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.surveyPlotBtn} onPress={() => setSurveyChartPostId(post.id)}>
                <Ionicons name="bar-chart-outline" size={18} color={Colors.primary} />
                <Text style={styles.surveyPlotBtnText}>Plot</Text>
              </TouchableOpacity>
            </View>
          )}
          {isExpanded && (
            <View style={styles.surveyExpandRow}>
              <TouchableOpacity
                style={styles.surveyCollapseBtn}
                onPress={() => setExpandedSurveyPostIds((prev) => { const next = new Set(prev); next.delete(post.id); return next; })}
              >
                <Ionicons name="chevron-up" size={16} color={Colors.textSecondary} />
                <Text style={styles.surveyCollapseBtnText}>Collapse</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.surveyPlotBtn} onPress={() => setSurveyChartPostId(post.id)}>
                <Ionicons name="bar-chart-outline" size={18} color={Colors.primary} />
                <Text style={styles.surveyPlotBtnText}>Plot</Text>
              </TouchableOpacity>
            </View>
          )}
          {showSurveyPingBubble === post.id && (
            <View style={styles.surveyPingBubble}>
              <Text style={styles.pingBubbleText}>Send a reminder to people who haven't answered yet. You can use this once every 24 hours.</Text>
            </View>
          )}
            </>
          )}
        </View>
      );
    }

    return (
      <View style={styles.postCard}>
        <View style={styles.postHeader}>
          <Avatar uri={post.profile?.avatar_url} name={post.profile?.full_name} size={40} />
          <View style={styles.postHeaderText}>
            <Text style={styles.postAuthor}>{post.profile?.full_name ?? 'Someone'}</Text>
            <Text style={styles.postTime}>{formatPostTime(post.created_at)}</Text>
          </View>
          {isMe && !isEditing && (
            <View
              ref={(r) => {
                if (r) postButtonRefs.current[post.id] = r;
              }}
              collapsable={false}
            >
              <TouchableOpacity
                onPress={() => {
                  const ref = postButtonRefs.current[post.id];
                  ref?.measureInWindow((x, y, width, height) => {
                    setPostMenuPostId(post.id);
                    setPostMenuPosition({ x, y: y + height, width });
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {isEditing ? (
          <View style={styles.postEditRow}>
            <TextInput
              style={styles.postEditInput}
              value={editPostText}
              onChangeText={setEditPostText}
              multiline
              autoFocus
            />
            <View style={styles.postEditActions}>
              <TouchableOpacity
                style={styles.postEditSave}
                onPress={() => handleEditPost(post.id)}
              >
                <Text style={styles.postEditSaveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.postEditCancel}
                onPress={() => {
                  setEditingPostId(null);
                  setEditPostText('');
                }}
              >
                <Text style={styles.postEditCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Text style={styles.postContent}>{post.content}</Text>
        )}

        <View style={styles.commentsSection}>
          <TouchableOpacity
            style={styles.commentsToggle}
            onPress={() =>
              setExpandedComments((prev) => {
                const next = new Set(prev);
                if (next.has(post.id)) next.delete(post.id);
                else next.add(post.id);
                return next;
              })
            }
          >
            <Ionicons
              name={expandedComments.has(post.id) ? 'chatbubbles' : 'chatbubble-outline'}
              size={18}
              color={Colors.primary}
            />
            <Text style={styles.commentsToggleText}>
              {post.comments.length === 0
                ? 'Comment'
                : `${post.comments.length} ${post.comments.length === 1 ? 'comment' : 'comments'}`}
            </Text>
          </TouchableOpacity>
          {expandedComments.has(post.id) && (
            <View style={styles.commentsExpanded}>
              {post.comments.map((c) => renderComment(c, post.id))}
              <View style={styles.commentInputRow}>
                <TextInput
                  style={styles.commentInput}
                  value={commentInputs[post.id] ?? ''}
                  onChangeText={(t) => setCommentInputs((prev) => ({ ...prev, [post.id]: t }))}
                  placeholder="Write a comment…"
                  placeholderTextColor={Colors.textSecondary}
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[
                    styles.commentPostBtn,
                    (!(commentInputs[post.id] ?? '').trim() || commentSending[post.id]) &&
                      styles.commentPostBtnDisabled,
                  ]}
                  onPress={() => handleComment(post.id)}
                  disabled={!(commentInputs[post.id] ?? '').trim() || commentSending[post.id]}
                >
                  {commentSending[post.id] ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title=""
        showBack
        rightActionPeek={
          id
            ? {
                icon: 'eye-outline',
                onPressIn: () => setShowPeek(true),
                onPressOut: () => setShowPeek(false),
              }
            : undefined
        }
      />

      {/* Title section with splash thumb to the left */}
      <TouchableOpacity
        style={styles.titleSection}
        activeOpacity={id ? 0.7 : 1}
        onPress={
          id
            ? () =>
                router.push(
                  `/(app)/activity/${id}?fromTab=${encodeURIComponent(fromTab ?? 'chats')}`
                )
            : undefined
        }
        disabled={!id}
      >
        <View style={[styles.titleRow, (activityDetails?.place_photo_name || activityDetails?.splash_art) && styles.titleRowWithSplash]}>
          {(activityDetails?.place_photo_name || activityDetails?.splash_art) && (
            <View style={styles.splashBackground}>
              <SplashArt
                preset={getActivityCoverProps(activityDetails)?.preset}
                imageUri={getActivityCoverProps(activityDetails)?.imageUri}
                height={90}
                opacity={0.5}
                resizeMode="cover"
              />
            </View>
          )}
          <View style={[styles.titleContent, (activityDetails?.place_photo_name || activityDetails?.splash_art) && styles.titleContentOverlay]}>
            <Text style={[styles.boardTitle, isHebrew(activityTitle || '') && styles.boardTitleRtl]} numberOfLines={2}>
              {activityTitle || 'Board'}
            </Text>
            <Text style={styles.boardSubtitle}>
              Posts and comments
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      <Modal visible={showPeek} transparent animationType="fade">
        <Pressable style={styles.peekOverlay} onPress={() => setShowPeek(false)}>
          <Pressable
            style={[
              styles.peekCard,
              {
                marginTop: insets.top + 56,
                width: SCREEN_WIDTH,
                maxHeight: SCREEN_HEIGHT * 0.85,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {activityDetails ? (
              <ScrollView style={styles.peekContent} contentContainerStyle={styles.peekContentContainer} showsVerticalScrollIndicator={false}>
                <View style={styles.peekMeta}>
                  <View style={styles.peekMetaRow}>
                    <View style={styles.peekMetaIcon}>
                      <Ionicons name="calendar" size={20} color={Colors.primary} />
                    </View>
                    <View style={styles.peekMetaValueWrap}>
                      <Text style={styles.peekMetaLabel}>When</Text>
                      <Text style={styles.peekMetaValue}>
                        {isJoinMeNow(activityDetails)
                          ? 'Now'
                          : (() => {
                              const d = new Date(activityDetails.activity_time);
                              return isToday(d)
                                ? `Today at ${format(d, 'h:mm a')}`
                                : isTomorrow(d)
                                  ? `Tomorrow at ${format(d, 'h:mm a')}`
                                  : format(d, 'EEEE, MMMM d · h:mm a');
                            })()}
                      </Text>
                    </View>
                  </View>
                  {activityDetails.location && (
                    <View style={styles.peekMetaRow}>
                      <View style={styles.peekMetaIcon}>
                        <Ionicons name="location" size={20} color={Colors.primary} />
                      </View>
                      <View style={styles.peekMetaValueWrap}>
                        <Text style={styles.peekMetaLabel}>Where</Text>
                        <LocationDisplay
                          location={activityDetails.location}
                          variant="detail"
                          showIcon={false}
                          allowFullWrap
                        />
                      </View>
                    </View>
                  )}
                  {activityDetails.description ? (
                    <View style={styles.peekMetaRow}>
                      <View style={styles.peekMetaIcon}>
                        <Ionicons name="document-text" size={20} color={Colors.primary} />
                      </View>
                      <View style={[styles.peekMetaValueWrap, styles.peekDescWrap]}>
                        <Text style={styles.peekMetaLabel}>About</Text>
                        <RichText style={styles.peekDescText}>{activityDetails.description}</RichText>
                      </View>
                    </View>
                  ) : null}
                  {activityDetails.going.length > 0 && (
                    <View style={styles.peekMetaRow}>
                      <View style={styles.peekMetaIcon}>
                        <Ionicons name="people" size={20} color={Colors.primary} />
                      </View>
                      <View style={styles.peekMetaValueWrap}>
                        <Text style={styles.peekMetaLabel}>Going</Text>
                        <View style={styles.peekGoingRow}>
                          {activityDetails.going.map((r) => (
                            <View key={r.user_id} style={styles.peekGoingItem}>
                              <Avatar uri={r.profile?.avatar_url} name={r.profile?.full_name} size={28} />
                              <Text style={styles.peekGoingName} numberOfLines={1}>
                                {r.profile?.full_name ?? 'Someone'}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            ) : (
              <Text style={styles.peekTitle}>Loading…</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.composer, { paddingBottom: 12 }]}
            onPress={() => setShowNewPostModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.composerInput}>
              <Text style={styles.composerPlaceholder}>What's on your mind?</Text>
            </View>
          </TouchableOpacity>

          <Modal
            visible={showNewPostModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowNewPostModal(false)}
          >
            <KeyboardAvoidingView
              style={styles.newPostModalOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <Pressable
                style={styles.newPostModalBackdrop}
                onPress={() => {
                  setShowNewPostModal(false);
                  setPostText('');
                  setNewPostMode('text');
                  setShowLiveLocationTimePicker(false);
                  setSurveyQuestion('');
                  setSurveyOptions(['', '']);
                  setSurveyAllowMultiple(false);
                }}
              />
              <View style={[styles.newPostModal, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.newPostModalHeader}>
                  <Text style={styles.newPostModalTitle}>New post</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowNewPostModal(false);
                      setPostText('');
                      setNewPostMode('text');
                      setShowLiveLocationTimePicker(false);
                      setSurveyQuestion('');
                      setSurveyOptions(['', '']);
                      setSurveyAllowMultiple(false);
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="close" size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>
                {newPostMode === 'survey' ? (
                  <View style={styles.surveyCreateForm}>
                    <TouchableOpacity
                      style={styles.surveyBackBtn}
                      onPress={() => {
                        setNewPostMode('text');
                        setSurveyQuestion('');
                        setSurveyOptions(['', '']);
                        setSurveyAllowMultiple(false);
                      }}
                    >
                      <Ionicons name="arrow-back" size={20} color={Colors.primary} />
                      <Text style={styles.surveyBackBtnText}>Back</Text>
                    </TouchableOpacity>
                    <Text style={styles.surveyCreateLabel}>Question</Text>
                    <TextInput
                      style={styles.surveyQuestionInput}
                      value={surveyQuestion}
                      onChangeText={setSurveyQuestion}
                      placeholder="Ask your question…"
                      placeholderTextColor={Colors.textSecondary}
                      multiline
                      numberOfLines={2}
                      maxLength={500}
                    />
                    <Text style={styles.surveyCreateLabel}>Options</Text>
                    <ScrollView style={styles.surveyOptionsScroll} contentContainerStyle={styles.surveyOptionsList} nestedScrollEnabled>
                      {surveyOptions.map((opt, idx) => (
                        <View key={idx} style={styles.surveyOptionInputRow}>
                          <Text style={styles.surveyOptionNumber}>{idx + 1}.</Text>
                          <TextInput
                            style={styles.surveyOptionInput}
                            value={opt}
                            onChangeText={(t) =>
                              setSurveyOptions((prev) => {
                                const next = [...prev];
                                next[idx] = t;
                                if (idx === prev.length - 1 && t.trim()) {
                                  next.push('');
                                }
                                return next;
                              })
                            }
                            placeholder={`Option ${idx + 1}`}
                            placeholderTextColor={Colors.textSecondary}
                            maxLength={200}
                          />
                          {surveyOptions.length > 2 && (
                            <TouchableOpacity
                              onPress={() => setSurveyOptions((prev) => prev.filter((_, i) => i !== idx))}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="close-circle" size={22} color={Colors.textSecondary} />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.surveyAllowMultipleRow}
                      onPress={() => setSurveyAllowMultiple((v) => !v)}
                    >
                      <Ionicons
                        name={surveyAllowMultiple ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={surveyAllowMultiple ? Colors.primary : Colors.textSecondary}
                      />
                      <Text style={styles.surveyAllowMultipleText}>Allow multiple answers</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.publishBtn,
                        (surveyPosting ||
                          !surveyQuestion.trim() ||
                          surveyOptions.filter((o) => o.trim()).length < 2) &&
                          styles.publishBtnDisabled,
                      ]}
                      onPress={handlePostSurvey}
                      disabled={
                        surveyPosting ||
                        !surveyQuestion.trim() ||
                        surveyOptions.filter((o) => o.trim()).length < 2
                      }
                    >
                      {surveyPosting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.publishBtnText}>Publish survey</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : showLiveLocationTimePicker ? (
                  <View style={styles.liveLocationTimePicker}>
                    <Text style={styles.liveLocationTimePickerTitle}>Share live location for</Text>
                    {LIVE_LOCATION_TIME_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.minutes}
                        style={styles.liveLocationTimeOption}
                        onPress={() => handleShareLiveLocation(opt.minutes)}
                        disabled={liveLocationPosting}
                      >
                        {liveLocationPosting ? (
                          <ActivityIndicator size="small" color={Colors.primary} />
                        ) : (
                          <Ionicons name="time-outline" size={20} color={Colors.primary} />
                        )}
                        <Text style={styles.liveLocationTimeOptionText}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={styles.liveLocationTimeCancel}
                      onPress={() => setShowLiveLocationTimePicker(false)}
                      disabled={liveLocationPosting}
                    >
                      <Text style={styles.liveLocationTimeCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.shareLiveLocationBtn}
                      onPress={() => {
                        setNewPostMode('survey');
                      }}
                    >
                      <Ionicons name="stats-chart-outline" size={22} color={Colors.primary} />
                      <Text style={styles.shareLiveLocationBtnText}>Create survey</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.shareLiveLocationBtn}
                      onPress={async () => {
                        const permResult = await checkMipoVisibleModePermissions();
                        if (!permResult.ok) {
                          if (!user) return;
                          const { turnedOffMipo, turnedOffLiveLocation } = await turnOffLocationSharingIfActiveWhenPermissionDenied(user.id, id);
                          if (turnedOffMipo || turnedOffLiveLocation) {
                            if (turnedOffMipo) setVisible(false, null);
                            await fetchPosts();
                            return;
                          }
                          setPermissionError({
                            visible: true,
                            title: permResult.missingPrecise ? 'Precise location required' : 'Location required',
                            message: permResult.message ?? 'Please enable location access in Settings.',
                          });
                          return;
                        }
                        setShowLiveLocationTimePicker(true);
                      }}
                    >
                      <Ionicons name="map-outline" size={22} color={Colors.primary} />
                      <Text style={styles.shareLiveLocationBtnText}>Share live location</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.newPostInput}
                      value={postText}
                      onChangeText={setPostText}
                      placeholder="What's on your mind?"
                      placeholderTextColor={Colors.textSecondary}
                      multiline
                      maxLength={2000}
                      autoFocus
                      textAlignVertical="top"
                    />
                    <TouchableOpacity
                      style={[
                        styles.publishBtn,
                        (!postText.trim() || posting) && styles.publishBtnDisabled,
                      ]}
                      onPress={handlePost}
                      disabled={!postText.trim() || posting}
                    >
                      {posting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.publishBtnText}>Publish</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <Modal
            visible={postMenuPostId != null}
            transparent
            animationType="fade"
            onRequestClose={() => { setPostMenuPostId(null); setPostMenuPosition(null); }}
          >
            <TouchableOpacity
              style={styles.dropdownOverlay}
              activeOpacity={1}
              onPress={() => { setPostMenuPostId(null); setPostMenuPosition(null); }}
            >
              <View
                style={[
                  styles.dropdownMenu,
                  postMenuPosition && {
                    top: postMenuPosition.y + 4,
                    left: Math.max(16, Math.min(postMenuPosition.x + postMenuPosition.width - DROPDOWN_WIDTH, Dimensions.get('window').width - DROPDOWN_WIDTH - 16)),
                    right: undefined,
                  },
                  !postMenuPosition && { top: insets.top + 56, right: 16 },
                ]}
              >
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    const post = posts.find((p) => p.id === postMenuPostId);
                    if (post) {
                      setEditingPostId(post.id);
                      setEditPostText(post.content);
                      if (post.post_type === 'survey' && post.survey_metadata) {
                        const meta = post.survey_metadata;
                        setEditSurveyQuestion(meta.question ?? post.content);
                        setEditSurveyOptions([...(meta.options ?? []), '']);
                        setEditSurveyAllowMultiple(meta.allow_multiple ?? false);
                      }
                    }
                    setPostMenuPostId(null);
                    setPostMenuPosition(null);
                  }}
                >
                  <Ionicons name="pencil-outline" size={14} color={Colors.text} />
                  <Text style={styles.dropdownItemText}>Edit</Text>
                </TouchableOpacity>
                <View style={styles.dropdownDivider} />
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    const post = posts.find((p) => p.id === postMenuPostId);
                    if (post) handleDeletePost(post);
                    setPostMenuPostId(null);
                    setPostMenuPosition(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                  <Text style={[styles.dropdownItemText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          <Modal
            visible={permissionError.visible}
            transparent
            animationType="fade"
            onRequestClose={() => setPermissionError((p) => ({ ...p, visible: false }))}
          >
            <Pressable
              style={styles.dropdownOverlay}
              onPress={() => setPermissionError((p) => ({ ...p, visible: false }))}
            >
              <Pressable style={styles.permissionErrorCard} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.permissionErrorTitle}>{permissionError.title}</Text>
                <Text style={styles.permissionErrorMessage}>{permissionError.message}</Text>
                <TouchableOpacity
                  style={styles.permissionErrorBtn}
                  onPress={() => setPermissionError((p) => ({ ...p, visible: false }))}
                >
                  <Text style={styles.permissionErrorBtnText}>OK</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>

          <Modal
            visible={surveyChartPostId != null}
            transparent
            animationType="fade"
            onRequestClose={() => setSurveyChartPostId(null)}
          >
            <Pressable style={styles.dropdownOverlay} onPress={() => setSurveyChartPostId(null)}>
              <Pressable style={styles.surveyChartModal} onPress={(e) => e.stopPropagation()}>
                {(() => {
                  const post = posts.find((p) => p.id === surveyChartPostId);
                  if (!post || post.post_type !== 'survey' || !post.survey_metadata) return null;
                  const meta = post.survey_metadata;
                  const options = meta.options ?? [];
                  const counts = options.map((_, idx) =>
                    (post.surveyResponses ?? []).filter((r) => r.selected_indices?.includes(idx)).length
                  );
                  const maxCount = Math.max(0, ...counts);
                  const totalResponses = (post.surveyResponses ?? []).length;
                  return (
                    <>
                      <Text style={styles.surveyChartTitle}>{meta.question}</Text>
                      <ScrollView style={styles.surveyChartScroll} showsVerticalScrollIndicator={false}>
                        {totalResponses === 0 ? (
                          <Text style={styles.surveyChartEmpty}>No responses yet</Text>
                        ) : (
                          <View style={styles.surveyChartBars}>
                            {options.map((opt, idx) => {
                              const count = counts[idx];
                              const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                              const isTop = maxCount > 0 && count === maxCount;
                              const respondents = (post.surveyResponses ?? []).filter((r) => r.selected_indices?.includes(idx));
                              const maxAvatars = 6;
                              const shown = respondents.slice(0, maxAvatars);
                              const extra = respondents.length - maxAvatars;
                              return (
                                <View key={idx} style={styles.surveyChartOption}>
                                  <View style={styles.surveyChartRow}>
                                    <Text style={styles.surveyChartLabel} numberOfLines={1}>{opt}</Text>
                                    <View style={styles.surveyChartBarWrap}>
                                      <View
                                        style={[
                                          styles.surveyChartBar,
                                          { width: `${pct}%` },
                                          isTop ? styles.surveyChartBarTop : styles.surveyChartBarNormal,
                                        ]}
                                      />
                                    </View>
                                    <Text style={styles.surveyChartCount}>{count}</Text>
                                  </View>
                                  {respondents.length > 0 && (
                                    <View style={styles.surveyChartAvatars}>
                                      {shown.map((r) => (
                                        <Avatar key={r.id} uri={r.profile?.avatar_url} name={r.profile?.full_name} size={20} />
                                      ))}
                                      {extra > 0 && (
                                        <Text style={styles.surveyChartExtra}>+{extra}</Text>
                                      )}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </ScrollView>
                      <TouchableOpacity style={styles.surveyChartClose} onPress={() => setSurveyChartPostId(null)}>
                        <Text style={styles.surveyChartCloseText}>Close</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </Pressable>
            </Pressable>
          </Modal>

          <Modal
            visible={commentMenuComment != null}
            transparent
            animationType="fade"
            onRequestClose={() => { setCommentMenuComment(null); setCommentMenuPosition(null); }}
          >
            <TouchableOpacity
              style={styles.dropdownOverlay}
              activeOpacity={1}
              onPress={() => { setCommentMenuComment(null); setCommentMenuPosition(null); }}
            >
              <View
                style={[
                  styles.dropdownMenu,
                  commentMenuPosition && {
                    top: commentMenuPosition.y + 4,
                    left: Math.max(16, Math.min(commentMenuPosition.x + commentMenuPosition.width - DROPDOWN_WIDTH, Dimensions.get('window').width - DROPDOWN_WIDTH - 16)),
                    right: undefined,
                  },
                  !commentMenuPosition && { top: insets.top + 56, right: 16 },
                ]}
              >
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    if (commentMenuComment) {
                      setEditingCommentId(commentMenuComment.id);
                      setEditCommentText(commentMenuComment.content);
                    }
                    setCommentMenuComment(null);
                    setCommentMenuPosition(null);
                  }}
                >
                  <Ionicons name="pencil-outline" size={14} color={Colors.text} />
                  <Text style={styles.dropdownItemText}>Edit</Text>
                </TouchableOpacity>
                <View style={styles.dropdownDivider} />
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    if (commentMenuComment) handleDeleteComment(commentMenuComment);
                    setCommentMenuComment(null);
                    setCommentMenuPosition(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                  <Text style={[styles.dropdownItemText, { color: Colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {posts.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to post something!</Text>
            </View>
          ) : (
            <FlatList
              data={posts}
              keyExtractor={(item) => item.id}
              renderItem={renderPost}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
              }
            />
          )}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary },

  titleSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRowWithSplash: { position: 'relative' as const, marginHorizontal: -20, marginTop: -8, minHeight: 90 },
  splashBackground: { position: 'absolute' as const, top: 0, left: 0, right: 0, overflow: 'hidden', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  titleContent: { flex: 1, minWidth: 0 },
  titleContentOverlay: { padding: 20, paddingTop: 16 },
  boardTitle: { fontSize: 28, fontWeight: '800', color: Colors.text, lineHeight: 34, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 4 },
  boardTitleRtl: { textAlign: 'right' },
  boardSubtitle: { fontSize: 14, color: Colors.textSecondary },

  composer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  composerInput: {
    backgroundColor: Colors.background,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  composerPlaceholder: { fontSize: 15, color: Colors.textSecondary },

  newPostModalOverlay: { flex: 1, justifyContent: 'flex-end' },
  newPostModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  newPostModal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  newPostModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  newPostModalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  shareLiveLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.accentLight,
    borderRadius: 12,
    marginBottom: 16,
  },
  shareLiveLocationBtnText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  liveLocationTimePicker: { marginBottom: 16 },
  liveLocationTimePickerTitle: { fontSize: 16, color: Colors.text, marginBottom: 12 },
  liveLocationTimeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.background,
    borderRadius: 12,
    marginBottom: 8,
  },
  liveLocationTimeOptionText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  liveLocationTimeCancel: { paddingVertical: 12, alignItems: 'center' },
  liveLocationTimeCancelText: { fontSize: 15, color: Colors.textSecondary },
  liveLocationIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionErrorCard: {
    marginHorizontal: 24,
    padding: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  permissionErrorTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  permissionErrorMessage: { fontSize: 15, color: Colors.textSecondary, marginBottom: 16, lineHeight: 22 },
  permissionErrorBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  permissionErrorBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  newPostInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    minHeight: 120,
    marginBottom: 16,
  },
  publishBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishBtnDisabled: { backgroundColor: Colors.border, opacity: 0.6 },
  publishBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  peekOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
  },
  peekCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  peekContent: {},
  peekContentContainer: { padding: 16, paddingBottom: 24, flexGrow: 0 },
  peekTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  peekMeta: { gap: 14 },
  peekMetaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  peekMetaIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekMetaLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  peekMetaValue: { fontSize: 15, color: Colors.text, fontWeight: '600', marginTop: 1 },
  peekMetaValueWrap: { flex: 1, minWidth: 0 },
  peekDescWrap: {},
  peekDescText: { fontSize: 15, color: Colors.text, lineHeight: 22, marginTop: 1 },
  peekGoingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  peekGoingItem: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  peekGoingName: { fontSize: 14, color: Colors.text, fontWeight: '500', flex: 1, minWidth: 0 },

  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  dropdownMenu: {
    position: 'absolute',
    right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    minWidth: DROPDOWN_WIDTH,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
  },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  dropdownItemText: { fontSize: 13, fontWeight: '500', color: Colors.text },
  dropdownDivider: { height: 1, backgroundColor: Colors.borderLight },

  listContent: { padding: 16, gap: 12 },

  postCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  postHeaderText: { flex: 1, marginLeft: 12 },
  postAuthor: { fontSize: 16, fontWeight: '700', color: Colors.text },
  postTime: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  postContent: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  postEditRow: { marginBottom: 8 },
  postEditInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  postEditActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  postEditSave: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  postEditSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  postEditCancel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  postEditCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },

  commentsSection: { marginTop: 16 },
  commentsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentsToggleText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  commentsExpanded: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  commentContent: { flex: 1, marginLeft: 10 },
  commentAuthor: { fontSize: 14, fontWeight: '600', color: Colors.text },
  commentText: { fontSize: 14, color: Colors.text, lineHeight: 20, marginTop: 2 },
  commentTime: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  commentEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  commentEditInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.text,
    minHeight: 36,
  },
  commentEditSave: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primary },
  commentEditSaveText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  commentEditCancel: { paddingHorizontal: 12, paddingVertical: 6 },
  commentEditCancelText: { fontSize: 13, color: Colors.textSecondary },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  commentInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.text,
    maxHeight: 80,
  },
  commentPostBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentPostBtnDisabled: { backgroundColor: Colors.border, opacity: 0.6 },

  postHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  pingBtnDisabled: { opacity: 0.6, borderColor: Colors.textSecondary },
  pingBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  surveyQuestion: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 12 },
  surveyOptions: { gap: 4 },
  surveyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  surveyOptionSelected: { backgroundColor: Colors.accentLight },
  surveyOptionText: { fontSize: 15, color: Colors.text, flex: 1 },
  surveySubmitBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  surveyPingBubble: {
    marginTop: 12,
    padding: 12,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  pingBubbleText: { fontSize: 14, color: Colors.text, lineHeight: 20 },

  surveyCreateForm: { marginBottom: 16 },
  surveyEditForm: { marginTop: 8 },
  surveyBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  surveyBackBtnText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  surveyCreateLabel: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  surveyQuestionInput: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    minHeight: 44,
    maxHeight: 60,
    textAlignVertical: 'top',
  },
  surveyOptionsScroll: { maxHeight: 200 },
  surveyOptionsList: { gap: 8, paddingRight: 4 },
  surveyOptionNumber: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary, minWidth: 20 },
  surveyOptionInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  surveyOptionInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
  },
  surveyAllowMultipleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    marginBottom: 16,
  },
  surveyAllowMultipleText: { fontSize: 15, color: Colors.text },

  surveyChartModal: {
    marginHorizontal: 24,
    marginVertical: 80,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  surveyChartTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  surveyChartScroll: { maxHeight: SCREEN_HEIGHT * 0.5 },
  surveyChartEmpty: { fontSize: 15, color: Colors.textSecondary, marginBottom: 16 },
  surveyChartBars: { gap: 12, marginBottom: 16 },
  surveyChartOption: { gap: 4 },
  surveyChartRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  surveyChartAvatars: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 },
  surveyChartExtra: { fontSize: 12, color: Colors.textSecondary, marginLeft: 2 },
  surveyChartLabel: { fontSize: 14, color: Colors.text, flex: 1, minWidth: 0 },
  surveyChartBarWrap: { flex: 1, height: 24, backgroundColor: Colors.borderLight, borderRadius: 6, overflow: 'hidden', justifyContent: 'center' },
  surveyChartBar: { height: '100%', borderRadius: 6 },
  surveyChartBarNormal: { backgroundColor: Colors.primary },
  surveyChartBarTop: { backgroundColor: Colors.success },
  surveyChartCount: { fontSize: 14, fontWeight: '700', color: Colors.text, minWidth: 24, textAlign: 'right' },
  surveyChartClose: { paddingVertical: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.borderLight },
  surveyChartCloseText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  surveyExpandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  surveyPlotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  surveyPlotBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  surveyExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  surveyExpandBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  surveyCollapseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  surveyCollapseBtnText: { fontSize: 13, color: Colors.textSecondary },
});
