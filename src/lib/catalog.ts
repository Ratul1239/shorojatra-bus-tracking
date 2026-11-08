// =====================================================================
// ক্যাটালগ / সার্চ / DTO সার্ভিস লেয়ার
// ---------------------------------------------------------------------
// Django তে: selectors.py + services.py + serializers.py-এর সমতুল্য।
// নিরাপত্তা: ইউজার ইনপুট কখনো SQL-এ string হিসেবে যায় না; সব ছাঁকা হয়,
// তারপর ক্যাশ করা read model-এর ওপর in-memory ম্যাচিং হয় (SQL injection অসম্ভব)।
// স্কেলিং: PostgreSQL থেকে ৪টি flat SELECT একবার (৬০ সেকেন্ড), তারপর সবকিছু RAM-এ।
//
// এই সংস্করণের বাগ ফিক্স:
//  ১) সার্চ স্কোরিং: "Khulna → Jessore" এখন ঠিক Jessore স্টপ ধরে (আগে জেলা-ম্যাচে Benapole ধরত)।
//  ২) ১ অক্ষরের query ("a" → "b") আর সব রুট ফেরত দেয় না।
//  ৩) DB সাময়িক ব্যর্থ হলে পুরনো (stale) ক্যাটালগ দিয়ে সাইট চলতে থাকে।
//  ৪) লাইভ ক্যাশের race condition (খালি ফ্রেম ফেরত যাওয়া) সরানো হয়েছে।
//  ৫) হোম/সার্চ ফলাফল ২ সেকেন্ড singleflight ক্যাশে — ১০০০ জন একই পেজ চাইলে ১টি গণনা।
// =====================================================================

import { db } from "@/db"; // PostgreSQL/Drizzle ক্লায়েন্ট
import { ensureSeeded } from "@/db/seed"; // প্রথম কলে টেবিল + সিড নিশ্চিত
import { buses as busesTable, routeStops as routeStopsTable, routes as routesTable, stops as stopsTable } from "@/db/schema";
import { buildRouteGeometry, parsePath } from "@/lib/geometry"; // রুটের জ্যামিতি
import { apiLabels, dictionary, localizeNumber, type Lang, type TranslationKey } from "@/lib/i18n";
import { computeLive } from "@/lib/live"; // লাইভ ফ্রেম গণনা
import { ensureRoadGeometry } from "@/lib/road-geometry"; // আসল সড়কের পথ (ব্যাকগ্রাউন্ড)
import { cached } from "@/lib/ttl-cache"; // singleflight TTL ক্যাশ
import type {
  AmenityDto,
  ApiEnvelope,
  BusDto,
  Catalog,
  CatalogBus,
  CatalogRoute,
  CatalogStop,
  StatsDto,
  StopDto,
} from "@/lib/types";

// ক্যাটালগ ক্যাশের অবস্থা: ডেটা, মেয়াদ ও চলমান লোডের প্রমিজ।
type CatalogState = { data?: Catalog; expiresAt: number; loading?: Promise<Catalog> };

// গ্লোবাল ক্যাশ: hot reload / একাধিক বান্ডেলে টিকে থাকার জন্য globalThis।
const globalForCatalog = globalThis as typeof globalThis & { __shoroCatalog?: CatalogState };

const CATALOG_TTL_MS = 60_000; // রুট/বাস মেটাডেটা ৬০ সেকেন্ড ক্যাশ (কদাচিৎ বদলায়)।
const STALE_RETRY_MS = 5_000; // DB ব্যর্থ হলে পুরনো ডেটা দিয়ে চলি, ৫ সেকেন্ড পর আবার চেষ্টা।
const SNAPSHOT_TTL_MS = 2_000; // হোম/সার্চ ফলাফল ২ সেকেন্ড ক্যাশ (লাইভ ডেটা মিশে আছে)।

// ক্যাটালগ অবস্থা lazily তৈরি করি (module evaluation-এ নয়)।
function catalogState(): CatalogState {
  if (!globalForCatalog.__shoroCatalog) globalForCatalog.__shoroCatalog = { expiresAt: 0 };
  return globalForCatalog.__shoroCatalog;
}

// PostgreSQL থেকে পুরো read model তৈরি করি।
async function buildCatalog(): Promise<Catalog> {
  await ensureSeeded(); // ফ্রেশ ডাটাবেজ নিজে থেকে তৈরি হয়
  // চারটি query একসাথে চালাই → মোট latency একটি query-র সমান (Promise.all)।
  const [routeRows, stopRows, routeStopRows, busRows] = await Promise.all([
    db.select().from(routesTable),
    db.select().from(stopsTable),
    db.select().from(routeStopsTable),
    db.select().from(busesTable),
  ]);

  const stopMap = new Map<number, CatalogStop>(); // স্টপ id → স্টপ
  for (const row of stopRows) {
    stopMap.set(row.id, {
      id: row.id,
      slug: row.slug,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      districtEn: row.districtEn,
      districtBn: row.districtBn,
      lat: row.lat,
      lng: row.lng,
    });
  }

  // route_stops কে sequence অনুযায়ী সাজিয়ে route-এর সাথে join করি (JS = zero extra query)।
  const stepsByRoute = new Map<number, { stop: CatalogStop; sequence: number; offsetMinutes: number }[]>();
  for (const row of routeStopRows) {
    const stop = stopMap.get(row.stopId);
    if (!stop) continue; // অপ্রত্যাশিত orphan row নিরাপদে বাদ
    const list = stepsByRoute.get(row.routeId) ?? [];
    list.push({ stop, sequence: row.sequence, offsetMinutes: row.offsetMinutes });
    stepsByRoute.set(row.routeId, list);
  }
  for (const list of stepsByRoute.values()) list.sort((a, b) => a.sequence - b.sequence);

  const catalogRoutes: CatalogRoute[] = routeRows.map((row) => {
    const steps = stepsByRoute.get(row.id) ?? [];
    // জ্যামিতি একবারই গণনা: আসল সড়ক থাকলে সেটি, নাহলে স্টপগুলোর সরলরেখা।
    const geometry = buildRouteGeometry(
      steps.map((step) => ({ lat: step.stop.lat, lng: step.stop.lng })),
      parsePath(row.pathJson),
    );
    return {
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      originEn: row.originEn,
      originBn: row.originBn,
      destinationEn: row.destinationEn,
      destinationBn: row.destinationBn,
      distanceKm: row.distanceKm,
      durationMinutes: row.durationMinutes,
      fareBdt: row.fareBdt,
      steps,
      ...geometry,
    };
  });
  const routeMap = new Map(catalogRoutes.map((route) => [route.id, route]));

  const catalogBuses: CatalogBus[] = [];
  for (const row of busRows) {
    const route = routeMap.get(row.routeId);
    if (!route || route.steps.length < 2) continue; // অবৈধ route_id বা অসম্পূর্ণ রুট বাদ
    catalogBuses.push({
      id: row.id,
      slug: row.slug,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      operatorEn: row.operatorEn,
      operatorBn: row.operatorBn,
      registrationNo: row.registrationNo,
      routeId: row.routeId,
      serviceType: row.serviceType,
      seatCount: row.seatCount,
      amenities: row.amenities,
      ratingX10: row.ratingX10,
      departureTime: row.departureTime,
      isActive: row.isActive,
      accentColor: row.accentColor,
      tripStartMinute: row.tripStartMinute,
      loopSeconds: Math.max(row.loopSeconds, 60), // ০ বা ঋণাত্মক হলে ভাগ-শূন্য এড়াই
      baseSpeedKph: row.baseSpeedKph,
      deviceLat: row.deviceLat,
      deviceLng: row.deviceLng,
      route,
    });
  }
  catalogBuses.sort((a, b) => a.id - b.id);

  return { routes: catalogRoutes, stops: Array.from(stopMap.values()), buses: catalogBuses };
}

// কোনো রুটে আসল সড়ক না থাকলে ব্যাকগ্রাউন্ডে আনি; এনে ফেললে ক্যাটালগ নতুন করে লোড হবে।
function kickRoadGeometry(state: CatalogState, catalog: Catalog): void {
  if (catalog.routes.every((route) => route.hasRoadGeometry)) return; // সবই আছে
  void ensureRoadGeometry().then((updated) => {
    if (updated > 0) state.expiresAt = 0; // পরের রিকোয়েস্টে নতুন জ্যামিতি সহ রিলোড
  });
}

// ক্যাটালগ লোডের পাবলিক এন্ট্রি: ক্যাশ → singleflight → (ব্যর্থ হলে stale)।
export async function loadCatalog(): Promise<Catalog> {
  const state = catalogState();
  if (state.data && Date.now() < state.expiresAt) return state.data; // HIT: DB স্পর্শ নেই
  if (state.loading) return state.loading; // অন্য রিকোয়েস্ট আগেই লোড করছে → একই প্রমিজ শেয়ার
  state.loading = buildCatalog()
    .then((catalog) => {
      state.data = catalog;
      state.expiresAt = Date.now() + CATALOG_TTL_MS;
      kickRoadGeometry(state, catalog); // ব্যাকগ্রাউন্ডে সড়কের জ্যামিতি (ব্লক করে না)
      return catalog;
    })
    .catch((error: unknown) => {
      // বাগ ফিক্স: DB সাময়িক ব্যর্থ হলে পুরনো ডেটা থাকলে সেটি দিয়েই চলি (সাইট বন্ধ হয় না)।
      if (state.data) {
        state.expiresAt = Date.now() + STALE_RETRY_MS;
        return state.data;
      }
      throw error; // একদমই ডেটা নেই ⇒ ত্রুটি ওপরে যাক (503)
    })
    .finally(() => {
      state.loading = undefined; // পরের বার নতুন করে লোড করার সুযোগ
    });
  return state.loading;
}

// ইউজার ইনপুট পরিষ্কার: কন্ট্রোল ক্যারেক্টার/HTML চিহ্ন বাদ + ৮০ অক্ষরের সীমা।
export function cleanInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f<>"'`;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ইউনিকোড-নিরাপদ normalize: বাংলা যুক্তাক্ষর ঠিক রেখে যতিচিহ্ন ও ফাঁকা জায়গা সামলাই।
function normalize(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// প্রচলিত ভিন্ন বানান/সংক্ষেপ → normalize করা স্টপ নাম/slug।
const STOP_ALIASES: Record<string, string> = {
  chittagong: "chattogram",
  ctg: "chattogram",
  dacca: "dhaka",
  dhk: "dhaka",
  comilla: "comilla",
  cumilla: "comilla",
  jashore: "jessore",
  barisal: "barishal",
  bogra: "bogura",
  "cox bazar": "coxs bazar",
  coxsbazar: "coxs bazar",
  "চিটাগং": "চট্টগ্রাম",
  "কুমিল্লা": "comilla",
  "কক্স বাজার": "কক্সবাজার",
};

// একটি স্টপ query-র সাথে কতটা মেলে: ৪ = নাম হুবহু, ৩ = নামের শুরু, ২ = নামে অংশ,
// ১ = শুধু জেলা, ০ = মেলে না। (জেলা-ম্যাচ সবচেয়ে দুর্বল, তাই ভুল স্টপ ধরা পড়ে না।)
function stopScore(stop: CatalogStop, query: string): number {
  const q = normalize(query);
  if (q.length < 2) return 0; // খুব ছোট query সবকিছুর সাথে মিলে যায়, তাই বাতিল
  const alias = STOP_ALIASES[q] ?? q; // বিকল্প বানান
  const names = [stop.nameEn, stop.nameBn, stop.slug].map(normalize);
  const districts = [stop.districtEn, stop.districtBn].map(normalize);
  if (names.some((n) => n === q || n === alias)) return 4;
  if (names.some((n) => n.startsWith(q) || n.startsWith(alias))) return 3;
  if (q.length >= 3 && names.some((n) => n.includes(q) || n.includes(alias))) return 2;
  if (districts.some((d) => d === q || d === alias)) return 1;
  return 0;
}

// রুটের ধাপগুলোর মধ্যে সবচেয়ে ভালো ম্যাচের অবস্থান; সমান স্কোরে from ⇒ প্রথম, to ⇒ শেষ।
function findStepIndex(steps: CatalogRoute["steps"], query: string, preferLast: boolean): number {
  const scores = steps.map((step) => stopScore(step.stop, query));
  const best = Math.max(0, ...scores);
  if (best === 0) return -1; // কোনো স্টপই মেলেনি
  const indices = scores.flatMap((score, index) => (score === best ? [index] : []));
  return preferLast ? indices[indices.length - 1] : indices[0];
}

// "Dhaka to Khulna" / "ঢাকা থেকে খুলনা" / "Dhaka→Khulna" — এক ইনপুটে দুটি শহর থাকলে ভাগ করি।
export function parseRouteQuery(fromRaw: string, toRaw: string): { from: string; to: string } {
  let from = cleanInput(fromRaw);
  let to = cleanInput(toRaw);
  if (from && !to) {
    const parts = from
      .split(/\s*(?:→|->)\s*|\s+(?:to|থেকে|হয়ে|টু|-|>)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      from = parts[0];
      to = parts[parts.length - 1];
    }
  }
  return { from, to };
}

// স্টপ → স্থানীয়কৃত StopDto (ম্যাপ ও টাইমলাইন উভয় জায়গায় ব্যবহৃত)।
function toStopDto(step: CatalogRoute["steps"][number], lang: Lang, sequence?: number): StopDto {
  const offset = step.offsetMinutes;
  return {
    id: step.stop.id,
    name: lang === "bn" ? step.stop.nameBn : step.stop.nameEn,
    district: lang === "bn" ? step.stop.districtBn : step.stop.districtEn,
    lat: step.stop.lat,
    lng: step.stop.lng,
    sequence: sequence ?? step.sequence,
    offsetMinutes: offset,
    // প্রথম স্টপে "শুরু"/"Start", বাকিতে "+N মিনিট"/"+N min"।
    offsetLabel:
      offset === 0
        ? lang === "bn"
          ? "শুরু"
          : "Start"
        : `+${localizeNumber(offset, lang)} ${lang === "bn" ? "মিনিট" : "min"}`,
  };
}

// সুবিধার কমা-separated key গুলোকে অনূদিত চিপে রূপান্তর করি।
function toAmenities(raw: string, lang: Lang): AmenityDto[] {
  const allowed = ["wifi", "charging", "reclining", "water", "gps"]; // allow-list = নিরাপদ
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((key) => allowed.includes(key))
    .map((key) => ({ key, label: dictionary[lang][key as TranslationKey] ?? key }));
}

// CatalogBus → সম্পূর্ণ স্থানীয়কৃত API DTO (DRF Serializer.to_representation-এর সমান)।
export function toBusDto(
  bus: CatalogBus,
  lang: Lang,
  nowMs: number,
  options?: { matchedFromIndex?: number; matchedToIndex?: number },
): BusDto {
  const t = dictionary[lang];
  const live = computeLive(bus, lang, nowMs); // বিশুদ্ধ গণনা: কোনো I/O নেই
  const allStops = bus.route.steps.map((step) => toStopDto(step, lang));
  const fromIndex = options?.matchedFromIndex ?? 0;
  const toIndex = options?.matchedToIndex ?? bus.route.steps.length - 1;
  // ম্যাচ করা অংশের ক্রম আবার ১ থেকে নম্বর করি (from → to যাত্রার ক্রম)।
  // পারফরম্যান্স: রুট-সার্চ ছাড়া matchedStops পাঠাই না (হোম/ট্র্যাকারে bus.stops-এরই ডুপ্লিকেট হত;
  // BusCard খালি হলে bus.stops-এ fallback করে) ⇒ প্রতিটি পেজের ডেটা প্রায় ৩০% কমে।
  const matchedStops = options
    ? bus.route.steps.slice(fromIndex, toIndex + 1).map((step, index) => toStopDto(step, lang, index + 1))
    : [];
  const hours = Math.floor(bus.route.durationMinutes / 60);
  const minutes = bus.route.durationMinutes % 60;

  return {
    id: bus.id,
    slug: bus.slug,
    name: lang === "bn" ? bus.nameBn : bus.nameEn,
    operator: lang === "bn" ? bus.operatorBn : bus.operatorEn,
    registrationNo: localizeNumber(bus.registrationNo, lang),
    routeId: bus.route.id,
    routeCode: bus.route.code,
    routeName: lang === "bn" ? bus.route.nameBn : bus.route.nameEn,
    origin: lang === "bn" ? bus.route.originBn : bus.route.originEn,
    destination: lang === "bn" ? bus.route.destinationBn : bus.route.destinationEn,
    departureTime: bus.departureTime,
    departureLabel: localizeNumber(bus.departureTime, lang),
    serviceType: bus.serviceType === "ac" ? "ac" : "non_ac",
    serviceTypeLabel: bus.serviceType === "ac" ? t.ac : t.nonAc,
    seatCountLabel: `${localizeNumber(bus.seatCount, lang)} ${lang === "bn" ? "টি" : "seats"}`,
    fareLabel: `৳${localizeNumber(bus.route.fareBdt, lang)}`,
    distanceLabel: `${localizeNumber(bus.route.distanceKm, lang)} ${lang === "bn" ? "কিমি" : "km"}`,
    durationLabel: `${localizeNumber(hours, lang)} ${lang === "bn" ? "ঘণ্টা" : "h"} ${localizeNumber(minutes, lang)} ${lang === "bn" ? "মিনিট" : "min"}`,
    ratingX10: bus.ratingX10,
    ratingLabel: `${localizeNumber((bus.ratingX10 / 10).toFixed(1), lang)} ★`,
    amenities: toAmenities(bus.amenities, lang),
    status: bus.isActive ? "active" : "inactive",
    statusLabel: bus.isActive ? t.active : t.inactive,
    isActive: bus.isActive,
    accentColor: bus.accentColor,
    stops: allStops, // পুরো রুটের কাউন্টার ক্রম
    matchedStops, // ইউজার যে অংশ খুঁজেছেন, শুধু সেই ক্রম
    matchedFrom: matchedStops[0]?.name ?? "",
    matchedTo: matchedStops[matchedStops.length - 1]?.name ?? "",
    countersBetween: Math.max(0, matchedStops.length - 2),
    live,
  };
}

// API রেসপন্সের সাধারণ খাম (ভাষা + labels + generatedAt); লাইভ পোলিংয়ে labels বাদ দেওয়া যায়।
export function envelope<T>(
  lang: Lang,
  data: T,
  ttl: number,
  generatedAt?: string,
  withLabels = true,
): ApiEnvelope<T> {
  return {
    language: lang,
    ...(withLabels ? { labels: apiLabels(lang) } : {}), // সম্পূর্ণ বাংলা/ইংরেজি লেবেল
    generatedAt: generatedAt ?? new Date().toISOString(),
    cacheTtlSeconds: ttl,
    data,
  };
}

// হোম পেজের পরিসংখ্যান: সব সংখ্যা ভাষা অনুযায়ী ডিজিটে রূপান্তরিত।
export function getStats(catalog: Catalog, lang: Lang): StatsDto {
  return {
    activeBuses: localizeNumber(catalog.buses.filter((bus) => bus.isActive).length, lang),
    routes: localizeNumber(catalog.routes.length, lang),
    stops: localizeNumber(catalog.stops.length, lang),
    refreshSeconds: localizeNumber(5, lang),
  };
}

// হোম পেজের ডেটা: আজ সচল বাস + লাইভ স্ট্যাটাস + পরিসংখ্যান (২ সেকেন্ড singleflight ক্যাশ)।
export async function getHomeData(lang: Lang): Promise<{ buses: BusDto[]; stats: StatsDto }> {
  const { value } = await cached(`home:${lang}`, SNAPSHOT_TTL_MS, async () => {
    const catalog = await loadCatalog(); // ৬০ সেকেন্ড ক্যাশ
    const now = Date.now();
    return {
      buses: catalog.buses.filter((bus) => bus.isActive).map((bus) => toBusDto(bus, lang, now)),
      stats: getStats(catalog, lang),
    };
  });
  return value;
}

// সার্চের প্যারামিটার: mode allow-list করা, বাকি ইনপুট cleanInput দিয়ে ছাঁকা।
export type SearchParams = { mode: "route" | "name" | "active"; from?: string; to?: string; q?: string };

// সার্চের ফলাফলের ধরন (API তে data হিসেবে যায়)।
export type SearchResult = {
  mode: "route" | "name" | "active";
  from: string;
  to: string;
  q: string;
  count: number;
  countLabel: string;
  title: string;
  subtitle: string;
  results: BusDto[];
  validationMessage: string;
};

// সার্চের মূল গণনা (ক্যাশ করা হয় না — searchBuses ক্যাশ দিয়ে ঘিরে রাখে)।
async function computeSearch(
  mode: SearchParams["mode"],
  parsed: { from: string; to: string },
  q: string,
  lang: Lang,
): Promise<SearchResult> {
  const catalog = await loadCatalog();
  const t = dictionary[lang];
  const now = Date.now();

  // সাধারণ খসড়া: ভুল ইনপুটে খালি ফলাফল + নির্দেশনা বার্তা ফেরত দিই।
  const base: SearchResult = {
    mode,
    from: parsed.from,
    to: parsed.to,
    q,
    count: 0,
    countLabel: "",
    title: t.resultsTitle,
    subtitle: mode === "route" ? t.resultsForRoute : t.resultsForName,
    results: [],
    validationMessage: "",
  };
  // সর্টের সহায়ক: সচল আগে, তারপর রেটিং (সংখ্যাগত) ও ছাড়ার সময়।
  const byQuality = (a: BusDto, b: BusDto) =>
    Number(b.isActive) - Number(a.isActive) || b.ratingX10 - a.ratingX10 || a.departureTime.localeCompare(b.departureTime);

  // ----- ক) রুট ভিত্তিক সার্চ: from ও to একই রুটে ক্রম অনুযায়ী থাকতে হবে -----
  if (mode === "route") {
    if (!parsed.from) return { ...base, validationMessage: t.emptyFrom };
    if (!parsed.to) return { ...base, validationMessage: t.emptyTo };
    if (normalize(parsed.from).length < 2 || normalize(parsed.to).length < 2) {
      return { ...base, validationMessage: t.queryTooShort }; // "a → b" এর মতো ইনপুট বাতিল
    }
    const found: BusDto[] = [];
    for (const route of catalog.routes) {
      const fromIndex = findStepIndex(route.steps, parsed.from, false);
      const toIndex = findStepIndex(route.steps, parsed.to, true);
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= toIndex) continue; // দিক ও ক্রম যাচাই
      for (const bus of catalog.buses) {
        if (bus.routeId !== route.id) continue;
        found.push(toBusDto(bus, lang, now, { matchedFromIndex: fromIndex, matchedToIndex: toIndex }));
      }
    }
    found.sort(byQuality);
    return {
      ...base,
      results: found,
      count: found.length,
      countLabel: `${localizeNumber(found.length, lang)} ${t.resultsCount}`,
      subtitle: `${parsed.from} → ${parsed.to}`,
    };
  }

  // ----- খ) নাম ভিত্তিক সার্চ: বাস/অপারেটর/রেজিস্ট্রেশন -----
  if (mode === "name") {
    if (!q) return { ...base, validationMessage: t.emptyName };
    if (normalize(q).length < 2) return { ...base, validationMessage: t.queryTooShort };
    const needle = normalize(q);
    // শুধু বাস/অপারেটর/রেজিস্ট্রেশনে খুঁজি: রুটের নামের আকস্মিক substring ভুল ফলাফল আনত।
    const found = catalog.buses
      .filter((bus) =>
        [bus.nameEn, bus.nameBn, bus.operatorEn, bus.operatorBn, bus.registrationNo]
          .map(normalize)
          .some((field) => field.includes(needle)),
      )
      .map((bus) => toBusDto(bus, lang, now));
    found.sort((a, b) => byQuality(a, b) || a.name.localeCompare(b.name));
    return {
      ...base,
      results: found,
      count: found.length,
      countLabel: `${localizeNumber(found.length, lang)} ${t.resultsCount}`,
      subtitle: q,
    };
  }

  // ----- গ) fallback: সচল বহর (হোম/API parity) -----
  const found = catalog.buses.filter((bus) => bus.isActive).map((bus) => toBusDto(bus, lang, now));
  return { ...base, results: found, count: found.length, countLabel: `${localizeNumber(found.length, lang)} ${t.resultsCount}` };
}

// মূল সার্চ ফাংশন: ইনপুট ছেঁকে ২ সেকেন্ড singleflight ক্যাশে ফলাফল দিই (সর্বোচ্চ ৪০০ এন্ট্রি)।
export async function searchBuses(params: SearchParams, lang: Lang): Promise<SearchResult> {
  const q = cleanInput(params.q);
  const parsed = parseRouteQuery(params.from ?? "", params.to ?? "");
  const key = `search:${lang}:${params.mode}:${parsed.from}|${parsed.to}|${q}`;
  const { value } = await cached(key, SNAPSHOT_TTL_MS, () => computeSearch(params.mode, parsed, q, lang), 400);
  return value;
}

// slug বা numeric id দিয়ে একটি বাস খোঁজা (ট্র্যাকার পেজের জন্য)।
export async function getBusByKey(key: string, lang: Lang): Promise<BusDto | null> {
  const safe = cleanInput(key);
  const catalog = await loadCatalog();
  const bus = catalog.buses.find((item) => item.slug === safe || String(item.id) === safe);
  if (!bus) return null;
  return toBusDto(bus, lang, Date.now());
}

// একটি রুটের সড়ক-পথ [[lat,lng],...] (ম্যাপ একবার নিয়ে নেয়; দীর্ঘ সময় ক্যাশযোগ্য)।
export async function getRoutePath(
  routeId: number,
): Promise<{ routeId: number; hasRoadGeometry: boolean; path: [number, number][] } | null> {
  const catalog = await loadCatalog();
  const route = catalog.routes.find((item) => item.id === routeId);
  if (!route) return null;
  return {
    routeId: route.id,
    hasRoadGeometry: route.hasRoadGeometry,
    path: route.path.map((point) => [point.lat, point.lng] as [number, number]),
  };
}
