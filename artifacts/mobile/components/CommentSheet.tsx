/**
 * CommentSheet — modal sheet showing server comments with a send input.
 *
 * Comments are fetched via useGetPostComments(postId).
 * New comments POST through useCreateComment; on success the returned
 * PostComment is appended to the query cache for instant display, and
 * onCommentPosted() is called so the parent page can bump its local count.
 */

import React, { useState, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ReportFlow from '@/components/ReportFlow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatCircle } from 'phosphor-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  useGetPostComments,
  useCreateComment,
  getGetPostCommentsQueryKey,
} from '@workspace/api-client-react';
import type { PostComment } from '@workspace/api-client-react';

interface Props {
  visible: boolean;
  onClose: () => void;
  postId: string | null;
  /** Called after a comment is successfully posted — parent updates its count. */
  onCommentPosted?: () => void;
}

// ─── Row component ────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  colors,
  onLongPress,
}: {
  comment: PostComment;
  colors: ReturnType<typeof useColors>;
  onLongPress: () => void;
}) {
  const initials = comment.authorUsername
    .split(/[._-]/)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  const relativeTime = (() => {
    const diff = Date.now() - new Date(comment.createdAt).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  })();

  return (
    // Long-press opens the report flow for this comment.
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityHint="long-press to report"
      style={styles.commentRow}
    >
      <View style={[styles.avatar, { backgroundColor: colors.card }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>
          {initials || '?'}
        </Text>
      </View>
      <View style={styles.commentContent}>
        <Text style={[styles.commentAuthor, { color: colors.foreground }]}>
          {comment.authorUsername}
          <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
            {'  '}{relativeTime}
          </Text>
        </Text>
        <Text style={[styles.commentText, { color: colors.foreground }]}>
          {comment.text}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── CommentSheet ─────────────────────────────────────────────────────────────

export default function CommentSheet({ visible, onClose, postId, onCommentPosted }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);
  // Report state — which comment is being reported (null = none open)
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);

  // Fetch server comments — disabled when no postId or sheet not visible
  const { data: serverComments, isLoading } = useGetPostComments(
    postId ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!postId && visible } as any },
  );

  // POST comment mutation
  const { mutate: postComment, isPending: isSending } = useCreateComment();

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || !postId || isSending) return;

    postComment(
      { id: postId, data: { text: trimmed } },
      {
        onSuccess: (newComment) => {
          setDraft('');
          // Append to query cache — instant display without a round-trip refetch
          queryClient.setQueryData<PostComment[]>(
            getGetPostCommentsQueryKey(postId),
            (old) => [...(old ?? []), newComment],
          );
          // Notify parent page to bump its comment count
          onCommentPosted?.();
        },
      },
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.card }]}>

        {/*
         * ── PINNED HEADER ──────────────────────────────────────────────────
         * Lives OUTSIDE the KeyboardAvoidingView so it never moves when the
         * keyboard opens or the input grows.  Cancel (left) and Post (right)
         * are always visible regardless of keyboard state or text length.
         */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.headerRow}>
            {/* Cancel — left */}
            <TouchableOpacity
              onPress={onClose}
              style={styles.headerActionLeft}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>

            {/* Title — center */}
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Comments</Text>

            {/* Post — right */}
            <TouchableOpacity
              onPress={handleSend}
              activeOpacity={0.7}
              disabled={!draft.trim() || isSending}
              style={styles.headerActionRight}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
            >
              {isSending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[
                    styles.sendText,
                    {
                      color: draft.trim() ? colors.primary : colors.mutedForeground,
                      opacity: draft.trim() ? 1 : 0.45,
                    },
                  ]}
                >
                  Post
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/*
         * ── KEYBOARD-AWARE BODY ────────────────────────────────────────────
         * KAV shrinks this region from the bottom when the keyboard appears,
         * keeping the input bar above the keyboard.  The header above is
         * unaffected because it sits outside this View.
         */}
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {/* Comments list — fills available space, scrollable */}
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              style={styles.fill}
              data={serverComments ?? []}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <CommentRow
                  comment={item}
                  colors={colors}
                  onLongPress={() => setReportingCommentId(item.id)}
                />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <ChatCircle size={32} color={colors.mutedForeground} weight="regular" />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    No comments yet.{'\n'}Be the first to say something.
                  </Text>
                </View>
              }
            />
          )}

          {/* Input bar — pinned above keyboard; Post lives in the header */}
          <View
            style={[
              styles.inputBar,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 8,
              },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              multiline
              maxLength={280}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>
        </KeyboardAvoidingView>

      </View>

      {/* Report flow — authorId from comments response */}
      <ReportFlow
        visible={reportingCommentId !== null}
        onClose={() => setReportingCommentId(null)}
        targetType="comment"
        targetId={reportingCommentId ?? ''}
        ownerUserId={
          ((serverComments ?? []).find(c => c.id === reportingCommentId) as unknown as { authorId?: string })?.authorId
        }
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill:      { flex: 1 },

  // ── Pinned header ────────────────────────────────────────────────────────
  // Sits OUTSIDE the KeyboardAvoidingView so it never shifts when the
  // keyboard opens.  Cancel and Post are always visible.
  header: {
    paddingTop:        12,
    paddingBottom:     10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    width:       36,
    height:      4,
    borderRadius: 2,
    marginBottom: 10,
    alignSelf:   'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems:   'center',
  },
  // Both action slots share the same minWidth so the title stays centered.
  headerActionLeft: {
    minWidth:    64,
    minHeight:   44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerActionRight: {
    minWidth:    64,
    minHeight:   44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex:       1,
    textAlign:  'center',
    fontSize:   16,
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Keyboard-aware body ──────────────────────────────────────────────────
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop:  12,
    paddingBottom: 8,
    flexGrow:    1,
  },

  // ── Comment rows ─────────────────────────────────────────────────────────
  commentRow: {
    flexDirection: 'row',
    gap:          12,
    marginBottom: 20,
  },
  avatar: {
    width:         36,
    height:        36,
    borderRadius:  18,
    alignItems:    'center',
    justifyContent:'center',
  },
  avatarText: {
    fontSize:   12,
    fontWeight: '700' as const,
  },
  commentContent: {
    flex: 1,
    gap:  3,
  },
  commentAuthor: {
    fontSize:   13,
    fontWeight: '600' as const,
  },
  commentTime: {
    fontSize:   12,
    fontWeight: '400' as const,
  },
  commentText: {
    fontSize:   14,
    lineHeight: 20,
  },
  emptyState: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap:            12,
  },
  emptyText: {
    fontSize:   14,
    textAlign:  'center',
    lineHeight: 20,
  },

  // ── Input bar ─────────────────────────────────────────────────────────────
  // Post lives in the header; this bar holds only the TextInput.
  inputBar: {
    paddingHorizontal: 16,
    paddingTop:        10,
    borderTopWidth:    StyleSheet.hairlineWidth,
  },
  input: {
    borderRadius:     20,
    borderWidth:      1,
    paddingHorizontal: 14,
    paddingVertical:  10,
    fontSize:         14,
    maxHeight:        120,
    lineHeight:       20,
  },

  // ── Header actions ────────────────────────────────────────────────────────
  sendText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize:   15,
  },
  cancelText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },
});
