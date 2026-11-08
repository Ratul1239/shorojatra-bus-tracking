"use client";
// =====================================================================
// সাইট হেডার: লোগো, নেভিগেশন ও ডান পাশে বাংলা/English সুইচ
// ---------------------------------------------------------------------
// sticky + backdrop-blur দিয়ে প্রিমিয়াম ফিল; মোবাইলে নেভি হরিজন্টাল স্ক্রল।
// ভাষার বাটন LanguageProvider-এর state আপডেট করে → পুরো পেজ সাথে সাথে বদলে যায়।
// =====================================================================

import Link from "next/link"; // ক্লায়েন্ট-সাইড নেভিগেশন (পেজ রিফ্রেশ নয়)
import { usePathname } from "next/navigation"; // সক্রিয় লিংক হাইলাইট করার জন্য
import { useLanguage } from "@/components/LanguageProvider"; // ভাষা কনটেক্সট
import type { TranslationKey } from "@/lib/i18n"; // টাইপ-সেফ অনুবাদ key

// নেভিগেশন আইটেম: label key + path; এক জায়গায় থাকায় নতুন পেজ যোগ করা সহজ।
const NAV: { key: TranslationKey; href: string }[] = [
  { key: "navHome", href: "/" },
  { key: "navSearch", href: "/search?mode=active" },
  { key: "navArchitecture", href: "/architecture" },
];

export function Header() {
  const { lang, setLang, t } = useLanguage(); // বর্তমান ভাষা, setter ও অনুবাদক
  const pathname = usePathname(); // বর্তমান পাথ

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(5,14,21,0.78)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {/* লোগো: ছোট বাস আইকন + ব্র্যান্ড নাম; হোমে ফেরত যায় */}
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label={t("brand")}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--mint)] to-[#1c9c78] text-[#04221a] shadow-[0_6px_18px_rgba(69,223,176,0.25)]">
            {/* SVG বাস আইকন: কোনো external asset নেই, তাই দ্রুত লোড হয় */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="13" rx="2.5" />
              <path d="M3 11h18M7 17v2M17 17v2M7.5 14.5h.01M16.5 14.5h.01" />
              <path d="M7 7.5h10" opacity="0.55" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-[1.05rem] font-extrabold tracking-tight text-white">{t("brand")}</span>
            <span className="hidden text-[0.64rem] font-medium tracking-[0.08em] text-[var(--muted)] sm:block">{t("tagline")}</span>
          </span>
        </Link>

        {/* নেভিগেশন: ডেস্কটপে মাঝখানে, ছোট স্ক্রিনে নিচের সারিতে স্ক্রলযোগ্য */}
        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-[0.85rem] font-semibold transition-colors ${
                  active ? "bg-[rgba(69,223,176,0.12)] text-[var(--mint)]" : "text-[#a9c3c8] hover:bg-white/5 hover:text-white"
                }`}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        {/* ডান পাশের ভাষা সুইচ: দুটি স্পষ্ট বাটন, সক্রিয়টিতে মিন্ট রঙ */}
        <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-[var(--line-strong)] bg-[rgba(255,255,255,0.04)] p-1 md:ml-2" role="group" aria-label={t("language")}>
          <button
            type="button"
            onClick={() => setLang("bn")}
            aria-pressed={lang === "bn"}
            className={`rounded-full px-3 py-1.5 text-[0.78rem] font-bold transition-all ${lang === "bn" ? "bg-[var(--mint)] text-[#04221a] shadow" : "text-[#a9c3c8] hover:text-white"}`}
          >
            বাংলা
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            aria-pressed={lang === "en"}
            className={`rounded-full px-3 py-1.5 text-[0.78rem] font-bold transition-all ${lang === "en" ? "bg-[var(--mint)] text-[#04221a] shadow" : "text-[#a9c3c8] hover:text-white"}`}
          >
            EN
          </button>
        </div>
      </div>

      {/* মোবাইল নেভি: overflow-x-auto দিয়ে জায়গার অভাবে স্ক্রল করা যায় */}
      <nav className="flex gap-1 overflow-x-auto border-t border-[var(--line)] px-4 py-2 md:hidden" aria-label="Mobile navigation">
        {NAV.map((item) => (
          <Link key={item.key} href={item.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[0.78rem] font-semibold text-[#a9c3c8] hover:bg-white/5 hover:text-white">
            {t(item.key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
