// =====================================================================
// GET /api/search — রুট ভিত্তিক ও নাম ভিত্তিক সার্চ (REST)
// ---------------------------------------------------------------------
// উদাহরণ:
//   /api/search?mode=route&from=Dhaka&to=Khulna&lang=bn
//   /api/search?mode=route&from=Dhaka%20to%20Khulna&lang=en
//   /api/search?mode=name&q=Ena&lang=bn
// Django DRF: SearchFilter + custom get_queryset() logic-এর সমতুল্য।
// =====================================================================

import { envelope, searchBuses, type SearchParams } from "@/lib/catalog"; // সার্ভিস + DTO
import { parseLang } from "@/lib/i18n"; // ভাষা ভ্যালিডেশন
import { rateLimit, tooMany } from "@/lib/rate-limit"; // IP রেট লিমিট

// প্রতি IP-তে মিনিটে সর্বোচ্চ সার্চ (সার্চ তুলনামূলক ভারী, তাই লিমিট কম)।
const SEARCH_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_SEARCH_PER_MIN ?? 90) || 90;

// লাইভ ফলাফল: প্রতি রিকোয়েস্টে নতুন গণনা করা হয় (ক্যাশ read model-এ)।
export const dynamic = "force-dynamic";

// GET হ্যান্ডলার: query প্যারামিটার allow-list → সার্চ → স্থানীয়কৃত JSON।
export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, "search", SEARCH_LIMIT_PER_MIN); // বটের অপব্যবহার রোধ
  if (!limited.ok) return tooMany(limited.retryAfter);
  const url = new URL(request.url); // রিকোয়েস্ট URL পার্স
  const params = url.searchParams; // query string
  const lang = parseLang(params.get("lang")); // bn | en (অন্য কিছু → en)

  // mode শুধুমাত্র তিনটি অনুমোদিত মান নিতে পারে => ইনজেকশন/অবাঞ্ছিত branch নেই।
  const rawMode = params.get("mode");
  const mode: SearchParams["mode"] = rawMode === "route" || rawMode === "name" ? rawMode : "active";

  try {
    // ইনপুট cleanInput() দিয়ে সার্ভিসের ভেতরে ছাঁকা হয় (length ≤ 80, control chars বাদ)।
    const result = await searchBuses(
      { mode, from: params.get("from") ?? "", to: params.get("to") ?? "", q: params.get("q") ?? "" },
      lang,
    );
    // সার্চ ফলাফল ১০ সেকেন্ড CDN ক্যাশে রাখা যায় (মেটাডেটা দ্রুত বদলে না)।
    return Response.json(envelope(lang, result, 10), {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
        "X-Api-Language": lang,
        "X-Search-Mode": mode,
      },
    });
  } catch {
    // ক্লায়েন্টে শুধু সাধারণ বার্তা; ডাটাবেজের তথ্য ফাঁস হয় না।
    return Response.json({ ok: false, message: "Search temporarily unavailable" }, { status: 503 });
  }
}
