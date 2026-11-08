"use client";
// =====================================================================
// সার্চ ফলাফলের ক্লায়েন্ট অংশ
// ---------------------------------------------------------------------
// • SSR ফলাফল দিয়ে শুরু; ভাষা বদলালে /api/search?...&lang=... আবার কল করি।
// • "সার্চ বদলান" প্যানেলে রুট ও নাম — দুই ধরনের সার্চই এখান থেকে করা যায়।
// • পাশের JSON প্রিভিউ দেখায় যে API response-ও ভাষা অনুযায়ী বদলায়।
// =====================================================================

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BusCard } from "@/components/BusCard";
import { useLanguage } from "@/components/LanguageProvider";
import type { ApiEnvelope } from "@/lib/types";
import type { SearchResult } from "@/lib/catalog";
import type { Lang } from "@/lib/i18n";

type Props = { initialResult: SearchResult; initialLang: Lang; queryString: string };

export function SearchResultsClient({ initialResult, initialLang, queryString }: Props) {
  const { lang, t } = useLanguage(); // ভাষা ও অনুবাদক
  const router = useRouter(); // সার্চ সম্পাদনার পর নেভিগেশন
  const [result, setResult] = useState<SearchResult>(initialResult); // বর্তমান ফলাফল
  // বাগ ফিক্স: loading আলাদা state নয়; "কোন ভাষার ফলাফল দেখাচ্ছি" থেকে নির্ণীত।
  const [loadedLang, setLoadedLang] = useState<Lang>(initialLang); // বর্তমান ফলাফলের ভাষা
  const loading = loadedLang !== lang; // নতুন ভাষার ফলাফল আসার অপেক্ষায়
  const [editing, setEditing] = useState(false); // সার্চ এডিট প্যানেল
  const [from, setFrom] = useState(initialResult.from); // রুট: শুরু
  const [to, setTo] = useState(initialResult.to); // রুট: গন্তব্য
  const [q, setQ] = useState(initialResult.q); // নাম: query

  // ---- ভাষা বদলালে একই query নতুন ভাষায় REST API থেকে আনি ----
  useEffect(() => {
    if (loadedLang === lang) return; // ফলাফল ইতিমধ্যে এই ভাষায় আছে
    const controller = new AbortController();
    fetch(`/api/search?${queryString}&lang=${lang}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("search api failed");
        return response.json() as Promise<ApiEnvelope<SearchResult>>;
      })
      .then((payload) => {
        setResult(payload.data); // সম্পূর্ণ স্থানীয়কৃত ফলাফল
        setLoadedLang(lang);
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setLoadedLang(lang); // ব্যর্থ হলে আগের ফলাফলই থাকবে
      });
    return () => controller.abort(); // পুরনো রিকোয়েস্ট বাতিল
  }, [lang, queryString, loadedLang]);

  // রুট সম্পাদনা ফর্ম: হোমের মতোই "Dhaka to Khulna" এক ঘরে লেখা যাবে।
  const submitRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ mode: "route", from: from.trim(), to: to.trim() });
    router.push(`/search?${params.toString()}`);
    setEditing(false);
  };

  // নাম সম্পাদনা ফর্ম: বাস/অপারেটরের নাম।
  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ mode: "name", q: q.trim() });
    router.push(`/search?${params.toString()}`);
    setEditing(false);
  };

  // JSON প্রিভিউ: API থেকে আসা ডেটার প্রতিফলন (শুধু দেখানোর জন্য)।
  const preview = JSON.stringify(
    {
      language: lang,
      labels: { brand: t("brand"), nextStop: t("nextStop"), active: t("active") },
      data: { mode: result.mode, count: result.count, firstBus: result.results[0]?.name ?? null, nextStop: result.results[0]?.live.nextStop ?? null },
    },
    null,
    2,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      {/* ব্রেডক্রাম্ব ও শিরোনাম */}
      <div className="flex flex-wrap items-center gap-2 text-[0.74rem] text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--mint)]">{t("navHome")}</Link>
        <span>/</span>
        <span className="text-[#cfe7e6]">{t("resultsTitle")}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="chip border-[rgba(69,223,176,0.35)] text-[var(--mint)]">
            {result.mode === "route" ? t("routeSearch") : result.mode === "name" ? t("nameSearch") : t("navSearch")}
          </span>
          <h1 className="mt-3 text-[1.85rem] font-extrabold text-white sm:text-[2.4rem]">{result.title}</h1>
          <p className="mt-1 text-[0.9rem] text-[var(--muted)]">
            {result.subtitle} · <span className="font-bold text-[var(--mint)]">{result.countLabel}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing((value) => !value)} className="ghost-btn">{t("editSearch")}</button>
          <Link href="/" className="primary-btn">{t("backHome")}</Link>
        </div>
      </div>

      {/* সার্চ সম্পাদনা প্যানেল: টগলে খোলে */}
      {editing && (
        <div className="glass-card fade-up mt-6 grid gap-5 p-5 lg:grid-cols-2">
          <form onSubmit={submitRoute}>
            <p className="mb-3 text-[0.82rem] font-bold text-white">{t("searchRouteTitle")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" value={from} onChange={(event) => setFrom(event.target.value)} placeholder={t("searchFromPlaceholder")} maxLength={80} />
              <input className="input" value={to} onChange={(event) => setTo(event.target.value)} placeholder={t("searchToPlaceholder")} maxLength={80} />
            </div>
            <button type="submit" className="primary-btn mt-3 w-full">{t("searchRouteButton")}</button>
          </form>
          <form onSubmit={submitName}>
            <p className="mb-3 text-[0.82rem] font-bold text-white">{t("searchNameTitle")}</p>
            <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("searchNamePlaceholder")} maxLength={80} />
            <button type="submit" className="primary-btn mt-3 w-full !bg-gradient-to-r !from-[#f8cd72] !to-[#f0a94b] !text-[#33210a]">{t("searchNameButton")}</button>
          </form>
        </div>
      )}

      {/* ভুল/খালি ইনপুটের নির্দেশনা */}
      {result.validationMessage && (
        <div className="glass-card mt-6 p-5 text-[0.86rem] text-amber-200">{result.validationMessage}</div>
      )}

      {/* মূল কনটেন্ট: বাঁয়ে ফলাফল গ্রিড, ডানে স্থানীয়কৃত API প্রিভিউ */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_290px]">
        <div>
          {loading && <p className="mb-4 text-[0.78rem] text-[var(--muted)]">{t("searching")}</p>}
          {result.results.length === 0 ? (
            <div className="glass-card p-9 text-center">
              <p className="text-[0.9rem] text-[var(--muted)]">{t("noResults")}</p>
              <Link href="/" className="primary-btn mt-5">{t("noResultsAction")}</Link>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {result.results.map((bus) => <BusCard key={bus.id} bus={bus} />)}
            </div>
          )}
        </div>

        {/* সাইডবার: API ভাষা ও JSON নমুনা, আর্কিটেকচার পেজের লিংক */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[0.78rem] font-bold text-white">{t("apiResponse")}</p>
              <span className="chip text-[var(--mint)]">{lang === "bn" ? "বাংলা" : "EN"}</span>
            </div>
            <p className="mt-1 text-[0.7rem] text-[var(--muted)]">{t("apiLanguage")}: ?lang={lang}</p>
            <pre className="mono scroll-thin mt-3 max-h-[280px] overflow-auto rounded-xl border border-[var(--line)] bg-[rgba(3,12,18,0.85)] p-3 text-[#9fd8c8]">{preview}</pre>
          </div>
          <div className="glass-card p-4">
            <p className="text-[0.78rem] font-bold text-white">{t("archTitle")}</p>
            <p className="mt-2 text-[0.74rem] leading-relaxed text-[var(--muted)]">{t("archCard2Body")}</p>
            <Link href="/architecture" className="ghost-btn mt-3 w-full">{t("navArchitecture")}</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
