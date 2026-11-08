// =====================================================================
// IP-ভিত্তিক রেট লিমিটার (fixed window, in-memory)
// ---------------------------------------------------------------------
// Django DRF তে: AnonRateThrottle ('anon': '240/min') এর সমতুল্য।
// উদ্দেশ্য: একটি বট/স্ক্রিপ্ট যেন হাজার হাজার রিকোয়েস্ট পাঠিয়ে বাকি ১০০০ ইউজারকে ধীর না করে।
// সীমাগুলো সাধারণ ব্যবহারের (৫ সেকেন্ডে ১ পোল = ১২/মিনিট) বহুগুণ বেশি, তাই বৈধ ইউজার আটকায় না।
// ক্লায়েন্ট IP শনাক্ত করা না গেলে (যেমন লোকাল ডেভ) সীমা প্রয়োগ হয় না।
// প্রোডাকশনে একাধিক ইনস্ট্যান্স থাকলে Redis (INCR + EXPIRE) দিয়ে প্রতিস্থাপন করুন।
// =====================================================================

// প্রতিটি (scope, ip)-র কাউন্টার ও রিসেটের সময়।
type Bucket = { count: number; resetAt: number };

// প্রসেস-গ্লোবাল স্টোর।
const globalForLimit = globalThis as typeof globalThis & { __shoroRateStore?: Map<string, Bucket> };

// স্টোর lazily তৈরি।
function store(): Map<string, Bucket> {
  if (!globalForLimit.__shoroRateStore) globalForLimit.__shoroRateStore = new Map();
  return globalForLimit.__shoroRateStore;
}

// প্রক্সির সংখ্যা: X-Forwarded-For-এর ডান দিক থেকে কোন অবস্থানের IP বিশ্বাস করব।
// ডিফল্ট ১ ⇒ আমাদের সামনের বিশ্বস্ত প্রক্সি যে IP যোগ করেছে সেটিই (ক্লায়েন্ট বানাতে পারে না)।
const TRUSTED_HOPS = Math.max(Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1, 1);

// রিকোয়েস্ট থেকে ক্লায়েন্ট IP বের করি (না পেলে null)।
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for"); // প্রক্সি-যোগ করা চেইন
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean); // IP তালিকা
    const picked = parts[Math.max(parts.length - TRUSTED_HOPS, 0)]; // বিশ্বস্ত অবস্থানের IP
    if (picked) return picked.slice(0, 64); // দৈর্ঘ্য সীমিত (key ফোলানো রোধ)
  }
  const real = request.headers.get("x-real-ip"); // বিকল্প হেডার
  return real ? real.slice(0, 64) : null;
}

// ফলাফল: অনুমোদিত কি না, আর না হলে কত সেকেন্ড পরে আবার চেষ্টা করবে।
export type LimitResult = { ok: boolean; retryAfter: number };

// মূল ফাংশন: scope-ভিত্তিক সীমা পরীক্ষা ও কাউন্টার বাড়ানো।
export function rateLimit(request: Request, scope: string, limit: number, windowMs = 60_000): LimitResult {
  const ip = clientIp(request); // ক্লায়েন্ট শনাক্তকরণ
  if (!ip) return { ok: true, retryAfter: 0 }; // শনাক্ত করা না গেলে সীমা নেই
  const map = store();
  const now = Date.now();
  const key = `${scope}:${ip}`; // scope আলাদা হওয়ায় live-এর ভিড় search-কে আটকায় না
  const bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs }); // নতুন window
    if (map.size > 20_000) {
      for (const [k, b] of map) if (b.resetAt <= now) map.delete(k); // মেয়াদোত্তীর্ণ পরিষ্কার (RAM সীমা)
    }
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1; // একই window-এ আরেকটি রিকোয়েস্ট
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1) }; // সীমা ছাড়িয়েছে
  }
  return { ok: true, retryAfter: 0 };
}

// 429 Too Many Requests রেসপন্স তৈরির সহায়ক (Retry-After সহ)।
export function tooMany(retryAfter: number): Response {
  return Response.json(
    { ok: false, message: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}
