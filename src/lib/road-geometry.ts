// =====================================================================
// আসল সড়কের জ্যামিতি সংগ্রহ (OSRM) — একবার এনে PostgreSQL-এ সংরক্ষণ
// ---------------------------------------------------------------------
// কেন দরকার: স্টপগুলো সরলরেখায় জুড়লে ৩D ম্যাপে বাস নদী/মাঠের ওপর দিয়ে চলত।
// এখন OSRM-এর driving route ব্যবহার হয়, ফলে বাস আসল মহাসড়ক ধরে চলে।
// স্কেলিং/নিরাপত্তা:
//  • ব্যবহারকারীর রিকোয়েস্টে কখনো বাইরের API কল হয় না — কেবল ব্যাকগ্রাউন্ডে, একবার।
//  • ফলাফল DB-তে থাকে (routes.path_json), রিস্টার্টেও আবার আনতে হয় না।
//  • বাইরের ডেটা বিশ্বাস করি না: সংখ্যা/সীমানা (বাংলাদেশের bbox) যাচাই করে তবেই সংরক্ষণ।
//  • OSRM ডেমো সার্ভারের নীতি মেনে ১ রিকোয়েস্ট/সেকেন্ডের বেশি নয়; উল্টো দিকের রুটে
//    একই পথ উল্টে ব্যবহার করি (অর্ধেক কল)। প্রোডাকশনে OSRM_BASE_URL দিয়ে নিজস্ব সার্ভার দিন।
// =====================================================================

import { eq, isNull } from "drizzle-orm"; // query helper
import { db } from "@/db"; // ডাটাবেজ
import { routes as routesTable, routeStops as routeStopsTable, stops as stopsTable } from "@/db/schema"; // টেবিল
import { segmentKm } from "@/lib/geometry"; // দূরত্ব গণনা
import type { LatLng } from "@/lib/types"; // বিন্দুর টাইপ

// OSRM সার্ভারের ঠিকানা (env দিয়ে বদলানো যায়)।
const OSRM_BASE = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
// পথের বিন্দুগুলোর ন্যূনতম ব্যবধান (কিমি): ডেটা ছোট রাখতে (~৫৫০ বিন্দু/৩৩০ কিমি)।
const MIN_SPACING_KM = 0.6;

// প্রসেস-গ্লোবাল অবস্থা: একসাথে একটিমাত্র কাজ + ব্যর্থ হলে পরবর্তী চেষ্টার সময়।
const globalForGeo = globalThis as typeof globalThis & {
  __shoroGeo?: { running?: Promise<number>; retryAfter: number };
};

// ঘুমানোর সহায়ক (OSRM-এর rate limit মানতে)।
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// বাংলাদেশের আনুমানিক bounding box: এর বাইরের বিন্দু সন্দেহজনক ⇒ প্রত্যাখ্যান।
function insideBangladesh(point: LatLng): boolean {
  return point.lat > 20 && point.lat < 27 && point.lng > 87 && point.lng < 93.5;
}

// ঘন পথকে বিরল করি: আগের রাখা বিন্দু থেকে MIN_SPACING_KM দূরের বিন্দুই রাখি (শুরু-শেষ সবসময়)।
function decimate(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (segmentKm(last, points[i]) >= MIN_SPACING_KM) {
      out.push(points[i]);
      last = points[i];
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// OSRM থেকে একটি রুটের সড়ক-পথ আনি; যেকোনো সমস্যায় null (অ্যাপ fallback সরলরেখায় চলবে)।
async function fetchRoad(points: LatLng[]): Promise<LatLng[] | null> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";"); // OSRM-এ lng,lat ক্রম
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000); // ১৫ সেকেন্ডের বেশি অপেক্ষা নয়
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ShoroJatra-demo/1.0" } });
    if (!response.ok) return null; // 4xx/5xx
    const json = (await response.json()) as { routes?: { geometry?: { coordinates?: unknown } }[] };
    const raw = json.routes?.[0]?.geometry?.coordinates; // GeoJSON LineString
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const path: LatLng[] = [];
    for (const item of raw) {
      if (!Array.isArray(item) || typeof item[0] !== "number" || typeof item[1] !== "number") return null;
      const point = { lat: Number(item[1].toFixed(5)), lng: Number(item[0].toFixed(5)) }; // ৫ দশমিক ≈ ১ মিটার
      if (!insideBangladesh(point)) return null; // সীমানার বাইরে ⇒ সন্দেহজনক ডেটা
      path.push(point);
    }
    return decimate(path);
  } catch {
    return null; // নেটওয়ার্ক/টাইমআউট
  } finally {
    clearTimeout(timer);
  }
}

// প্রকৃত কাজ: যে রুটে path_json নেই, শুধু সেগুলোর জন্য সড়ক আনি। ফেরত দিই কতগুলো আপডেট হল।
async function run(): Promise<number> {
  const missing = await db.select({ id: routesTable.id }).from(routesTable).where(isNull(routesTable.pathJson));
  if (missing.length === 0) return 0; // সব রুটে আগেই আছে
  const [stopRows, stepRows, allRoutes] = await Promise.all([
    db.select().from(stopsTable),
    db.select().from(routeStopsTable),
    db.select({ id: routesTable.id, pathJson: routesTable.pathJson }).from(routesTable),
  ]);
  const stopMap = new Map(stopRows.map((s) => [s.id, { lat: s.lat, lng: s.lng }])); // id → স্থানাঙ্ক

  // রুট id → ক্রমানুসারে স্টপ id তালিকা।
  const orderByRoute = new Map<number, number[]>();
  for (const row of [...stepRows].sort((a, b) => a.sequence - b.sequence)) {
    const list = orderByRoute.get(row.routeId) ?? [];
    list.push(row.stopId);
    orderByRoute.set(row.routeId, list);
  }

  // আগে থেকে সংরক্ষিত পথগুলো key (স্টপ-আইডির ক্রম) দিয়ে মনে রাখি — উল্টো রুটে পুনর্ব্যবহারের জন্য।
  const known = new Map<string, LatLng[]>();
  for (const row of allRoutes) {
    if (!row.pathJson) continue;
    try {
      const parsed = (JSON.parse(row.pathJson) as [number, number][]).map(([lat, lng]) => ({ lat, lng }));
      known.set((orderByRoute.get(row.id) ?? []).join("-"), parsed);
    } catch {
      /* ভাঙা JSON উপেক্ষা: নিচে আবার আনা হবে না কারণ route.pathJson NULL নয়; পরে ম্যানুয়ালি মুছুন */
    }
  }

  let updated = 0; // সফল আপডেট
  let calledOsrm = false; // rate limit-এর জন্য
  for (const { id } of missing) {
    const ids = orderByRoute.get(id) ?? [];
    const points = ids.map((stopId) => stopMap.get(stopId)).filter((p): p is LatLng => Boolean(p));
    if (points.length < 2) continue; // অসম্পূর্ণ রুট বাদ
    const key = ids.join("-");
    const reverse = known.get([...ids].reverse().join("-")); // উল্টো রুটের পথ থাকলে উল্টে নিই
    let path: LatLng[] | null = known.get(key) ?? (reverse ? [...reverse].reverse() : null);
    if (!path) {
      if (calledOsrm) await sleep(1100); // OSRM ডেমো নীতি: ≤ ১ রিকোয়েস্ট/সেকেন্ড
      calledOsrm = true;
      path = await fetchRoad(points);
    }
    if (!path) continue; // ব্যর্থ ⇒ এই রুট fallback সরলরেখায় থাকবে, পরে আবার চেষ্টা
    known.set(key, path);
    await db
      .update(routesTable)
      .set({ pathJson: JSON.stringify(path.map((p) => [p.lat, p.lng])) })
      .where(eq(routesTable.id, id));
    updated += 1;
  }
  return updated;
}

// বাইরের এন্ট্রিপয়েন্ট: singleflight + ব্যর্থ হলে ১০ মিনিট পর পুনরায় চেষ্টা।
export function ensureRoadGeometry(): Promise<number> {
  if (!globalForGeo.__shoroGeo) globalForGeo.__shoroGeo = { retryAfter: 0 };
  const state = globalForGeo.__shoroGeo;
  if (state.running) return state.running; // ইতিমধ্যে চলছে
  if (Date.now() < state.retryAfter) return Promise.resolve(0); // সদ্য ব্যর্থ, এখন নয়
  state.running = run()
    .then((updated) => {
      state.retryAfter = Date.now() + 10 * 60_000; // সফল/আংশিক হলেও ১০ মিনিটের আগে আর নয়
      return updated;
    })
    .catch(() => {
      state.retryAfter = Date.now() + 10 * 60_000;
      return 0;
    })
    .finally(() => {
      state.running = undefined;
    });
  return state.running;
}
