"use client";
// =====================================================================
// ক্লায়েন্ট ভাষা কনটেক্সট (React Context)
// ---------------------------------------------------------------------
// ডান পাশের টগলে ক্লিক করলে: state + <html lang> + localStorage + cookie
// একসাথে আপডেট হয়। কুকি আপডেটের ফলে পরবর্তী server render-ও সঠিক ভাষায় হয়।
// সব ক্লায়েন্ট কম্পোনেন্ট useLanguage() দিয়ে t('key') পায় (i18n t() ফাংশন)।
// =====================================================================

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { dictionary, type Lang, type TranslationKey } from "@/lib/i18n";

// কনটেক্সটে যা যা থাকবে: বর্তমান ভাষা, বদলানোর ফাংশন, টগল ও অনুবাদক।
type LanguageContextValue = {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggle: () => void;
  t: (key: TranslationKey) => string;
};

// প্রাথমিক মান null → provider-এর বাইরে ব্যবহার করলে স্পষ্ট error পাওয়া যায়।
const LanguageContext = createContext<LanguageContextValue | null>(null);

// Provider-এর props: সার্ভার কুকি থেকে পাওয়া প্রাথমিক ভাষা + children।
export function LanguageProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang); // UI-র তাৎক্ষণিক ভাষা

  // ভাষা বদলানোর একমাত্র ফাংশন: সব স্টোরেজ একসাথে সিঙ্ক করি।
  const setLang = useCallback((next: Lang) => {
    setLangState(next); // ১) React state → সাথে সাথে UI রি-রেন্ডার
    document.documentElement.lang = next; // ২) অ্যাক্সেসিবিলিটি/স্ক্রিনরিডারের জন্য
    try {
      localStorage.setItem("shoro-lang", next); // ৩) পরের ভিজিটে মনে রাখা
    } catch {
      // প্রাইভেট মোডে localStorage ব্যর্থ হতে পারে; অ্যাপ চলতে থাকবে।
    }
    // ৪) সার্ভার কম্পোনেন্ট যেন একই ভাষা রেন্ডার করে, সেজন্য কুকি।
    document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // এক ক্লিকে বাংলা ↔ ইংরেজি বদলানোর সুবিধা (মোবাইলে কাজে লাগে)।
  const toggle = useCallback(() => setLang(lang === "bn" ? "en" : "bn"), [lang, setLang]);

  // t() ফাংশন: অভিধান থেকে key-এর অনূদিত মান দেয়; useMemo দিয়ে অপ্রয়োজনীয় rerender এড়াই।
  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, toggle, t: (key: TranslationKey) => dictionary[lang][key] }),
    [lang, setLang, toggle],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// সব কম্পোনেন্টের জন্য ছোট hook; provider না থাকলে বুঝতে সুবিধা হয়।
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
