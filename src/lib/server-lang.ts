// =====================================================================
// সার্ভার কম্পোনেন্টের জন্য ভাষা নির্ধারক হেল্পার
// ---------------------------------------------------------------------
// Django: LocaleMiddleware + request.COOKIES[settings.LANGUAGE_COOKIE_NAME].
// কুকি না থাকলে ডিফল্ট বাংলা, ফলে প্রথম ভিজিটেই পুরো সাইট বাংলায় আসে।
// =====================================================================

import { cookies } from "next/headers"; // Next.js App Router-এর async cookie store
import type { Lang } from "@/lib/i18n"; // ভাষার টাইপ

// async: Next.js 16-এ cookies() একটি Promise দেয়, তাই await করতে হয়।
export async function getServerLang(): Promise<Lang> {
  const store = await cookies(); // রিকোয়েস্টের কুকি পড়ি
  const value = store.get("lang")?.value; // 'bn' | 'en' | undefined
  // allow-list ভিত্তিক যাচাই: ইংরেজি ছাড়া সব কিছু বাংলা হিসেবে ধরা হয় (safe default)।
  return value === "en" ? "en" : "bn";
}
