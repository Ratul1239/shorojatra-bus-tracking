// =====================================================================
// /track/[slug] — একক বাসের ফুল-পেজ লাইভ ট্র্যাকার (Server Component)
// ---------------------------------------------------------------------
// slug বা numeric id দুটোই চলে; অজানা হলে Next.js-এর notFound() 404 দেখায়।
// প্রথম পেইন্ট server-rendered ⇒ ম্যাপ তাৎক্ষণিকভাবে একটি ফ্রেম পায়।
// =====================================================================

import { notFound } from "next/navigation"; // 404 হ্যান্ডলার
import { TrackerClient } from "@/components/TrackerClient";
import { getBusByKey } from "@/lib/catalog";
import { getServerLang } from "@/lib/server-lang";

export const dynamic = "force-dynamic";

// Next.js 16: dynamic route params-ও Promise।
export default async function TrackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; // URL-এর অংশ
  const lang = await getServerLang(); // কুকি থেকে ভাষা
  const bus = await getBusByKey(slug, lang); // ক্যাটালগ থেকে একটি বাস
  if (!bus) notFound(); // সঠিক 404 পেজ
  return <TrackerClient initialBus={bus} initialLang={lang} />;
}
