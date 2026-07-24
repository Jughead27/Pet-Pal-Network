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
  pet: Pet;
  boopCount: number;
  treatCount: number;
  comments: Comment[];
  isInPack: boolean;
  // Whether the user has tapped Boop at least once (for teaching label)
  hasBoopedOnce: boolean;
  // Whether the user has tapped Treat at least once (for teaching label)
  hasTreatedOnce: boolean;
  boop: () => void;
  treat: () => void;
  addComment: (text: string) => void;
  togglePack: () => void;
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

const RIPLEY: Pet = {
  id: "RIPLEY",
  name: "Finn",
  breed: "Crowntail Betta",
  caption: "Flaring at my own reflection again.",
  bio: "Professional bubble-nest architect.\nMood: iridescent.",
  posts: [
    { id: "post-1", imageKey: "hero", caption: "Morning flare session." },
    { id: "post-2", imageKey: "post1", caption: "The fins. They flow." },
    {
      id: "post-3",
      imageKey: "post2",
      caption: "Close enough to count scales.",
    },
  ],
};

const INITIAL_COMMENTS: Comment[] = [
  {
    id: "c1",
    author: "aqua.keeper",
    initials: "AK",
    text: "Those fins are absolutely spectacular.",
    timestamp: "2h",
  },
  {
    id: "c2",
    author: "fin.fancier",
    initials: "FF",
    text: "Finn is living their best life.",
    timestamp: "45m",
  },
];

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boopCount, setBoopCount] = useState(247);
  const [treatCount, setTreatCount] = useState(89);
  const [comments, setComments] = useState<Comment[]>(INITIAL_COMMENTS);
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

  return (
    <AppContext.Provider
      value={{
        pet: RIPLEY,
        boopCount,
        treatCount,
        comments,
        isInPack,
        hasBoopedOnce,
        hasTreatedOnce,
        boop,
        treat,
        addComment,
        togglePack,
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
