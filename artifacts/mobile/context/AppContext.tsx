import React, { createContext, useContext, useState, useCallback } from "react";

// AppContext carries only global app state that is NOT per-post.
// Per-post reaction counts (boops, treats, comments) and viewer flags live
// inside each FeedPage component to prevent state bleeding between pages.

interface AppContextType {
  isInPack: boolean;
  togglePack: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isInPack, setIsInPack] = useState(false);
  const togglePack = useCallback(() => setIsInPack((v) => !v), []);

  return (
    <AppContext.Provider value={{ isInPack, togglePack }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
