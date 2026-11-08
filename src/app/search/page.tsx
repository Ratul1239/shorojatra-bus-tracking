// =====================================================================
// সার্চ ফলাফল পেজ (Server Component) — হোম থেকে আলাদা পেজ
// ---------------------------------------------------------------------
// Query: ?mode=route&from=Dhaka&to=Khulna | ?mode=name&q=Ena | ?mode=active
// Next.js 16-এ searchParams একটি Promise, তাই await করতে হয়।
// সার্ভারে প্রথম ফলাফল রেন্ডার ⇒ SEO + দ্রুত first paint; ভাষা বদলে client refetch।
// =====================================================================

import { SearchResultsClient } from "@/components/SearchResultsClient";
import { searchBuses, type SearchParams } from "@/lib/catalog";
import { getServerLang } from "@/lib/server-lang";

export const dynamic = "force-dynamic";

// searchParams-এর টাইপ: Next.js string | string[] | undefined দিতে পারে।
type RawSearchParams = Record<string, string | string[] | undefined>;

// array আকারে এলে প্রথম মানটি নিই (query duplication-এ নিরাপদ)।
function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams; // URL query পার্স
  const lang = await getServerLang(); // কুকি-ভিত্তিক ভাষা
  // mode allow-list: অজানা মান এলে সচল বহর দেখাই (কোনো error নয়)।
  const rawMode = first(raw.mode);
  const mode: SearchParams["mode"] = rawMode === "route" || rawMode === "name" ? rawMode : "active";

  const result = await searchBuses({ mode, from: first(raw.from), to: first(raw.to), q: first(raw.q) }, lang);

  // ভাষা টগলের পর ক্লায়েন্টকে একই query আবার পাঠাতে হবে ⇒ string হিসেবে pass করি।
  const query = new URLSearchParams({
    mode,
    from: result.from, // parseRouteQuery দিয়ে "Dhaka to Khulna" ভাগ করা হয়েছে
    to: result.to,
    q: result.q,
  });

  // বাগ ফিক্স: key = query ⇒ নতুন সার্চে ক্লায়েন্ট state (পুরনো ফলাফল/ইনপুট) রিসেট হয়।
  return <SearchResultsClient key={query.toString()} initialResult={result} initialLang={lang} queryString={query.toString()} />;
}
