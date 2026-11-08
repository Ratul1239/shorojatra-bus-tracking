// =====================================================================
// GET /api/routes/:id/path — একটি রুটের আসল সড়ক-পথ [[lat,lng], ...]
// ---------------------------------------------------------------------
// ৩D ম্যাপ খুললে একবারই এটি নেয়। পথ কদাচিৎ বদলায় বলে CDN/ব্রাউজারে দীর্ঘ সময় ক্যাশযোগ্য,
// ফলে ৫ সেকেন্ডের লাইভ পোলিংয়ে ভারী জ্যামিতি আর বারবার পাঠাতে হয় না।
// Django DRF তে: RetrieveAPIView + cache_page(3600).
// =====================================================================

import { getRoutePath } from "@/lib/catalog"; // সার্ভিস লেয়ার
import { rateLimit, tooMany } from "@/lib/rate-limit"; // IP রেট লিমিট

export const dynamic = "force-dynamic";

// Next.js 16-এ route params একটি Promise।
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = rateLimit(request, "path", 60); // প্রতি IP-তে মিনিটে ৬০
  if (!limited.ok) return tooMany(limited.retryAfter);
  const { id } = await context.params; // URL-এর id
  // শুধু ধনাত্মক পূর্ণসংখ্যা গ্রহণযোগ্য (allow-list ভ্যালিডেশন)।
  if (!/^\d{1,6}$/.test(id)) return Response.json({ ok: false, message: "Invalid route id" }, { status: 400 });
  try {
    const result = await getRoutePath(Number(id));
    if (!result) return Response.json({ ok: false, message: "Route not found" }, { status: 404 });
    return Response.json(result, {
      headers: {
        // ১ ঘণ্টা CDN ক্যাশ + পুরনো কপি দিয়ে ২৪ ঘণ্টা পর্যন্ত দ্রুত উত্তর।
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.json({ ok: false, message: "Service temporarily unavailable" }, { status: 503 });
  }
}
