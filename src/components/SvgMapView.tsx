"use client";
// =====================================================================
// SvgMapView: শেষ ভরসার ২D স্কিম্যাটিক ম্যাপ (কোনো বাইরের নির্ভরতা নেই)
// ---------------------------------------------------------------------
// ৩D ম্যাপ চালু না হলে (WebGL নেই / টাইল সার্ভার অনুপলব্ধ / অবৈধ API key) এটি দেখানো হয়,
// ফলে ব্যবহারকারী কোনো অবস্থাতেই ফাঁকা ম্যাপ দেখে না। রুটের স্থানাঙ্ক SVG-তে প্রজেক্ট করা হয়।
// মার্কারের গ্লাইড CSS transition দিয়ে (JavaScript অ্যানিমেশন লাগে না)।
// =====================================================================

import { useMemo } from "react"; // হিসাব মনে রাখতে
import { cumulativeKm, sliceByKm } from "@/lib/geometry"; // রুটের জ্যামিতি
import type { MapViewProps } from "@/components/map-types"; // শেয়ার্ড props

// শুধু যা লাগে সেই props।
type Props = Pick<MapViewProps, "bus" | "frame" | "path">;

export function SvgMapView({ bus, frame, path }: Props) {
  // রুটের সীমানা ও lat/lng → ০..১০০ শতকরা অবস্থানের প্রজেক্টর (path বদলালেই নতুন হিসাব)।
  const geometry = useMemo(() => {
    const lats = path.map((p) => p.lat);
    const lngs = path.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padLat = Math.max((maxLat - minLat) * 0.14, 0.05); // ওপর-নিচে ফাঁকা জায়গা
    const padLng = Math.max((maxLng - minLng) * 0.14, 0.05); // ডানে-বাঁয়ে ফাঁকা জায়গা
    const lowLat = minLat - padLat;
    const highLat = maxLat + padLat;
    const lowLng = minLng - padLng;
    const highLng = maxLng + padLng;
    // lng → x, lat → উল্টো y (ম্যাপে উত্তর ওপরে)।
    const project = (lat: number, lng: number) => ({
      x: ((lng - lowLng) / (highLng - lowLng)) * 100,
      y: (1 - (lat - lowLat) / (highLat - lowLat)) * 100,
    });
    const line = path.map((p) => project(p.lat, p.lng)); // সম্পূর্ণ রুট
    const stops = bus.stops.map((stop) => ({ name: stop.name, ...project(stop.lat, stop.lng) })); // স্টপের বিন্দু
    return { project, line, stops, cum: cumulativeKm(path) };
  }, [path, bus.stops]);

  // পেরিয়ে আসা পথের বিন্দু ও বাসের বর্তমান অবস্থান।
  const done = sliceByKm(path, geometry.cum, frame.travelledKm).map((p) => geometry.project(p.lat, p.lng));
  const marker = geometry.project(frame.lat, frame.lng);
  const toPoints = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="map-grid absolute inset-0 h-full w-full">
      {/* viewBox ০..১০০ + preserveAspectRatio none ⇒ শতকরা স্থানাঙ্ক সরাসরি মেলে */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {/* আলংকারিক নদী রেখা: ম্যাপকে বাংলাদেশের মতো ফিল দেয় */}
        <path d="M-5 78 C 18 62, 30 88, 52 70 S 82 84, 105 60" fill="none" stroke="rgba(120,200,245,0.16)" strokeWidth="2.4" strokeDasharray="1 2" />
        {/* রুটের ছায়া + মূল রেখা + পেরিয়ে আসা সোনালি অংশ */}
        <polyline points={toPoints(geometry.line)} fill="none" stroke="rgba(245,189,85,0.16)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={toPoints(geometry.line)} fill="none" stroke="#45dfb0" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 1.4" />
        <polyline points={toPoints(done)} fill="none" stroke="#f5bd55" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      </svg>

      {/* প্রতিটি কাউন্টার: ছোট ডট + নাম (প্রান্তের দুটো সবসময় দেখা যায়) */}
      {geometry.stops.map((stop, index) => {
        const isEdge = index === 0 || index === geometry.stops.length - 1;
        return (
          <div key={`${stop.name}-${index}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${stop.x}%`, top: `${stop.y}%` }}>
            <div className={`mx-auto rounded-full border ${isEdge ? "h-3 w-3 border-[var(--gold)] bg-[rgba(245,189,85,0.3)]" : "h-2 w-2 border-[var(--mint)] bg-[rgba(69,223,176,0.25)]"}`} />
            <span className={`mt-1 block whitespace-nowrap rounded bg-[rgba(4,16,23,0.78)] px-1 text-[9px] font-medium text-[#bcd7d9] ${isEdge ? "" : "hidden sm:block"}`}>{stop.name}</span>
          </div>
        );
      })}

      {/* বাসের মার্কার: CSS transition-এ ১.২ সেকেন্ডে নতুন অবস্থানে গ্লাইড করে */}
      <div className="bus-marker" style={{ left: `${Math.min(98, Math.max(2, marker.x))}%`, top: `${Math.min(96, Math.max(4, marker.y))}%` }}>
        <span className="absolute -inset-4 animate-ping rounded-full bg-[rgba(69,223,176,0.18)]" aria-hidden="true" />
        <span className="relative grid h-10 w-10 place-items-center rounded-full border-2 border-white/80 bg-[var(--mint)] text-[#04221a] shadow-[0_6px_20px_rgba(69,223,176,0.55)]" title={bus.name}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="13" rx="2.5" />
            <path d="M3 11h18M7 17v2M17 17v2" />
          </svg>
        </span>
        <span className="absolute left-1/2 top-11 -translate-x-1/2 whitespace-nowrap rounded-md bg-[rgba(4,16,23,0.9)] px-2 py-0.5 text-[10px] font-bold text-white shadow">{frame.nextStop}</span>
      </div>
    </div>
  );
}
