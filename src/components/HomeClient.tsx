"use client";
// =====================================================================
// হোম পেজের ক্লায়েন্ট অংশ (Server data দিয়ে hydrate + ভাষা বদলে refetch)
// ---------------------------------------------------------------------
// • প্রথম পেইন্টে server-rendered initialBuses ব্যবহার ⇒ blank screen নেই (SEO +速度)।
// • ভাষা টগল করলে /api/buses?lang=bn|en কল করে সম্পূর্ণ নতুন স্থানীয়কৃত DTO আনি।
// • দুটি সার্চ ফর্ম /search পেজে mode সহ navigate করে (Fetch API নয়, client routing)।
// =====================================================================

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BusCard } from "@/components/BusCard";
import { useLanguage } from "@/components/LanguageProvider";
import type { ApiEnvelope, BusDto, StatsDto } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

// সার্ভার থেকে আসা প্রাথমিক ডেটার টাইপ (page.tsx থেকে pass করা হয়)।
type HomeProps = { initialBuses: BusDto[]; initialStats: StatsDto; initialLang: Lang };

// ফিল্টারের অনুমোদিত মান: সব / এসি / নন-এসি (allow-list)।
type Filter = "all" | "ac" | "non_ac";

export function HomeClient({ initialBuses, initialStats, initialLang }: HomeProps) {
  const { lang, t } = useLanguage(); // ভাষা ও অনুবাদক
  const router = useRouter(); // Next.js ক্লায়েন্ট রাউটার
  const [buses, setBuses] = useState<BusDto[]>(initialBuses); // বর্তমান প্রদর্শিত বহর
  const [stats, setStats] = useState<StatsDto>(initialStats); // পরিসংখ্যান
  // বাগ ফিক্স: syncing আলাদা state নয়, "কোন ভাষার ডেটা লোড আছে" থেকে নির্ণীত (effect-এ sync setState নেই)।
  const [loadedLang, setLoadedLang] = useState<Lang>(initialLang); // বর্তমান ডেটা যে ভাষার
  const [fetchFailed, setFetchFailed] = useState(false); // ভাষা-রিফেচ ব্যর্থ হয়েছে কি না
  const syncing = loadedLang !== lang; // ভাষা বদলেছে কিন্তু নতুন ডেটা এখনো আসেনি
  const [filter, setFilter] = useState<Filter>("all"); // বর্তমান ফিল্টার
  const [from, setFrom] = useState(""); // রুট সার্চ: শুরু
  const [to, setTo] = useState(""); // রুট সার্চ: গন্তব্য
  const [name, setName] = useState(""); // নাম সার্চ: বাস/অপারেটর

  // ---- ভাষা বদলালে REST API থেকে নতুন ভাষার ডেটা আনি ----
  useEffect(() => {
    if (loadedLang === lang) return; // ডেটা ইতিমধ্যে এই ভাষায় আছে, fetch দরকার নেই
    const controller = new AbortController(); // দ্রুত ভাষা বদলালে পুরনো রিকোয়েস্ট বাতিলের জন্য
    fetch(`/api/buses?lang=${lang}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("bus api failed");
        return response.json() as Promise<ApiEnvelope<{ buses: BusDto[]; stats: StatsDto }>>;
      })
      .then((payload) => {
        setBuses(payload.data.buses); // সম্পূর্ণ বাংলা/ইংরেজি নাম, লেবেল ও সংখ্যা
        setStats(payload.data.stats);
        setFetchFailed(false);
        setLoadedLang(lang); // এখন ডেটা ও ভাষা মিলেছে
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return; // আমরাই বাতিল করেছি ⇒ ত্রুটি নয়
        setFetchFailed(true); // ব্যর্থ: আগের ডেটাই থাকবে, ব্যবহারকারীকে জানাই
        setLoadedLang(lang); // অনন্ত "লোড হচ্ছে" এড়াতে
      });
    return () => controller.abort(); // cleanup: race condition নেই
  }, [lang, loadedLang]);

  // ---- রুট ফর্ম submit: "Dhaka to Khulna" এক ঘরেও লেখা যায়; সার্ভার ভাগ করবে ----
  const submitRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); // ব্রাউজারের ডিফল্ট রিলোড বন্ধ
    const params = new URLSearchParams({ mode: "route", from: from.trim(), to: to.trim() });
    router.push(`/search?${params.toString()}`); // আলাদা ফলাফল পেজে নেভিগেশন
  };

  // ---- নাম ফর্ম submit: Ena / Green Line ইত্যাদি ----
  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ mode: "name", q: name.trim() });
    router.push(`/search?${params.toString()}`);
  };

  // ফিল্টার প্রয়োগ: inactive API তে আসে না, তবুও দ্বিতীয় স্তরের যাচাই রাখি।
  const shownBuses = buses.filter((bus) => {
    if (!bus.isActive) return false;
    // বাগ ফিক্স: ভাষা-নিরপেক্ষ serviceType দিয়ে ফিল্টার (আগে অনূদিত লেবেল মেলানো হত)।
    return filter === "all" || bus.serviceType === filter;
  });

  // জনপ্রিয় সার্চ: এক ক্লিকে ডেমো করা যায় (দুই ভাষাতেই কাজ করে)।
  const popular = [
    { label: lang === "bn" ? "ঢাকা → খুলনা" : "Dhaka → Khulna", href: "/search?mode=route&from=Dhaka&to=Khulna" },
    { label: lang === "bn" ? "ঢাকা → চট্টগ্রাম" : "Dhaka → Chattogram", href: "/search?mode=route&from=Dhaka&to=Chattogram" },
    { label: "Ena", href: "/search?mode=name&q=Ena" },
    { label: "Green Line", href: "/search?mode=name&q=Green%20Line" },
  ];

  return (
    <>
      {/* ======================= হিরো ======================= */}
      <section
        className="relative isolate overflow-hidden border-b border-[var(--line)]"
        style={{ backgroundImage: "url('/images/hero-bus.jpg')", backgroundSize: "cover", backgroundPosition: "center 55%" }}
      >
        <div className="hero-overlay absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-14 sm:px-6 md:pb-20 md:pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:px-8">
          {/* বাঁ পাশ: মূল headline, বর্ণনা ও CTA */}
          <div className="fade-up">
            <span className="chip border-[rgba(69,223,176,0.35)] bg-[rgba(69,223,176,0.09)] text-[var(--mint)]">
              <span className="live-pulse" aria-hidden="true" /> {t("heroEyebrow")}
            </span>
            <h1 className="mt-5 text-[2.45rem] font-extrabold leading-[1.16] tracking-tight text-white sm:text-[3.35rem] lg:text-[3.8rem]">
              {t("heroTitleA")}
              <br />
              <span className="gradient-text">{t("heroTitleB")}</span>
            </h1>
            <p className="mt-5 max-w-xl text-[0.98rem] leading-relaxed text-[#b6cfd2]">{t("heroSubtitle")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#active-fleet" className="primary-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
                {t("heroCta")}
              </a>
              <Link href="/architecture" className="ghost-btn">{t("heroSecondary")}</Link>
            </div>
            {/* জনপ্রিয় সার্চের চিপ */}
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="text-[0.72rem] font-semibold text-[var(--muted)]">{t("popularSearches")}:</span>
              {popular.map((item) => (
                <Link key={item.href} href={item.href} className="chip hover:border-[rgba(69,223,176,0.55)] hover:text-white">{item.label}</Link>
              ))}
            </div>
          </div>

          {/* ডান পাশ: লাইভ নেটওয়ার্কের ছোট গ্লাস প্যানেল (প্রথম ৩টি বাস) */}
          <div className="glass-card fade-up hidden p-5 lg:block" style={{ animationDelay: "0.12s" }}>
            <div className="flex items-center justify-between">
              <p className="text-[0.78rem] font-bold uppercase tracking-[0.09em] text-[var(--muted)]">{t("activeTitle")}</p>
              <span className="chip text-[var(--mint)]"><span className="live-pulse" aria-hidden="true" /> {t("liveBadge")}</span>
            </div>
            <div className="mt-4 space-y-2.5">
              {buses.slice(0, 4).map((bus) => (
                <div key={bus.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[rgba(6,20,29,0.55)] px-3 py-2.5">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: bus.accentColor }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-semibold text-white">{bus.name}</p>
                    <p className="truncate text-[0.68rem] text-[var(--muted)]">{bus.routeName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.72rem] font-bold text-[var(--mint)]">{bus.live.speedLabel}</p>
                    <p className="truncate text-[0.66rem] text-[var(--muted)]">{bus.live.nextStop}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3 text-[0.7rem] text-[var(--muted)]">
              <span>{t("statRefresh")}</span>
              <span className="font-bold text-[var(--gold)]">{t("statRefreshValue")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ======================= পরিসংখ্যান বার ======================= */}
      {/* হিরোর সাথে সামান্য overlap রাখা হয়েছে, কিন্তু relative + z-10 থাকায়
          কার্ড আর হিরোর পেছনে ঢাকা পড়বে না। প্রতিটি মানের জন্য আলাদা আইকন। */}
      <section
        aria-label={lang === "bn" ? "লাইভ নেটওয়ার্কের পরিসংখ্যান" : "Live network statistics"}
        className="relative z-10 mx-auto -mt-6 max-w-7xl px-4 sm:-mt-8 sm:px-6 lg:px-8"
      >
        <dl className="stats-grid">
          <Stat icon="bus" value={stats.activeBuses} label={t("statActive")} />
          <Stat icon="route" value={stats.routes} label={t("statRoutes")} />
          <Stat icon="stop" value={stats.stops} label={t("statStops")} />
          <Stat icon="refresh" value={t("statRefreshValue")} label={t("statRefresh")} accent />
        </dl>
      </section>

      {/* ======================= দুটি সার্চ বার ======================= */}
      <section className="mx-auto max-w-7xl px-4 pt-14 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ক) রুট ভিত্তিক সার্চ */}
          <form onSubmit={submitRoute} className="glass-card fade-up p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgba(69,223,176,0.12)] text-[var(--mint)]">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H15a3 3 0 0 1 0 6h-6a3 3 0 0 0 0 6h6.5" /></svg>
              </span>
              <div>
                <h2 className="text-[1.05rem] font-bold text-white">{t("searchRouteTitle")}</h2>
                <p className="text-[0.74rem] text-[var(--muted)]">{t("searchRouteHint")}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[0.72rem] font-semibold text-[#b6cfd2]">{t("searchFrom")}</span>
                <input className="input" value={from} onChange={(event) => setFrom(event.target.value)} placeholder={t("searchCombinedPlaceholder")} maxLength={80} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[0.72rem] font-semibold text-[#b6cfd2]">{t("searchTo")}</span>
                <input className="input" value={to} onChange={(event) => setTo(event.target.value)} placeholder={t("searchToPlaceholder")} maxLength={80} />
              </label>
            </div>
            <button type="submit" className="primary-btn mt-4 w-full">{t("searchRouteButton")}</button>
          </form>

          {/* খ) নাম ভিত্তিক সার্চ */}
          <form onSubmit={submitName} className="glass-card fade-up p-5 sm:p-6" style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgba(245,189,85,0.13)] text-[var(--gold)]">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M3 11h18M7 17v2M17 17v2" /></svg>
              </span>
              <div>
                <h2 className="text-[1.05rem] font-bold text-white">{t("searchNameTitle")}</h2>
                <p className="text-[0.74rem] text-[var(--muted)]">{t("searchNameHint")}</p>
              </div>
            </div>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-[0.72rem] font-semibold text-[#b6cfd2]">{t("searchNamePlaceholder")}</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ena / গ্রিন লাইন / Shyamoli" maxLength={80} />
            </label>
            <button type="submit" className="primary-btn mt-4 w-full !bg-gradient-to-r !from-[#f8cd72] !to-[#f0a94b] !text-[#33210a]">{t("searchNameButton")}</button>
          </form>
        </div>
      </section>

      {/* ======================= আজ সচল বাসের তালিকা ======================= */}
      <section id="active-fleet" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-16 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--mint)]">{t("liveBadge")} · GPS</p>
            <h2 className="mt-1 text-[1.7rem] font-extrabold text-white sm:text-[2.1rem]">{t("activeTitle")}</h2>
            <p className="mt-1 text-[0.84rem] text-[var(--muted)]">{t("activeSubtitle")}</p>
          </div>
          {/* ফিল্টার চিপ: সব / এসি / নন-এসি */}
          <div className="flex flex-wrap gap-2">
            {(["all", "ac", "non_ac"] as Filter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`chip !px-3 !py-1.5 !text-[0.75rem] ${filter === item ? "!border-[rgba(69,223,176,0.6)] !bg-[rgba(69,223,176,0.12)] !text-[var(--mint)]" : ""}`}
              >
                {item === "all" ? (lang === "bn" ? "সব" : "All") : item === "ac" ? t("ac") : t("nonAc")}
              </button>
            ))}
          </div>
        </div>

        {/* লোডিং/খালি অবস্থা ও কার্ড গ্রিড */}
        {syncing && <p className="mt-6 text-[0.8rem] text-[var(--muted)]">{t("loading")}</p>}
        {fetchFailed && <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[0.78rem] text-amber-200">{t("errorTitle")}</p>}
        {shownBuses.length === 0 ? (
          <div className="glass-card mt-8 p-8 text-center text-[0.88rem] text-[var(--muted)]">{t("noResults")}</div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {shownBuses.map((bus) => <BusCard key={bus.id} bus={bus} />)}
          </div>
        )}
      </section>

      {/* ======================= কীভাবে কাজ করে ======================= */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-8">
        <h2 className="text-[1.55rem] font-extrabold text-white">{t("howItWorks")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { n: "01", title: t("step1Title"), body: t("step1Body") },
            { n: "02", title: t("step2Title"), body: t("step2Body") },
            { n: "03", title: t("step3Title"), body: t("step3Body") },
          ].map((step) => (
            <div key={step.n} className="glass-card p-5">
              <span className="mono text-[0.78rem] font-bold text-[var(--gold)]">{step.n}</span>
              <h3 className="mt-2 text-[1rem] font-bold text-white">{step.title}</h3>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-[var(--muted)]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ======================= আর্কিটেকচার CTA ======================= */}
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8">
        <div className="glass-card relative overflow-hidden p-7 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[rgba(69,223,176,0.11)] blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div className="max-w-2xl">
              <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--mint)]">REST · Cache · Polling</p>
              <h2 className="mt-2 text-[1.45rem] font-extrabold text-white sm:text-[1.8rem]">{t("archTitle")}</h2>
              <p className="mt-2 text-[0.84rem] text-[var(--muted)]">{t("archSubtitle")}</p>
            </div>
            <Link href="/architecture" className="primary-btn">{t("navArchitecture")}</Link>
          </div>
        </div>
      </section>
    </>
  );
}

// পরিসংখ্যানের চারটি অনুমোদিত আইকন: নির্দিষ্ট ধরন থাকায় ভুল আইকন পাঠানো যায় না।
type StatIcon = "bus" | "route" | "stop" | "refresh";

// একটি পরিসংখ্যান ঘর: আইকন, বড় মান ও নিচে বিবরণ।
// dt/dd ব্যবহার করায় স্ক্রিন রিডারও লেবেল ও মানের সম্পর্ক বুঝতে পারে।
function Stat({ value, label, icon, accent = false }: { value: string; label: string; icon: StatIcon; accent?: boolean }) {
  return (
    <div className="stats-item">
      {/* আইকনগুলো শুধুই অলংকার; টেক্সটেই অর্থ আছে বলে স্ক্রিন রিডার থেকে লুকানো। */}
      <span className={`stats-icon ${accent ? "stats-icon-gold" : ""}`} aria-hidden="true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon === "bus" && <><rect x="4" y="4" width="16" height="14" rx="3" /><path d="M4 11h16M8 18v2M16 18v2M8 15h.01M16 15h.01" /></>}
          {icon === "route" && <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5" /></>}
          {icon === "stop" && <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>}
          {icon === "refresh" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
        </svg>
      </span>
      {/* মান আগে দেখালেও DOM-এ লেবেল আগে রাখি, যাতে স্ক্রিন রিডারে ক্রম স্বাভাবিক থাকে। */}
      <div className="flex min-w-0 flex-1 flex-col">
        <dt className="stats-label order-2">{label}</dt>
        <dd className={`stats-value order-1 ${accent ? "text-[var(--gold)]" : "text-white"}`}>{value}</dd>
      </div>
    </div>
  );
}
