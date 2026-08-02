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
import { Ionicons } from '@expo/vector-icons';
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
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Comments
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Comments list */}
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
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
            // Prevent this inner scroll from ever bubbling to the pager
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

        {/* Input */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View
            style={[
              styles.inputRow,
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
            <TouchableOpacity
              onPress={handleSend}
              activeOpacity={0.7}
              disabled={!draft.trim() || isSending}
              style={[
                styles.sendBtn,
                {
                  backgroundColor:
                    draft.trim() && !isSending ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={
                  draft.trim() && !isSending
                    ? colors.primaryForeground
                    : colors.mutedForeground
                }
              />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Report flow — comment.  authorId comes from the comments response (field added server-side). */}
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
  header: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    padding: 4,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexGrow: 1,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  commentContent: {
    flex: 1,
    gap: 3,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  commentTime: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
