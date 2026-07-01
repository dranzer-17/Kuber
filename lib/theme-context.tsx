"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  applyTheme, DEFAULT_THEME_ID, DEFAULT_THEME_MODE, isThemeId, isThemeMode,
  THEME_MODE_STORAGE_KEY, THEME_STORAGE_KEY, type ThemeId, type ThemeMode,
} from "@/lib/branding";
import { fetchSettings, patchSettings } from "@/lib/api-client";

type ThemeContextValue = {
  theme: ThemeId;
  mode: ThemeMode;
  setTheme: (id: ThemeId) => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  savingTheme: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Persists the theme + mode choice to the `settings` table (per-workspace, server-side). */
export function ThemeProvider({ session, children }: { session: Session | null; children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME_ID;
    const cached = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(cached) ? cached : DEFAULT_THEME_ID;
  });
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME_MODE;
    const cached = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(cached) ? cached : DEFAULT_THEME_MODE;
  });
  const [savingTheme, setSavingTheme] = useState(false);

  // Pull the source-of-truth theme from settings once authenticated.
  useEffect(() => {
    if (!session) return;
    fetchSettings(session.access_token)
      .then((s) => {
        const nextTheme = isThemeId(s.theme) ? s.theme : theme;
        const nextMode = isThemeMode(s.theme_mode) ? s.theme_mode : mode;
        setThemeState(nextTheme);
        setModeState(nextMode);
        applyTheme(nextTheme, nextMode);
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        localStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode);
      })
      .catch(() => { /* fall back to local cache */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  const setTheme = useCallback(async (id: ThemeId) => {
    setThemeState(id);
    applyTheme(id, mode);
    localStorage.setItem(THEME_STORAGE_KEY, id);
    if (!session) return;
    setSavingTheme(true);
    try {
      await patchSettings(session.access_token, { theme: id });
    } finally {
      setSavingTheme(false);
    }
  }, [session, mode]);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    applyTheme(theme, next);
    localStorage.setItem(THEME_MODE_STORAGE_KEY, next);
    if (!session) return;
    setSavingTheme(true);
    try {
      await patchSettings(session.access_token, { theme_mode: next });
    } finally {
      setSavingTheme(false);
    }
  }, [session, theme]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, savingTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
