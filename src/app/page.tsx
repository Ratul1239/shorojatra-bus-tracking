// =====================================================================
// হোম পেজ (Server Component)
// ---------------------------------------------------------------------
// Django তে: TemplateView + context['buses'] = BusSelector.active_today().
// এখানে Drizzle read model থেকে প্রথম পেইন্টের ডেটা server-এ তৈরি করি,
// ফলে ব্রাউজারে প্রথমেই সম্পূর্ণ তথ্য দেখা যায় (blank skeleton নেই)।
// force-dynamic: বিল্ডের সময় ডাটাবেজ ছোঁয়া হয় না, লাইভ ডেটা সবসময় তাজা।
// =====================================================================

import { HomeClient } from "@/components/HomeClient"; // ক্লায়েন্ট ইন্টারঅ্যাকশন
import { getHomeData } from "@/lib/catalog"; // সচল বাস + পরিসংখ্যান সার্ভিস
import { getServerLang } from "@/lib/server-lang"; // কুকি থেকে ভাষা

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const lang = await getServerLang(); // 'bn' অথবা 'en'
  const home = await getHomeData(lang); // ক্যাশ করা catalog → স্থানীয়কৃত DTO
  // প্রাথমিক ডেটা ক্লায়েন্টে pass করি; ভাষা বদলালে ক্লায়েন্ট REST API কল করবে।
  return <HomeClient initialBuses={home.buses} initialStats={home.stats} initialLang={lang} />;
}
