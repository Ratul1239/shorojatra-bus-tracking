// =====================================================================
// জ্যামিতি হেল্পার (Pure functions — সার্ভার ও ব্রাউজার উভয়ে ব্যবহারযোগ্য)
// ---------------------------------------------------------------------
// • রুটের পলিলাইন → cumulative দূরত্ব (একবারই গণনা, ক্যাটালগ লোডের সময়)
// • দূরত্ব (কিমি) → ঠিক সেই বিন্দুর lat/lng + heading (binary search, O(log n))
// • স্টপগুলো সড়কের কত কিমিতে পড়ে (পরবর্তী কাউন্টার নির্ণয়ের জন্য)
// এই কোড live.ts (সার্ভার) এবং ম্যাপ কম্পোনেন্টে (ক্লায়েন্ট) একই ফল দেয়।
// =====================================================================

import type { LatLng } from "@/lib/types"; // বিন্দুর টাইপ

// দুই বিন্দুর মাঝের আনুমানিক দূরত্ব (কিমি) — equirectangular approximation।
// ম্যাপ মার্কারের জন্য যথেষ্ট নির্ভুল, haversine-এর চেয়ে সস্তা।
export function segmentKm(a: LatLng, b: LatLng): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180); // গড় অক্ষাংশ radian-এ
  const dx = (b.lng - a.lng) * 111.32 * Math.cos(midLat); // দ্রাঘিমাংশ → কিমি
  const dy = (b.lat - a.lat) * 110.57; // অক্ষাংশ → কিমি
  return Math.sqrt(dx * dx + dy * dy); // পিথাগোরাস
}

// পলিলাইনের প্রতিটি বিন্দু পর্যন্ত cumulative কিমি: [0, d1, d1+d2, ...]।
export function cumulativeKm(path: LatLng[]): number[] {
  const cum: number[] = [0]; // শুরুতে ০ কিমি
  for (let i = 0; i < path.length - 1; i += 1) {
    cum.push(cum[i] + segmentKm(path[i], path[i + 1])); // আগের যোগফল + এই সেগমেন্ট
  }
  return cum;
}

// DB-তে JSON হিসেবে রাখা [[lat,lng],...] কে নিরাপদে পার্স করি (অবৈধ হলে null)।
export function parsePath(raw: string | null | undefined): LatLng[] | null {
  if (!raw) return null; // কিছু নেই
  try {
    const data: unknown = JSON.parse(raw); // JSON পার্স
    if (!Array.isArray(data) || data.length < 2) return null; // কমপক্ষে ২ বিন্দু লাগবে
    const out: LatLng[] = [];
    for (const item of data) {
      // প্রতিটি উপাদান [number, number] কি না যাচাই — বাইরের ডেটা বিশ্বাস করি না।
      if (!Array.isArray(item) || typeof item[0] !== "number" || typeof item[1] !== "number") return null;
      if (!Number.isFinite(item[0]) || !Number.isFinite(item[1])) return null;
      out.push({ lat: item[0], lng: item[1] });
    }
    return out;
  } catch {
    return null; // ভাঙা JSON হলেও অ্যাপ থামে না
  }
}

// রুটের জ্যামিতির সারাংশ: ক্যাটালগ লোডের সময় একবার তৈরি হয়।
export type RouteGeometry = {
  path: LatLng[];
  pathCumKm: number[];
  stopCumKm: number[];
  totalKm: number;
  hasRoadGeometry: boolean;
};

// স্টপের বিন্দু + (ঐচ্ছিক) আসল সড়কের পথ থেকে RouteGeometry বানাই।
export function buildRouteGeometry(stopPoints: LatLng[], roadPath: LatLng[] | null): RouteGeometry {
  const hasRoad = Boolean(roadPath && roadPath.length >= 2); // সড়কের তথ্য আছে কি না
  const path = hasRoad ? (roadPath as LatLng[]) : stopPoints; // না থাকলে স্টপগুলো সোজা জুড়ি
  const pathCumKm = cumulativeKm(path); // cumulative দূরত্ব
  const totalKm = Math.max(pathCumKm[pathCumKm.length - 1] ?? 0, 0.001); // শূন্য দৈর্ঘ্য এড়াই

  const stopCumKm: number[] = []; // প্রতিটি স্টপ পথের কত কিমিতে
  let lastIndex = 0; // ক্রম ঠিক রাখতে: পরের স্টপ আগের স্টপের পেছনে হতে পারে না
  stopPoints.forEach((point, index) => {
    if (!hasRoad) {
      stopCumKm.push(pathCumKm[index]); // fallback-এ path-এর বিন্দুই স্টপ
      return;
    }
    if (index === 0) {
      stopCumKm.push(0); // প্রথম স্টপ = পথের শুরু
      return;
    }
    if (index === stopPoints.length - 1) {
      stopCumKm.push(totalKm); // শেষ স্টপ = পথের শেষ
      return;
    }
    let bestIndex = lastIndex; // নিকটতম বিন্দুর index
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let j = lastIndex; j < path.length; j += 1) {
      const distance = segmentKm(point, path[j]); // স্টপ থেকে path-এর j-তম বিন্দুর দূরত্ব
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = j;
      }
    }
    lastIndex = bestIndex; // পরের স্টপ এখান থেকেই খোঁজা শুরু করবে
    stopCumKm.push(pathCumKm[bestIndex]);
  });

  return { path, pathCumKm, stopCumKm, totalKm, hasRoadGeometry: hasRoad };
}

// দুই বিন্দুর মাঝের দিক (bearing): উত্তর = ০°, পূর্ব = ৯০°।
export function bearing(a: LatLng, b: LatLng): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180); // গড় অক্ষাংশ
  const dx = (b.lng - a.lng) * Math.cos(midLat); // পূর্ব-পশ্চিম অংশ
  const dy = b.lat - a.lat; // উত্তর-দক্ষিণ অংশ
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI; // atan2(পূর্ব, উত্তর)
  return (degrees + 360) % 360; // ০..৩৬০ এ আনি
}

// পথের km-তম বিন্দুর lat/lng (binary search দিয়ে সেগমেন্ট খুঁজে interpolate)।
function pointAt(path: LatLng[], cum: number[], km: number): LatLng {
  const total = cum[cum.length - 1] ?? 0; // মোট দৈর্ঘ্য
  const d = Math.min(Math.max(km, 0), total); // সীমার মধ্যে আটকাই
  let lo = 0; // বাইনারি সার্চের নিচের সীমা
  let hi = Math.max(path.length - 2, 0); // ওপরের সীমা (শেষ সেগমেন্টের শুরু)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1; // মাঝের index (ওপরের দিকে ঝুঁকে)
    if (cum[mid] <= d) lo = mid; // d এই সেগমেন্টের ডানে বা ভেতরে
    else hi = mid - 1; // d বামে
  }
  const a = path[lo]; // সেগমেন্টের শুরু
  const b = path[Math.min(lo + 1, path.length - 1)]; // সেগমেন্টের শেষ
  const length = (cum[lo + 1] ?? cum[lo]) - cum[lo]; // সেগমেন্টের দৈর্ঘ্য
  const ratio = length > 0 ? (d - cum[lo]) / length : 0; // সেগমেন্টের ভগ্নাংশ
  return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
}

// km-তম অবস্থানের lat/lng + স্থিতিশীল heading (±০.২৫ কিমির মধ্যবর্তী দিক)।
export function positionAt(path: LatLng[], cum: number[], km: number): LatLng & { heading: number } {
  const here = pointAt(path, cum, km); // বর্তমান বিন্দু
  const behind = pointAt(path, cum, km - 0.25); // সামান্য পেছনে
  const ahead = pointAt(path, cum, km + 0.25); // সামান্য সামনে
  return { ...here, heading: bearing(behind, ahead) }; // ছোট সেগমেন্টের কাঁপুনি এড়াতে lookahead
}

// শুরু থেকে km পর্যন্ত পথের অংশ (ম্যাপে "পেরিয়ে আসা পথ" সোনালি রঙে আঁকার জন্য)।
export function sliceByKm(path: LatLng[], cum: number[], km: number): LatLng[] {
  if (km <= 0) return path.slice(0, 1); // শুরুতেই থাকলে একটি বিন্দু
  const out: LatLng[] = [];
  for (let i = 0; i < path.length; i += 1) {
    if (cum[i] <= km) out.push(path[i]); // এই বিন্দু পর্যন্ত বাস পৌঁছে গেছে
    else break; // এর পরের বিন্দুগুলো সামনে
  }
  out.push(pointAt(path, cum, km)); // শেষে বাসের হুবহু অবস্থান
  return out;
}
