"use client";
// =====================================================================
// আর্কিটেকচার ও API ডকুমেন্টেশন পেজ
// ---------------------------------------------------------------------
// • ১০০০+ concurrent viewer-এর স্কেলিং প্ল্যান ধাপে ধাপে দেখানো হয়।
// • REST কনট্র্যাক্টের সব এন্ডপয়েন্ট ও প্যারামিটার তালিকাভুক্ত।
// • নিচে সরাসরি /api/live?lang=... কল করে বাংলা JSON রেসপন্স দেখানো হয়।
// • Django DRF রেফারেন্স কোড django_reference/ ফোল্ডারে আছে।
// =====================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import type { ApiEnvelope } from "@/lib/types";

// পাইপলাইনের ধাপ: ব্রাউজার থেকে PostgreSQL পর্যন্ত প্রতিটি স্তরের ভূমিকা।
const PIPELINE = [
  { en: "Browser setInterval(5s)", bn: "ব্রাউজার setInterval(৫সে)", detailEn: "Fetch API + AbortController + ETag", detailBn: "Fetch API + AbortController + ETag" },
  { en: "CDN / 304 Not Modified", bn: "CDN / 304 Not Modified", detailEn: "s-maxage=2, stale-while-revalidate=8", detailBn: "s-maxage=2, stale-while-revalidate=8" },
  { en: "REST Route Handler", bn: "REST Route Handler", detailEn: "Validated params, localized DTO", detailBn: "ভ্যালিডেটেড প্যারামিটার, স্থানীয়কৃত DTO" },
  { en: "2s singleflight cache", bn: "২ সেকেন্ড singleflight ক্যাশ", detailEn: "1,000 polls → 1 calculation", detailBn: "১০০০ পোল → ১টি গণনা" },
  { en: "GPS geometry engine", bn: "GPS জ্যামিতি ইঞ্জিন", detailEn: "Route polyline + time → lat/lng", detailBn: "রুট পলিলাইন + সময় → lat/lng" },
  { en: "PostgreSQL read model", bn: "PostgreSQL read model", detailEn: "60s shared cache, zero writes", detailBn: "৬০ সেকেন্ড শেয়ার্ড ক্যাশ, কোনো WRITE নয়" },
];

// REST এন্ডপয়েন্ট তালিকা (Django urls.py-এর সাথে ১:১ ম্যাপ করা যায়)।
const ENDPOINTS = [
  { method: "GET", path: "/api/buses?lang=bn", en: "Active buses + stats", bn: "সচল বাস + পরিসংখ্যান" },
  { method: "GET", path: "/api/buses/:slug?lang=bn", en: "One localized bus", bn: "একটি বাসের স্থানীয়কৃত তথ্য" },
  { method: "GET", path: "/api/search?mode=route&from=…&to=…", en: "Route + counter sequence", bn: "রুট ও কাউন্টারের ক্রম" },
  { method: "GET", path: "/api/search?mode=name&q=Ena", en: "Bus/operator name search", bn: "বাস/অপারেটর নাম সার্চ" },
  { method: "GET", path: "/api/live?bus=1&lang=bn", en: "5s polling frame (ETag/304)", bn: "৫ সেকেন্ড পোলিং ফ্রেম (ETag/304)" },
  { method: "GET", path: "/api/health", en: "Readiness probe", bn: "হেলথ/রেডিনেস চেক" },
];

export default function ArchitecturePage() {
  const { lang, t } = useLanguage(); // ভাষা ও অনুবাদক
  // লাইভ API রেসপন্সের প্রিভিউ: কোন ভাষার জন্য আনা হয়েছে সেটিও সাথে রাখি।
  // বাগ ফিক্স: effect-এর ভেতরে সরাসরি setState না করে অবস্থা "ফলাফল থেকে নির্ণয়" করা হয়।
  const [snapshot, setSnapshot] = useState<{ lang: string; state: "ok" | "error"; text: string } | null>(null);
  const fresh = snapshot !== null && snapshot.lang === lang; // বর্তমান ভাষার ফলাফল এসেছে কি না
  const apiState: "loading" | "ok" | "error" = fresh ? snapshot.state : "loading";
  const preview = fresh ? snapshot.text : "…";

  // ভাষা বদলালে /api/live পুনরায় কল করি ⇒ বাংলা labels সরাসরি প্রমাণিত হয় (?labels=1 দিয়ে)।
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/live?bus=1&lang=${lang}&labels=1`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("api failed");
        const payload = (await response.json()) as ApiEnvelope<unknown>;
        // শুধু প্রথম অংশ দেখাই; পুরো JSON বড় হলে পেজ ভারী হত।
        const note = payload.data && typeof payload.data === "object" && "note" in payload.data ? (payload.data as { note: string }).note : "";
        const text = JSON.stringify(
          {
            language: payload.language,
            labels: { brand: payload.labels?.brand, nextStop: payload.labels?.nextStop, active: payload.labels?.active },
            generatedAt: payload.generatedAt,
            cacheTtlSeconds: payload.cacheTtlSeconds,
            note,
          },
          null,
          2,
        );
        setSnapshot({ lang, state: "ok", text });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setSnapshot({ lang, state: "error", text: "" });
      });
    return () => controller.abort();
  }, [lang]);

  // চারটি স্কেলিং কার্ডের কনটেন্ট অভিধান থেকে আনি।
  const cards = [
    { title: t("archCard1Title"), body: t("archCard1Body"), icon: "◈" },
    { title: t("archCard2Title"), body: t("archCard2Body"), icon: "⌁" },
    { title: t("archCard3Title"), body: t("archCard3Body"), icon: "⟳" },
    { title: t("archCard4Title"), body: t("archCard4Body"), icon: "⛨" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      {/* শিরোনাম */}
      <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--mint)]">System design</p>
      <h1 className="mt-2 text-[1.9rem] font-extrabold text-white sm:text-[2.6rem]">{t("archTitle")}</h1>
      <p className="mt-2 max-w-2xl text-[0.9rem] text-[var(--muted)]">{t("archSubtitle")}</p>

      {/* স্কেলিংয়ের চারটি স্তম্ভ */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className="glass-card p-5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[rgba(69,223,176,0.12)] text-lg text-[var(--mint)]">{card.icon}</span>
            <h2 className="mt-4 text-[0.95rem] font-bold text-white">{card.title}</h2>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--muted)]">{card.body}</p>
          </div>
        ))}
      </div>

      {/* পাইপলাইন ডায়াগ্রাম */}
      <div className="glass-card mt-6 p-5 sm:p-6">
        <h2 className="text-[1rem] font-bold text-white">{lang === "bn" ? "রিকোয়েস্টের পথ (এক নজরে)" : "Request path at a glance"}</h2>
        <div className="mt-5 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {PIPELINE.map((step, index) => (
            <div key={step.en} className="panel relative p-3">
              <span className="mono text-[0.66rem] text-[var(--gold)]">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-1 text-[0.79rem] font-bold text-white">{lang === "bn" ? step.bn : step.en}</p>
              <p className="mono mt-1 break-words text-[0.66rem] text-[var(--muted)]">{lang === "bn" ? step.detailBn : step.detailEn}</p>
              {index < PIPELINE.length - 1 && <span className="absolute -right-2 top-1/2 hidden text-[var(--mint)] xl:block" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* REST API টেবিল + লাইভ JSON প্রিভিউ */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-card overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-[1rem] font-bold text-white">{t("archApiTitle")}</h2>
            <p className="mt-1 text-[0.74rem] text-[var(--muted)]">{t("archApiNote")}</p>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {ENDPOINTS.map((endpoint) => (
              <div key={endpoint.path} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="chip !text-[0.66rem] text-[var(--mint)]">{endpoint.method}</span>
                <code className="mono min-w-0 flex-1 break-all text-[#c5e6de]">{endpoint.path}</code>
                <span className="text-[0.72rem] text-[var(--muted)]">{lang === "bn" ? endpoint.bn : endpoint.en}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.92rem] font-bold text-white">{t("apiResponse")}</h2>
            <span className={`chip ${apiState === "ok" ? "text-[var(--mint)]" : "text-[var(--gold)]"}`}>?lang={lang}</span>
          </div>
          <pre className="mono scroll-thin mt-3 max-h-[300px] overflow-auto rounded-xl border border-[var(--line)] bg-[rgba(3,12,18,0.85)] p-3 text-[#9fd8c8]">
            {apiState === "error" ? t("errorTitle") : preview}
          </pre>
          <p className="mt-2 text-[0.7rem] text-[var(--muted)]">{lang === "bn" ? "উপরের JSON সরাসরি সার্ভার থেকে এসেছে।" : "The JSON above comes straight from the server."}</p>
        </div>
      </div>

      {/* Django DRF ম্যাপিং: স্ট্যাকের পার্থক্য স্বচ্ছভাবে ব্যাখ্যা */}
      <div className="glass-card mt-6 p-6">
        <h2 className="text-[1.05rem] font-bold text-white">{t("archDjangoTitle")}</h2>
        <p className="mt-2 max-w-3xl text-[0.82rem] leading-relaxed text-[var(--muted)]">{t("archDjangoBody")}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["models.py", "Route / Stop / RouteStop / Bus / GPSDevice"],
            ["serializers.py", "LocalizedBusSerializer + language context"],
            ["views.py", "BusList, Search, LiveFrame (cache_page + ETag)"],
            ["urls.py", "router.register → /api/buses, /api/live"],
          ].map(([file, description]) => (
            <div key={file} className="panel p-3">
              <code className="mono text-[0.76rem] text-[var(--gold)]">django_reference/{file}</code>
              <p className="mt-1.5 text-[0.72rem] text-[var(--muted)]">{description}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/" className="ghost-btn">{t("backHome")}</Link>
          <Link href="/search?mode=route&from=Dhaka&to=Khulna" className="primary-btn">{t("searchRouteButton")}</Link>
        </div>
      </div>
    </div>
  );
}
