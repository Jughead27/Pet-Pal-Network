/**
 * FollowsContext — per-species and per-breed interest-follow state shared across screens.
 *
 * Mirrors the PackContext pattern. Components read:
 *   speciesMap[speciesId] ?? serverValue   (context overrides once set)
 *   breedMap[breedId]     ?? serverValue
 *
 * This ensures:
 *   - Following "Cat" from Ripley's profile immediately shows active on any
 *     other Cat's profile without a refetch.
 *   - Unfollowing "Calico" from Profile → Following immediately clears the
 *     chip on Ripley's profile if it's in the stack.
 */

import React, { createContext, useCallback, useContext, useState } from 'react';

interface FollowsContextType {
  speciesMap: Record<string, boolean>;
  breedMap:   Record<string, boolean>;
  setSpeciesFollow: (speciesId: string, follows: boolean) => void;
  setBreedFollow:   (breedId:   string, follows: boolean) => void;
}

const FollowsContext = createContext<FollowsContextType | null>(null);

export function FollowsProvider({ children }: { children: React.ReactNode }) {
  const [speciesMap, setSpeciesMap] = useState<Record<string, boolean>>({});
  const [breedMap,   setBreedMap]   = useState<Record<string, boolean>>({});

  const setSpeciesFollow = useCallback((speciesId: string, follows: boolean) => {
    setSpeciesMap((prev) => ({ ...prev, [speciesId]: follows }));
  }, []);

  const setBreedFollow = useCallback((breedId: string, follows: boolean) => {
    setBreedMap((prev) => ({ ...prev, [breedId]: follows }));
  }, []);

  return (
    <FollowsContext.Provider value={{ speciesMap, breedMap, setSpeciesFollow, setBreedFollow }}>
      {children}
    </FollowsContext.Provider>
  );
}

export function useFollowsContext(): FollowsContextType {
  const ctx = useContext(FollowsContext);
  if (!ctx) throw new Error('useFollowsContext must be used within FollowsProvider');
  return ctx;
}
