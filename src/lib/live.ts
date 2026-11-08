// =====================================================================
// লাইভ GPS ইঞ্জিন (Pure computation — কোনো I/O নেই)
// ---------------------------------------------------------------------
// Django তে এটি Celery/Redis-ভিত্তিক tracker service-এর সমান্তরাল।
// মূল স্কেলিং ধারণা: প্রতিটি ভিউয়ারের জন্য DB তে অবস্থান লিখি না;
// বরং রুটের জ্যামিতি + সময় থেকে অবস্থান "গণনা" করি।
//
// বাগ ফিক্স (আগের সংস্করণের সমস্যা):
//  ১) আগে বাস শেষ স্টপে পৌঁছে উল্টো দিকে ফিরত (ping-pong) — তখন "পরবর্তী কাউন্টার" ভুল
//     দেখাত। এখন বাস সবসময় রুটের দিকেই চলে; গন্তব্যে কিছুক্ষণ থেমে নতুন ট্রিপ শুরু করে।
//  ২) আগে অবস্থানে sin() "কাঁপুনি" ছিল, ফলে ৩D ম্যাপে বাস সড়কের বাইরে চলে যেত। এখন নেই।
//  ৩) আগে প্রতি রিকোয়েস্টে পলিলাইনের দৈর্ঘ্য নতুন করে গণনা হত। এখন ক্যাটালগ লোডের সময়
//     একবার গণনা করা (route.pathCumKm), প্রতি কলে শুধু O(log n) বাইনারি সার্চ।
// =====================================================================

import { dictionary, localizeNumber, type Lang } from "@/lib/i18n"; // অনুবাদ
import { positionAt } from "@/lib/geometry"; // km → lat/lng + heading
import type { Catalog, CatalogBus, LiveDto } from "@/lib/types"; // টাইপ

// গন্তব্যে থামার অংশ: loopSeconds-এর শেষ ৬% সময় বাস টার্মিনালে দাঁড়িয়ে থাকে।
const DWELL_FRACTION = 0.06;

// একটি বাসের বর্তমান লাইভ ফ্রেম বের করার বিশুদ্ধ ফাংশন।
export function computeLive(bus: CatalogBus, lang: Lang, nowMs: number): LiveDto {
  const t = dictionary[lang]; // নির্বাচিত ভাষার লেবেল
  const route = bus.route; // বাসের রুট (আগে থেকে গণনা করা জ্যামিতিসহ)

  // ফেজ: প্রতি বাসের নিজস্ব loopSeconds ও অফসেট ⇒ মার্কারগুলো একসাথে জমাট বাঁধে না।
  const seconds = nowMs / 1000 + bus.tripStartMinute * 37;
  const phase = (((seconds % bus.loopSeconds) + bus.loopSeconds) % bus.loopSeconds) / bus.loopSeconds;
  const movingPart = 1 - DWELL_FRACTION; // চলমান অংশ (বাকিটা টার্মিনালে অপেক্ষা)
  const atDestination = phase >= movingPart; // এখন গন্তব্যে দাঁড়িয়ে আছে কি না
  const progress = atDestination ? 1 : phase / movingPart; // ০ → ১ (শুধু সামনের দিকে)
  const travelledKm = progress * route.totalKm; // শুরু থেকে অতিক্রান্ত দূরত্ব

  // সড়কের পলিলাইনে ঠিক এই km-এর অবস্থান ও দিক (heading)।
  const pos = positionAt(route.path, route.pathCumKm, travelledKm);

  // পরবর্তী কাউন্টার: যে স্টপের দূরত্ব বর্তমান অবস্থানের (০.৩ কিমি) সামনে।
  let nextIndex = route.steps.length - 1; // না পেলে গন্তব্য
  for (let i = 0; i < route.stopCumKm.length; i += 1) {
    if (route.stopCumKm[i] > travelledKm + 0.3) {
      nextIndex = i;
      break;
    }
  }
  const nextStep = route.steps[nextIndex];
  const nextStop = lang === "bn" ? nextStep.stop.nameBn : nextStep.stop.nameEn;

  // গতি: চলমান অবস্থায় বেস গতি ± সামান্য ওঠানামা; গন্তব্যে থাকলে ০।
  const speedKph = atDestination ? 0 : Math.max(28, Math.round(bus.baseSpeedKph + Math.sin(nowMs / 14000 + bus.id) * 7));
  // ETA = বাকি দূরত্ব / গতি (মিনিট); গন্তব্যে পৌঁছালে ০।
  const etaMinutes = atDestination ? 0 : Math.max(1, Math.round(((route.totalKm - travelledKm) / Math.max(speedKph, 1)) * 60));
  const progressPct = Math.round(progress * 100);

  // সব মানব-পাঠযোগ্য স্ট্রিং এখানেই ভাষান্তরিত ⇒ API রেসপন্স সম্পূর্ণ স্থানীয়কৃত।
  return {
    busId: bus.id,
    lat: Number(pos.lat.toFixed(5)),
    lng: Number(pos.lng.toFixed(5)),
    heading: Number(pos.heading.toFixed(1)),
    speedKph,
    speedLabel: `${localizeNumber(speedKph, lang)} ${lang === "bn" ? "কিমি/ঘণ্টা" : "km/h"}`,
    travelledKm: Number(travelledKm.toFixed(3)),
    progressPct,
    progressLabel: `${localizeNumber(progressPct, lang)}%`,
    nextStop,
    etaLabel: `≈ ${localizeNumber(etaMinutes, lang)} ${lang === "bn" ? "মিনিট" : "min"}`,
    status: bus.isActive ? "active" : "inactive",
    statusLabel: bus.isActive ? t.active : t.inactive,
    lastSyncedAt: new Date(nowMs).toISOString(),
    lastSyncedLabel: localizeNumber(new Date(nowMs).toISOString().slice(11, 19), lang),
    isSimulated: true, // ডেমো GPS ফিড; প্রোডাকশনে ডিভাইস পিং দিয়ে প্রতিস্থাপনযোগ্য
  };
}

// এক বা সব বাসের লাইভ ফ্রেম তৈরি করি (একই nowMs ⇒ সব মার্কার সামঞ্জস্যপূর্ণ)।
export function computeLiveFrames(catalog: Catalog, lang: Lang, busId: number | null, nowMs: number): LiveDto[] {
  // busId দিলে শুধু সেইটিই গণনা করি (ট্র্যাকিং পেজের হালকা পেলোড)।
  const selection = busId === null ? catalog.buses : catalog.buses.filter((bus) => bus.id === busId);
  return selection.map((bus) => computeLive(bus, lang, nowMs));
}
