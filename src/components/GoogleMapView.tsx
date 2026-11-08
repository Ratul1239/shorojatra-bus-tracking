"use client";
// =====================================================================
// GoogleMapView: Google Maps JavaScript API (ভেক্টর ম্যাপ, tilt ৬৭.৫° ⇒ ৩D বিল্ডিং)
// ---------------------------------------------------------------------
// শুধু তখনই ব্যবহার হয় যখন NEXT_PUBLIC_GOOGLE_MAPS_API_KEY সেট করা আছে।
// বাগ ফিক্স: আগের কোডে `loading=async` সহ সরাসরি `new google.maps.Map` ডাকা হত — এই মোডে
// ক্লাস আগে importLibrary("maps") দিয়ে লোড করতে হয়, নইলে Map undefined। এখন সঠিকভাবে লোড হয়।
// ৩D-র জন্য Map ID লাগে: NEXT_PUBLIC_GOOGLE_MAP_ID না দিলে Google-এর ডেমো ID ব্যবহার হয়।
// key অবৈধ/ব্যর্থ হলে onFail() ⇒ LiveMap স্বয়ংক্রিয়ভাবে OpenStreetMap ৩D-তে নামে।
// =====================================================================

import { useEffect, useRef } from "react"; // React hooks
import { createGlide, lerpAngle } from "@/lib/glide"; // মসৃণ গ্লাইড
import { cumulativeKm, sliceByKm } from "@/lib/geometry"; // রুটের জ্যামিতি
import type { MapViewProps } from "@/components/map-types"; // শেয়ার্ড props
import type { BusDto, LatLng, LiveDto } from "@/lib/types"; // DTO

// Google Maps API-র যে সামান্য অংশ ব্যবহার করি তার নিজস্ব টাইপ (@types লাগে না)।
type GMap = {
  getHeading: () => number | undefined;
  setHeading: (value: number) => void;
  setTilt: (value: number) => void;
  setZoom: (value: number) => void;
  getZoom: () => number | undefined;
  setCenter: (point: LatLng) => void;
  fitBounds: (bounds: unknown, padding?: number) => void;
  addListener: (event: string, handler: () => void) => { remove: () => void };
};
type GPolyline = { setMap: (map: unknown) => void; setPath: (path: LatLng[]) => void };
type GMarker = { position: LatLng | null; map: unknown; content: HTMLElement };
type GoogleApi = {
  maps: {
    importLibrary: (name: string) => Promise<Record<string, unknown>>;
    LatLngBounds: new () => { extend: (point: LatLng) => void };
    Polyline: new (options: Record<string, unknown>) => GPolyline;
  };
};

// window-এ Google-সংক্রান্ত গ্লোবাল প্রপার্টির টাইপ।
declare global {
  interface Window {
    google?: GoogleApi;
    gm_authFailure?: () => void;
    __shoroGoogleMapsReady?: () => void;
  }
}

// ক্লায়েন্ট bundle-এ শুধু NEXT_PUBLIC_* যায়; সার্ভার secret কখনো আসে না।
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "DEMO_MAP_ID"; // ভেক্টর/৩D-র জন্য আবশ্যক

// একই স্ক্রিপ্ট বারবার লোড না করার জন্য মডিউল-লেভেল প্রমিজ (Singleton)।
let googlePromise: Promise<GoogleApi> | null = null;

// Google Maps স্ক্রিপ্ট একবারই <head>-এ যোগ করি; callback দিয়ে ready জানি।
function loadGoogle(): Promise<GoogleApi> {
  if (window.google?.maps) return Promise.resolve(window.google); // আগেই লোড হয়ে থাকলে
  if (googlePromise) return googlePromise; // অন্য ম্যাপ আগেই শুরু করেছে
  googlePromise = new Promise<GoogleApi>((resolve, reject) => {
    window.__shoroGoogleMapsReady = () => resolve(window.google as GoogleApi); // Google এটি কল করবে
    const script = document.createElement("script");
    // `loading=async` ইচ্ছে করেই নেই; ক্লাসগুলো নিচে importLibrary দিয়ে নিই।
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=weekly&callback=__shoroGoogleMapsReady`;
    script.async = true;
    script.onerror = () => {
      googlePromise = null; // ব্যর্থ হলে পরে আবার চেষ্টা করা যাবে
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(script);
  });
  return googlePromise;
}

// ম্যাপ নিয়ন্ত্রণ API (MapLibreView-এর সাথে একই আকার)।
type Api = {
  pushFrame: (frame: LiveDto) => void;
  setPath: (path: LatLng[]) => void;
  setView3d: (on: boolean) => void;
  setFollow: (on: boolean) => void;
  fit: () => void;
  setLabels: (bus: BusDto) => void;
  destroy: () => void;
};

// Google ম্যাপ তৈরি করে Api ফেরত দেয়।
async function createGoogleMap(container: HTMLElement, propsRef: { current: MapViewProps }, isCancelled: () => boolean): Promise<Api | null> {
  const google = await loadGoogle();
  const { Map } = (await google.maps.importLibrary("maps")) as { Map: new (el: HTMLElement, options: Record<string, unknown>) => GMap };
  const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as { AdvancedMarkerElement: new (options: Record<string, unknown>) => GMarker };
  if (isCancelled()) return null; // অপেক্ষার মাঝে unmount হয়ে গেছে

  const init = propsRef.current;
  let bus = init.bus;
  let path = init.path;
  let cum = cumulativeKm(path);
  let latest = init.frame;
  let followOn = init.follow;
  let view3dOn = init.view3d;
  let lastRoute = 0;

  // ভেক্টর ম্যাপ: tilt/heading শুধু ভেক্টর রেন্ডারিংয়ে কাজ করে।
  const map = new Map(container, {
    center: { lat: latest.lat, lng: latest.lng },
    zoom: followOn ? 14 : 8,
    mapId: MAP_ID,
    tilt: view3dOn ? 67.5 : 0, // ৩D কাত
    heading: latest.heading,
    renderingType: "VECTOR",
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
  });

  // রুট রেখা (মিন্ট) ও পেরিয়ে আসা অংশ (সোনালি)।
  const routeLine = new google.maps.Polyline({ path, strokeColor: "#45dfb0", strokeOpacity: 0.95, strokeWeight: 5, map });
  const doneLine = new google.maps.Polyline({ path: [], strokeColor: "#f5bd55", strokeOpacity: 1, strokeWeight: 5, map });

  // বাসের মার্কার: AdvancedMarkerElement ৩D কাত ম্যাপে মাটির সাথে মিলে থাকে।
  const busEl = document.createElement("div");
  busEl.className = "m3d-bus-label m3d-google-bus";
  const refreshLabel = () => {
    busEl.textContent = `${bus.name} → ${latest.nextStop}`; // textContent ⇒ XSS-নিরাপদ
  };
  refreshLabel();
  const busMarker = new AdvancedMarkerElement({ map, position: { lat: latest.lat, lng: latest.lng }, content: busEl, title: bus.name });

  // স্টপের লেবেল মার্কার।
  const stopEls: HTMLElement[] = [];
  const stopMarkers = bus.stops.map((stop, index) => {
    const el = document.createElement("div");
    el.className = `m3d-stop${index === 0 || index === bus.stops.length - 1 ? " m3d-stop-edge" : ""}`;
    el.textContent = stop.name;
    stopEls.push(el);
    return new AdvancedMarkerElement({ map, position: { lat: stop.lat, lng: stop.lng }, content: el });
  });

  // ব্যবহারকারী ম্যাপ টানলে অনুসরণ বন্ধ।
  const dragListener = map.addListener("dragstart", () => {
    if (followOn) {
      followOn = false;
      propsRef.current.onFollowChange(false);
    }
  });

  // গ্লাইড: মার্কার মসৃণভাবে এগোয়; অনুসরণে ক্যামেরা ও দিক বাসের সাথে ঘোরে।
  const glide = createGlide((pose) => {
    busMarker.position = { lat: pose.lat, lng: pose.lng };
    const now = performance.now();
    if (now - lastRoute > 300) {
      doneLine.setPath(sliceByKm(path, cum, pose.km)); // পেরিয়ে আসা পথ
      lastRoute = now;
    }
    if (followOn) {
      map.setCenter({ lat: pose.lat, lng: pose.lng });
      if (view3dOn) map.setHeading(lerpAngle(map.getHeading() ?? 0, pose.heading, 0.05)); // chase-cam
    }
  });
  glide.push({ lat: latest.lat, lng: latest.lng, heading: latest.heading, km: latest.travelledKm });

  propsRef.current.onReady();
  return {
    pushFrame(frame) {
      latest = frame;
      refreshLabel();
      glide.push({ lat: frame.lat, lng: frame.lng, heading: frame.heading, km: frame.travelledKm });
    },
    setPath(next) {
      path = next;
      cum = cumulativeKm(next);
      routeLine.setPath(next);
    },
    setView3d(on) {
      view3dOn = on;
      map.setTilt(on ? 67.5 : 0);
      if (!on) map.setHeading(0);
    },
    setFollow(on) {
      followOn = on;
      if (on && (map.getZoom() ?? 0) < 12) map.setZoom(14); // দূর থেকে অনুসরণে কাছে আনি
    },
    fit() {
      followOn = false;
      const bounds = new google.maps.LatLngBounds();
      path.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 60);
    },
    setLabels(next) {
      bus = next;
      next.stops.forEach((stop, index) => {
        if (stopEls[index]) stopEls[index].textContent = stop.name; // ভাষা বদলালে নাম বদলায়
      });
      refreshLabel();
    },
    destroy() {
      glide.destroy();
      dragListener.remove();
      busMarker.map = null;
      stopMarkers.forEach((marker) => {
        marker.map = null;
      });
      routeLine.setMap(null);
      doneLine.setMap(null);
    },
  };
}

// React কম্পোনেন্ট: MapLibreView-এর সাথে একই props ও একই আচরণ।
export function GoogleMapView(props: MapViewProps) {
  const { bus, frame, path, view3d, follow, fitTick } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const propsRef = useRef<MapViewProps>(props);

  // সর্বশেষ props সংরক্ষণ।
  useEffect(() => {
    propsRef.current = props;
  });

  // ম্যাপ তৈরি (অ্যাসিঙ্ক); অবৈধ key হলে Google gm_authFailure ডাকে ⇒ fallback।
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    window.gm_authFailure = () => propsRef.current.onFail();
    createGoogleMap(container, propsRef, () => cancelled)
      .then((api) => {
        if (!api) return;
        if (cancelled) api.destroy();
        else apiRef.current = api;
      })
      .catch(() => {
        if (!cancelled) propsRef.current.onFail();
      });
    return () => {
      cancelled = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [bus.id]);

  // props → ম্যাপ।
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
