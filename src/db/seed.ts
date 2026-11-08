// =====================================================================
// সিড ডেটা + সেল্ফ-হিলিং স্কিমা বুটস্ট্র্যাপ
// ---------------------------------------------------------------------
// Django তে এটি migration + fixture/seed management command-এর সমান।
// এখানে প্রথম রিকোয়েস্টে CREATE TABLE IF NOT EXISTS চালিয়ে নিশ্চিত করা হয়
// যে preview/production যেকোনো ফ্রেশ ডাটাবেজে অ্যাপটি নিজেই চালু হতে পারে।
// সব আইডি ফিক্সড হওয়ায় বারবার চালালেও ডুপ্লিকেট ডেটা তৈরি হয় না (idempotent)।
// =====================================================================

import { db } from "@/db"; // Drizzle ক্লায়েন্ট (pg Pool)
import { sql } from "drizzle-orm"; // র স্টেটমেন্টের জন্য sql.raw
import { buses, routes, routeStops, stops } from "@/db/schema"; // টেবিল ডেফিনিশন

// গ্লোবাল প্রমিজ: একই প্রসেসে একাধিক concurrent রিকোয়েস্টে সিড একবারই চলবে।
const globalForSeed = globalThis as typeof globalThis & { __shoroSeedPromise?: Promise<void> };

// টেবিল তৈরির DDL: Drizzle schema.ts-এর সাথে হুবহু মিল রেখে লেখা হয়েছে।
const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS routes (
  id serial PRIMARY KEY,
  code varchar(24) NOT NULL UNIQUE,
  name_en varchar(160) NOT NULL,
  name_bn varchar(160) NOT NULL,
  origin_en varchar(80) NOT NULL,
  origin_bn varchar(80) NOT NULL,
  destination_en varchar(80) NOT NULL,
  destination_bn varchar(80) NOT NULL,
  distance_km integer NOT NULL,
  duration_minutes integer NOT NULL,
  fare_bdt integer NOT NULL,
  path_json text
);
-- পুরনো ডাটাবেজে কলামটি না থাকলে যোগ হবে (idempotent migration)।
ALTER TABLE routes ADD COLUMN IF NOT EXISTS path_json text;
CREATE TABLE IF NOT EXISTS stops (
  id serial PRIMARY KEY,
  slug varchar(80) NOT NULL UNIQUE,
  name_en varchar(100) NOT NULL,
  name_bn varchar(100) NOT NULL,
  district_en varchar(100) NOT NULL,
  district_bn varchar(100) NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS stops_name_en_idx ON stops (name_en);
CREATE INDEX IF NOT EXISTS stops_name_bn_idx ON stops (name_bn);
CREATE TABLE IF NOT EXISTS route_stops (
  id serial PRIMARY KEY,
  route_id integer NOT NULL,
  stop_id integer NOT NULL,
  sequence integer NOT NULL,
  offset_minutes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS route_stops_route_seq_idx ON route_stops (route_id, sequence);
CREATE TABLE IF NOT EXISTS buses (
  id serial PRIMARY KEY,
  slug varchar(100) NOT NULL UNIQUE,
  name_en varchar(120) NOT NULL,
  name_bn varchar(120) NOT NULL,
  operator_en varchar(120) NOT NULL,
  operator_bn varchar(120) NOT NULL,
  registration_no varchar(40) NOT NULL,
  route_id integer NOT NULL,
  service_type varchar(20) NOT NULL,
  seat_count integer NOT NULL,
  amenities text NOT NULL,
  rating_x10 integer NOT NULL,
  departure_time varchar(8) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  accent_color varchar(16) NOT NULL,
  trip_start_minute integer NOT NULL,
  loop_seconds integer NOT NULL,
  base_speed_kph integer NOT NULL,
  device_lat double precision NOT NULL,
  device_lng double precision NOT NULL,
  device_updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS buses_name_en_idx ON buses (name_en);
CREATE INDEX IF NOT EXISTS buses_name_bn_idx ON buses (name_bn);
CREATE INDEX IF NOT EXISTS buses_active_idx ON buses (is_active);
-- Drizzle schema.ts-এ .unique() দিয়ে যে নামের constraint তৈরি হয়, সেটিই এখানে যোগ করি।
-- DO block ব্যবহার করায় পুরনো ডাটাবেজে বারবার চালালেও "already exists" error হয় না।
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_code_unique') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_code_unique UNIQUE (code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stops_slug_unique') THEN
    ALTER TABLE stops ADD CONSTRAINT stops_slug_unique UNIQUE (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buses_slug_unique') THEN
    ALTER TABLE buses ADD CONSTRAINT buses_slug_unique UNIQUE (slug);
  END IF;
END $$;
`;

// স্টপেজ ডেটা: [id, slug, nameEn, nameBn, districtEn, districtBn, lat, lng]
type StopSeed = [number, string, string, string, string, string, number, number];

// বাংলাদেশের বাস্তব আন্তঃনগর কাউন্টারের আনুমানিক স্থানাঙ্ক (ম্যাপ প্লটিংয়ের জন্য)।
const stopSeeds: StopSeed[] = [
  [1, "dhaka", "Dhaka", "ঢাকা", "Dhaka", "ঢাকা", 23.8103, 90.4125],
  [2, "savar", "Savar", "সাভার", "Dhaka", "ঢাকা", 23.8583, 90.2452],
  [3, "manikganj", "Manikganj", "মানিকগঞ্জ", "Manikganj", "মানিকগঞ্জ", 23.8617, 90.0003],
  [4, "faridpur", "Faridpur", "ফরিদপুর", "Faridpur", "ফরিদপুর", 23.0949, 89.846],
  [5, "magura", "Magura", "মাগুরা", "Magura", "মাগুরা", 23.4853, 89.419],
  [6, "jhenaidah", "Jhenaidah", "ঝিনাইদহ", "Jhenaidah", "ঝিনাইদহ", 23.5448, 89.174],
  [7, "jessore", "Jessore", "যশোর", "Jessore", "যশোর", 23.1687, 89.2082],
  [8, "khulna", "Khulna", "খুলনা", "Khulna", "খুলনা", 22.8168, 89.551],
  [9, "narayanganj", "Narayanganj", "নারায়ণগঞ্জ", "Narayanganj", "নারায়ণগঞ্জ", 23.6238, 90.4996],
  [10, "comilla", "Cumilla", "কুমিল্লা", "Cumilla", "কুমিল্লা", 23.4607, 91.1814],
  [11, "feni", "Feni", "ফেনী", "Feni", "ফেনী", 23.0159, 91.3971],
  [12, "chattogram", "Chattogram", "চট্টগ্রাম", "Chattogram", "চট্টগ্রাম", 22.3569, 91.7832],
  [13, "narsingdi", "Narsingdi", "নরসিংদী", "Narsingdi", "নরসিংদী", 23.9322, 90.7154],
  [14, "brahmanbaria", "Brahmanbaria", "ব্রাহ্মণবাড়িয়া", "Brahmanbaria", "ব্রাহ্মণবাড়িয়া", 23.957, 91.11],
  [15, "habiganj", "Habiganj", "হাবিগঞ্জ", "Habiganj", "হাবিগঞ্জ", 24.375, 91.415],
  [16, "sylhet", "Sylhet", "সিলেট", "Sylhet", "সিলেট", 24.8949, 91.8687],
  [17, "gazipur", "Gazipur", "গাজীপুর", "Gazipur", "গাজীপুর", 23.9999, 90.4203],
  [18, "tangail", "Tangail", "টাঙ্গাইল", "Tangail", "টাঙ্গাইল", 24.2513, 89.9167],
  [19, "bogura", "Bogura", "বগুড়া", "Bogura", "বগুড়া", 24.851, 89.374],
  [20, "rajshahi", "Rajshahi", "রাজশাহী", "Rajshahi", "রাজশাহী", 24.3745, 88.6042],
  [21, "mawa", "Mawa", "মাওয়া", "Munshiganj", "মুন্সীগঞ্জ", 23.538, 90.226],
  [22, "barishal", "Barishal", "বরিশাল", "Barishal", "বরিশাল", 22.701, 90.3535],
  [23, "patuakhali", "Patuakhali", "পটুয়াখালী", "Patuakhali", "পটুয়াখালী", 22.354, 90.318],
  [24, "pabna", "Pabna", "পাবনা", "Pabna", "পাবনা", 24.0064, 89.237],
  [25, "kushtia", "Kushtia", "কুষ্টিয়া", "Kushtia", "কুষ্টিয়া", 23.901, 89.122],
  [26, "benapole", "Benapole", "বেনাপোল", "Jessore", "যশোর", 23.048, 88.911],
  [27, "coxs-bazar", "Cox's Bazar", "কক্সবাজার", "Cox's Bazar", "কক্সবাজার", 21.4272, 92.0058],
  [28, "rangpur", "Rangpur", "রংপুর", "Rangpur", "রংপুর", 25.7439, 89.2752],
  [29, "mymensingh", "Mymensingh", "ময়মনসিংহ", "Mymensingh", "ময়মনসিংহ", 24.7471, 90.4206],
  [30, "narsingdi", "Narsingdi", "নরসিংদী", "Narsingdi", "নরসিংদী", 23.9322, 90.7154],
  [31, "tangail", "Tangail", "টাঙ্গাইল", "Tangail", "টাঙ্গাইল", 24.2513, 89.9167],
  [32, "jamalpur", "Jamalpur", "জামালপুর", "Jamalpur", "জামালপুর", 24.8971, 89.9506],
  [33, "sherpur", "Sherpur", "শেরপুর", "Sherpur", "শেরপুর", 25.0167, 90.0167],
  [34, "netrokona", "Netrokona", "নেত্রকোণা", "Netrokona", "নেত্রকোণা", 24.8811, 90.7276],
  [35, "kishoreganj", "Kishoreganj", "কিশোরগঞ্জ", "Kishoreganj", "কিশোরগঞ্জ", 24.4407, 90.7795],
  [36, "gazipur", "Gazipur", "গাজীপুর", "Gazipur", "গাজীপুর", 23.9999, 90.4203],
  [37, "narayanganj", "Narayanganj", "নারায়ণগঞ্জ", "Narayanganj", "নারায়ণগঞ্জ", 23.6238, 90.4996],
  [38, "manikganj", "Manikganj", "মানিকগঞ্জ", "Manikganj", "মানিকগঞ্জ", 23.8617, 90.0003],
  [39, "savar", "Savar", "সাভার", "Dhaka", "ঢাকা", 23.8583, 90.2452],
  [40, "feni", "Feni", "ফেনী", "Feni", "ফেনী", 23.0159, 91.3971],
  [41, "noakhali", "Noakhali", "নোয়াখালী", "Noakhali", "নোয়াখালী", 22.8111, 91.0993],
  [42, "lakshmipur", "Lakshmipur", "লক্ষ্মীপুর", "Lakshmipur", "লক্ষ্মীপুর", 22.9407, 90.8211],
  [43, "chandpur", "Chandpur", "চাঁদপুর", "Chandpur", "চাঁদপুর", 23.2337, 90.6669],
  [44, "comilla", "Cumilla", "কুমিল্লা", "Cumilla", "কুমিল্লা", 23.4607, 91.1814],
  [45, "brahmanbaria", "Brahmanbaria", "ব্রাহ্মণবাড়িয়া", "Brahmanbaria", "ব্রাহ্মণবাড়িয়া", 23.957, 91.11],
  [46, "habiganj", "Habiganj", "হাবিগঞ্জ", "Habiganj", "হাবিগঞ্জ", 24.375, 91.415],
  [47, "moulvibazar", "Moulvibazar", "মৌলভীবাজার", "Moulvibazar", "মৌলভীবাজার", 24.4829, 91.7714],
  [48, "sunamganj", "Sunamganj", "সুনামগঞ্জ", "Sunamganj", "সুনামগঞ্জ", 25.0711, 91.3971],
  [49, "sylhet", "Sylhet", "সিলেট", "Sylhet", "সিলেট", 24.8949, 91.8687],
  [50, "rajshahi", "Rajshahi", "রাজশাহী", "Rajshahi", "রাজশাহী", 24.3745, 88.6042],
  [51, "naogaon", "Naogaon", "নওগাঁ", "Naogaon", "নওগাঁ", 24.8084, 88.9384],
  [52, "natore", "Natore", "নাটোর", "Natore", "নাটোর", 24.4205, 89.0036],
  [53, "chapainawabganj", "Chapainawabganj", "চাঁপাইনবাবগঞ্জ", "Chapainawabganj", "চাঁপাইনবাবগঞ্জ", 24.5941, 88.2723],
  [54, "pabna", "Pabna", "পাবনা", "Pabna", "পাবনা", 24.0064, 89.237],
  [55, "sirajganj", "Sirajganj", "সিরাজগঞ্জ", "Sirajganj", "সিরাজগঞ্জ", 24.4531, 89.7008],
  [56, "bogura", "Bogura", "বগুড়া", "Bogura", "বগুড়া", 24.851, 89.374],
  [57, "joypurhat", "Joypurhat", "জয়পুরহাট", "Joypurhat", "জয়পুরহাট", 25.0977, 89.0269],
  [58, "khulna", "Khulna", "খুলনা", "Khulna", "খুলনা", 22.8168, 89.551],
  [59, "jessore", "Jessore", "যশোর", "Jessore", "যশোর", 23.1687, 89.2082],
  [60, "satkhira", "Satkhira", "সাতখিরা", "Satkhira", "সাতখিরা", 22.7082, 89.0719],
  [61, "narail", "Narail", "নড়াইল", "Narail", "নড়াইল", 23.1773, 89.5102],
  [62, "magura", "Magura", "মাগুরা", "Magura", "মাগুরা", 23.4853, 89.419],
  [63, "jhenaidah", "Jhenaidah", "ঝিনাইদহ", "Jhenaidah", "ঝিনাইদহ", 23.5448, 89.174],
  [64, "kushtia", "Kushtia", "কুষ্টিয়া", "Kushtia", "কুষ্টিয়া", 23.901, 89.122],
  [65, "chuadanga", "Chuadanga", "চুয়াডাঙ্গা", "Chuadanga", "চুয়াডাঙ্গা", 23.6401, 88.8412],
  [66, "meherpur", "Meherpur", "মেহেরপুর", "Meherpur", "মেহেরপুর", 23.7118, 88.6308],
  [67, "barishal", "Barishal", "বরিশাল", "Barishal", "বরিশাল", 22.701, 90.3535],
  [68, "barguna", "Barguna", "বরগুনা", "Barguna", "বরগুনা", 22.0935, 90.1144],
  [69, "patuakhali", "Patuakhali", "পটুয়াখালী", "Patuakhali", "পটুয়াখালী", 22.354, 90.318],
  [70, "jhalakathi", "Jhalakathi", "ঝালকাঠি", "Jhalakathi", "ঝালকাঠি", 22.6321, 90.1962],
  [71, "pirojpur", "Pirojpur", "পিরোজপুর", "Pirojpur", "পিরোজপুর", 22.5784, 89.9752],
  [72, "bhola", "Bhola", "ভোলা", "Bhola", "ভোলা", 22.1449, 90.6489],
  [73, "coxs-bazar", "Cox's Bazar", "কক্সবাজার", "Cox's Bazar", "কক্সবাজার", 21.4272, 92.0058],
  [74, "bandarban", "Bandarban", "বান্দরবান", "Bandarban", "বান্দরবান", 22.1953, 92.2183],
  [75, "khagrachari", "Khagrachari", "খাগড়াছড়ি", "Khagrachari", "খাগড়াছড়ি", 23.1194, 91.9786],
  [76, "rangamati", "Rangamati", "রাঙ্গামাটি", "Rangamati", "রাঙ্গামাটি", 22.6156, 92.1794],
];

// রুট ডেফিনিশন: [id, code, nameEn, nameBn, originStopId, destStopId, km, mins, fare, stopIds]
type RouteSeed = [number, string, string, string, number, number, number, number, number, number[]];

// দিক-ভিত্তিক রুট (Dhaka→Khulna এবং Khulna→Dhaka আলাদা), যেন সার্চ ক্রম মেলে।
const routeSeeds: RouteSeed[] = [
  [1, "DHK-KHL-01", "Dhaka → Khulna", "ঢাকা → খুলনা", 1, 8, 332, 420, 850, [1, 2, 3, 4, 5, 6, 7, 8]],
  [2, "KHL-DHK-01", "Khulna → Dhaka", "খুলনা → ঢাকা", 8, 1, 332, 420, 850, [8, 7, 6, 5, 4, 3, 2, 1]],
  [3, "DHK-CTG-01", "Dhaka → Chattogram", "ঢাকা → চট্টগ্রাম", 1, 12, 265, 330, 720, [1, 9, 10, 11, 12]],
  [4, "CTG-DHK-01", "Chattogram → Dhaka", "চট্টগ্রাম → ঢাকা", 12, 1, 265, 330, 720, [12, 11, 10, 9, 1]],
  [5, "DHK-SYL-01", "Dhaka → Sylhet", "ঢাকা → সিলেট", 1, 16, 245, 330, 680, [1, 17, 13, 14, 15, 16]],
  [6, "SYL-DHK-01", "Sylhet → Dhaka", "সিলেট → ঢাকা", 16, 1, 245, 330, 680, [16, 15, 14, 13, 17, 1]],
  [7, "DHK-RAJ-01", "Dhaka → Rajshahi", "ঢাকা → রাজশাহী", 1, 20, 255, 360, 700, [1, 2, 18, 19, 24, 20]],
  [8, "RAJ-DHK-01", "Rajshahi → Dhaka", "রাজশাহী → ঢাকা", 20, 1, 255, 360, 700, [20, 24, 19, 18, 2, 1]],
  [9, "DHK-BAR-01", "Dhaka → Barishal", "ঢাকা → বরিশাল", 1, 22, 142, 210, 480, [1, 21, 22, 23]],
  [10, "BAR-DHK-01", "Barishal → Dhaka", "বরিশাল → ঢাকা", 22, 1, 142, 210, 480, [23, 22, 21, 1]],
  [11, "DHK-CXB-01", "Dhaka → Cox's Bazar", "ঢাকা → কক্সবাজার", 1, 27, 415, 540, 1250, [1, 9, 10, 11, 12, 27]],
  [12, "JSR-DHK-01", "Jessore → Dhaka", "যশোর → ঢাকা", 7, 1, 280, 360, 760, [7, 6, 5, 25, 4, 3, 2, 1]],
  [13, "DHK-RNG-01", "Dhaka → Rangpur", "ঢাকা → রংপুর", 1, 28, 330, 420, 820, [1, 2, 18, 19, 28]],
  [14, "KHL-BNP-01", "Khulna → Benapole", "খুলনা → বেনাপোল", 8, 26, 105, 150, 320, [8, 7, 26]],
  // ঢাকা থেকে সারাদেশের নতুন রুটসমূহ (দ vlak ভিত্তিক সার্চের জন্য)
  [15, "DHK-MYM-01", "Dhaka → Mymensingh", "ঢাকা → ময়মনসিংহ", 1, 29, 120, 180, 350, [1, 37, 29]],
  [16, "MYM-DHK-01", "Mymensingh → Dhaka", "ময়মনসিংহ → ঢাকা", 29, 1, 120, 180, 350, [29, 37, 1]],
  [17, "DHK-CUM-01", "Dhaka → Cumilla", "ঢাকা → কুমিল্লা", 1, 44, 100, 150, 300, [1, 37, 44]],
  [18, "CUM-DHK-01", "Cumilla → Dhaka", "কুমিল্লা → ঢাকা", 44, 1, 100, 150, 300, [44, 37, 1]],
  [19, "DHK-NOA-01", "Dhaka → Noakhali", "ঢাকা → নোয়াখালী", 1, 41, 150, 240, 450, [1, 37, 44, 41]],
  [20, "NOA-DHK-01", "Noakhali → Dhaka", "নোয়াখালী → ঢাকা", 41, 1, 150, 240, 450, [41, 44, 37, 1]],
  [21, "DHK-CHP-01", "Dhaka → Chandpur", "ঢাকা → চাঁদপুর", 1, 43, 110, 170, 320, [1, 37, 44, 43]],
  [22, "CHP-DHK-01", "Chandpur → Dhaka", "চাঁদপুর → ঢাকা", 43, 1, 110, 170, 320, [43, 44, 37, 1]],
  [23, "DHK-FEN-01", "Dhaka → Feni", "ঢাকা → ফেনী", 1, 40, 150, 230, 420, [1, 37, 44, 40]],
  [24, "FEN-DHK-01", "Feni → Dhaka", "ফেনী → ঢাকা", 40, 1, 150, 230, 420, [40, 44, 37, 1]],
  [25, "DHK-BOG-01", "Dhaka → Bogura", "ঢাকা → বগুড়া", 1, 56, 180, 270, 480, [1, 2, 31, 56]],
  [26, "BOG-DHK-01", "Bogura → Dhaka", "বগুড়া → ঢাকা", 56, 1, 180, 270, 480, [56, 31, 2, 1]],
  [27, "DHK-SIJ-01", "Dhaka → Sirajganj", "ঢাকা → সিরাজগঞ্জ", 1, 55, 130, 200, 380, [1, 2, 31, 55]],
  [28, "SIJ-DHK-01", "Sirajganj → Dhaka", "সিরাজগঞ্জ → ঢাকা", 55, 1, 130, 200, 380, [55, 31, 2, 1]],
  [29, "DHK-PAB-01", "Dhaka → Pabna", "ঢাকা → পাবনা", 1, 54, 160, 240, 420, [1, 2, 31, 54]],
  [30, "PAB-DHK-01", "Pabna → Dhaka", "পাবনা → ঢাকা", 54, 1, 160, 240, 420, [54, 31, 2, 1]],
  [31, "DHK-NAT-01", "Dhaka → Natore", "ঢাকা → নাটোর", 1, 52, 200, 300, 520, [1, 2, 31, 52]],
  [32, "NAT-DHK-01", "Natore → Dhaka", "নাটোর → ঢাকা", 52, 1, 200, 300, 520, [52, 31, 2, 1]],
];

// স্টপ id → নাম বের করার সহায়ক ম্যাপ (রুটের named fields তৈরিতে)।
const stopById = new Map(stopSeeds.map((row) => [row[0], row]));

// বাস সিড: প্রতিটি এন্ট্রি একটি সার্ভিস; "Ena" দুটি বাসে আছে (নাম সার্চ ডেমোর জন্য)।
type BusSeed = {
  id: number;
  slug: string;
  nameEn: string;
  nameBn: string;
  operatorEn: string;
  operatorBn: string;
  registrationNo: string;
  routeId: number;
  serviceType: "ac" | "non_ac";
  seatCount: number;
  amenities: string;
  ratingX10: number;
  departureTime: string;
  isActive: boolean;
  accentColor: string;
  tripStartMinute: number;
  loopSeconds: number;
  baseSpeedKph: number;
};

const busSeeds: BusSeed[] = [
  { id: 1, slug: "ena-royal-express", nameEn: "Ena Royal Express", nameBn: "এনা রয়েল এক্সপ্রেস", operatorEn: "Ena Transport", operatorBn: "এনা ট্রান্সপোর্ট", registrationNo: "DHK-GA-11-4521", routeId: 1, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,reclining,water,gps", ratingX10: 48, departureTime: "06:30", isActive: true, accentColor: "#f2b544", tripStartMinute: 12, loopSeconds: 540, baseSpeedKph: 62 },
  { id: 2, slug: "ena-super-deluxe", nameEn: "Ena Super Deluxe", nameBn: "এনা সুপার ডিলাক্স", operatorEn: "Ena Transport", operatorBn: "এনা ট্রান্সপোর্ট", registrationNo: "KHL-GA-12-1180", routeId: 2, serviceType: "ac", seatCount: 44, amenities: "wifi,charging,reclining,gps", ratingX10: 46, departureTime: "07:15", isActive: true, accentColor: "#58c7a4", tripStartMinute: 76, loopSeconds: 600, baseSpeedKph: 58 },
  { id: 3, slug: "green-line-dhk-ctg", nameEn: "Green Line Premium", nameBn: "গ্রিন লাইন প্রিমিয়াম", operatorEn: "Green Line Paribahan", operatorBn: "গ্রিন লাইন পরিবহন", registrationNo: "DHK-GA-15-8830", routeId: 3, serviceType: "ac", seatCount: 36, amenities: "wifi,charging,reclining,water,gps", ratingX10: 49, departureTime: "08:00", isActive: true, accentColor: "#5bd6c0", tripStartMinute: 31, loopSeconds: 480, baseSpeedKph: 68 },
  { id: 4, slug: "shyamoli-sylhet", nameEn: "Shyamoli NR Travels", nameBn: "শ্যামলী এন আর ট্রাভেলস", operatorEn: "Shyamoli Paribahan", operatorBn: "শ্যামলী পরিবহন", registrationNo: "DHK-GA-13-2209", routeId: 5, serviceType: "ac", seatCount: 42, amenities: "charging,reclining,water,gps", ratingX10: 45, departureTime: "06:45", isActive: true, accentColor: "#8fa8ff", tripStartMinute: 118, loopSeconds: 570, baseSpeedKph: 60 },
  { id: 5, slug: "hanif-rajshahi", nameEn: "Hanif Enterprise", nameBn: "হানিফ এন্টারপ্রাইজ", operatorEn: "Hanif Paribahan", operatorBn: "হানিফ পরিবহন", registrationNo: "DHK-GA-14-6742", routeId: 7, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,gps", ratingX10: 44, departureTime: "09:20", isActive: true, accentColor: "#f28f6b", tripStartMinute: 54, loopSeconds: 620, baseSpeedKph: 56 },
  { id: 6, slug: "shohagh-barishal", nameEn: "Shohagh Paribahan", nameBn: "শোহাগ পরিবহন", operatorEn: "Shohagh Group", operatorBn: "শোহাগ গ্রুপ", registrationNo: "DHK-GA-16-3391", routeId: 9, serviceType: "non_ac", seatCount: 48, amenities: "charging,water,gps", ratingX10: 42, departureTime: "07:40", isActive: true, accentColor: "#d5a1ff", tripStartMinute: 143, loopSeconds: 450, baseSpeedKph: 52 },
  { id: 7, slug: "soudia-coxs", nameEn: "Soudia Coach Service", nameBn: "সৌদিয়া কোচ সার্ভিস", operatorEn: "Soudia Coach", operatorBn: "সৌদিয়া কোচ", registrationNo: "DHK-GA-17-9021", routeId: 11, serviceType: "ac", seatCount: 34, amenities: "wifi,charging,reclining,water,gps", ratingX10: 47, departureTime: "21:30", isActive: true, accentColor: "#7dd3fc", tripStartMinute: 22, loopSeconds: 660, baseSpeedKph: 64 },
  { id: 8, slug: "eagle-chattogram", nameEn: "Eagle Paribahan", nameBn: "ঈগল পরিবহন", operatorEn: "Eagle Group", operatorBn: "ঈগল গ্রুপ", registrationNo: "CTG-GA-11-4028", routeId: 4, serviceType: "ac", seatCount: 38, amenities: "wifi,charging,gps", ratingX10: 43, departureTime: "10:10", isActive: true, accentColor: "#fbbf6e", tripStartMinute: 96, loopSeconds: 510, baseSpeedKph: 61 },
  { id: 9, slug: "desh-travels-sylhet", nameEn: "Desh Travels", nameBn: "দেশ ট্রাভেলস", operatorEn: "Desh Group", operatorBn: "দেশ গ্রুপ", registrationNo: "SYL-GA-12-7713", routeId: 6, serviceType: "ac", seatCount: 40, amenities: "reclining,water,gps", ratingX10: 44, departureTime: "08:30", isActive: true, accentColor: "#9ae6b4", tripStartMinute: 168, loopSeconds: 585, baseSpeedKph: 59 },
  { id: 10, slug: "akota-jessore", nameEn: "Akota Paribahan", nameBn: "আকোটা পরিবহন", operatorEn: "Akota Group", operatorBn: "আকোটা গ্রুপ", registrationNo: "JSR-GA-13-2280", routeId: 12, serviceType: "non_ac", seatCount: 46, amenities: "charging,gps", ratingX10: 41, departureTime: "05:50", isActive: true, accentColor: "#f7a8c4", tripStartMinute: 205, loopSeconds: 555, baseSpeedKph: 54 },
  { id: 11, slug: "sakura-rangpur", nameEn: "Sakura Express", nameBn: "সাকুরা এক্সপ্রেস", operatorEn: "Sakura Travels", operatorBn: "সাকুরা ট্রাভেলস", registrationNo: "DHK-GA-18-5502", routeId: 13, serviceType: "ac", seatCount: 36, amenities: "wifi,charging,reclining,gps", ratingX10: 46, departureTime: "22:00", isActive: true, accentColor: "#a5b4fc", tripStartMinute: 240, loopSeconds: 630, baseSpeedKph: 63 },
  { id: 12, slug: "modhumoti-khulna", nameEn: "Modhumoti Lines", nameBn: "মধুমতী লাইন্স", operatorEn: "Modhumoti Group", operatorBn: "মধুমতী গ্রুপ", registrationNo: "KHL-GA-11-8834", routeId: 1, serviceType: "non_ac", seatCount: 50, amenities: "water,gps", ratingX10: 40, departureTime: "11:15", isActive: true, accentColor: "#86efac", tripStartMinute: 288, loopSeconds: 600, baseSpeedKph: 50 },
  { id: 13, slug: "banalata-benapole", nameEn: "Banalata Express", nameBn: "বনলতা এক্সপ্রেস", operatorEn: "Banalata Travels", operatorBn: "বনলতা ট্রাভেলস", registrationNo: "KHL-GA-15-1190", routeId: 14, serviceType: "ac", seatCount: 38, amenities: "wifi,charging,gps", ratingX10: 45, departureTime: "13:00", isActive: false, accentColor: "#cbd5e1", tripStartMinute: 320, loopSeconds: 480, baseSpeedKph: 57 },
  { id: 14, slug: "royal-rangpur", nameEn: "Royal Rajshahi", nameBn: "রয়েল রাজশাহী", operatorEn: "Royal Group", operatorBn: "রয়েল গ্রুপ", registrationNo: "RAJ-GA-14-6620", routeId: 8, serviceType: "ac", seatCount: 40, amenities: "charging,reclining,gps", ratingX10: 43, departureTime: "12:30", isActive: false, accentColor: "#cbd5e1", tripStartMinute: 350, loopSeconds: 600, baseSpeedKph: 58 },
  { id: 15, slug: "nabil-north-bengal", nameEn: "Nabil North Bengal Express", nameBn: "নাবিল উত্তরবঙ্গ এক্সপ্রেস", operatorEn: "Nabil Paribahan", operatorBn: "নাবিল পরিবহন", registrationNo: "RAJ-GA-16-7734", routeId: 7, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,gps", ratingX10: 45, departureTime: "10:00", isActive: true, accentColor: "#ef9a9a", tripStartMinute: 180, loopSeconds: 610, baseSpeedKph: 59 },
  { id: 16, slug: "saintmartin-coxs", nameEn: "Saintmartin Travels", nameBn: "সেন্টমার্টিন ট্রাভেলস", operatorEn: "Saintmartin Travels", operatorBn: "সেন্টমার্টিন ট্রাভেলস", registrationNo: "CXB-GA-15-5023", routeId: 11, serviceType: "ac", seatCount: 36, amenities: "wifi,charging,reclining,water,gps", ratingX10: 47, departureTime: "19:30", isActive: true, accentColor: "#5c6bc0", tripStartMinute: 400, loopSeconds: 640, baseSpeedKph: 65 },
  // নতুন রুটের বাসসমূহ (ঢাকা থেকে সারাদেশ)
  { id: 17, slug: "mymensingh-express", nameEn: "Mymensingh Express", nameBn: "ময়মনসিংহ এক্সপ্রেস", operatorEn: "Mymensingh Paribahan", operatorBn: "ময়মনসিংহ পরিবহন", registrationNo: "MYM-GA-17-8841", routeId: 15, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,reclining,water,gps", ratingX10: 46, departureTime: "07:00", isActive: true, accentColor: "#ffab91", tripStartMinute: 60, loopSeconds: 240, baseSpeedKph: 60 },
  { id: 18, slug: "cumilla-dhaka", nameEn: "Cumilla Dhaka Link", nameBn: "কুমিল্লা ঢাকা লিঙ্ক", operatorEn: "Cumilla Paribahan", operatorBn: "কুমিল্লা পরিবহন", registrationNo: "CUM-GA-18-9021", routeId: 17, serviceType: "ac", seatCount: 38, amenities: "wifi,charging,gps", ratingX10: 45, departureTime: "07:30", isActive: true, accentColor: "#81c784", tripStartMinute: 90, loopSeconds: 200, baseSpeedKph: 62 },
  { id: 19, slug: "noakhali-link", nameEn: "Noakhali Link Service", nameBn: "নোয়াখালী লিঙ্ক সার্ভিস", operatorEn: "Noakhali Travels", operatorBn: "নোয়াখালী ট্রাভেলস", registrationNo: "NOA-GA-19-1103", routeId: 19, serviceType: "ac", seatCount: 42, amenities: "wifi,charging,reclining,water,gps", ratingX10: 47, departureTime: "06:00", isActive: true, accentColor: "#ffcc80", tripStartMinute: 120, loopSeconds: 320, baseSpeedKph: 58 },
  { id: 20, slug: "chandpur-express", nameEn: "Chandpur Express", nameBn: "চাঁদপুর এক্সপ্রেস", operatorEn: "Chandpur Paribahan", operatorBn: "চাঁদপুর পরিবহন", registrationNo: "CHP-GA-20-4455", routeId: 21, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,gps", ratingX10: 44, departureTime: "08:15", isActive: true, accentColor: "#64b5f6", tripStartMinute: 150, loopSeconds: 220, baseSpeedKph: 61 },
  { id: 21, slug: "feni-express", nameEn: "Feni Express", nameBn: "ফেনী এক্সপ্রেস", operatorEn: "Feni Paribahan", operatorBn: "ফেনী পরিবহন", registrationNo: "FEN-GA-21-7788", routeId: 23, serviceType: "ac", seatCount: 36, amenities: "wifi,charging,reclining,water,gps", ratingX10: 46, departureTime: "05:45", isActive: true, accentColor: "#ba68c8", tripStartMinute: 180, loopSeconds: 300, baseSpeedKph: 63 },
  { id: 22, slug: "bogura-link", nameEn: "Bogura Link Express", nameBn: "বগুড়া লিঙ্ক এক্সপ্রেস", operatorEn: "Bogura Travels", operatorBn: "বগুড়া ট্রাভেলস", registrationNo: "BOG-GA-22-3310", routeId: 25, serviceType: "ac", seatCount: 44, amenities: "wifi,charging,reclining,gps", ratingX10: 45, departureTime: "09:00", isActive: true, accentColor: "#4db6ac", tripStartMinute: 210, loopSeconds: 360, baseSpeedKph: 59 },
  { id: 23, slug: "sirajganj-express", nameEn: "Sirajganj Express", nameBn: "সিরাজগঞ্জ এক্সপ্রেস", operatorEn: "Sirajganj Paribahan", operatorBn: "সিরাজগঞ্জ পরিবহন", registrationNo: "SIJ-GA-23-5566", routeId: 27, serviceType: "non_ac", seatCount: 48, amenities: "charging,water,gps", ratingX10: 42, departureTime: "06:30", isActive: true, accentColor: "#ff8a65", tripStartMinute: 240, loopSeconds: 280, baseSpeedKph: 55 },
  { id: 24, slug: "pabna-link", nameEn: "Pabna Link Service", nameBn: "পাবনা লিঙ্ক সার্ভিস", operatorEn: "Pabna Paribahan", operatorBn: "পাবনা পরিবহন", registrationNo: "PAB-GA-24-2299", routeId: 29, serviceType: "non_ac", seatCount: 50, amenities: "water,gps", ratingX10: 41, departureTime: "07:45", isActive: true, accentColor: "#aed581", tripStartMinute: 270, loopSeconds: 320, baseSpeedKph: 54 },
  { id: 25, slug: "natore-link", nameEn: "Natore Link Express", nameBn: "নাটোর লিঙ্ক এক্সপ্রেস", operatorEn: "Natore Travels", operatorBn: "নাটোর ট্রাভেলস", registrationNo: "NAT-GA-25-6644", routeId: 31, serviceType: "ac", seatCount: 40, amenities: "wifi,charging,gps", ratingX10: 44, departureTime: "10:15", isActive: true, accentColor: "#ffd54f", tripStartMinute: 300, loopSeconds: 400, baseSpeedKph: 57 },
];

// GPS ডিভাইসের শেষ ping-এর固定的 সময় (সব সিডে একই, ডেমোর জন্য নির্ণয়যোগ্য)।
const DEVICE_TIME = new Date("2026-01-01T00:00:00.000Z");

// মূল সিড ফাংশন: DDL → stops → routes → route_stops → buses (ক্রম FK-বান্ধব)।
async function runSeed(): Promise<void> {
  // ১) টেবিল ও ইনডেক্স নিশ্চিত করি; mysql/postgres ফ্রেশ ইনস্ট্যান্সেও কাজ করে।
  await db.execute(sql.raw(BOOTSTRAP_DDL));

  // ২) স্টপেজ insert; onConflictDoNothing দিয়ে rerun-safe রাখা হয়েছে।
  await db
    .insert(stops)
    .values(
      stopSeeds.map((row) => ({
        id: row[0],
        slug: row[1],
        nameEn: row[2],
        nameBn: row[3],
        districtEn: row[4],
        districtBn: row[5],
        lat: row[6],
        lng: row[7],
      })),
    )
    .onConflictDoNothing();

  // ৩) রুট insert; origin/destination নাম স্টপ টেবিল থেকে নেওয়া হয়।
  await db
    .insert(routes)
    .values(
      routeSeeds.map((row) => {
        const origin = stopById.get(row[4])!;
        const destination = stopById.get(row[5])!;
        return {
          id: row[0],
          code: row[1],
          nameEn: row[2],
          nameBn: row[3],
          originEn: origin[2],
          originBn: origin[3],
          destinationEn: destination[2],
          destinationBn: destination[3],
          distanceKm: row[6],
          durationMinutes: row[7],
          fareBdt: row[8],
        };
      }),
    )
    .onConflictDoNothing();

  // ৪) রুটের কাউন্টার-ক্রম insert; sequence = 1..n, offset = যাত্রার আনুমানিক মিনিট।
  const routeStopRows: { id: number; routeId: number; stopId: number; sequence: number; offsetMinutes: number }[] = [];
  let routeStopId = 1;
  for (const row of routeSeeds) {
    const totalStops = row[9].length;
    row[9].forEach((stopId, index) => {
      routeStopRows.push({
        id: routeStopId++,
        routeId: row[0],
        stopId,
        sequence: index + 1,
        offsetMinutes: Math.round((index / (totalStops - 1)) * row[7]),
      });
    });
  }
  await db.insert(routeStops).values(routeStopRows).onConflictDoNothing();

  // ৫) বাস insert; GPS অ্যাঙ্কর হিসেবে রুটের প্রথম স্টপের স্থানাঙ্ক ব্যবহার করি।
  await db
    .insert(buses)
    .values(
      busSeeds.map((bus) => {
        const firstStopId = routeSeeds.find((row) => row[0] === bus.routeId)![9][0];
        const firstStop = stopById.get(firstStopId)!;
        return {
          ...bus,
          deviceLat: firstStop[6],
          deviceLng: firstStop[7],
          deviceUpdatedAt: DEVICE_TIME,
        };
      }),
    )
    .onConflictDoNothing();

  // ৬) বাগ ফিক্স: স্পষ্ট id দিয়ে insert করলে serial sequence এগোয় না; ভবিষ্যতের insert-এ
  //    "duplicate key" এড়াতে প্রতিটি sequence-কে সর্বোচ্চ id-তে সিঙ্ক করি।
  await db.execute(
    sql.raw(`
      SELECT setval(pg_get_serial_sequence('routes','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM routes),1));
      SELECT setval(pg_get_serial_sequence('stops','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM stops),1));
      SELECT setval(pg_get_serial_sequence('route_stops','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM route_stops),1));
      SELECT setval(pg_get_serial_sequence('buses','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM buses),1));
    `),
  );
}

// বাইরে থেকে কল করার একমাত্র এন্ট্রিপয়েন্ট: singleflight দিয়ে race condition এড়াই।
export function ensureSeeded(): Promise<void> {
  if (!globalForSeed.__shoroSeedPromise) {
    // ব্যর্থ হলে পরবর্তী রিকোয়েস্টে আবার চেষ্টা করা যায় বলে catch-এ প্রমিজ রিসেট করি।
    globalForSeed.__shoroSeedPromise = runSeed().catch((error) => {
      globalForSeed.__shoroSeedPromise = undefined;
      throw error;
    });
  }
  return globalForSeed.__shoroSeedPromise;
}
