// =====================================================================
// Glide: প্রতি ৫ সেকেন্ডের GPS ফ্রেমের মাঝে বাসকে মসৃণভাবে এগিয়ে নেওয়ার অ্যানিমেশন ইঞ্জিন
// ---------------------------------------------------------------------
// সার্ভার ৫ সেকেন্ডে একবার অবস্থান দেয়; ব্রাউজার requestAnimationFrame দিয়ে মাঝের
// ফ্রেমগুলো interpolate করে — ফলে মার্কার "লাফায়" না, ঝরঝরে গড়িয়ে চলে।
// ডেটা ফ্রেম কম (নেটওয়ার্ক সাশ্রয়), অথচ চোখে ৬০fps — ১০০০+ ইউজারে সার্ভারের বাড়তি খরচ শূন্য।
// React-মুক্ত (pure TS) তাই MapLibre ও Google উভয় ভিউ একই ইঞ্জিন ব্যবহার করে।
// =====================================================================

import { segmentKm } from "@/lib/geometry"; // দূরত্ব গণনা (jump শনাক্তকরণে)

// বাসের একটি "ভঙ্গি": অবস্থান + দিক + রুটে অতিক্রান্ত কিমি।
export type Pose = { lat: number; lng: number; heading: number; km: number };

// দুই কোণের মাঝে সংক্ষিপ্ততম পথে interpolate (যেমন ৩৫০° → ১০° মানে +২০°, -৩৪০° নয়)।
export function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180; // -১৮০..+১৮০ ব্যবধান
  return (from + delta * t + 360) % 360;
}

// Glide ইঞ্জিনের পাবলিক ইন্টারফেস।
export type Glide = {
  push: (next: Pose) => void; // নতুন GPS ফ্রেম এসেছে: এখান থেকে সেখানে গড়াও
  current: () => Pose | null; // এই মুহূর্তে দেখানো ভঙ্গি
  keepAlive: (ms: number) => void; // অন্তত এত ms লুপ চালু রাখো (ক্যামেরা blend-এর জন্য)
  destroy: () => void; // লুপ বন্ধ (unmount-এ)
};

// গ্লাইড তৈরি: onStep প্রতিটি অ্যানিমেশন ফ্রেমে (≈৬০fps) বর্তমান ভঙ্গি পায়।
export function createGlide(onStep: (pose: Pose, done: boolean) => void, durationMs = 4800): Glide {
  let from: Pose | null = null; // গ্লাইডের শুরুর ভঙ্গি
  let to: Pose | null = null; // গ্লাইডের গন্তব্য ভঙ্গি
  let shown: Pose | null = null; // বর্তমানে দেখানো ভঙ্গি
  let startedAt = 0; // গ্লাইড শুরুর সময় (performance.now)
  let duration = durationMs; // এই গ্লাইডের দৈর্ঘ্য
  let aliveUntil = 0; // এই সময় পর্যন্ত লুপ চালু থাকবে
  let raf = 0; // requestAnimationFrame id
  let destroyed = false; // ধ্বংস হয়েছে কি না

  // প্রতি অ্যানিমেশন ফ্রেমে চলে।
  const tick = (now: number) => {
    raf = 0; // এই ফ্রেম শেষ; নিচে দরকার হলে আবার নেব
    if (destroyed || !from || !to) return;
    const p = Math.min(1, Math.max(0, (now - startedAt) / duration)); // ০..১ অগ্রগতি (linear = ধ্রুব গতি)
    shown = {
      lat: from.lat + (to.lat - from.lat) * p,
      lng: from.lng + (to.lng - from.lng) * p,
      heading: lerpAngle(from.heading, to.heading, p),
      km: from.km + (to.km - from.km) * p,
    };
    const done = p >= 1; // গ্লাইড শেষ কি না
    onStep(shown, done);
    if (!done || now < aliveUntil) raf = requestAnimationFrame(tick); // দরকার থাকলে চালিয়ে যাই
  };

  // লুপ চালু না থাকলে চালু করি।
  const ensureLoop = () => {
    if (!raf && !destroyed) raf = requestAnimationFrame(tick);
  };

  return {
    push(next) {
      const now = performance.now();
      if (!shown) {
        // প্রথম ফ্রেম: গ্লাইড নয়, সরাসরি বসাই।
        from = next;
        to = next;
        shown = next;
        startedAt = now;
        duration = 1;
        ensureLoop();
        return;
      }
      // নতুন ট্রিপ শুরু (বাস গন্তব্য থেকে আবার শুরুতে) বা বড় লাফ ⇒ গড়ানো নয়, সরাসরি যাই।
      const jumped = next.km < shown.km - 0.05 || segmentKm(shown, next) > 25;
      from = jumped ? next : shown; // আগের গ্লাইড অসমাপ্ত থাকলেও বর্তমান অবস্থান থেকেই শুরু (লাফ নেই)
      to = next;
      startedAt = now;
      duration = jumped ? 1 : durationMs;
      ensureLoop();
    },
    current: () => shown,
    keepAlive(ms) {
      aliveUntil = Math.max(aliveUntil, performance.now() + ms);
      ensureLoop();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
