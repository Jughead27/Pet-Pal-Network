import React, { createContext, useContext, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  author: string;
  initials: string;
  text: string;
  timestamp: string;
}

export interface PetPost {
  id: string;
  imageKey: "hero" | "post1" | "post2";
  caption: string;
}

export interface Pet {
  id: string;
  name: string;
  breed: string;
  caption: string;
  bio: string;
  posts: PetPost[];
}

interface AppContextType {
  // ── Reaction counts ──────────────────────────────────────────────────────
  // Initialized from server on first data load; local taps increment them.
  boopCount: number;
  treatCount: number;
  // Server baseline for the comment count; added to localComments.length
  // for the ActionRail display.
  serverCommentCount: number;
  // ── Local comment additions (optimistic, not yet persisted) ───────────────
  comments: Comment[];
  // ── Other UI state ───────────────────────────────────────────────────────
  isInPack: boolean;
  hasBoopedOnce: boolean;
  hasTreatedOnce: boolean;
  // ── Actions ──────────────────────────────────────────────────────────────
  boop: () => void;
  treat: () => void;
  addComment: (text: string) => void;
  togglePack: () => void;
  /** Called once when server data loads to seed the local reaction counts. */
  initFromServer: (boops: number, treats: number, commentCount: number) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Reaction counts — start at 0, initialized from server on first data load.
  const [boopCount, setBoopCount] = useState(0);
  const [treatCount, setTreatCount] = useState(0);
  const [serverCommentCount, setServerCommentCount] = useState(0);

  // Local comments: optimistic additions from the comment input.
  // Server comments are fetched directly via useGetPostComments in CommentSheet.
  const [comments, setComments] = useState<Comment[]>([]);

  const [isInPack, setIsInPack] = useState(false);
  const [hasBoopedOnce, setHasBoopedOnce] = useState(false);
  const [hasTreatedOnce, setHasTreatedOnce] = useState(false);

  const boop = useCallback(() => {
    setBoopCount((n) => n + 1);
    if (!hasBoopedOnce) setHasBoopedOnce(true);
  }, [hasBoopedOnce]);

  const treat = useCallback(() => {
    setTreatCount((n) => n + 1);
    if (!hasTreatedOnce) setHasTreatedOnce(true);
  }, [hasTreatedOnce]);

  const addComment = useCallback((text: string) => {
    const newComment: Comment = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      author: "you",
      initials: "YO",
      text,
      timestamp: "now",
    };
    setComments((prev) => [...prev, newComment]);
  }, []);

  const togglePack = useCallback(() => {
    setIsInPack((v) => !v);
  }, []);

  const initFromServer = useCallback(
    (boops: number, treats: number, commentCount: number) => {
      setBoopCount(boops);
      setTreatCount(treats);
      setServerCommentCount(commentCount);
    },
    [],
  );

  return (
    <AppContext.Provider
      value={{
        boopCount,
        treatCount,
        serverCommentCount,
        comments,
        isInPack,
        hasBoopedOnce,
        hasTreatedOnce,
        boop,
        treat,
        addComment,
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
