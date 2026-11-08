"use client";
// =====================================================================
// ফুল-পেজ ট্র্যাকার: একটি বাস + সবসময়-চালু LiveMap + পুরো স্টপ-ক্রম
// ---------------------------------------------------------------------
// ভাষা বদলালে /api/buses/:slug?lang=... থেকে নতুন স্থানীয়কৃত DTO আনি।
// ম্যাপ নিজেই ৫ সেকেন্ডে /api/live পোল করে; এখানে অতিরিক্ত interval নেই।
// =====================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LiveMap } from "@/components/LiveMap";
import { useLanguage } from "@/components/LanguageProvider";
import type { ApiEnvelope, BusDto } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export function TrackerClient({ initialBus, initialLang }: { initialBus: BusDto; initialLang: Lang }) {
  const { lang, t } = useLanguage(); // ভাষা ও অনুবাদক
  const [bus, setBus] = useState<BusDto>(initialBus); // বর্তমান বাস DTO
  const lastLang = useRef<Lang>(initialLang); // শেষ সিঙ্ক করা ভাষা

  // ভাষা পরিবর্তনে শুধু বাসের মেটাডেটা রি-ফেচ; ম্যাপ নিজের ফ্রেম নিজে আনবে।
  useEffect(() => {
    if (lastLang.current === lang) return;
    lastLang.current = lang;
    const controller = new AbortController();
    fetch(`/api/buses/${encodeURIComponent(initialBus.slug)}?lang=${lang}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("detail api failed");
        return response.json() as Promise<ApiEnvelope<{ bus: BusDto }>>;
      })
      .then((payload) => setBus(payload.data.bus))
      .catch(() => { /* ব্যর্থ হলে আগের ভাষার ডেটা দিয়েই চলতে থাকি */ });
    return () => controller.abort();
  }, [lang, initialBus.slug]);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      {/* ব্রেডক্রাম্ব */}
      <div className="flex flex-wrap items-center gap-2 text-[0.74rem] text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--mint)]">{t("navHome")}</Link>
        <span>/</span>
        <span className="text-[#cfe7e6]">{t("trackTitle")}</span>
      </div>

      {/* হেডার: বাসের নাম, রুট ও লাইভ ব্যাজ */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[1.8rem] font-extrabold text-white sm:text-[2.3rem]">{t("trackTitle")} · {bus.name}</h1>
          <p className="mt-1 text-[0.86rem] text-[var(--muted)]">{t("trackSubtitle")} {bus.origin} → {bus.destination}</p>
        </div>
        <span className="chip border-[rgba(69,223,176,0.4)] text-[var(--mint)]"><span className="live-pulse" aria-hidden="true" /> {t("liveBadge")}</span>
      </div>

      {/* দুই কলাম: বাঁয়ে বড় ম্যাপ, ডানে তথ্য ও স্টপ-ক্রম */}
      <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="glass-card p-4 sm:p-5">
          {/* LiveMap সবসময় mounted ⇒ ৫ সেকেন্ড পোলিং চলতেই থাকে */}
          <LiveMap bus={bus} />
        </div>

        <aside className="space-y-4">
          {/* বাসের সারাংশ */}
          <div className="glass-card p-5">
            <p className="text-[0.7rem] uppercase tracking-wider text-[var(--muted)]">{bus.routeCode}</p>
            <h2 className="mt-1 text-[1.05rem] font-bold text-white">{bus.routeName}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-[0.75rem]">
              <div><p className="text-[var(--muted)]">{t("departure")}</p><p className="font-bold text-white">{bus.departureLabel}</p></div>
              <div><p className="text-[var(--muted)]">{t("fare")}</p><p className="font-bold text-white">{bus.fareLabel}</p></div>
              <div><p className="text-[var(--muted)]">{t("distance")}</p><p className="font-bold text-white">{bus.distanceLabel}</p></div>
              <div><p className="text-[var(--muted)]">{t("duration")}</p><p className="font-bold text-white">{bus.durationLabel}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="chip text-[var(--mint)]">{bus.serviceTypeLabel}</span>
              {bus.amenities.map((item) => <span key={item.key} className="chip">{item.label}</span>)}
            </div>
          </div>

          {/* পুরো রুটের কাউন্টার-ক্রম */}
          <div className="glass-card p-5">
            <p className="text-[0.82rem] font-bold text-white">{t("counters")}</p>
            <ol className="scroll-thin mt-3 max-h-[340px] space-y-0 overflow-y-auto pr-1">
              {bus.stops.map((stop) => (
                <li key={`${stop.id}-${stop.sequence}`} className="flex items-start gap-3 border-l border-[var(--line-strong)] pb-3 pl-3 last:pb-0">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[9px] font-bold text-[var(--mint)]">{stop.sequence}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[0.8rem] font-semibold text-white">{stop.name}</p>
                    <p className="text-[0.68rem] text-[var(--muted)]">{stop.district} · {stop.offsetLabel}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
