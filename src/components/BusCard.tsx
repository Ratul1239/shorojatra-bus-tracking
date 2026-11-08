"use client";
// =====================================================================
// BusCard: একটি বাসের সম্পূর্ণ তথ্য + লাইভ লোকেশন বাটন
// ---------------------------------------------------------------------
// • ম্যাপ বন্ধ থাকলে LiveMap mount-ই হয় না ⇒ ১০০০ কার্ড থাকলেও ১০০০ পোলিং নেই।
// • কাউন্টারের ক্রম matchedStops (from→to) অথবা পুরো route.stops থেকে আসে।
// • সব টেক্সট useLanguage().t() বা স্থানীয়কৃত API DTO থেকে আসে।
// =====================================================================

import { useState } from "react";
import Link from "next/link";
import { LiveMap } from "@/components/LiveMap";
import { useLanguage } from "@/components/LanguageProvider";
import type { BusDto, StopDto } from "@/lib/types";

export function BusCard({ bus }: { bus: BusDto }) {
  const { t } = useLanguage(); // অনুবাদক ফাংশন
  const [mapOpen, setMapOpen] = useState(false); // ম্যাপ খোলা/বন্ধ
  const [expanded, setExpanded] = useState(false); // পুরো স্টপ-ক্রম দেখানোর টগল

  // রুট সার্চে ম্যাচ করা অংশ, নাহলে পুরো রুট; দুটোই ক্রম অনুযায়ী সাজানো।
  const sequence: StopDto[] = bus.matchedStops.length ? bus.matchedStops : bus.stops;
  // প্রথমে ৪টি কাউন্টার দেখাই; "সব দেখুন"-এ পুরো তালিকা খুলে যায়।
  const visibleStops = expanded ? sequence : sequence.slice(0, 4);

  return (
    <article className="glass-card fade-up relative overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5" style={{ borderTop: `2px solid ${bus.accentColor}` }}>
      {/* উপরের সারি: বাসের নাম + স্ট্যাটাস ব্যাজ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#04221a]" style={{ background: bus.accentColor }}>
              {/* ছোট বাস আইকন */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M3 11h18M7 17v2M17 17v2" />
              </svg>
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[1.02rem] font-bold text-white" title={bus.name}>{bus.name}</h3>
              <p className="truncate text-[0.72rem] text-[var(--muted)]">{bus.operator} · {bus.registrationNo}</p>
            </div>
          </div>
        </div>
        {/* সচল/অসচল ব্যাজ: লাইভ ডট শুধু সচল অবস্থায় */}
        <span className={`chip ${bus.isActive ? "text-[var(--mint)]" : "text-[#c2ced1]"}`}>
          {bus.isActive && <span className="live-pulse" aria-hidden="true" />}
          {bus.statusLabel}
        </span>
      </div>

      {/* রুট ভিজুয়াল: শুরু → রেখা → গন্তব্য */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[rgba(6,20,29,0.6)] px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.64rem] uppercase tracking-wider text-[var(--muted)]">{t("from")}</p>
          <p className="truncate text-[0.9rem] font-bold text-white">{bus.origin}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[var(--mint)]">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="h-px w-8 bg-current opacity-60 sm:w-14" />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[0.64rem] uppercase tracking-wider text-[var(--muted)]">{t("to")}</p>
          <p className="truncate text-[0.9rem] font-bold text-white">{bus.destination}</p>
        </div>
      </div>

      {/* মেটাডাটা গ্রিড: ছাড়ার সময়, ধরন, আসন, ভাড়া, দূরত্ব, রেটিং */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Meta label={t("departure")} value={bus.departureLabel} />
        <Meta label={t("fare")} value={bus.fareLabel} />
        <Meta label={t("rating")} value={bus.ratingLabel} />
        <Meta label={t("seats")} value={bus.seatCountLabel} />
        <Meta label={t("distance")} value={bus.distanceLabel} />
        <Meta label={t("duration")} value={bus.durationLabel} />
      </div>

      {/* সুবিধার চিপ: API থেকে অনূদিত label সহ */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="chip border-[rgba(69,223,176,0.35)] text-[var(--mint)]">{bus.serviceTypeLabel}</span>
        {bus.amenities.map((amenity) => <span key={amenity.key} className="chip">{amenity.label}</span>)}
      </div>

      {/* ক্রম অনুযায়ী কাউন্টার টাইমলাইন — রুট সার্চের মূল ফিচার */}
      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.76rem] font-bold text-[#cfe7e6]">{t("counters")}</p>
          <span className="chip">{sequence.length} {t("stopsCount")}</span>
        </div>
        <ol className="scroll-thin mt-3 max-h-[210px] space-y-0 overflow-y-auto pr-1">
          {visibleStops.map((stop, index) => (
            <li key={`${stop.id}-${index}`} className="relative flex items-start gap-3 pb-3 last:pb-0">
              {/* বাঁ পাশের উল্লম্ব রেখা: শেষ আইটেম ছাড়া সবখানে */}
              {index < visibleStops.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-14px)] w-px bg-[var(--line-strong)]" aria-hidden="true" />}
              <span className={`relative z-10 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border text-[9px] font-bold ${index === 0 || index === visibleStops.length - 1 ? "border-[var(--gold)] bg-[rgba(245,189,85,0.16)] text-[var(--gold)]" : "border-[var(--line-strong)] bg-[var(--surface-2)] text-[#a9c3c8]"}`}>
                {stop.sequence}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[0.8rem] font-semibold text-white">{stop.name}</p>
                <p className="text-[0.68rem] text-[var(--muted)]">{stop.district} · {stop.offsetLabel}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* ৪টির বেশি স্টপ থাকলে সম্প্রসারণের বাটন */}
        {sequence.length > 4 && (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 text-[0.72rem] font-semibold text-[var(--mint)] hover:underline">
            {expanded ? t("hideSequence") : `${t("showSequence")} (${sequence.length})`}
          </button>
        )}
      </div>

      {/* লাইভ স্ট্যাটাসের এক-লাইন সারাংশ + অ্যাকশন বাটন */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-[0.72rem] text-[var(--muted)]">
          {t("nextStop")}: <span className="font-semibold text-[var(--gold)]">{bus.live.nextStop}</span> · {bus.live.speedLabel}
        </p>
        <div className="flex items-center gap-2">
          {/* পূর্ণ পেজ ট্র্যাকার: আলাদা পেজে বড় ম্যাপ */}
          <Link href={`/track/${bus.slug}`} className="ghost-btn !px-3 !py-2 text-[0.76rem]">{t("openFullTracker")}</Link>
          {/* মূল লোকেশন বাটন: ক্লিকে ম্যাপ mount হয় ও ৫ সেকেন্ড পোলিং শুরু হয় */}
          <button type="button" onClick={() => setMapOpen((value) => !value)} aria-expanded={mapOpen} className="primary-btn !px-3.5 !py-2 text-[0.78rem]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" />
            </svg>
            {mapOpen ? t("hideLocation") : t("viewLocation")}
          </button>
        </div>
      </div>

      {/* শর্তসাপেক্ষ render: বন্ধ অবস্থায় কোনো fetch/interval থাকে না */}
      {mapOpen && <LiveMap bus={bus} />}
    </article>
  );
}

// ছোট মেটাডাটা ব্লক: লেবেল + মান; hidden দিয়ে ভবিষ্যতের ফিল্ডের জন্য নমনীয় রাখা হয়েছে।
function Meta({ label, value, hidden = false }: { label: string; value: string; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div>
      <p className="text-[0.66rem] text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 truncate text-[0.84rem] font-semibold text-white">{value}</p>
    </div>
  );
}
