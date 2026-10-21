"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, isLang, LANGS, STRINGS, type Dict, type Lang } from "@/lib/i18n";

// Language for the public pages: ?lang=en|it wins, then the visitor's saved choice
// (localStorage, a per-browser convenience), then Italian.

const STORAGE_KEY = "bsm-lang";

type Ctx = { lang: Lang; t: Dict; setLang: (l: Lang) => void };
const LangContext = createContext<Ctx>({ lang: DEFAULT_LANG, t: STRINGS[DEFAULT_LANG], setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage blocked (private mode etc.): keep the default
    }
    const initial = isLang(fromUrl) ? fromUrl : isLang(saved) ? saved : DEFAULT_LANG;
    if (initial !== DEFAULT_LANG) setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // not persisted; fine
    }
  }, []);

  return <LangContext.Provider value={{ lang, t: STRINGS[lang], setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** IT | EN toggle. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, t, setLang } = useLang();
  return (
    <div role="group" aria-label={t.langSwitch} className={`flex overflow-hidden rounded-md border border-gray-300 text-xs ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`px-2 py-0.5 font-medium uppercase ${lang === l ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
