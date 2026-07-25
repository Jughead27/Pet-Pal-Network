import React, { createContext, useContext, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppContextType {
  // ── Reaction counts ──────────────────────────────────────────────────────
  boopCount: number;
  treatCount: number;
  // Server baseline comment count; incremented locally after each successful POST
  serverCommentCount: number;
  // ── Viewer state (initialized from server on first load) ──────────────────
  viewerHasBooped: boolean;
  viewerHasTreated: boolean;
  treatsRemainingToday: number;
  // ── Other UI state ───────────────────────────────────────────────────────
  isInPack: boolean;
  // ── Actions ──────────────────────────────────────────────────────────────
  /** Optimistic boop: increments count and sets viewerHasBooped immediately. */
  boop: () => void;
  /** Called on server-confirmed treat success. */
  onTreatSuccess: (newTreatCount: number, treatsRemaining: number) => void;
  /** Called after a comment is successfully posted. */
  onCommentPosted: () => void;
  togglePack: () => void;
  /** Called once when server data loads to seed local state. */
  initFromServer: (
    boops: number,
    treats: number,
    commentCount: number,
    viewerHasBooped: boolean,
    viewerHasTreated: boolean,
    treatsRemainingToday: number,
  ) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boopCount, setBoopCount] = useState(0);
  const [treatCount, setTreatCount] = useState(0);
  const [serverCommentCount, setServerCommentCount] = useState(0);

  const [viewerHasBooped, setViewerHasBooped] = useState(false);
  const [viewerHasTreated, setViewerHasTreated] = useState(false);
  const [treatsRemainingToday, setTreatsRemainingToday] = useState(0);

  const [isInPack, setIsInPack] = useState(false);

  const boop = useCallback(() => {
    setBoopCount((n) => n + 1);
    setViewerHasBooped(true);
  }, []);

  const onTreatSuccess = useCallback(
    (newTreatCount: number, treatsRemaining: number) => {
      setTreatCount(newTreatCount);
      setViewerHasTreated(true);
      setTreatsRemainingToday(treatsRemaining);
    },
    [],
  );

  const onCommentPosted = useCallback(() => {
    setServerCommentCount((n) => n + 1);
  }, []);

  const togglePack = useCallback(() => {
    setIsInPack((v) => !v);
  }, []);

  const initFromServer = useCallback(
    (
      boops: number,
      treats: number,
      commentCount: number,
      hasBooped: boolean,
      hasTreated: boolean,
      treatsRemaining: number,
    ) => {
      setBoopCount(boops);
      setTreatCount(treats);
      setServerCommentCount(commentCount);
      setViewerHasBooped(hasBooped);
      setViewerHasTreated(hasTreated);
      setTreatsRemainingToday(treatsRemaining);
    },
    [],
  );

  return (
    <AppContext.Provider
      value={{
        boopCount,
        treatCount,
        serverCommentCount,
        viewerHasBooped,
        viewerHasTreated,
        treatsRemainingToday,
        isInPack,
        boop,
        onTreatSuccess,
        onCommentPosted,
        togglePack,
        initFromServer,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
