"use client";
// =====================================================================
// MapLibreView: কোনো API key ছাড়া সত্যিকারের ৩D ম্যাপ (OpenStreetMap + MapLibre GL)
// ---------------------------------------------------------------------
// কী কী ৩D:
//  • কাত করা ক্যামেরা (pitch ৬২°) + আকাশ/কুয়াশা (horizon) ⇒ গভীরতার অনুভূতি
//  • শহরে (zoom ≥ ১৪) আসল বিল্ডিংগুলো উঁচু হয়ে দাঁড়ায় (OpenFreeMap "building-3d")
//  • বাসটি নিজেই একটি ৩D মডেল: বডি + কাচের কেবিন + সাদা ছাদ + হেডলাইট (fill-extrusion)
//  • chase-cam: ক্যামেরা বাসের পেছনে থেকে তার দিকে ঘুরে ঘুরে অনুসরণ করে
// ডেটা: ম্যাপ টাইল OpenFreeMap (বিনামূল্যে, key লাগে না), রুট রেখা আসল সড়কের জ্যামিতি।
// কেন MapLibre: Google Maps key ছাড়া চলে না; MapLibre ওপেন সোর্স, WebGL-এ ৩D রেন্ডার করে।
// ব্যর্থ হলে (WebGL নেই/টাইল সার্ভার অনুপলব্ধ) onFail() ডাকে ⇒ LiveMap স্কিম্যাটিক ম্যাপে নামে।
// =====================================================================

import { useEffect, useRef } from "react"; // React hooks
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl"; // ম্যাপ ইঞ্জিন
import "maplibre-gl/dist/maplibre-gl.css"; // ম্যাপ কনট্রোল ও অ্যাট্রিবিউশনের স্টাইল
import { cumulativeKm, sliceByKm } from "@/lib/geometry"; // রুটের জ্যামিতি
import { createGlide, lerpAngle, type Pose } from "@/lib/glide"; // মসৃণ গ্লাইড
import type { MapViewProps } from "@/components/map-types"; // শেয়ার্ড props
import type { BusDto, LatLng, LiveDto } from "@/lib/types"; // DTO

// বাগ ফিক্স: MapLibre ৬.x তার ওয়ার্কার `import.meta.url` দিয়ে খোঁজে, যা Turbopack বান্ডলে ভেঙে যায়
// ("Worker failed to load")। তাই ওয়ার্কার ফাইলটি public/ থেকে সার্ভ করি এবং URL স্পষ্ট করে দিই।
// ফাইলটি node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs-এর কপি (maplibre-gl আপগ্রেড করলে আবার কপি করুন)।
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

// ম্যাপের স্টাইল URL: ডিফল্ট OpenFreeMap "liberty" (৩D বিল্ডিংসহ); env দিয়ে বদলানো যায়।
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
const PITCH_3D = 62; // ৩D ভিউয়ের ক্যামেরা কাত (ডিগ্রি)
const FOLLOW_ZOOM = 12.5; // অনুসরণ মোডের ডিফল্ট zoom
const BUS_LENGTH_M = 12; // আসল বাসের দৈর্ঘ্য (মিটার)
const BUS_TARGET_PX = 28; // কম zoom-এও বাস যেন অন্তত এত পিক্সেল লম্বা দেখায়

// ম্যাপ নিয়ন্ত্রণের জন্য বাইরে উন্মুক্ত API (React effect গুলো এটি ডাকে)।
type MapApi = {
  pushFrame: (frame: LiveDto) => void;
  setPath: (path: LatLng[]) => void;
  setView3d: (on: boolean) => void;
  setFollow: (on: boolean) => void;
  fit: () => void;
  setLabels: (bus: BusDto) => void;
  destroy: () => void;
};

// খালি GeoJSON FeatureCollection (শুরুতে ও পরিষ্কার করতে)।
const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// একটি LineString ফিচার (রুট/পেরিয়ে আসা পথের জন্য)।
function lineCollection(points: LatLng[]): GeoJSON.FeatureCollection {
  if (points.length < 2) return emptyCollection(); // এক বিন্দুতে রেখা হয় না
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) } },
    ],
  };
}

// মাটির প্রতি পিক্সেলে কত মিটার (Web Mercator সূত্র) — বাসের আকার zoom অনুযায়ী ঠিক করতে।
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

// heading অনুযায়ী ঘোরানো আয়তক্ষেত্র: কেন্দ্র থেকে shiftM মিটার সামনে, length × width মিটার।
function boxRing(lng: number, lat: number, headingDeg: number, shiftM: number, lengthM: number, widthM: number): [number, number][] {
  const h = (headingDeg * Math.PI) / 180; // রেডিয়ানে দিক (উত্তর থেকে ঘড়ির কাঁটার দিকে)
  const fx = Math.sin(h); // সামনের দিকের পূর্ব-উপাদান
  const fy = Math.cos(h); // সামনের দিকের উত্তর-উপাদান
  const rx = Math.cos(h); // ডান দিকের পূর্ব-উপাদান
  const ry = -Math.sin(h); // ডান দিকের উত্তর-উপাদান
  const kLat = 1 / 110540; // মিটার → অক্ষাংশ ডিগ্রি
  const kLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180)); // মিটার → দ্রাঘিমাংশ ডিগ্রি
  const l = lengthM / 2; // অর্ধেক দৈর্ঘ্য
  const w = widthM / 2; // অর্ধেক প্রস্থ
  const corners: [number, number][] = [[l, w], [l, -w], [-l, -w], [-l, w]]; // (সামনে, ডানে) কোণ
  const ring = corners.map(([f, r]) => {
    const ff = f + shiftM; // সামনে-পেছনে সরণ
    return [lng + (ff * fx + r * rx) * kLng, lat + (ff * fy + r * ry) * kLat] as [number, number];
  });
  ring.push(ring[0]); // বহুভুজ বন্ধ করি
  return ring;
}

// বাসের ৩D মডেল: কয়েকটি স্তরিত extrusion (বডি, কাচের কেবিন, ছাদ, হেডলাইট)।
function busModel(pose: Pose, scale: number, accent: string, zoom: number): GeoJSON.FeatureCollection {
  const s = scale; // zoom অনুযায়ী বড় করার গুণক
  // প্রতিটি অংশ: [সরণ, দৈর্ঘ্য, প্রস্থ, ভিত্তি-উচ্চতা, শীর্ষ-উচ্চতা, রং]
  const parts: [number, number, number, number, number, string][] = [
    [0, 12, 2.6, 0, 1.8, accent], // নিচের বডি (বাসের রঙে)
    [-0.4, 10.4, 2.45, 1.8, 3.1, "#14323f"], // কাচের কেবিন (গাঢ় নীল-সবুজ)
    [-0.4, 10.4, 2.45, 3.1, 3.35, "#f4fbfa"], // সাদা ছাদ
    [5.9, 0.5, 2.2, 0.5, 1.2, "#ffe08a"], // সামনের হেডলাইট-বার (দিক বোঝায়)
  ];
  void zoom; // ভবিষ্যতে zoom-ভিত্তিক বিস্তারিততার জন্য সংরক্ষিত
  return {
    type: "FeatureCollection",
    features: parts.map(([shift, length, width, base, top, color]) => ({
      type: "Feature" as const,
      properties: { color, b: base * s, h: top * s },
      geometry: { type: "Polygon" as const, coordinates: [boxRing(pose.lng, pose.lat, pose.heading, shift * s, length * s, width * s)] },
    })),
  };
}

// ম্যাপ তৈরি ও নিয়ন্ত্রণ API ফেরত দেয় (WebGL না থাকলে null)।
function createMap(container: HTMLElement, propsRef: { current: MapViewProps }): MapApi | null {
  setWorkerUrl(WORKER_URL); // ম্যাপ তৈরির আগেই ওয়ার্কারের ঠিকানা জানাই (বারবার ডাকলেও নিরাপদ)
  const init = propsRef.current; // প্রথম props
  let map: MapLibreMap;
  try {
    map = new MapLibreMap({
      container,
      style: STYLE_URL, // OpenFreeMap liberty (৩D বিল্ডিং আছে)
      center: [init.frame.lng, init.frame.lat], // বাসের অবস্থান
      zoom: init.follow ? FOLLOW_ZOOM : 7.5,
      pitch: init.view3d ? PITCH_3D : 0, // কাত ক্যামেরা = ৩D
      bearing: init.follow ? init.frame.heading : -12,
      maxPitch: 80,
      attributionControl: { compact: true }, // OpenFreeMap/OSM অ্যাট্রিবিউশন (লাইসেন্সে আবশ্যক)
    });
  } catch {
    return null; // WebGL অনুপলব্ধ ⇒ ওপরে fallback
  }

  // ---- ভেতরের অবস্থা (closure) ----
  let styleLoaded = false; // স্টাইল লোড শেষ কি না
  let destroyed = false; // ধ্বংস হয়েছে কি না
  let failed = false; // onFail ডাকা হয়েছে কি না
  let bus = init.bus; // বর্তমান বাস DTO
  let path = init.path; // রুটের পলিলাইন
  let cum = cumulativeKm(path); // পলিলাইনের cumulative কিমি
  let latest = init.frame; // সর্বশেষ GPS ফ্রেম
  let followOn = init.follow; // অনুসরণ চালু কি না
  let view3dOn = init.view3d; // ৩D চালু কি না
  let targetZoom = FOLLOW_ZOOM; // অনুসরণে লক্ষ্য zoom
  let targetPitch = init.view3d ? PITCH_3D : 0; // লক্ষ্য pitch
  let blendUntil = 0; // এই সময় পর্যন্ত zoom/pitch ধীরে ধীরে লক্ষ্যে নেওয়া হবে
  let lastDraw = 0; // শেষ বাস-আঁকার সময়
  let lastRoute = 0; // শেষ "পেরিয়ে আসা পথ" আপডেটের সময়
  const stopMarkers: Marker[] = []; // স্টপের লেবেল মার্কার
  const stopLabelEls: HTMLElement[] = []; // লেবেলের DOM (ভাষা বদলাতে)
  let busMarker: Marker | null = null; // বাসের নাম-লেবেল মার্কার
  let busLabelEl: HTMLElement | null = null; // তার DOM

  // স্টাইল না এলে ১২ সেকেন্ড পর হাল ছাড়ি ⇒ fallback।
  const fail = () => {
    if (failed || destroyed) return;
    failed = true;
    propsRef.current.onFail();
  };
  const styleTimer = setTimeout(() => {
    if (!styleLoaded) fail();
  }, 12_000);
  // স্টাইল লোডের আগে কোনো ত্রুটি = স্টাইল সার্ভার অনুপলব্ধ ⇒ সাথে সাথে fallback।
  map.on("error", () => {
    if (!styleLoaded) fail();
  });

  // বাসের নাম + পরবর্তী কাউন্টারের লেবেল আপডেট (textContent ⇒ XSS-নিরাপদ)।
  const refreshBusLabel = () => {
    if (busLabelEl) busLabelEl.textContent = `${bus.name} → ${latest.nextStop}`;
  };

  // বাস আঁকি: ৩D মডেল + মাটির glow + লেবেলের অবস্থান।
  const drawBus = (pose: Pose) => {
    const mpp = metersPerPixel(pose.lat, map.getZoom()); // এই zoom-এ মিটার/পিক্সেল
    const scale = Math.max(1, (BUS_TARGET_PX * mpp) / BUS_LENGTH_M); // কম zoom-এ বড় করে দেখাই
    (map.getSource("bus-3d") as GeoJSONSource | undefined)?.setData(busModel(pose, scale, bus.accentColor, map.getZoom()));
    (map.getSource("bus-pt") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pose.lng, pose.lat] } }],
    });
    busMarker?.setLngLat([pose.lng, pose.lat]);
  };

  // পেরিয়ে আসা পথ (সোনালি) আপডেট।
  const updateDone = (km: number) => {
    (map.getSource("route-done") as GeoJSONSource | undefined)?.setData(lineCollection(sliceByKm(path, cum, km)));
  };

  // chase-cam: কেন্দ্র বাসে লক, দিক ধীরে ধীরে বাসের heading-এ ঘোরে।
  const followCamera = (pose: Pose, now: number) => {
    const blending = now < blendUntil; // zoom/pitch রূপান্তর চলছে কি না
    const bearing = lerpAngle(map.getBearing(), pose.heading, 0.06); // নরম ঘূর্ণন
    map.jumpTo({
      center: [pose.lng, pose.lat],
      bearing,
      ...(blending
        ? {
            zoom: map.getZoom() + (targetZoom - map.getZoom()) * 0.1,
            pitch: map.getPitch() + (targetPitch - map.getPitch()) * 0.1,
          }
        : {}),
    });
  };

  // গ্লাইড: প্রতি অ্যানিমেশন ফ্রেমে বাস আঁকা, পথ আপডেট, প্রয়োজনে ক্যামেরা অনুসরণ।
  const glide = createGlide((pose, done) => {
    if (!styleLoaded || destroyed) return;
    const now = performance.now();
    if (done || now - lastDraw > 32) {
      drawBus(pose); // ≈৩০fps যথেষ্ট (GeoJSON setData ভারী নয়)
      lastDraw = now;
    }
    if (done || now - lastRoute > 250) {
      updateDone(pose.km);
      lastRoute = now;
    }
    if (followOn) followCamera(pose, now);
  });

  // GPS ফ্রেম → Pose।
  const poseOf = (frame: LiveDto): Pose => ({ lat: frame.lat, lng: frame.lng, heading: frame.heading, km: frame.travelledKm });

  // পুরো রুট ফ্রেমে আনি (অ্যানিমেশনসহ বা ছাড়া)।
  const fitRoute = (animate: boolean) => {
    const bounds = new LngLatBounds();
    for (const p of path) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 60, left: 50, right: 50 },
      pitch: view3dOn ? 55 : 0,
      bearing: view3dOn ? -18 : 0,
      duration: animate ? 1300 : 0,
      maxZoom: 11,
    });
  };

  // ব্যবহারকারী নিজে ম্যাপ টানলে/ঘোরালে অনুসরণ বন্ধ (প্রোগ্রাম-চালিত নড়াচড়ায় originalEvent নেই)।
  const userMoved = (event: { originalEvent?: unknown }) => {
    if (event.originalEvent && followOn) {
      followOn = false;
      propsRef.current.onFollowChange(false);
    }
  };
  map.on("dragstart", userMoved);
  map.on("rotatestart", userMoved);
  map.on("pitchstart", userMoved);
  // zoom বদলালে বাসের আকার নতুন করে হিসাব (গ্লাইড বন্ধ থাকলেও)।
  map.on("zoom", () => {
    const pose = glide.current();
    const now = performance.now();
    if (pose && styleLoaded && now - lastDraw > 32) {
      drawBus(pose);
      lastDraw = now;
    }
  });

  // স্টাইল লোড হলে: আকাশ, রুট, স্টপ, ৩D বাস, মার্কার সব যোগ করি।
  map.on("style.load", () => {
    if (destroyed) return;
    styleLoaded = true;
    clearTimeout(styleTimer);

    // আকাশ ও দিগন্ত-কুয়াশা: কাত ক্যামেরায় ৩D গভীরতা বাড়ায় (ব্যর্থ হলে উপেক্ষা)।
    try {
      map.setSky({
        "sky-color": "#8fcdf5",
        "horizon-color": "#eaf4fb",
        "fog-color": "#dfeaf3",
        "sky-horizon-blend": 0.55,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.25,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
      });
    } catch {
      /* পুরনো রেন্ডারারে sky নেই — ছাড়াই চলবে */
    }

    // লেবেল (শহরের নাম)-এর নিচে রুট বসাই, যাতে নাম ঢাকা না পড়ে।
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    const width = ["interpolate", ["linear"], ["zoom"], 6, 2.5, 14, 6] as unknown as number; // zoom-ভিত্তিক রেখার প্রস্থ
    const casingWidth = ["interpolate", ["linear"], ["zoom"], 6, 5, 14, 12] as unknown as number;

    map.addSource("route", { type: "geojson", data: lineCollection(path) });
    map.addSource("route-done", { type: "geojson", data: emptyCollection() });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#04141b", "line-width": casingWidth, "line-opacity": 0.78 } }, firstSymbol);
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#45dfb0", "line-width": width } }, firstSymbol);
    map.addLayer({ id: "route-done-line", type: "line", source: "route-done", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f5bd55", "line-width": width } }, firstSymbol);

    // স্টপের বিন্দু (প্রান্তের দুটি সোনালি, মাঝেরগুলো মিন্ট)।
    map.addSource("stops", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: bus.stops.map((stop, index) => ({
          type: "Feature" as const,
          properties: { edge: index === 0 || index === bus.stops.length - 1 },
          geometry: { type: "Point" as const, coordinates: [stop.lng, stop.lat] },
        })),
      },
    });
    map.addLayer({
      id: "stops-dot",
      type: "circle",
      source: "stops",
      paint: {
        "circle-radius": ["case", ["get", "edge"], 8, 6],
        "circle-color": "#0b1b26",
        "circle-stroke-color": ["case", ["get", "edge"], "#f5bd55", "#45dfb0"],
        "circle-stroke-width": 3,
      },
    }, firstSymbol);

    // বাসের glow (মাটির সমতলে শুয়ে থাকে ⇒ ৩D-তে বাসের নিচে ছায়ার মতো) + ৩D মডেল।
    map.addSource("bus-pt", { type: "geojson", data: emptyCollection() });
    map.addSource("bus-3d", { type: "geojson", data: emptyCollection() });
    map.addLayer({ id: "bus-glow", type: "circle", source: "bus-pt", paint: { "circle-radius": 26, "circle-color": bus.accentColor, "circle-opacity": 0.3, "circle-blur": 0.8, "circle-pitch-alignment": "map" } });
    map.addLayer({
      id: "bus-3d",
      type: "fill-extrusion",
      source: "bus-3d",
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": ["get", "b"],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    // স্টপের নাম-লেবেল: HTML মার্কার (ব্রাউজারের ফন্ট ⇒ বাংলা অক্ষর নিখুঁত)।
    bus.stops.forEach((stop, index) => {
      const el = document.createElement("div");
      el.className = `m3d-stop${index === 0 || index === bus.stops.length - 1 ? " m3d-stop-edge" : ""}`;
      el.textContent = stop.name; // textContent ⇒ XSS অসম্ভব
      stopLabelEls.push(el);
      stopMarkers.push(new Marker({ element: el, anchor: "bottom", offset: [0, -12] }).setLngLat([stop.lng, stop.lat]).addTo(map));
    });

    // বাসের লেবেল মার্কার।
    busLabelEl = document.createElement("div");
    busLabelEl.className = "m3d-bus-label";
    busMarker = new Marker({ element: busLabelEl, anchor: "bottom", offset: [0, -34] }).setLngLat([latest.lng, latest.lat]).addTo(map);
    refreshBusLabel();

    // প্রথম অবস্থান বসাই; অনুসরণ বন্ধ থাকলে পুরো রুট দেখাই।
    glide.push(poseOf(latest));
    if (!followOn) fitRoute(false);
    propsRef.current.onReady();
  });

  // কন্টেইনারের আকার বদলালে ম্যাপ রিসাইজ।
  const observer = new ResizeObserver(() => map.resize());
  observer.observe(container);

  // ---- বাইরে উন্মুক্ত নিয়ন্ত্রণ ----
  return {
    pushFrame(frame) {
      latest = frame;
      if (!styleLoaded) return; // লোডের পর প্রথম pose বসবে
      refreshBusLabel();
      glide.push(poseOf(frame)); // নতুন ফ্রেম পর্যন্ত গড়িয়ে যাও
    },
    setPath(next) {
      path = next;
      cum = cumulativeKm(next);
      if (!styleLoaded) return;
      (map.getSource("route") as GeoJSONSource | undefined)?.setData(lineCollection(next));
    },
    setView3d(on) {
      view3dOn = on;
      targetPitch = on ? PITCH_3D : 0;
      if (!styleLoaded) return;
      if (followOn) {
        blendUntil = performance.now() + 1600; // অনুসরণে ধীরে ধীরে pitch বদলাই
        glide.keepAlive(1700);
      } else {
        map.easeTo({ pitch: targetPitch, bearing: on ? map.getBearing() : 0, duration: 800 });
      }
    },
    setFollow(on) {
      followOn = on;
      if (!on || !styleLoaded) return;
      targetZoom = map.getZoom() < 10 ? FOLLOW_ZOOM : map.getZoom(); // ব্যবহারকারী জুম করা থাকলে সেটাই রাখি
      blendUntil = performance.now() + 1900;
      glide.keepAlive(2000);
    },
    fit() {
      followOn = false;
      if (styleLoaded) fitRoute(true);
    },
    setLabels(next) {
      bus = next;
      next.stops.forEach((stop, index) => {
        if (stopLabelEls[index]) stopLabelEls[index].textContent = stop.name; // ভাষা বদলালে নাম বদলায়
      });
      refreshBusLabel();
    },
    destroy() {
      destroyed = true;
      clearTimeout(styleTimer);
      glide.destroy();
      observer.disconnect();
      stopMarkers.forEach((marker) => marker.remove());
      busMarker?.remove();
      map.remove(); // WebGL context মুক্ত করি (memory leak নেই)
    },
  };
}

// React কম্পোনেন্ট: ম্যাপ একবার তৈরি, তারপর props বদলালে API ডাকে (ম্যাপ নতুন করে বানায় না)।
export function MapLibreView(props: MapViewProps) {
  const { bus, frame, path, view3d, follow, fitTick } = props;
  const containerRef = useRef<HTMLDivElement | null>(null); // ম্যাপের কনটেইনার
  const apiRef = useRef<MapApi | null>(null); // নিয়ন্ত্রণ API
  const propsRef = useRef<MapViewProps>(props); // সর্বশেষ props (callback-এর জন্য)

  // প্রতি রেন্ডারের পর সর্বশেষ props সংরক্ষণ (রেন্ডারের সময় ref লেখা নিষিদ্ধ, তাই effect-এ)।
  useEffect(() => {
    propsRef.current = props;
  });

  // ম্যাপ তৈরি (শুধু বাস বদলালে নতুন করে); cleanup-এ WebGL মুক্ত।
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const api = createMap(container, propsRef);
    if (!api) {
      propsRef.current.onFail(); // WebGL নেই
      return;
    }
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [bus.id]);

  // props → ম্যাপ: প্রতিটি আলাদা effect যেন শুধু নিজের পরিবর্তনে চলে।
  useEffect(() => {
    apiRef.current?.pushFrame(frame);
  }, [frame]);
  useEffect(() => {
    apiRef.current?.setPath(path);
  }, [path]);
  useEffect(() => {
    apiRef.current?.setView3d(view3d);
  }, [view3d]);
  useEffect(() => {
    apiRef.current?.setFollow(follow);
  }, [follow]);
  useEffect(() => {
    if (fitTick > 0) apiRef.current?.fit();
  }, [fitTick]);
  useEffect(() => {
    apiRef.current?.setLabels(bus);
  }, [bus]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
