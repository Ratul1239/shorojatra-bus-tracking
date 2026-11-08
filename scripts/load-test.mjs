// =====================================================================
// লোড টেস্ট: ১০০০+ একযোগে ইউজার সিমুলেশন (কোনো বাইরের প্যাকেজ ছাড়া, শুধু Node.js)
// ---------------------------------------------------------------------
// চালানোর নিয়ম (সার্ভার চালু থাকা অবস্থায়):
//   ulimit -n 65536 && node scripts/load-test.mjs
// পরিবেশ-চলক: BASE_URL (ডিফল্ট http://127.0.0.1:3000), USERS (ডিফল্ট ১০০০), DURATION (সেকেন্ড, ডিফল্ট ৩০)
//
// চারটি পরিস্থিতি:
//   ১) SPIKE   — ঠিক একই মুহূর্তে USERS জন /api/live চাইছে (সবচেয়ে কঠিন মুহূর্ত)
//   ২) SUSTAINED — USERS জন ব্রাউজারের মতো প্রতি ~৫ সেকেন্ডে পোল করছে (ETag/304 সহ) DURATION সেকেন্ড ধরে
//   ৩) PAGES   — USERS জন একই সাথে হোম পেজ (SSR) খুলছে + সার্চ পেজ
//   ৪) ABUSE   — একটি IP থেকে বট-সদৃশ ৪০০ রিকোয়েস্ট ⇒ রেট লিমিট (429) কাজ করছে কি না
// প্রতিটি ইউজারের আলাদা X-Forwarded-For (আসল ইন্টারনেটে প্রতিটি ইউজারের আলাদা IP থাকে)।
// =====================================================================

import http from "node:http"; // সরাসরি HTTP ক্লায়েন্ট (সকেট নিয়ন্ত্রণের জন্য)
import { performance } from "node:perf_hooks"; // নির্ভুল সময় মাপার ঘড়ি

const BASE = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3000"); // টেস্ট করা সার্ভার
const USERS = Number(process.env.USERS ?? 1000); // ভার্চুয়াল ইউজার সংখ্যা
const DURATION_MS = Number(process.env.DURATION ?? 30) * 1000; // টানা ব্যবহারের সময়
const REQUEST_TIMEOUT_MS = 30_000; // একটি রিকোয়েস্টের সর্বোচ্চ অপেক্ষা

// keep-alive এজেন্ট: ব্রাউজারের মতো কানেকশন পুনর্ব্যবহার করে; maxSockets বড় যেন ১০০০ একসাথে চলে।
const agent = new http.Agent({ keepAlive: true, maxSockets: USERS + 200 });

// ইউজার-নম্বর থেকে একটি অনন্য ছদ্ম IP (10.x.y.z) বানাই।
const fakeIp = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;

// একটি HTTP রিকোয়েস্ট: status, সময় (ms), বডির বাইট ও ETag ফেরত দেয়; ব্যর্থ হলে status = 0।
function request(path, headers = {}) {
  return new Promise((resolve) => {
    const start = performance.now(); // শুরুর সময়
    const req = http.request(
      { host: BASE.hostname, port: BASE.port, path, method: "GET", agent, headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let bytes = 0;
        res.on("data", (chunk) => (bytes += chunk.length)); // বডি গুনি (জমা রাখি না)
        res.on("end", () => resolve({ status: res.statusCode ?? 0, ms: performance.now() - start, bytes, etag: res.headers.etag ?? "" }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout"))); // সময় শেষ ⇒ বাতিল
    req.on("error", () => resolve({ status: 0, ms: performance.now() - start, bytes: 0, etag: "" })); // সংযোগ ব্যর্থ
    req.end();
  });
}

// পার্সেন্টাইল বের করার সহায়ক (p50/p95/p99)।
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ফলাফলের সারাংশ ছাপি: মোট, সফল, 304, 429, ব্যর্থ, latency, throughput, ডেটা।
function report(title, results, wallMs) {
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const count = (fn) => results.filter(fn).length;
  const ok = count((r) => r.status === 200);
  const notModified = count((r) => r.status === 304);
  const limited = count((r) => r.status === 429);
  const failed = count((r) => r.status === 0 || r.status >= 500); // সংযোগ ব্যর্থ বা সার্ভার ত্রুটি
  const other = results.length - ok - notModified - limited - failed;
  const mb = results.reduce((sum, r) => sum + r.bytes, 0) / 1024 / 1024;
  console.log(`\n── ${title}`);
  console.log(`   রিকোয়েস্ট: ${results.length} | 200: ${ok} | 304: ${notModified} | 429: ${limited} | অন্য 4xx: ${other} | ব্যর্থ/5xx: ${failed}`);
  console.log(
    `   latency ms → p50: ${percentile(times, 50).toFixed(0)} | p95: ${percentile(times, 95).toFixed(0)} | p99: ${percentile(times, 99).toFixed(0)} | max: ${(times[times.length - 1] ?? 0).toFixed(0)}`,
  );
  console.log(`   throughput: ${(results.length / (wallMs / 1000)).toFixed(0)} req/s | ডেটা: ${mb.toFixed(2)} MB | মোট সময়: ${(wallMs / 1000).toFixed(1)}s`);
  return { ok, notModified, limited, failed, p95: percentile(times, 95), p99: percentile(times, 99) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); // ঘুমানোর সহায়ক
const busIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // সচল বাসের আইডি
const summary = []; // শেষে পাস/ফেল বিচারের জন্য

// ---- ১) SPIKE: একই মুহূর্তে USERS জন ----
async function spike() {
  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: USERS }, (_, i) =>
      request(`/api/live?bus=${busIds[i % busIds.length]}&lang=${i % 2 ? "bn" : "en"}`, { "x-forwarded-for": fakeIp(i + 1) }),
    ),
  );
  summary.push({ name: "SPIKE", ...report(`১) SPIKE — ${USERS} জন একই মুহূর্তে /api/live`, results, performance.now() - start) });
}

// ---- ২) SUSTAINED: প্রতিটি ইউজার ব্রাউজারের মতো প্রতি ~৫ সেকেন্ডে পোল ----
async function sustained() {
  const results = [];
  const start = performance.now();
  const endAt = start + DURATION_MS;
  await Promise.all(
    Array.from({ length: USERS }, async (_, i) => {
      const ip = fakeIp(i + 5001); // spike-এর IP থেকে আলাদা
      const bus = busIds[i % busIds.length];
      const lang = i % 2 ? "bn" : "en";
      let etag = ""; // প্রতিটি ইউজারের নিজস্ব ETag (আসল ব্রাউজারের মতো)
      await sleep(Math.random() * 5000); // সবাই একসাথে শুরু করে না (ramp-up)
      while (performance.now() < endAt) {
        const headers = { "x-forwarded-for": ip };
        if (etag) headers["if-none-match"] = etag; // শর্তসাপেক্ষ রিকোয়েস্ট
        const res = await request(`/api/live?bus=${bus}&lang=${lang}`, headers);
        if (res.etag) etag = res.etag;
        results.push(res);
        if (i % 50 === 0) results.push(await request(`/api/search?mode=route&from=Dhaka&to=Khulna&lang=${lang}`, { "x-forwarded-for": ip })); // ২% ইউজার সার্চও করে
        await sleep(5000 + (Math.random() - 0.5) * 600); // ৫ সেকেন্ড ± জিটার
      }
    }),
  );
  summary.push({ name: "SUSTAINED", ...report(`২) SUSTAINED — ${USERS} জন × প্রতি ৫ সেকেন্ডে পোল × ${DURATION_MS / 1000}s`, results, performance.now() - start) });
}

// ---- ৩) PAGES: একসাথে USERS জন হোম পেজ (SSR) খুলছে ----
async function pages() {
  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: USERS }, (_, i) =>
      request(i % 5 === 0 ? "/search?mode=route&from=Dhaka&to=Khulna" : "/", { "x-forwarded-for": fakeIp(i + 9001), cookie: `lang=${i % 2 ? "bn" : "en"}` }),
    ),
  );
  summary.push({ name: "PAGES", ...report(`৩) PAGES — ${USERS} জন একই মুহূর্তে হোম/সার্চ পেজ (SSR)`, results, performance.now() - start) });
}

// ---- ৪) ABUSE: একটি IP থেকে ৪০০ রিকোয়েস্ট ----
async function abuse() {
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: 400 }, () => request("/api/live?bus=1&lang=en", { "x-forwarded-for": "203.0.113.77" })));
  const rep = report("৪) ABUSE — একটি IP থেকে ৪০০ রিকোয়েস্ট (সীমা: ২৪০/মিনিট)", results, performance.now() - start);
  summary.push({ name: "ABUSE", ...rep });
  // অন্য একজন বৈধ ইউজার সেই মুহূর্তেও সফলভাবে সাড়া পায় কি না।
  const legit = await request("/api/live?bus=1&lang=en", { "x-forwarded-for": "198.51.100.5" });
  console.log(`   বৈধ ইউজার (অন্য IP) সেই সময়ে: HTTP ${legit.status} (${legit.ms.toFixed(0)} ms)`);
  summary.push({ name: "LEGIT-DURING-ABUSE", ok: legit.status === 200 ? 1 : 0, failed: legit.status === 200 ? 0 : 1, limited: 0, p95: legit.ms, p99: legit.ms, notModified: 0 });
}

// ---- ৫) REALISTIC: ইউজাররা ছড়িয়ে আসে (ARRIVAL সেকেন্ডে), পেজ খোলে, তারপর ম্যাপে ৫ সেকেন্ডে পোল ----
async function realistic() {
  const arrivalMs = Number(process.env.ARRIVAL ?? 30) * 1000; // সবাই এই সময়ের মধ্যে আসে
  const pageResults = []; // পেজ খোলার ফলাফল
  const pollResults = []; // লাইভ পোলের ফলাফল
  const start = performance.now();
  await Promise.all(
    Array.from({ length: USERS }, async (_, i) => {
      await sleep(Math.random() * arrivalMs); // আসল জীবনে ইউজাররা একসাথে আসে না
      const ip = fakeIp(i + 20001);
      pageResults.push(await request("/", { "x-forwarded-for": ip, cookie: `lang=${i % 2 ? "bn" : "en"}` })); // হোম পেজ খোলে
      let etag = "";
      for (let k = 0; k < 4; k += 1) {
        // "লাইভ লোকেশন" চাপার পর ৫ সেকেন্ডের পোলিং
        const headers = { "x-forwarded-for": ip };
        if (etag) headers["if-none-match"] = etag;
        const res = await request(`/api/live?bus=${busIds[i % busIds.length]}&lang=${i % 2 ? "bn" : "en"}`, headers);
        if (res.etag) etag = res.etag;
        pollResults.push(res);
        await sleep(5000);
      }
    }),
  );
  const wall = performance.now() - start;
  summary.push({ name: "REALISTIC-PAGES", ...report(`৫a) REALISTIC — ${USERS} জন ${arrivalMs / 1000}s-এ এসে পেজ খুলল`, pageResults, wall) });
  summary.push({ name: "REALISTIC-POLLS", ...report(`৫b) REALISTIC — একই সময়ে তাদের লাইভ পোল (পেজ লোডের চাপের মধ্যেও)`, pollResults, wall) });
}

// ---- মূল চালক ---- (PHASES=pages দিয়ে শুধু নির্বাচিত ধাপ চালানো যায়)
const phases = (process.env.PHASES ?? "spike,sustained,pages,abuse").split(",");
console.log(`লক্ষ্য: ${BASE.origin} | ভার্চুয়াল ইউজার: ${USERS} | টানা-টেস্ট: ${DURATION_MS / 1000}s | ধাপ: ${phases.join(", ")}`);
const runners = { spike, sustained, pages, abuse, realistic }; // ধাপের নাম → ফাংশন
for (const name of phases) {
  if (!runners[name]) continue; // অজানা নাম উপেক্ষা
  await runners[name]();
  await sleep(1500); // ধাপগুলোর মাঝে বিরতি
}

// ---- চূড়ান্ত রায় ---- (শুধু যে ধাপ চলেছে তার শর্ত যাচাই হয়)
const get = (name) => summary.find((s) => s.name === name);
const checks = [
  ["SPIKE", "SPIKE: কোনো ব্যর্থতা নেই", () => get("SPIKE").failed === 0],
  ["SPIKE", "SPIKE: p99 < ৩০০০ms", () => get("SPIKE").p99 < 3000],
  ["SUSTAINED", "SUSTAINED: কোনো ব্যর্থতা নেই", () => get("SUSTAINED").failed === 0],
  ["SUSTAINED", "SUSTAINED: p95 < ৫০০ms", () => get("SUSTAINED").p95 < 500],
  ["PAGES", "PAGES: কোনো ব্যর্থতা নেই", () => get("PAGES").failed === 0],
  ["REALISTIC-PAGES", "REALISTIC: পেজ — কোনো ব্যর্থতা নেই", () => get("REALISTIC-PAGES").failed === 0],
  ["REALISTIC-PAGES", "REALISTIC: পেজ p95 < ২০০০ms", () => get("REALISTIC-PAGES").p95 < 2000],
  ["REALISTIC-POLLS", "REALISTIC: লাইভ পোল — কোনো ব্যর্থতা নেই", () => get("REALISTIC-POLLS").failed === 0],
  ["REALISTIC-POLLS", "REALISTIC: লাইভ পোল p95 < ৫০০ms", () => get("REALISTIC-POLLS").p95 < 500],
  ["ABUSE", "ABUSE: রেট লিমিট কাজ করছে (429 > 0)", () => get("ABUSE").limited > 0],
  ["LEGIT-DURING-ABUSE", "ABUSE: বৈধ ইউজার অক্ষত", () => get("LEGIT-DURING-ABUSE").ok === 1],
].filter(([need]) => get(need));
console.log("\n══ রায় ══");
for (const [, label, test] of checks) console.log(`   ${test() ? "✅ PASS" : "❌ FAIL"}  ${label}`);
agent.destroy(); // সকেট বন্ধ
process.exit(checks.every(([, , test]) => test()) ? 0 : 1);
