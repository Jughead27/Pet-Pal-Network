/**
 * PackContext — per-pet pack-follow state shared across all components.
 *
 * Replaces AppContext's coarse `isInPack` boolean.  The context stores a
 * Record<petId, boolean> so that all AddToPackLink instances for the same pet
 * (e.g. multiple posts for Finn in the feed) share a single source of truth.
 *
 * Initialization pattern: AddToPackLink reads `packMap[petId] ?? initialInPack`.
 * Because the server guarantees consistent viewerInPack per pet, the fallback
 * to `initialInPack` is always safe — all instances for the same pet receive
 * the same server value until a mutation updates the map.
 */

import React, { createContext, useCallback, useContext, useState } from 'react';

interface PackContextType {
  /** Current override map — petId → viewerInPack.  Missing key ⇒ use initialInPack. */
  packMap: Record<string, boolean>;
  /** Update (or optimistically set) the pack state for a given pet. */
  setPackState: (petId: string, inPack: boolean) => void;
}

const PackContext = createContext<PackContextType | null>(null);

export function PackProvider({ children }: { children: React.ReactNode }) {
  const [packMap, setPackMap] = useState<Record<string, boolean>>({});

  const setPackState = useCallback((petId: string, inPack: boolean) => {
    setPackMap((prev) => ({ ...prev, [petId]: inPack }));
  }, []);

  return (
    <PackContext.Provider value={{ packMap, setPackState }}>
      {children}
    </PackContext.Provider>
  );
}

export function usePackContext(): PackContextType {
  const ctx = useContext(PackContext);
  if (!ctx) throw new Error('usePackContext must be used within PackProvider');
  return ctx;
}
