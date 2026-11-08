// =====================================================================
// ম্যাপ ভিউগুলোর (৩D OpenStreetMap / Google 3D / SVG) শেয়ার্ড টাইপ
// ---------------------------------------------------------------------
// তিনটি ভিউ একই props নেয়, ফলে LiveMap যেকোনো ভিউ বদলে দিতে পারে (fallback চেইনের জন্য জরুরি)।
// =====================================================================

import type { BusDto, LatLng, LiveDto } from "@/lib/types"; // শেয়ার্ড DTO

// ম্যাপ ভিউয়ের জন্য props।
export type MapViewProps = {
  bus: BusDto; // বাসের তথ্য (নাম, রং, স্টপ তালিকা)
  frame: LiveDto; // সর্বশেষ লাইভ GPS ফ্রেম
  path: LatLng[]; // রুটের পলিলাইন (আসল সড়ক অথবা fallback সরলরেখা)
  view3d: boolean; // true হলে ৩D (কাত করা ক্যামেরা), false হলে ওপর থেকে ২D
  follow: boolean; // true হলে ক্যামেরা বাসকে অনুসরণ করে (chase-cam)
  fitTick: number; // বাড়লেই "পুরো রুট" দেখানোর কমান্ড (counter pattern)
  onFollowChange: (value: boolean) => void; // ব্যবহারকারী ম্যাপ টানলে অনুসরণ বন্ধের জন্য
  onReady: () => void; // ম্যাপ প্রস্তুত হলে (লোডিং ওভারলে সরাতে)
  onFail: () => void; // ম্যাপ চালু করা না গেলে (পরবর্তী fallback-এ যেতে)
};
