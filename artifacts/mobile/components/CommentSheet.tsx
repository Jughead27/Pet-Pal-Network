/**
 * CommentSheet — modal sheet showing comments and a text input.
 */

import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useApp, Comment } from '@/context/AppContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

function CommentRow({ comment, colors }: { comment: Comment; colors: ReturnType<typeof useColors> }) {
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

export default function CommentSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { comments, pet, addComment } = useApp();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addComment(trimmed);
    setDraft('');
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
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CommentRow comment={item} colors={colors} />}
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
              placeholder={`Comment on ${pet.name}...`}
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
