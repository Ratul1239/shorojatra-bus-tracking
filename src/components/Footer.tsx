"use client";
// =====================================================================
// ফুটার: ব্র্যান্ড, ছোট বর্ণনা ও কপিরাইট — ভাষা বদলালে সাথে সাথে অনূদিত হয়
// ---------------------------------------------------------------------
// কোনো ডাটাবেজ কল নেই, তাই সব পেজে এর খরচ প্রায় শূন্য।
// =====================================================================

import Link from "next/link"; // অভ্যন্তরীণ লিংক
import { useLanguage } from "@/components/LanguageProvider"; // ভাষা কনটেক্সট

export function Footer() {
  const { t } = useLanguage(); // অনুবাদক ফাংশন

  return (
    <footer className="mt-20 border-t border-[var(--line)] bg-[rgba(4,12,19,0.75)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        {/* ব্র্যান্ড ও এক-লাইন বর্ণনা */}
        <div>
          <p className="text-base font-extrabold text-white">{t("brand")}</p>
          <p className="mt-1 max-w-md text-[0.82rem] text-[var(--muted)]">{t("footerNote")}</p>
        </div>
        {/* দ্রুত লিংক: হোম, সার্চ, আর্কিটেকচার */}
        <div className="flex flex-wrap items-center gap-4 text-[0.8rem] font-semibold text-[#a9c3c8]">
          <Link href="/" className="hover:text-[var(--mint)]">{t("navHome")}</Link>
          <Link href="/search?mode=active" className="hover:text-[var(--mint)]">{t("navSearch")}</Link>
          <Link href="/architecture" className="hover:text-[var(--mint)]">{t("navArchitecture")}</Link>
        </div>
      </div>
      {/* কপিরাইট লাইন: বাংলা/ইংরেজি উভয় ভাষায় */}
      <div className="border-t border-[var(--line)] px-4 py-4 text-center text-[0.72rem] text-[#6d8a92]">
        {t("footerRights")}
      </div>
    </footer>
  );
}
