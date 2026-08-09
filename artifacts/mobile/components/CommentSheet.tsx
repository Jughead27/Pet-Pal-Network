/**
 * CommentSheet — modal sheet showing server comments with a send input.
 *
 * Long-press behaviour (400 ms):
 *   • Own comment  → opens a minimal inline delete panel (own-comment only).
 *   • Other's comment → opens ReportFlow (unchanged).
 *
 * Delete is a soft-delete: DELETE /posts/:id/comments/:commentId sets
 * deleted_at server-side. The cache row is removed optimistically so the
 * comment disappears immediately; the next sheet open refetches to confirm.
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
import { useAuth } from '@clerk/clerk-expo';
import { useColors } from '@/hooks/useColors';
import {
  useGetPostComments,
  useCreateComment,
  useDeleteComment,
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
  isOwn,
  onLongPress,
  onDelete,
}: {
  comment: PostComment;
  colors: ReturnType<typeof useColors>;
  /** True when the viewer is the comment author — shows delete whisper + changes long-press hint. */
  isOwn: boolean;
  onLongPress: () => void;
  /** Called when the viewer taps the visible "delete" whisper on their own comment. */
  onDelete: () => void;
}) {
  // Display name with fallback — never the raw username/userID.
  // authorDisplayName is served by the API but not yet in the generated type
  // (same consumption pattern as the pet owners array).
  const authorName =
    (comment as PostComment & { authorDisplayName?: string | null }).authorDisplayName?.trim()
    || 'a pshpsh member';

  const initials = authorName
    .split(/[\s._-]+/)
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
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityHint={isOwn ? 'long-press to delete' : 'long-press to report'}
      style={styles.commentRow}
    >
      <View style={[styles.avatar, { backgroundColor: colors.card }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>
          {initials || '?'}
        </Text>
      </View>
      <View style={styles.commentContent}>
        <Text style={[styles.commentAuthor, { color: colors.foreground }]}>
          {authorName}
          <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
            {'  '}{relativeTime}
          </Text>
        </Text>
        <Text style={[styles.commentText, { color: colors.foreground }]}>
          {comment.text}
        </Text>
        {isOwn && (
          <TouchableOpacity
            onPress={onDelete}
            activeOpacity={0.5}
            accessibilityRole="button"
            accessibilityLabel="Delete comment"
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          >
            <Text style={[styles.deleteWhisper, { color: colors.mutedForeground }]}>
              delete
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Pressable>
  );
}

// ─── CommentSheet ─────────────────────────────────────────────────────────────

export default function CommentSheet({ visible, onClose, postId, onCommentPosted }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Report state — which comment is being reported (null = none open)
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  // Delete state — which own comment has the delete panel open (null = none)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // Fetch server comments — disabled when no postId or sheet not visible
  const { data: serverComments, isLoading } = useGetPostComments(
    postId ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !!postId && visible } as any },
  );

  // POST comment mutation
  const { mutate: postComment, isPending: isSending } = useCreateComment();

  // DELETE comment mutation
  const { mutate: deleteComment, isPending: isDeleting } = useDeleteComment();

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || !postId || isSending) return;

    postComment(
      { id: postId, data: { text: trimmed } },
      {
        onSuccess: (newComment) => {
          setDraft('');
          queryClient.setQueryData<PostComment[]>(
            getGetPostCommentsQueryKey(postId),
            (old) => [...(old ?? []), newComment],
          );
          void queryClient.invalidateQueries({
            queryKey: getGetPostCommentsQueryKey(postId),
          });
          onCommentPosted?.();
          // Intentionally NO onClose() here — after posting, the user stays
          // on the comment thread. Leaving is only via an explicit back
          // action (Cancel / hardware back / sheet dismiss).
        },
      },
    );
  };

  const handleDeleteConfirm = () => {
    if (!deletingCommentId || !postId || isDeleting) return;
    const commentId = deletingCommentId;

    // Optimistic removal — comment disappears immediately
    queryClient.setQueryData<PostComment[]>(
      getGetPostCommentsQueryKey(postId),
      (old) => (old ?? []).filter((c) => c.id !== commentId),
    );
    setDeletingCommentId(null);

    deleteComment(
      { id: postId, commentId },
      {
        onError: () => {
          // Revert optimistic removal on failure
          void queryClient.invalidateQueries({
            queryKey: getGetPostCommentsQueryKey(postId),
          });
        },
        onSettled: () => {
          // Always refetch to reconcile server state
          void queryClient.invalidateQueries({
            queryKey: getGetPostCommentsQueryKey(postId),
          });
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
      <View
        style={[
          styles.container,
          { backgroundColor: colors.card },
          Platform.OS === 'web' && (styles.containerWeb as object),
        ]}
      >

        {/* ── PINNED HEADER ─────────────────────────────────────────────── */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.headerActionLeft}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>

            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Comments</Text>

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

        {/* ── KEYBOARD-AWARE BODY ───────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
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
                  isOwn={!!userId && item.authorId === userId}
                  onDelete={() => setDeletingCommentId(item.id)}
                  onLongPress={() => {
                    if (!!userId && item.authorId === userId) {
                      setDeletingCommentId(item.id);
                    } else {
                      setReportingCommentId(item.id);
                    }
                  }}
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

          {/* Input bar */}
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

      {/* ── DELETE PANEL — own comments only ──────────────────────────────
          Shown as a slim overlay at the bottom of the sheet when the viewer
          long-presses their own comment.  Typographic/minimal — no capsule
          buttons, matches the exit-pattern weight of ReportFlow. */}
      <Modal
        visible={deletingCommentId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeletingCommentId(null)}
      >
        <Pressable
          style={styles.deleteBackdrop}
          onPress={() => setDeletingCommentId(null)}
          accessible={false}
        >
          <View
            style={[
              styles.deletePanel,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={[styles.deletePanelGrabber, { backgroundColor: colors.border }]} />
            <Text style={[styles.deletePanelTitle, { color: colors.foreground }]}>
              Delete comment?
            </Text>
            <Text style={[styles.deletePanelBody, { color: colors.mutedForeground }]}>
              This removes your comment for everyone. It can't be undone.
            </Text>

            <TouchableOpacity
              onPress={handleDeleteConfirm}
              disabled={isDeleting}
              style={styles.deletePanelAction}
              accessibilityRole="button"
              accessibilityLabel="Delete comment"
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#E05252" />
              ) : (
                <Text style={styles.deleteConfirmText}>delete comment</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setDeletingCommentId(null)}
              style={styles.deletePanelAction}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.deleteCancelText, { color: colors.mutedForeground }]}>
                cancel
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Report flow — other users' comments */}
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
  containerWeb: { height: '100dvh' as unknown as number },
  fill:      { flex: 1 },

  // ── Pinned header ────────────────────────────────────────────────────────
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
  deleteWhisper: {
    fontFamily: 'Inter_400Regular',
    fontSize:   11,
    opacity:    0.35,
    marginTop:  3,
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
  inputBar: {
    paddingHorizontal: 16,
    paddingTop:        10,
    borderTopWidth:    StyleSheet.hairlineWidth,
  },
  input: {
    flex:             1,
    borderRadius:     20,
    borderWidth:      1,
    paddingHorizontal: 14,
    paddingVertical:  10,
    fontSize:         16,
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

  // ── Delete panel ──────────────────────────────────────────────────────────
  // Shown in a transparent modal so it floats above the comment sheet without
  // disrupting the existing sheet stack.  Minimal typographic layout.
  deleteBackdrop: {
    flex:            1,
    justifyContent:  'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  deletePanel: {
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    paddingTop:        12,
    paddingHorizontal: 24,
    gap:               4,
  },
  deletePanelGrabber: {
    width:       36,
    height:      4,
    borderRadius: 2,
    alignSelf:   'center',
    marginBottom: 16,
  },
  deletePanelTitle: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      17,
    marginBottom:  6,
  },
  deletePanelBody: {
    fontFamily:  'Inter_400Regular',
    fontSize:    14,
    lineHeight:  20,
    marginBottom: 20,
  },
  deletePanelAction: {
    minHeight:      44,
    justifyContent: 'center',
  },
  deleteConfirmText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   16,
    color:      '#E05252',  // destructive red — same hue as system danger
  },
  deleteCancelText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   16,
  },
});
