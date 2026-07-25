/**
 * ShareSheet — minimal share options modal.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface ShareOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export default function ShareSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleOption = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const shareOptions: ShareOption[] = [
    {
      id: 'copy',
      label: 'Copy Link',
      icon: <Feather name="link" size={20} color={colors.foreground} />,
    },
    {
      id: 'message',
      label: 'Send to a Friend',
      icon: <Ionicons name="paper-plane-outline" size={20} color={colors.foreground} />,
    },
    {
      id: 'story',
      label: 'Share to Story',
      icon: <Feather name="circle" size={20} color={colors.foreground} />,
    },
    {
      id: 'save',
      label: 'Save to Camera Roll',
      icon: <Feather name="download" size={20} color={colors.foreground} />,
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.card }]}>
        {/* Drag handle */}
        <View style={styles.handleBar}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
        </View>

        {/* Title */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Share
          </Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button">
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Options */}
        <View style={styles.optionsList}>
          {shareOptions.map((opt, idx) => (
            <TouchableOpacity
              key={opt.id}
              onPress={() => handleOption(opt.id)}
              activeOpacity={0.7}
              style={[
                styles.option,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth:
                    idx < shareOptions.length - 1 ? StyleSheet.hairlineWidth : 0,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <View style={[styles.optionIcon, { backgroundColor: colors.muted }]}>
                {opt.icon}
              </View>
              <Text style={[styles.optionLabel, { color: colors.foreground }]}>
                {opt.label}
              </Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Cancel */}
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.7}
          style={[
            styles.cancelBtn,
            {
              backgroundColor: colors.muted,
              marginBottom: insets.bottom + 16,
            },
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
  },
  optionsList: {
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500' as const,
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
});
