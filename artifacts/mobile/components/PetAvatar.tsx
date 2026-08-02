/**
 * PetAvatar — shared circular avatar used on the profile page and compose screen.
 *
 * Shows the pet's real photo (via MediaImage, with native URL resolution) when
 * a URL is available, or a Phosphor PawPrint placeholder when it isn't.
 * Keeping this in one place ensures the two surfaces can never drift.
 */

import React, { useMemo } from 'react';
import { Platform, View } from 'react-native';
import { PawPrint } from 'phosphor-react-native';
import MediaImage from '@/components/MediaImage';
import { getBaseUrl } from '@workspace/api-client-react';

export interface PetAvatarProps {
  /** Signed R2 URL or relative /api/media/… path. Null/undefined shows placeholder. */
  url: string | null | undefined;
  /** Diameter of the circle in dp. */
  size: number;
  /** Background fill for the placeholder circle. */
  backgroundColor: string;
  /** PawPrint glyph color for the placeholder. */
  pawColor: string;
}

export default function PetAvatar({ url, size, backgroundColor, pawColor }: PetAvatarProps) {
  const source = useMemo(() => {
    if (!url) return null;
    // Relative /api/media/… paths need the dev host prepended on native;
    // absolute https:// R2 URLs pass through unchanged.
    let uri = url;
    if (Platform.OS !== 'web' && uri.startsWith('/')) {
      uri = (getBaseUrl() ?? '') + uri;
    }
    return { uri };
  }, [url]);

  if (!source) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PawPrint size={Math.round(size * 0.58)} weight="light" color={pawColor} />
      </View>
    );
  }

  return (
    <MediaImage
      source={source}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
    />
  );
}
