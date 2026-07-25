/**
 * CommentSheet — modal sheet showing server comments and a local-add input.
 *
 * Server comments are fetched via useGetPostComments(postId).
 * New comments added locally via AppContext.addComment are shown below them
 * (optimistic — not yet persisted; write endpoints come in the next phase).
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useApp, Comment } from '@/context/AppContext';
import { useGetPostComments } from '@workspace/api-client-react';
import type { PostComment } from '@workspace/api-client-react';

interface Props {
  visible: boolean;
  onClose: () => void;
  postId: string | null;
}

// ─── Row components ──────────────────────────────────────────────────────────

function ServerCommentRow({
  comment,
  colors,
}: {
  comment: PostComment;
  colors: ReturnType<typeof useColors>;
}) {
  const initials = comment.authorUsername
    .split(/[._-]/)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  // Relative timestamp: show "now" for items without a meaningful date diff
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
    <View style={styles.commentRow}>
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
    </View>
  );
}

function LocalCommentRow({
  comment,
  colors,
}: {
  comment: Comment;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.commentRow}>
      <View style={[styles.avatar, { backgroundColor: colors.card }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>
          {comment.initials}
        </Text>
      </View>
      <View style={styles.commentContent}>
        <Text style={[styles.commentAuthor, { color: colors.foreground }]}>
          {comment.author}
          <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
            {'  '}{comment.timestamp}
          </Text>
        </Text>
        <Text style={[styles.commentText, { color: colors.foreground }]}>
          {comment.text}
        </Text>
      </View>
    </View>
  );
}

// ─── CommentSheet ─────────────────────────────────────────────────────────────

export default function CommentSheet({ visible, onClose, postId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { comments: localComments, addComment } = useApp();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Fetch server comments — disabled when no postId.
  // We cast the query options because orval's generated type requires `queryKey`
  // but the hook's implementation always provides it from the path template.
  const { data: serverComments, isLoading } = useGetPostComments(
    postId ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!postId && visible } as any },
  );

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addComment(trimmed);
    setDraft('');
  };

  // Combine: server comments first (chronological), then local additions
  type ListItem =
    | { kind: 'server'; data: PostComment }
    | { kind: 'local'; data: Comment };

  const items: ListItem[] = [
    ...(serverComments ?? []).map((c) => ({ kind: 'server' as const, data: c })),
    ...localComments.map((c) => ({ kind: 'local' as const, data: c })),
  ];

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
            data={items}
            keyExtractor={(item) => `${item.kind}-${item.data.id}`}
            renderItem={({ item }) =>
              item.kind === 'server' ? (
                <ServerCommentRow comment={item.data} colors={colors} />
              ) : (
                <LocalCommentRow comment={item.data} colors={colors} />
              )
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Feather name="message-circle" size={32} color={colors.mutedForeground} />
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
              disabled={!draft.trim()}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: draft.trim() ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={draft.trim() ? colors.primaryForeground : colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
