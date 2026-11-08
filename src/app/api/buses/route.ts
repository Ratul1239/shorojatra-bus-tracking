// =====================================================================
// GET /api/buses?lang=bn | en — আজ রাস্তায় সচল বাসের তালিকা
// ---------------------------------------------------------------------
// Django DRF: class BusListAPIView(generics.ListAPIView) + LocaleMiddleware.
// Response-এ language, labels, generatedAt ও সম্পূর্ণ স্থানীয়কৃত data থাকে।
// বাগ ফিক্স: আগে প্রতি রিকোয়েস্টে `select 1` চালানো হত — ১০০০ ইউজারে ১০টি কানেকশনের পুলে
// লাইন লেগে যেত। এখন ক্যাশ করা read model থেকেই উত্তর দিই; DB স্বাস্থ্য /api/health দেখে।
// =====================================================================

import { envelope, getHomeData } from "@/lib/catalog"; // সার্ভিস লেয়ার + রেসপন্স খাম
import { parseLang } from "@/lib/i18n"; // ভাষা allow-list
import { rateLimit, tooMany } from "@/lib/rate-limit"; // IP রেট লিমিট

// সবসময় dynamic: বিল্ড টাইমে স্ট্যাটিক JSON বানানো যাবে না (লাইভ ডেটা)।
export const dynamic = "force-dynamic";

// প্রতি IP-তে মিনিটে সর্বোচ্চ রিকোয়েস্ট।
const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_API_PER_MIN ?? 120) || 120;

// GET হ্যান্ডলার: রেট লিমিট → ভাষা → সার্ভিস কল → JSON রেসপন্স।
export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, "buses", LIMIT_PER_MIN);
  if (!limited.ok) return tooMany(limited.retryAfter);
  // URL থেকে lang বের করি; অজানা মান স্বয়ংক্রিয়ভাবে 'en' হয়ে যায় (fail-safe)।
  const lang = parseLang(new URL(request.url).searchParams.get("lang"));
  try {
    // ক্যাশ করা read model থেকে সচল বাস + পরিসংখ্যান আনি (২ সেকেন্ড singleflight)।
    const home = await getHomeData(lang);
    // ৩০ সেকেন্ড CDN ক্যাশের কথা জানিয়ে দিই (revalidate allowed)।
    return Response.json(envelope(lang, home, 60), {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
        "X-Api-Language": lang,
      },
    });
  } catch {
    // সার্ভারের অভ্যন্তরীণ স্ট্যাক-ট্রেস ক্লায়েন্টে পাঠাই না (security best practice)।
    return Response.json({ ok: false, message: "Service temporarily unavailable" }, { status: 503 });
  }
}
