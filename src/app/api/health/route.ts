// =====================================================================
// GET /api/health — preview/load-balancer-এর readiness probe
// ---------------------------------------------------------------------
// • সংযোগ যাচাই: SELECT 1 (Drizzle, parameterised)।
// • প্রথম কলে স্কিমা + সিড নিশ্চিত করি; সিড ব্যর্থ হলেও হেলথ ভেঙে পড়ে না,
//   কারণ পরবর্তী রিকোয়েস্টে আবার চেষ্টা করার সুযোগ থাকবে।
// =====================================================================

import { db } from "@/db"; // PostgreSQL pool
import { sql } from "drizzle-orm"; // র connectivity query
import { loadCatalog } from "@/lib/catalog"; // ক্যাটালগ ওয়ার্ম-আপ (সিড + সড়কের জ্যামিতি ট্রিগার)

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`); // ডাটাবেজ লাইভ আছে কি না
    // fire-and-forget bootstrap: পেজ প্রথমবার খুললেই টেবিল/ডেটা তৈরি হয়ে যায়।
    void loadCatalog().catch(() => undefined);
    return Response.json({ ok: true, service: "shorojatra", database: "postgresql" });
  } catch {
    // স্ট্যাক-ট্রেস ক্লায়েন্টে না পাঠিয়ে শুধু সাধারণ অবস্থা জানাই (security)।
    return Response.json({ ok: false }, { status: 500 });
  }
}
