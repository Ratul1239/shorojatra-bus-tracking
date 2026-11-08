// =====================================================================
// শেয়ার্ড TypeScript DTO (Data Transfer Object)
// ---------------------------------------------------------------------
// Django DRF-এর Serializer-এর মতো: API কনট্র্যাক্ট এখানে এক জায়গায় সংজ্ঞায়িত।
// ফ্রন্টএন্ড ও ব্যাকএন্ড একই টাইপ ব্যবহার করায় ভাষা/ফিল্ডের অমিল হয় না।
// =====================================================================

import type { Lang, TranslationKey } from "@/lib/i18n";

// একটি ভৌগোলিক বিন্দু (অক্ষাংশ, দ্রাঘিমাংশ)।
export type LatLng = { lat: number; lng: number };

// একটি কাউন্টারের কাঁচা তথ্য (দুই ভাষার নাম + ম্যাপের স্থানাঙ্ক)।
export type CatalogStop = {
  id: number;
  slug: string;
  nameEn: string;
  nameBn: string;
  districtEn: string;
  districtBn: string;
  lat: number;
  lng: number;
};

// রুটের একটি ধাপ: কোন স্টপ, কত নম্বর ক্রমে, কত মিনিটে পৌঁছাবে।
export type RouteStep = {
  stop: CatalogStop;
  sequence: number;
  offsetMinutes: number;
};

// রুট + তার সাজানো কাউন্টার-ক্রম + আগে থেকে গণনা করা জ্যামিতি (প্রতি রিকোয়েস্টে গণনা নয়)।
export type CatalogRoute = {
  id: number;
  code: string;
  nameEn: string;
  nameBn: string;
  originEn: string;
  originBn: string;
  destinationEn: string;
  destinationBn: string;
  distanceKm: number;
  durationMinutes: number;
  fareBdt: number;
  steps: RouteStep[];
  path: LatLng[]; // বাস যে পথ ধরে চলে (আসল সড়ক অথবা fallback সরলরেখা)
  pathCumKm: number[]; // path-এর প্রতিটি বিন্দু পর্যন্ত cumulative কিমি
  stopCumKm: number[]; // প্রতিটি স্টপ path-এর কত কিমিতে পড়ে
  totalKm: number; // path-এর মোট দৈর্ঘ্য
  hasRoadGeometry: boolean; // আসল সড়কের জ্যামিতি আছে কি না
};

// বাস + তার রুটের রেফারেন্স (DB row-কে enriched করা হয়েছে)।
export type CatalogBus = {
  id: number;
  slug: string;
  nameEn: string;
  nameBn: string;
  operatorEn: string;
  operatorBn: string;
  registrationNo: string;
  routeId: number;
  serviceType: string;
  seatCount: number;
  amenities: string;
  ratingX10: number;
  departureTime: string;
  isActive: boolean;
  accentColor: string;
  tripStartMinute: number;
  loopSeconds: number;
  baseSpeedKph: number;
  deviceLat: number;
  deviceLng: number;
  route: CatalogRoute;
};

// পুরো ক্যাটালগ: ৬০ সেকেন্ডের জন্য ইন-মেমরি ক্যাশে থাকা read model।
export type Catalog = {
  routes: CatalogRoute[];
  buses: CatalogBus[];
  stops: CatalogStop[];
};

// ম্যাপে দেখানোর জন্য স্থানীয়কৃত স্টপ আইটেম।
export type StopDto = {
  id: number;
  name: string;
  district: string;
  lat: number;
  lng: number;
  sequence: number;
  offsetMinutes: number;
  offsetLabel: string;
};

// লাইভ GPS ফ্রেম: প্রতি ৫ সেকেন্ডে API থেকে আসা ছোট JSON অবজেক্ট।
export type LiveDto = {
  busId: number;
  lat: number;
  lng: number;
  heading: number; // ডিগ্রি, উত্তর = ০, ঘড়ির কাঁটার দিকে
  speedKph: number;
  speedLabel: string;
  travelledKm: number; // রুটের শুরু থেকে অতিক্রান্ত দূরত্ব (ম্যাপে "পেরিয়ে আসা পথ" আঁকতে)
  progressPct: number;
  progressLabel: string;
  nextStop: string;
  etaLabel: string;
  status: "active" | "inactive";
  statusLabel: string;
  lastSyncedAt: string;
  lastSyncedLabel: string;
  isSimulated: boolean;
};

// সুবিধার আইটেম (key + অনূদিত লেবেল), UI চিপ হিসেবে দেখানো হয়।
export type AmenityDto = { key: string; label: string };

// একটি বাসের সম্পূর্ণ স্থানীয়কৃত রেসপন্স (DRF serializer-এর output)।
export type BusDto = {
  id: number;
  slug: string;
  name: string;
  operator: string;
  registrationNo: string;
  routeId: number;
  routeCode: string;
  routeName: string;
  origin: string;
  destination: string;
  departureTime: string;
  departureLabel: string;
  serviceType: "ac" | "non_ac"; // ভাষা-নিরপেক্ষ মান (ফিল্টার/সর্টের জন্য)
  serviceTypeLabel: string;
  seatCountLabel: string;
  fareLabel: string;
  distanceLabel: string;
  durationLabel: string;
  ratingX10: number; // সংখ্যাগত রেটিং ×১০ (সর্টের জন্য)
  ratingLabel: string;
  amenities: AmenityDto[];
  status: "active" | "inactive";
  statusLabel: string;
  isActive: boolean;
  accentColor: string;
  stops: StopDto[];
  matchedStops: StopDto[];
  matchedFrom: string;
  matchedTo: string;
  countersBetween: number;
  live: LiveDto;
};

// API রেসপন্সের সাধারণ খাম: ভাষা, labels ও তৈরির সময় সব এন্ডপয়েন্টে একই।
// labels ঐচ্ছিক: ৫ সেকেন্ডের লাইভ পোলিংয়ে ~৬KB labels প্রতিবার পাঠানো অপচয়, তাই বাদ দেওয়া যায়।
export type ApiEnvelope<T> = {
  language: Lang;
  labels?: Record<TranslationKey, string>;
  generatedAt: string;
  cacheTtlSeconds: number;
  data: T;
};

// হোম পেজের পরিসংখ্যান (স্থানীয়কৃত স্ট্রিং হিসেবে পাঠানো হয়)।
export type StatsDto = {
  activeBuses: string;
  routes: string;
  stops: string;
  refreshSeconds: string;
};
