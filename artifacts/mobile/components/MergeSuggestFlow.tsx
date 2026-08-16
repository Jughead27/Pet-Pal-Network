/**
 * MergeSuggestFlow — quiet, typographic "same pet as one of yours?" modal.
 *
 * Collaborative framing — owners discovering their pets are the same animal.
 * Never a report. No notification goes to the target pet's owners; the
 * suggestion lands in the admin queue only.
 *
 * Three internal steps (same pattern as ReportFlow):
 *   pick     → user picks which of their own pets is the same animal
 *   sending  → submitting
 *   done     → warm confirmation, auto-dismisses after a beat
 *
 * Props:
 *   visible      — controls the Modal
 *   onClose      — called when the user dismisses or the flow completes
 *   targetPetId  — the pet being viewed (viewer has no ownership of it)
 *   targetPetName — for the heading copy
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { customFetch, useGetMyPets } from '@workspace/api-client-react';

interface Props {
  visible: boolean;
  onClose: () => void;
  targetPetId: string;
  targetPetName: string;
}

type Step = 'pick' | 'sending' | 'done';

/** Structured API error shape thrown by customFetch. */
type ApiError = { status?: number; data?: { error?: string } };

export default function MergeSuggestFlow({ visible, onClose, targetPetId, targetPetName }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('pick');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tracks the auto-close timer so it can be cleared on manual dismiss.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: myPetsData, isLoading } = useGetMyPets();
  const myPets = (myPetsData?.pets ?? []).filter((p) => p.id !== targetPetId);

  // Reset internal state whenever the modal opens.
  const handleShow = useCallback(() => {
    setStep('pick');
    setErrorMsg(null);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }, [onClose]);

  const handlePick = async (suggesterPetId: string) => {
    setStep('sending');
    setErrorMsg(null);
    try {
      // Duplicate response ({ ok: true, duplicate: true }) is an intentional
      // success — the suggestion already exists in the queue.
      await customFetch<{ ok: boolean; duplicate?: boolean }>('/api/merge-suggestions', {
        method: 'POST',
        body: JSON.stringify({ suggesterPetId, targetPetId }),
      });
      setStep('done');
      closeTimerRef.current = setTimeout(handleClose, 2200);
    } catch (e) {
      // Only confirm when a row actually exists — restore the picker with a
      // quiet message on failure.
      const err = e as ApiError;
      setErrorMsg(
        err.status === 429
          ? "that's a lot of suggestions for one day — try again tomorrow."
          : "couldn't send that just now — try again in a moment.",
      );
      setStep('pick');
    }
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
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={[styles.closeTxt, { color: colors.mutedForeground }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Pick step ───────────────────────────────────────────────────── */}
        {(step === 'pick' || step === 'sending') && (
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: pb }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.heading, { color: colors.foreground }]}>
              which of your pets is the same animal as {targetPetName}?
            </Text>

            {errorMsg && (
              <Text style={[styles.errorTxt, { color: colors.mutedForeground }]}>
                {errorMsg}
              </Text>
            )}

            {isLoading || step === 'sending' ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.spinner} />
            ) : myPets.length === 0 ? (
              <Text style={[styles.emptyTxt, { color: colors.mutedForeground }]}>
                you don't have any pets yet.
              </Text>
            ) : (
              myPets.map((pet) => (
                <Pressable
                  key={pet.id}
                  onPress={() => handlePick(pet.id)}
                  accessibilityRole="button"
                  accessibilityLabel={pet.name}
                  style={({ pressed }) => [
                    styles.petRow,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.45 },
                  ]}
                >
                  <Text style={[styles.petName, { color: colors.foreground }]}>{pet.name}</Text>
                  <Text style={[styles.petMeta, { color: colors.mutedForeground }]}>
                    {pet.breed ?? pet.species}
                  </Text>
                </Pressable>
              ))
            )}

            {/* Cancel whisper — hidden while sending */}
            {step === 'pick' && (
              <TouchableOpacity
                onPress={handleClose}
                style={styles.cancelWhisperBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.cancelWhisper, { color: colors.mutedForeground }]}>
                  cancel
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* ── Confirmation step ────────────────────────────────────────────── */}
        {step === 'done' && (
          <View style={[styles.body, styles.doneBody, { paddingBottom: pb }]}>
            <Text style={[styles.doneTxt, { color: colors.foreground }]}>
              thanks — we'll take a look{'\n'}and help you combine their history.
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.cancelWhisperBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.cancelWhisper, { color: colors.mutedForeground }]}>
                close
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles — same quiet register as ReportFlow ───────────────────────────────

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  closeBtn: { position: 'absolute', right: 16, bottom: 14, padding: 6 },
  closeTxt: { fontSize: 16 },
  body: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600' as const,
    marginBottom: 20,
    lineHeight: 24,
  },
  spinner: { marginTop: 24, alignSelf: 'flex-start' },
  emptyTxt: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  errorTxt: { fontSize: 12, fontFamily: 'Inter_400Regular', opacity: 0.7, marginBottom: 12 },

  // Pet list — typographic rows, no pills
  petRow: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  petName: {
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.1,
  },
  petMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    opacity: 0.7,
  },

  // Confirmation
  doneBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneTxt: {
    fontSize: 20,
    fontWeight: '600' as const,
    textAlign: 'center',
    lineHeight: 30,
  },

  cancelWhisperBtn: {
    alignSelf: 'center',
    marginTop: 32,
    paddingVertical: 4,
  },
  cancelWhisper: {
    fontSize: 12,
    opacity: 0.4,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
});
