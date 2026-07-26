/**
 * FeedbackFlow — minimal feedback modal in the portal visual system.
 *
 * Two internal steps:
 *   compose  → multiline textarea (counter, ≤1000), bold "send", whisper "cancel"
 *   done     → "thank you. we read everything." — auto-closes after 2.2 s
 *
 * Every step has an exit.  Auto-close timer is cleared on manual dismiss.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  Platform,
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

const BODY_MAX = 1000;

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'compose' | 'sending' | 'done';

export default function FeedbackFlow({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('compose');
  const [body, setBody] = useState('');

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state whenever the modal opens.
  const handleShow = useCallback(() => {
    setStep('compose');
    setBody('');
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }, [onClose]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setStep('sending');
    try {
      await customFetch<{ ok: boolean }>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ body: body.trim().slice(0, BODY_MAX) }),
      });
    } catch {
      // Network errors — still show confirmation; don't alarm the user.
    }
    setStep('done');
    closeTimerRef.current = setTimeout(handleClose, 2200);
  };

  const pb = insets.bottom + (Platform.OS === 'web' ? 24 : 8);
  const canSend = body.trim().length > 0 && step === 'compose';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      onShow={handleShow}
    >
      <View style={[styles.sheet, { backgroundColor: colors.card }]}>
        {/* ── Header: grabber + close ─────────────────────────────────── */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={[styles.closeTxt, { color: colors.mutedForeground }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Compose step ────────────────────────────────────────────── */}
        {(step === 'compose' || step === 'sending') && (
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: pb }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.heading, { color: colors.foreground }]}>
              what's on your mind?
            </Text>

            <TextInput
              value={body}
              onChangeText={(t) => setBody(t.slice(0, BODY_MAX))}
              placeholder="type here…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={BODY_MAX}
              style={[
                styles.input,
                {
                  color:           colors.foreground,
                  backgroundColor: colors.background,
                  borderColor:     colors.border,
                },
              ]}
              editable={step === 'compose'}
              accessibilityLabel="Feedback text"
              textAlignVertical="top"
            />

            {/* Character counter */}
            <Text style={[styles.counter, { color: colors.mutedForeground }]}>
              {body.length}/{BODY_MAX}
            </Text>

            {/* Send — bold text, left-aligned */}
            <TouchableOpacity
              onPress={handleSend}
              disabled={!canSend}
              style={styles.sendBtn}
              accessibilityRole="button"
              accessibilityLabel="Send feedback"
            >
              <Text
                style={[
                  styles.sendTxt,
                  {
                    color: !canSend
                      ? colors.mutedForeground
                      : colors.foreground,
                  },
                ]}
              >
                {step === 'sending' ? 'sending…' : 'send'}
              </Text>
            </TouchableOpacity>

            {/* Cancel whisper — hidden while sending */}
            {step === 'compose' && (
              <TouchableOpacity
                onPress={handleClose}
                style={styles.cancelBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.cancelTxt, { color: colors.mutedForeground }]}>
                  cancel
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* ── Done step ───────────────────────────────────────────────── */}
        {step === 'done' && (
          <View style={[styles.body, styles.doneBody, { paddingBottom: pb }]}>
            <Text style={[styles.doneTxt, { color: colors.foreground }]}>
              thank you.{'\n'}we read everything.
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.cancelBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.cancelTxt, { color: colors.mutedForeground }]}>
                close
              </Text>
            </TouchableOpacity>
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
    paddingTop:        12,
    paddingBottom:     14,
    paddingHorizontal: 16,
    alignItems:        'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position:          'relative',
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

  input: {
    borderWidth:       1,
    borderRadius:      12,
    paddingHorizontal: 14,
    paddingVertical:   10,
    fontSize:          15,
    lineHeight:        22,
    minHeight:         120,
    maxHeight:         200,
  },
  counter: {
    fontSize:     11,
    marginTop:    6,
    textAlign:    'right',
    marginBottom: 28,
  },
  sendBtn: {
    alignSelf:       'flex-start',
    paddingVertical: 4,
  },
  sendTxt: {
    fontSize:   17,
    fontWeight: '700' as const,
  },

  cancelBtn: {
    alignSelf:       'center',
    marginTop:       32,
    paddingVertical: 4,
  },
  cancelTxt: {
    fontSize:      12,
    opacity:       0.4,
    fontFamily:    'Inter_400Regular',
    letterSpacing: 0.1,
    textAlign:     'center',
  },

  // Done step
  doneBody: {
    flex:           1,
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
