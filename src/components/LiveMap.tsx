"use client";
// =====================================================================
// LiveMap: বাসের লাইভ লোকেশন — ৩D ম্যাপ + ৫ সেকেন্ড পোলিং + স্বয়ংক্রিয় fallback
// ---------------------------------------------------------------------
// ম্যাপ ইঞ্জিনের অগ্রাধিকার (একটি ব্যর্থ হলে পরেরটিতে নামে, ব্যবহারকারী কখনো ফাঁকা ম্যাপ দেখে না):
//   ১) Google Maps ৩D  — NEXT_PUBLIC_GOOGLE_MAPS_API_KEY থাকলে
//   ২) OpenStreetMap ৩D (MapLibre) — key ছাড়াই; আসল ৩D বিল্ডিং + ৩D বাস মডেল
//   ৩) SVG স্কিম্যাটিক ২D — WebGL/নেটওয়ার্ক না থাকলে
// লাইভ ডেটা: setInterval(5000) + Fetch API + AbortController + ETag/304 + ট্যাব hidden হলে বিরতি।
// ভারী ম্যাপ লাইব্রেরি (maplibre ~৮০০KB) next/dynamic দিয়ে শুধু ম্যাপ খুললেই লোড হয়।
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react"; // React hooks
import dynamic from "next/dynamic"; // ভারী ম্যাপ কম্পোনেন্ট lazy লোড
import { useLanguage } from "@/components/LanguageProvider"; // ভাষা ও অনুবাদক
import { SvgMapView } from "@/components/SvgMapView"; // ২D fallback (ছোট, সরাসরি import)
import type { ApiEnvelope, BusDto, LatLng, LiveDto } from "@/lib/types"; // DTO

// ৩D ভিউগুলো ssr:false — WebGL শুধু ব্রাউজারে চলে; আলাদা chunk হিসেবে লোড হয়।
const MapLibreView = dynamic(() => import("@/components/MapLibreView").then((m) => m.MapLibreView), { ssr: false });
const GoogleMapView = dynamic(() => import("@/components/GoogleMapView").then((m) => m.GoogleMapView), { ssr: false });

// কোন ইঞ্জিন চলছে।
type Engine = "google" | "maplibre" | "svg";

// ক্লায়েন্ট bundle-এ শুধু NEXT_PUBLIC_* ভ্যারিয়েবল যায়।
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// /api/live রেসপন্সের ছোট টাইপ (এই কম্পোনেন্ট শুধু frames ব্যবহার করে)।
type LivePayload = { frames: LiveDto[]; pollingIntervalSeconds: number; serverCacheTtlSeconds: number; note: string };

// সড়কের পথের তথ্য; at = কখন আনা হয়েছে (সরলরেখা হলে কিছুক্ষণ পর আবার চেষ্টা করি)।
type PathInfo = { path: LatLng[]; road: boolean; at: number };

// মডিউল-লেভেল ক্যাশ: একই রুটের ম্যাপ বারবার খুললে path আবার আনতে হয় না।
const pathCache = new Map<number, PathInfo>();

// মূল কম্পোনেন্ট: parent থেকে BusDto পায়।
export function LiveMap({ bus }: { bus: BusDto }) {
  const { lang, t } = useLanguage(); // নির্বাচিত ভাষা + অনুবাদক
  const [frame, setFrame] = useState<LiveDto>(bus.live); // সর্বশেষ GPS ফ্রেম (প্রথমে SSR ডেটা)
  const [pollCount, setPollCount] = useState(0); // "কতবার সিঙ্ক হল" দেখানোর জন্য
  const [error, setError] = useState(""); // নেটওয়ার্ক ত্রুটির বার্তা
  const [engine, setEngine] = useState<Engine>(GOOGLE_KEY ? "google" : "maplibre"); // বর্তমান ম্যাপ ইঞ্জিন
  const [ready, setReady] = useState(false); // ৩D ম্যাপ প্রস্তুত কি না
  const [fellBack, setFellBack] = useState(false); // ৩D ব্যর্থ হয়ে SVG-তে নেমেছে কি না
  const [view3d, setView3d] = useState(true); // ৩D (কাত) / ২D (ওপর থেকে)
  const [follow, setFollow] = useState(true); // বাসকে ক্যামেরা অনুসরণ করবে কি না
  const [fitTick, setFitTick] = useState(0); // "পুরো রুট" কমান্ডের counter
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(() => pathCache.get(bus.routeId) ?? null); // সড়কের পথ
  const etagRef = useRef<string>(""); // সর্বশেষ ETag → 304 conditional request
  const abortRef = useRef<AbortController | null>(null); // চলমান fetch বাতিল করার জন্য

  // ---- ১) পোলিং: প্রথম কল সাথে সাথে, এরপর প্রতি ৫০০০ms এ setInterval ----
  useEffect(() => {
    let failures = 0; // পরপর ব্যর্থতার সংখ্যা (backoff-এর জন্য)
    let ticks = 0; // interval tick কাউন্টার

    // একটি পোল চক্র: hidden ট্যাবে বাদ, পুরনো request abort, নতুন fetch।
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return; // ব্যাকগ্রাউন্ড ট্যাবে bandwidth বাঁচাই
      abortRef.current?.abort(); // আগের রিকোয়েস্ট এখনো চললে বাতিল (race condition নেই)
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (etagRef.current) headers["If-None-Match"] = etagRef.current; // শর্তসাপেক্ষ রিকোয়েস্ট
        const response = await fetch(`/api/live?bus=${encodeURIComponent(bus.id)}&lang=${lang}`, {
          signal: controller.signal,
          headers,
          cache: "no-store", // ব্রাউজার cache বাদ; ETag আমরাই ম্যানেজ করি
        });
        if (response.status === 304) {
          // ডেটা বদলায়নি ⇒ পুরনো ফ্রেমই রাখি, শুধু সিঙ্ক কাউন্টার বাড়াই।
          setPollCount((value) => value + 1);
          failures = 0;
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`); // 429/503 সহ সব ব্যর্থতা backoff-এ যায়
        const nextEtag = response.headers.get("ETag");
        if (nextEtag) etagRef.current = nextEtag; // পরের চক্রে If-None-Match হিসেবে পাঠাব
        const payload = (await response.json()) as ApiEnvelope<LivePayload>;
        const nextFrame = payload.data.frames.find((item) => item.busId === bus.id); // শুধু এই বাস
        if (nextFrame) setFrame(nextFrame); // state বদলালেই মার্কার গ্লাইড শুরু করে
        setError(""); // সফল হলে আগের ত্রুটি মুছে ফেলি
        failures = 0; // backoff রিসেট
        setPollCount((value) => value + 1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // আমরা নিজেই বাতিল করেছি → ত্রুটি নয়
        failures += 1; // পরের tick-এ backoff প্রয়োগ হবে
        setError(t("errorTitle")); // ব্যবহারকারীকে সাধারণ বার্তা
      }
    };

    void poll(); // মাউন্ট হওয়ার সাথে সাথে প্রথম ফ্রেম (ভাষা বদলালে নতুন ভাষায় ফ্রেম)
    // setInterval: ৫ সেকেন্ড; ব্যর্থতার পর একাধিক tick এড়িয়ে ১০ সেকেন্ড backoff পাই।
    const interval = setInterval(() => {
      ticks += 1;
      if (failures > 0 && ticks % 2 !== 0) return;
      void poll();
    }, 5000);
    // cleanup: ম্যাপ বন্ধ/পেজ ছাড়লে interval ও fetch বন্ধ ⇒ memory leak নেই।
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // bus.id + lang বদলালেই নতুন পোলিং চক্র; t শুধু ত্রুটি-বার্তার জন্য।
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus.id, lang]);

  // ---- ২) আসল সড়কের পথ: একবার আনি (দীর্ঘ-ক্যাশযোগ্য এন্ডপয়েন্ট)। ৫ সেকেন্ডের পোলিংয়ে ভারী জ্যামিতি যায় না ----
  useEffect(() => {
    const cachedPath = pathCache.get(bus.routeId);
    // আসল সড়ক থাকলে বা সরলরেখা সদ্য আনা হলে আর আনি না (সার্ভার ব্যাকগ্রাউন্ডে সড়ক আনছে হতে পারে)।
    if (cachedPath && (cachedPath.road || Date.now() - cachedPath.at < 60_000)) return;
    const controller = new AbortController();
    fetch(`/api/routes/${bus.routeId}/path`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("path api failed");
        return response.json() as Promise<{ hasRoadGeometry: boolean; path: [number, number][] }>;
      })
      .then((data) => {
        const info: PathInfo = { path: data.path.map(([lat, lng]) => ({ lat, lng })), road: data.hasRoadGeometry, at: Date.now() };
        pathCache.set(bus.routeId, info);
        setPathInfo(info);
      })
      .catch(() => {
        /* ব্যর্থ হলে স্টপের সরলরেখাই চলবে */
      });
    return () => controller.abort();
  }, [bus.routeId]);

  // ম্যাপে যে পথ আঁকা হবে: আসল সড়ক, না এলে স্টপগুলোর সরলরেখা।
  const path = useMemo<LatLng[]>(
    () => pathInfo?.path ?? bus.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    [pathInfo, bus.stops],
  );

  // ---- ইঞ্জিন fallback: Google ব্যর্থ ⇒ OSM ৩D; OSM ব্যর্থ ⇒ SVG ----
  const handleFail = useCallback(() => {
    setReady(false);
    setEngine((current) => {
      if (current === "google") return "maplibre"; // key অবৈধ/নেটওয়ার্ক ⇒ key-বিহীন ৩D
      setFellBack(true); // WebGL/টাইল সার্ভার নেই ⇒ SVG
      return "svg";
    });
  }, []);
  const handleReady = useCallback(() => setReady(true), []);
  const handleFollowChange = useCallback((value: boolean) => setFollow(value), []);

  // ইঞ্জিনের লেবেল (হেডার চিপে)।
  const engineLabel = engine === "google" ? t("mapGoogle3d") : engine === "maplibre" ? t("mapOsm") : t("mapFallback");

  // তিনটি ভিউয়ের জন্য একই props।
  const viewProps = { bus, frame, path, view3d, follow, fitTick, onFollowChange: handleFollowChange, onReady: handleReady, onFail: handleFail };

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[rgba(4,16,23,0.85)]">
      {/* ম্যাপ হেডার: শিরোনাম, ইঞ্জিন/পথের ধরন ও লাইভ ব্যাজ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="live-pulse" aria-hidden="true" />
          <p className="text-[0.84rem] font-bold text-white">{t("mapTitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">{engineLabel}</span>
          <span className="chip">{pathInfo?.road ? t("mapRoads") : t("mapStraight")}</span>
          {frame.isSimulated && <span className="chip">{t("demoFeed")}</span>}
          <span className="chip text-[var(--mint)]">{t("liveBadge")}</span>
        </div>
      </div>

      {/* ম্যাপ কনভাস: fixed height, responsive */}
      <div className="relative h-[340px] w-full overflow-hidden bg-[#071b24] sm:h-[460px]">
        {engine === "maplibre" && <MapLibreView {...viewProps} />}
        {engine === "google" && <GoogleMapView {...viewProps} />}
        {engine === "svg" && <SvgMapView bus={bus} frame={frame} path={path} />}

        {/* ৩D ম্যাপ লোড হওয়ার সময় ওভারলে */}
        {engine !== "svg" && !ready && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-[rgba(4,16,23,0.82)] text-[0.82rem] font-semibold text-[#bcd7d9]">
            <span className="flex items-center gap-2"><span className="live-pulse" aria-hidden="true" />{t("mapLoading3d")}</span>
          </div>
        )}

        {/* টুলবার: ৩D/২D, বাস অনুসরণ, পুরো রুট (SVG-তে এগুলো অর্থহীন) */}
        {engine !== "svg" && (
          <div className="absolute left-3 top-3 z-30 flex flex-wrap gap-1.5">
            <button type="button" className={`map-btn ${view3d ? "map-btn-on" : ""}`} aria-pressed={view3d} onClick={() => setView3d((value) => !value)}>
              {view3d ? t("view3d") : t("view2d")}
            </button>
            <button type="button" className={`map-btn ${follow ? "map-btn-on" : ""}`} aria-pressed={follow} onClick={() => setFollow((value) => !value)}>
              {t("followBus")}
            </button>
            <button
              type="button"
              className="map-btn"
              onClick={() => {
                setFollow(false); // পুরো রুট দেখতে অনুসরণ বন্ধ
                setFitTick((value) => value + 1);
              }}
            >
              {t("fitRoute")}
            </button>
          </div>
        )}

        {/* রুট কোড ও অগ্রগতি ব্যাজ */}
        <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-lg border border-[var(--line)] bg-[rgba(4,16,23,0.78)] px-2.5 py-1.5 text-[0.68rem] font-semibold text-[#bcd7d9] backdrop-blur">
          {bus.routeCode} · {frame.progressLabel}
        </div>
      </div>

      {/* ৩D ব্যর্থ হয়ে স্কিম্যাটিক ম্যাপে নামলে জানাই */}
      {fellBack && <p className="border-t border-[var(--line)] bg-amber-400/10 px-4 py-2 text-[0.74rem] text-amber-200">{t("mapFailed3d")}</p>}

      {/* লাইভ পরিসংখ্যান প্যানেল: গতি, পরবর্তী কাউন্টার, ETA, অগ্রগতি */}
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] p-4 sm:grid-cols-4" aria-live="polite">
        <div className="panel px-3 py-2">
          <p className="text-[0.68rem] text-[var(--muted)]">{t("speed")}</p>
          <p className="mt-0.5 text-[0.95rem] font-bold text-white">{frame.speedLabel}</p>
        </div>
        <div className="panel px-3 py-2">
          <p className="text-[0.68rem] text-[var(--muted)]">{t("nextStop")}</p>
          <p className="mt-0.5 truncate text-[0.95rem] font-bold text-[var(--mint)]" title={frame.nextStop}>{frame.nextStop}</p>
        </div>
        <div className="panel px-3 py-2">
          <p className="text-[0.68rem] text-[var(--muted)]">{t("approaching")}</p>
          <p className="mt-0.5 text-[0.95rem] font-bold text-[var(--gold)]">{frame.etaLabel}</p>
        </div>
        <div className="panel px-3 py-2">
          <p className="text-[0.68rem] text-[var(--muted)]">{t("progress")}</p>
          <p className="mt-0.5 text-[0.95rem] font-bold text-white">{frame.progressLabel}</p>
        </div>
      </div>

      {/* অগ্রগতি বার + সিঙ্ক তথ্য: ৫ সেকেন্ড পোলিংয়ের প্রমাণ ব্যবহারকারীকে দেখাই */}
      <div className="px-4 pb-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-gradient-to-r from-[var(--mint)] to-[var(--gold)] transition-[width] duration-1000 ease-linear" style={{ width: `${frame.progressPct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-[var(--muted)]">
          <span>{t("mapNote")}</span>
          <span className="mono text-[#8fb6bb]" data-testid="sync-info">
            {t("lastUpdate")}: {frame.lastSyncedLabel} · sync #{pollCount}
          </span>
        </div>
        {/* নেটওয়ার্ক ত্রুটি হলে ইন্টারফেস ভেঙে না পড়ে সাধারণ বার্তা দেখাই */}
        {error && <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[0.74rem] text-amber-200">{error}</p>}
      </div>
    </div>
  );
}
