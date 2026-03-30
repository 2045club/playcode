"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APP_LOCALE_COOKIE_NAME,
  APP_LOCALE_STORAGE_KEY,
  DEFAULT_APP_LOCALE,
  getLocaleDisplayCode,
  getLocaleToggleLabel,
  normalizeAppLocale,
  translateByLocale,
  translateConnectionPhaseLabel,
  translateErrorMessage,
  translateReasoningLabel,
  translateSessionStatus,
  type AppLocale,
} from "@/lib/locale";

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: (zhText: string, enText: string) => string;
  translateError: (message: string) => string;
  translateReasoning: (label: string) => string;
  translateConnectionPhase: (label: string) => string;
  translateStatus: (status: string) => string;
  localeLabel: string;
  localeCode: string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_APP_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: AppLocale;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    if (typeof window === "undefined") {
      return initialLocale;
    }

    return normalizeAppLocale(
      window.localStorage.getItem(APP_LOCALE_STORAGE_KEY) ?? initialLocale,
    );
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.lang = locale;
    document.cookie = `${APP_LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; samesite=lax`;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(normalizeAppLocale(nextLocale));
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((currentLocale) =>
      currentLocale === "zh-CN" ? "en-US" : "zh-CN",
    );
  }, []);

  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t: (zhText, enText) => translateByLocale(locale, zhText, enText),
      translateError: (message) => translateErrorMessage(message, locale),
      translateReasoning: (label) => translateReasoningLabel(label, locale),
      translateConnectionPhase: (label) =>
        translateConnectionPhaseLabel(label, locale),
      translateStatus: (status) => translateSessionStatus(status, locale),
      localeLabel: getLocaleToggleLabel(locale),
      localeCode: getLocaleDisplayCode(locale),
    }),
    [locale, setLocale, toggleLocale],
  );

  return (
    <LocaleContext.Provider value={contextValue}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider.");
  }

  return context;
}
