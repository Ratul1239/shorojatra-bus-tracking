// =====================================================================
// PostgreSQL কানেকশন পুল (Drizzle ORM)
// ---------------------------------------------------------------------
// বাগ ফিক্স: আগে প্রোডাকশনে পুলটি globalThis-এ রাখা হত না; ফলে Next.js-এর একাধিক
// বান্ডেলে আলাদা আলাদা পুল (প্রতিটি ১০ কানেকশন) তৈরি হতে পারত।
// এখন সব পরিবেশেই একটিমাত্র শেয়ার্ড পুল ব্যবহার হয়, আর timeout সীমাও দেওয়া আছে।
// =====================================================================

import { drizzle } from "drizzle-orm/node-postgres"; // Drizzle-এর node-postgres অ্যাডাপ্টার
import { Pool } from "pg"; // PostgreSQL কানেকশন পুল

// DATABASE_URL না থাকলে অ্যাপ শুরুতেই স্পষ্ট ত্রুটি দিয়ে থামবে (fail-fast)।
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// globalThis-এ পুল রাখার জন্য টাইপ: hot reload ও একাধিক বান্ডেলেও একই পুল মিলবে।
const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// পুলের সর্বোচ্চ কানেকশন: env থেকে নেওয়া যায়, ডিফল্ট ২০ (PostgreSQL-এর ১০০ সীমার ভেতরে)।
const poolMax = Math.min(Math.max(Number(process.env.DB_POOL_MAX ?? 20) || 20, 2), 80);

// পুল তৈরি: আগে থেকে থাকলে সেটিই ব্যবহার করি, নাহলে নতুন বানাই।
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl, // সংযোগ স্ট্রিং
    max: poolMax, // একসাথে সর্বোচ্চ কানেকশন
    idleTimeoutMillis: 30_000, // অলস কানেকশন ৩০ সেকেন্ড পরে বন্ধ
    connectionTimeoutMillis: 5_000, // কানেকশন না পেলে ৫ সেকেন্ডেই ব্যর্থ (অনন্ত অপেক্ষা নয়)
    statement_timeout: 10_000, // কোনো query ১০ সেকেন্ডের বেশি চলতে পারবে না
  });

// প্রোডাকশন সহ সব পরিবেশে পুলটি গ্লোবালে সংরক্ষণ করি (ডুপ্লিকেট পুল রোধ)।
globalForDb.__arenaNextJsPostgresqlPool = pool;

// অপ্রত্যাশিত idle-client error যেন পুরো প্রসেস ক্র্যাশ না করে।
pool.on("error", () => {
  // শুধু গিলে ফেলি; পরবর্তী query নতুন কানেকশন নেবে।
});

// Drizzle ক্লায়েন্ট: পুরো অ্যাপ এটিই import করে।
export const db = drizzle(pool);
