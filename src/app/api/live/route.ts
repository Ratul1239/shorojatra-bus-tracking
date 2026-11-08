// =====================================================================
// GET /api/live?bus=<id|slug>&lang=bn — ৫ সেকেন্ড পোলিংয়ের লাইভ ফ্রেম
// ---------------------------------------------------------------------
// ১০০০+ ইউজারের জন্য ডিজাইন:
//  • ২ সেকেন্ডের singleflight ক্যাশ → হাজার রিকোয়েস্ট একটিমাত্র গণনা ও একটিমাত্র JSON শেয়ার করে
//  • তৈরি করা JSON স্ট্রিংটাই ক্যাশে থাকে → প্রতি রিকোয়েস্টে নতুন করে stringify হয় না
//  • ETag/304 → ডেটা না বদলালে body-ই পাঠানো হয় না (bandwidth সাশ্রয়)
//  • কোনো DB WRITE/READ নেই → PostgreSQL-এ lock/contention তৈরি হয় না
//  • IP-ভিত্তিক রেট লিমিট → একটি বট বাকিদের ধীর করতে পারে না
// বাগ ফিক্স: আগে প্রতি ৫ সেকেন্ডের পোলে ~৬KB labels + পুরো স্টপ তালিকা যেত। এখন ফ্রেম ছোট।
// Django DRF তে: @method_decorator(cache_page(2)) + conditional ETAG decorator.
// =====================================================================

import { cleanInput, envelope, loadCatalog } from "@/lib/catalog"; // read model + খাম
import { parseLang } from "@/lib/i18n"; // ভাষা allow-list
import { computeLiveFrames } from "@/lib/live"; // লাইভ গণনা
import { rateLimit, tooMany } from "@/lib/rate-limit"; // IP রেট লিমিট
import { cached } from "@/lib/ttl-cache"; // singleflight ক্যাশ

// পোলিং এন্ডপয়েন্ট সবসময় dynamic + runtime nodejs (ক্যাশ প্রসেস-লোকাল)।
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// প্রতি IP-তে মিনিটে সর্বোচ্চ রিকোয়েস্ট (স্বাভাবিক ব্যবহার ১২/মিনিট; env দিয়ে বদলানো যায়)।
const LIVE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_LIVE_PER_MIN ?? 240) || 240;

// GET হ্যান্ডলার: রেট লিমিট → bus ফিল্টার → ক্যাশ lookup → ETag যাচাই → JSON/304।
export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, "live", LIVE_LIMIT_PER_MIN); // অপব্যবহার রোধ
  if (!limited.ok) return tooMany(limited.retryAfter);

  const params = new URL(request.url).searchParams; // query string
  const lang = parseLang(params.get("lang")); // bn | en
  const busKey = cleanInput(params.get("bus") ?? params.get("busId") ?? ""); // নিরাপদ ইনপুট
  const withLabels = params.get("labels") === "1"; // labels ঐচ্ছিক (ডিফল্ট বাদ)

  try {
    const catalog = await loadCatalog(); // ৬০ সেকেন্ড ক্যাশ: সাধারণত DB স্পর্শই হয় না

    // bus আইডি/স্লাগ যাচাই: অজানা মানে 404 (silent fallback নয়, client বুঝতে পারবে)।
    let busId: number | null = null;
    if (busKey) {
      const match = catalog.buses.find((bus) => bus.slug === busKey || String(bus.id) === busKey);
      if (!match) return Response.json({ ok: false, message: "Bus not found" }, { status: 404 });
      busId = match.id;
    }

    // ২ সেকেন্ডের bucket: সব ক্লায়েন্ট একই bucket-এর একই ফলাফল ও একই ETag পায়।
    const bucket = Math.floor(Date.now() / 2000) * 2000;
    const scope = `${lang}:${busId ?? "all"}:${withLabels ? 1 : 0}`;
    const { value, status } = await cached(`live:${scope}:${bucket}`, 2500, () => {
      const busMap = new Map(catalog.buses.map((bus) => [bus.id, bus])); // দ্রুত lookup
      const frames = computeLiveFrames(catalog, lang, busId, bucket).map((frame) => {
        const bus = busMap.get(frame.busId)!;
        return {
          ...frame,
          name: lang === "bn" ? bus.nameBn : bus.nameEn,
          routeName: lang === "bn" ? bus.route.nameBn : bus.route.nameEn,
          origin: lang === "bn" ? bus.route.originBn : bus.route.originEn,
          destination: lang === "bn" ? bus.route.destinationBn : bus.route.destinationEn,
        };
      });
      const data = {
        frames,
        pollingIntervalSeconds: 5,
        serverCacheTtlSeconds: 2,
        note: lang === "bn" ? "প্রতি ৫ সেকেন্ডে মার্কার আপডেট হয়" : "Marker refreshes every 5 seconds",
      };
      return {
        body: JSON.stringify(envelope(lang, data, 2, new Date(bucket).toISOString(), withLabels)), // একবারই stringify
        etag: `"live-${scope.replace(/:/g, "-")}-${bucket}"`,
      };
    });

    const headers: Record<string, string> = {
      ETag: value.etag,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=8",
      "X-Live-Cache": status,
      "X-Api-Language": lang,
      "X-Poll-Interval": "5",
    };
    if (request.headers.get("if-none-match") === value.etag) {
      return new Response(null, { status: 304, headers }); // বডি ছাড়াই 304 → নেটওয়ার্ক খরচ প্রায় শূন্য
    }
    return new Response(value.body, { status: 200, headers });
  } catch {
    return Response.json({ ok: false, message: "Live feed temporarily unavailable" }, { status: 503 });
  }
}
