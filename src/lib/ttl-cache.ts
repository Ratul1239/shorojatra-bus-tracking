// =====================================================================
// ছোট TTL ক্যাশ + singleflight (একই কাজ একই সময়ে একবারই চলে)
// ---------------------------------------------------------------------
// ১০০০ ইউজার একই মুহূর্তে একই পেজ/API চাইলে → ১টি গণনা, বাকি ৯৯৯টি সেই ফলের অপেক্ষায়।
// Django তে: cache.get_or_set() + Redis lock (dogpile prevention) এর সমতুল্য।
// নিরাপত্তা: এন্ট্রির সংখ্যা সীমিত, তাই আক্রমণকারী অসংখ্য আলাদা query পাঠিয়ে RAM ভরতে পারে না।
// =====================================================================

// ক্যাশের প্রতিটি এন্ট্রি: মান, মেয়াদ ও (গণনা চলমান থাকলে) pending প্রমিজ।
type Entry = { value?: unknown; expiresAt: number; pending?: Promise<unknown> };

// ক্যাশ ফলাফলের অবস্থা: HIT = ক্যাশ থেকে, MISS = নতুন গণনা, COALESCED = অন্যের গণনার অপেক্ষা।
export type CacheStatus = "HIT" | "MISS" | "COALESCED";

// প্রসেস-গ্লোবাল স্টোর: hot reload বা একাধিক বান্ডেলেও একটিই থাকে।
const globalForCache = globalThis as typeof globalThis & { __shoroTtlStore?: Map<string, Entry> };

// স্টোর lazily তৈরি করি।
function store(): Map<string, Entry> {
  if (!globalForCache.__shoroTtlStore) globalForCache.__shoroTtlStore = new Map();
  return globalForCache.__shoroTtlStore;
}

// সীমার বেশি এন্ট্রি হলে আগে মেয়াদোত্তীর্ণগুলো, তারপর সবচেয়ে পুরনোগুলো মুছি।
function evict(map: Map<string, Entry>, maxEntries: number): void {
  if (map.size <= maxEntries) return; // সীমার ভেতরে থাকলে কিছু করি না
  const now = Date.now();
  for (const [key, entry] of map) {
    if (!entry.pending && entry.expiresAt <= now) map.delete(key); // মেয়াদ শেষ
  }
  for (const key of map.keys()) {
    if (map.size <= maxEntries) break; // যথেষ্ট জায়গা হয়েছে
    map.delete(key); // Map insertion-order = সবচেয়ে পুরনো আগে
  }
}

// মূল ফাংশন: key-র মান ক্যাশে থাকলে দিই; না থাকলে producer একবারই চালিয়ে সবাইকে শেয়ার করি।
export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T> | T,
  maxEntries = 500,
): Promise<{ value: T; status: CacheStatus }> {
  const map = store();
  const now = Date.now();
  const entry = map.get(key);
  if (entry && !entry.pending && entry.expiresAt > now) {
    return { value: entry.value as T, status: "HIT" }; // তাজা ক্যাশ: গণনা নেই
  }
  if (entry?.pending) {
    return { value: (await entry.pending) as T, status: "COALESCED" }; // একই গণনার অপেক্ষা
  }
  // নতুন গণনা শুরু: ব্যর্থ হলে ক্যাশে ত্রুটি রাখি না (পরের রিকোয়েস্ট আবার চেষ্টা করবে)।
  const pending = Promise.resolve()
    .then(producer)
    .then((value) => {
      map.set(key, { value, expiresAt: Date.now() + ttlMs }); // সফল মান সংরক্ষণ
      return value;
    })
    .catch((error) => {
      map.delete(key); // ব্যর্থতা ক্যাশ করি না
      throw error;
    });
  map.set(key, { expiresAt: 0, pending }); // pending চিহ্নিত
  evict(map, maxEntries); // আকার নিয়ন্ত্রণ
  return { value: (await pending) as T, status: "MISS" };
}
