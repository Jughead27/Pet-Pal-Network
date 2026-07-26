/**
 * ReportFlow — quiet, typographic report modal.
 *
 * Three internal steps:
 *   reasons  → user picks a reason from a typographic list
 *   note     → optional "anything else?" textarea + "send report"
 *   done     → "thank you. we'll take a look."
 *
 * Props:
 *   visible     — controls the Modal
 *   onClose     — called when the user dismisses or the flow completes
 *   targetType  — 'post' | 'comment'
 *   targetId    — the ID of the post or comment being reported
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { customFetch } from '@workspace/api-client-react';

// ── Reason display labels ─────────────────────────────────────────────────────

type Reason =
  | 'not_animal_content'
  | 'animal_cruelty'
  | 'mislabeled_pet'
  | 'wrong_nursery_flag'
  | 'spam'
  | 'harassment'
  | 'other';

const REASONS: { value: Reason; label: string }[] = [
  { value: 'not_animal_content', label: 'not animal content' },
  { value: 'animal_cruelty',     label: 'animal cruelty' },
  { value: 'mislabeled_pet',     label: 'mislabeled pet' },
  { value: 'wrong_nursery_flag', label: 'wrong nursery flag' },
  { value: 'spam',               label: 'spam' },
  { value: 'harassment',         label: 'harassment' },
  { value: 'other',              label: 'other' },
];

const NOTE_MAX = 200;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible:    boolean;
  onClose:    () => void;
  targetType: 'post' | 'comment';
  targetId:   string;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = 'reasons' | 'note' | 'sending' | 'done';

export default function ReportFlow({ visible, onClose, targetType, targetId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step,           setStep]           = useState<Step>('reasons');
  const [selectedReason, setSelectedReason] = useState<Reason | null>(null);
  const [note,           setNote]           = useState('');

  // Reset internal state whenever the modal opens.
  const handleShow = useCallback(() => {
    setStep('reasons');
    setSelectedReason(null);
    setNote('');
  }, []);

  const handlePickReason = (reason: Reason) => {
    setSelectedReason(reason);
    setStep('note');
  };

  const handleSend = async () => {
    if (!selectedReason) return;
    setStep('sending');
    try {
      await customFetch<{ ok: boolean; duplicate?: boolean }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId,
          reason: selectedReason,
          note:   note.trim() || undefined,
        }),
      });
    } catch {
      // Network / server errors — still show confirmation (graceful, not alarming).
    }
    setStep('done');
    // Auto-close after a beat.
    setTimeout(onClose, 2200);
  };

  const handleClose = () => {
    onClose();
  };

  const pb = insets.bottom + (Platform.OS === 'web' ? 24 : 8);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      onShow={handleShow}
    >
      <View style={[styles.sheet, { backgroundColor: colors.card }]}>
        {/* Grabber + close */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          {step !== 'done' && (
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.closeTxt, { color: colors.mutedForeground }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Reason step ─────────────────────────────────────────────────── */}
        {step === 'reasons' && (
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: pb }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.heading, { color: colors.foreground }]}>
              why are you reporting this?
            </Text>
            {REASONS.map(({ value, label }) => (
              <Pressable
                key={value}
                onPress={() => handlePickReason(value)}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.reasonRow,
                  { borderBottomColor: colors.border },
                  pressed && { opacity: 0.45 },
                ]}
              >
                <Text style={[styles.reasonLabel, { color: colors.foreground }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ── Note step ───────────────────────────────────────────────────── */}
        {(step === 'note' || step === 'sending') && (
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: pb }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.heading, { color: colors.foreground }]}>
              {REASONS.find((r) => r.value === selectedReason)?.label ?? ''}
            </Text>
            <Text style={[styles.notePrompt, { color: colors.mutedForeground }]}>
              anything else? (optional)
            </Text>
            <TextInput
              value={note}
              onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
              placeholder="add a note…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={NOTE_MAX}
              style={[
                styles.noteInput,
                {
                  color:           colors.foreground,
                  backgroundColor: colors.background,
                  borderColor:     colors.border,
                },
              ]}
              editable={step === 'note'}
            />
            {/* Character counter */}
            <Text style={[styles.counter, { color: colors.mutedForeground }]}>
              {note.length}/{NOTE_MAX}
            </Text>

            <TouchableOpacity
              onPress={handleSend}
              disabled={step === 'sending'}
              style={styles.sendBtn}
              accessibilityRole="button"
              accessibilityLabel="Send report"
            >
              <Text style={[
                styles.sendTxt,
                { color: step === 'sending' ? colors.mutedForeground : colors.foreground },
              ]}>
                {step === 'sending' ? 'sending…' : 'send report'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── Confirmation step ────────────────────────────────────────────── */}
        {step === 'done' && (
          <View style={[styles.body, styles.doneBody, { paddingBottom: pb }]}>
            <Text style={[styles.doneTxt, { color: colors.foreground }]}>
              thank you.{'\n'}we'll take a look.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  header: {
    paddingTop:       12,
    paddingBottom:    14,
    paddingHorizontal: 16,
    alignItems:       'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position:         'relative',
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2,
  },
  closeBtn: {
    position: 'absolute', right: 16, bottom: 14, padding: 6,
  },
  closeTxt: {
    fontSize: 16,
  },
  body: {
    paddingHorizontal: 24,
    paddingTop:        24,
  },
  heading: {
    fontSize:     17,
    fontWeight:   '600' as const,
    marginBottom: 20,
    lineHeight:   24,
  },

  // Reason list — typographic, no pills
  reasonRow: {
    paddingVertical:   18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reasonLabel: {
    fontSize:   16,
    fontWeight: '400' as const,
    letterSpacing: 0.1,
  },

  // Note step
  notePrompt: {
    fontSize:     13,
    marginBottom:  8,
  },
  noteInput: {
    borderWidth:       1,
    borderRadius:      12,
    paddingHorizontal: 14,
    paddingVertical:   10,
    fontSize:          14,
    lineHeight:        20,
    minHeight:         80,
    maxHeight:         140,
    textAlignVertical: 'top',
  },
  counter: {
    fontSize:   11,
    marginTop:   6,
    textAlign:  'right',
    marginBottom: 28,
  },
  sendBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  sendTxt: {
    fontSize:   16,
    fontWeight: '700' as const,
  },

  // Confirmation
  doneBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems:     'center',
  },
  doneTxt: {
    fontSize:   20,
    fontWeight: '600' as const,
    textAlign:  'center',
    lineHeight: 30,
  },
});
