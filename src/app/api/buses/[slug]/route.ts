// =====================================================================
// GET /api/buses/:slug?lang=bn — একটি বাসের বিস্তারিত স্থানীয়কৃত তথ্য
// ---------------------------------------------------------------------
// Django DRF: RetrieveAPIView + lookup_field='slug' + LocaleMiddleware.
// ট্র্যাকার পেজ ভাষা বদলালে শুধু এই ছোট এন্ডপয়েন্টটি রি-ফেচ করে।
// =====================================================================

import { envelope, getBusByKey } from "@/lib/catalog"; // সার্ভিস + রেসপন্স খাম
import { parseLang } from "@/lib/i18n"; // ভাষা allow-list

export const dynamic = "force-dynamic";

// Next.js 16-এ route params একটি Promise; তাই await করে slug বের করি।
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params; // URL-এর slug/id
  const lang = parseLang(new URL(request.url).searchParams.get("lang")); // bn | en
  try {
    const bus = await getBusByKey(slug, lang); // slug বা numeric id দিয়ে খোঁজা
    if (!bus) return Response.json({ ok: false, message: "Bus not found" }, { status: 404 });
    // ৬০ সেকেন্ড ক্যাশ: বাসের মেটাডেটা ঘন ঘন বদলে না; লাইভ অবস্থান /api/live থেকে আসে।
    return Response.json(envelope(lang, { bus }, 60), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60", "X-Api-Language": lang },
    });
  } catch {
    return Response.json({ ok: false, message: "Service temporarily unavailable" }, { status: 503 });
  }
}
