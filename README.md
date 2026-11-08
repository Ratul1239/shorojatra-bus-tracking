# শরোযাত্রা / ShoroJatra — লাইভ বাস ট্র্যাকিং (৩D ম্যাপসহ)

বাংলাদেশের আন্তঃনগর বাসের **রুট সার্চ**, **নাম সার্চ**, **ক্রমিক কাউন্টার তালিকা**, **৩D লাইভ ম্যাপ (৫ সেকেন্ডে আপডেট)** ও **সম্পূর্ণ বাংলা/ইংরেজি i18n** সহ ফুলস্ট্যাক ডেমো।

> **স্ট্যাক সম্পর্কে স্বচ্ছতা:** মূল রিকোয়ারমেন্টে Python/Django/DRF + Bootstrap চাওয়া হয়েছিল। এই স্যান্ডবক্সের রানটাইম **Next.js 16 + PostgreSQL (Drizzle ORM)** ফিক্সড, তাই REST লেয়ার Next.js Route Handlers দিয়ে তৈরি — **API কনট্র্যাক্ট Django DRF-এর সাথে ১:১**। `django_reference/`-এ সমতুল্য `models.py`, `serializers.py`, `views.py`, `urls.py` আছে (সবকিছুতে বাংলা কমেন্ট)। Bootstrap-এর বদলে Tailwind CSS ব্যবহৃত।

---

## ১) ৩D ম্যাপ

ম্যাপ খুলতে বাসের কার্ডে **"লাইভ লোকেশন"** চাপুন (বা `/track/<slug>` পেজ)।

| ইঞ্জিন | কখন | বৈশিষ্ট্য |
| --- | --- | --- |
| **OpenStreetMap ৩D** (MapLibre GL) | ডিফল্ট — **কোনো API key লাগে না** | কাত ক্যামেরা (৬২°), আকাশ/কুয়াশা, শহরে ৩D বিল্ডিং (zoom ≥ ১৪), **৩D বাস মডেল** (বডি + কাচের কেবিন + ছাদ + হেডলাইট), chase-cam |
| **Google Maps ৩D** | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` থাকলে | ভেক্টর ম্যাপ, tilt ৬৭.৫°, `AdvancedMarkerElement`। ঐচ্ছিক `NEXT_PUBLIC_GOOGLE_MAP_ID` |
| **SVG স্কিম্যাটিক ২D** | উপরের দুটি ব্যর্থ হলে (WebGL নেই/অফলাইন/অবৈধ key) | কখনো ফাঁকা ম্যাপ দেখায় না |

- ম্যাপের টুলবার: **৩D/২D**, **বাস অনুসরণ** (chase-cam), **পুরো রুট**। ম্যাপ টানলে অনুসরণ নিজে বন্ধ হয়।
- বাস চলে **আসল সড়ক ধরে**: রুটের জ্যামিতি OSRM থেকে *একবার* এনে PostgreSQL-এ (`routes.path_json`) রাখা হয়; ইউজারের রিকোয়েস্টে কখনো বাইরের API ডাকা হয় না। না এলে সরলরেখায় fallback।
- সার্ভার ৫ সেকেন্ডে একটি অবস্থান দেয়; ব্রাউজার `requestAnimationFrame` দিয়ে মাঝের ফ্রেম interpolate করে (`src/lib/glide.ts`) ⇒ মার্কার লাফায় না, গড়িয়ে চলে।
- ⚠️ **GPS ফিড সিমুলেটেড** (UI-তে "ডেমো GPS ফিড" চিপ)। বাস একটি time-compressed লুপে রুট ধরে চলে। প্রোডাকশনে `computeLive()` প্রতিস্থাপন করে আসল ডিভাইসের ping বসাতে হবে।
- ⚠️ MapLibre ৬.x-এর ওয়ার্কার ফাইল Turbopack বান্ডলে ভাঙে, তাই `public/maplibre/maplibre-gl-worker.mjs` কপি করা আছে। `maplibre-gl` আপগ্রেড করলে আবার কপি করুন:
  `cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/maplibre/`

---

## ২) এই সংস্করণে ঠিক করা বাগ

| # | সমস্যা | সমাধান |
| --- | --- | --- |
| 1 | সার্চ ভুল ফল দিত: `a → b` লিখলে ৮টি বাস; `Khulna → Jessore` সার্চে জেলা-ম্যাচে Benapole ধরত | স্কোরিং (নাম হুবহু > নামের শুরু > অংশ > জেলা), ন্যূনতম ২ অক্ষর |
| 2 | সার্চ-সম্পাদনার পর পুরনো ফলাফল থেকে যেত (client state রিসেট হত না) | পেজে `key={query}` |
| 3 | হাইড্রেশন মিসম্যাচ (`new Date()` রেন্ডারে) | সরানো হয়েছে |
| 4 | ESLint-এ ৩টি `set-state-in-effect` এরর | অবস্থা "ফলাফল থেকে নির্ণীত", effect-এ sync setState নেই |
| 5 | এসি/নন-এসি ফিল্টার অনূদিত লেবেল মেলাত (ভাষা বদলের মুহূর্তে ভাঙত) | ভাষা-নিরপেক্ষ `serviceType` |
| 6 | লাইভ ক্যাশে race condition (খালি ফ্রেম ফেরত যেতে পারত) | `ttl-cache.ts` singleflight |
| 7 | `/api/buses` প্রতি রিকোয়েস্টে `select 1` চালাত (১০ কানেকশনের পুলে লাইন) | সরানো; read model থেকে উত্তর |
| 8 | বাস গন্তব্যে গিয়ে উল্টো ফিরত ⇒ "পরবর্তী কাউন্টার" ভুল; সড়কের বাইরে কাঁপুনি | শুধু সামনে চলা + গন্তব্যে থামা; কাঁপুনি নেই |
| 9 | প্রতি ৫ সেকেন্ডের পোলে ~১১KB (labels + স্টপ তালিকা) | ~৮৫০ বাইট (≈১৩× ছোট); labels ঐচ্ছিক `?labels=1` |
| 10 | Google Maps কোড `loading=async` + সরাসরি `new Map` (key দিলে ভাঙত) | `importLibrary` ব্যবহার |
| 11 | DB সাময়িক ব্যর্থ হলে সাইট বন্ধ | stale ক্যাটালগ দিয়ে চলে |
| 12 | সিডে serial sequence সিঙ্ক হত না; পুল প্রোডাকশনে globalThis-এ ছিল না | `setval`; একক শেয়ার্ড পুল + timeout |
| 13 | কোনো রেট লিমিট/সিকিউরিটি হেডার ছিল না | IP রেট লিমিট, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Powered-By` বন্ধ |

---

## ৩) লোড টেস্ট — ১০০০ ভার্চুয়াল ইউজার

```bash
ulimit -n 65536 && node scripts/load-test.mjs            # সব ধাপ
PHASES=realistic USERS=1000 ARRIVAL=30 node scripts/load-test.mjs
```

**পরিবেশ:** লোড-জেনারেটর ও সার্ভার একই ৪-CPU স্যান্ডবক্সে (জেনারেটর CPU ভাগ করে ⇒ ফল রক্ষণশীল), একটিমাত্র `next start` প্রসেস, সব রিকোয়েস্টে আলাদা ছদ্ম IP।

| পরিস্থিতি | ফল |
| --- | --- |
| **SPIKE** — ১০০০ জন একই মুহূর্তে `/api/live` | ১০০০/১০০০ সফল, p99 ≈ ১.৭s (১০০০ নতুন সকেট একসাথে খোলার খরচ) |
| **SUSTAINED** — ১০০০ জন × প্রতি ৫s পোল × ৩০s (৬১২৩ রিকোয়েস্ট) | ব্যর্থতা **০**, p50 **২ms**, p95 **৪ms**, p99 ৬ms |
| **REALISTIC** — ১০০০ জন ৩০s-এ এসে পেজ খুলল + ম্যাপ পোল | পেজ p50 **১৬ms** / p95 **৫১ms**; পোল p95 **৯ms**; ব্যর্থতা **০** |
| **ABUSE** — এক IP থেকে ৪০০ রিকোয়েস্ট | ২৪০ সফল, ১৬০ → **429**; একই সময়ে অন্য IP-র ইউজার ১ms-এ 200 |
| DB কানেকশন (লোডের আগে/পরে) | ১ / ১ — পোলিং DB স্পর্শ করে না |
| সার্ভার মেমরি | ~৭০০MB-এ স্থির (দুই রানে বাড়েনি) |

**সীমা (সৎভাবে):** এক Node প্রসেসের SSR ক্ষমতা ≈ **১০০ পেজ/সেকেন্ড** (ফ্রেমওয়ার্কের নিজস্ব খরচ ≈ ৭-১০ms/পেজ, সবচেয়ে হালকা পেজেও)। ১০০০ জন *ঠিক একই সেকেন্ডে* পেজ খুললে সবাই সফল হয় কিন্তু শেষ জন ≈ ৯s অপেক্ষা করে। বাস্তবে ইউজার ছড়িয়ে আসে (উপরের REALISTIC), আর খোলা পেজের পোল মাত্র ~২ms। আরও বড় ঢেউয়ের জন্য একাধিক ইনস্ট্যান্স + load balancer/CDN চালান এবং রেট-লিমিট/ক্যাশ Redis-এ নিন। ৩০০০+ কনকারেন্ট ইউজারের জন্য এটি আলাদা করে মাপা হয়নি। ৫ সেকেন্ড পোলে ETag/304 কদাচিৎ মেলে (ক্যাশ bucket ২s), আসল সাশ্রয় আসে ছোট পেলোড ও সার্ভার ক্যাশ থেকে।

---

## ৪) চালু করা

```bash
npm install
npx drizzle-kit push        # schema → PostgreSQL (টেবিল/সিড প্রথম রিকোয়েস্টে নিজেও তৈরি হয়)
npm run dev                 # http://localhost:3000
```

| env | কাজ |
| --- | --- |
| `DATABASE_URL` | PostgreSQL |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAP_ID` | ঐচ্ছিক Google ৩D |
| `NEXT_PUBLIC_MAP_STYLE_URL` | ঐচ্ছিক বিকল্প MapLibre স্টাইল |
| `OSRM_BASE_URL` | সড়কের জ্যামিতির সার্ভার (প্রোডাকশনে নিজস্ব দিন; ডেমো সার্ভার ≤১ req/s) |
| `RATE_LIMIT_LIVE_PER_MIN` (২৪০), `RATE_LIMIT_SEARCH_PER_MIN` (৯০), `RATE_LIMIT_API_PER_MIN` (১২০) | IP-ভিত্তিক সীমা |
| `TRUSTED_PROXY_HOPS` (১) | `X-Forwarded-For`-এর কোন অবস্থানের IP বিশ্বাসযোগ্য |
| `DB_POOL_MAX` (২০) | কানেকশন পুল |

---

## ৫) REST API (DRF-সামঞ্জস্যপূর্ণ)

সব এন্ডপয়েন্টে `?lang=bn|en`; খাম: `{ language, labels?, generatedAt, cacheTtlSeconds, data }`।

| Method | Path | কাজ |
| --- | --- | --- |
| GET | `/api/buses?lang=bn` | আজ সচল বাস + পরিসংখ্যান |
| GET | `/api/buses/:slug` | একটি বাসের বিস্তারিত |
| GET | `/api/search?mode=route&from=Dhaka&to=Khulna` | রুট + কাউন্টার ক্রম (`from=Dhaka to Khulna` এক ঘরেও চলে) |
| GET | `/api/search?mode=name&q=Ena` | নাম ভিত্তিক সার্চ |
| GET | `/api/live?bus=1&lang=bn` | ৫ সেকেন্ড পোলিং ফ্রেম (≈৮৫০B; `&labels=1` দিলে labels সহ) |
| GET | `/api/routes/:id/path` | আসল সড়কের পথ `[[lat,lng],…]` (CDN-এ ১ ঘণ্টা ক্যাশযোগ্য) |
| GET | `/api/health` | readiness probe |

## ৬) আর্কিটেকচার

```
Browser: setInterval(5s) → fetch(/api/live) → glide (rAF) → ৩D মার্কার
   → রেট লিমিট (IP) → ২s singleflight ক্যাশ (তৈরি JSON স্ট্রিংসহ)
   → গণনা: রুট পলিলাইন (আগে থেকে cumulative) + সময় → lat/lng/heading   [DB স্পর্শ নেই]
   → PostgreSQL read model (৬০s ক্যাশ; ব্যর্থ হলে stale; লেখা নেই)
```

## ৭) নিরাপত্তা

parameterised Drizzle query; `mode`/`lang`/amenity/id সব allow-list; ইনপুট ৮০ অক্ষরে সীমিত ও ছাঁকা; সব DOM টেক্সট `textContent`/React escape (XSS নেই); OSRM-এর বাইরের ডেটা যাচাই (সংখ্যা + বাংলাদেশের bbox) করে তবেই সংরক্ষণ; সার্ভার secret ক্লায়েন্টে যায় না; error-এ স্ট্যাক-ট্রেস ফাঁস নেই; IP রেট লিমিট; নিরাপত্তা হেডার। **এখনো নেই:** CSP (Next ইনলাইন স্ক্রিপ্ট ও ম্যাপ টাইলের জন্য নির্দিষ্ট nonce সেটআপ লাগবে), অ্যাডমিন/অথেন্টিকেশন (এই ডেমোতে প্রয়োজন নেই)।

## ৮) ফাইল ম্যাপ (প্রতিটি ফাইলে বাংলা কমেন্ট)

```
src/db/{index,schema,seed}.ts        পুল, টেবিল (+path_json), সিড
src/lib/geometry.ts                  পলিলাইন → cumulative km, positionAt, sliceByKm
src/lib/live.ts                      লাইভ GPS ইঞ্জিন (pure)
src/lib/road-geometry.ts             OSRM থেকে সড়কের পথ (ব্যাকগ্রাউন্ড, একবার)
src/lib/catalog.ts                   read model, সার্চ স্কোরিং, DTO, ক্যাশ
src/lib/{ttl-cache,rate-limit,glide}.ts   singleflight ক্যাশ, IP লিমিট, মসৃণ অ্যানিমেশন
src/components/LiveMap.tsx           পোলিং + ইঞ্জিন fallback চেইন + টুলবার
src/components/{MapLibreView,GoogleMapView,SvgMapView}.tsx   তিনটি ম্যাপ ইঞ্জিন
src/app/api/**/route.ts              REST (buses, search, live, routes/:id/path, health)
scripts/load-test.mjs                ১০০০+ ইউজার লোড টেস্ট
django_reference/*.py                Django ORM / DRF / URLconf রেফারেন্স
```
