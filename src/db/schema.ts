// =====================================================================
// ডাটাবেজ স্কিমা: PostgreSQL + Drizzle ORM
// ---------------------------------------------------------------------
// নোট: মূল পরিকল্পনায় Django ORM + DRF থাকলেও এই রানটাইমে Next.js
// Route Handlers কে REST কনট্রোলার হিসেবে ব্যবহার করা হয়েছে।
// টেবিলের কনট্রাক্ট Django মডেলের সাথে ১:১ ম্যাপ করা যায়
// (django_reference/models.py দেখুন)।
// প্রতিটি টেবিল "লাইভ লোকেশন" ফিচারের জন্য ইনডেক্স-ফ্রেন্ডলি রাখা হয়েছে,
// যাতে ১০০০+ ইউজার একসাথে পোলিং করলে DB তে বারবার JOIN না পড়ে।
// =====================================================================

import {
  pgTable,
  serial,
  varchar,
  integer,
  doublePrecision,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// রুট টেবিল: একটি রুট = একটি নির্দিষ্ট দিকের যাত্রাপথ (যেমন ঢাকা → খুলনা)।
// দুই ভাষার নাম আলাদা কলামে রাখা হয়েছে, ফলে API তে JOIN/গণনার প্রয়োজন নেই।
export const routes = pgTable("routes", {
  id: serial("id").primaryKey(), // রুটের স্থায়ী আইডি (সিড ডেটায় ফিক্সড)
  code: varchar("code", { length: 24 }).notNull().unique(), // যেমন DHK-KHL-01
  nameEn: varchar("name_en", { length: 160 }).notNull(), // ইংরেজি রুটের নাম
  nameBn: varchar("name_bn", { length: 160 }).notNull(), // বাংলা রুটের নাম
  originEn: varchar("origin_en", { length: 80 }).notNull(), // শুরুর শহর (ইংরেজি)
  originBn: varchar("origin_bn", { length: 80 }).notNull(), // শুরুর শহর (বাংলা)
  destinationEn: varchar("destination_en", { length: 80 }).notNull(), // গন্তব্য (ইংরেজি)
  destinationBn: varchar("destination_bn", { length: 80 }).notNull(), // গন্তব্য (বাংলা)
  distanceKm: integer("distance_km").notNull(), // মোট দূরত্ব (কিমি)
  durationMinutes: integer("duration_minutes").notNull(), // আনুমানিক যাত্রা সময়
  fareBdt: integer("fare_bdt").notNull(), // সর্বোচ্চ ভাড়া (টাকা)
  // আসল সড়কের জ্যামিতি: [[lat,lng],...] JSON (OSRM থেকে একবার এনে সংরক্ষিত)। NULL হলে সরলরেখা।
  pathJson: text("path_json"),
});

// স্টপেজ/কাউন্টার টেবিল: প্রতিটি কাউন্টারের অক্ষাংশ-দ্রাঘিমাংশ ম্যাপে আঁকার জন্য।
export const stops = pgTable(
  "stops",
  {
    id: serial("id").primaryKey(), // স্টপেজের স্থায়ী আইডি
    slug: varchar("slug", { length: 80 }).notNull().unique(), // URL-বান্ধব নাম
    nameEn: varchar("name_en", { length: 100 }).notNull(), // ইংরেজি নাম
    nameBn: varchar("name_bn", { length: 100 }).notNull(), // বাংলা নাম
    districtEn: varchar("district_en", { length: 100 }).notNull(), // জেলা (ইংরেজি)
    districtBn: varchar("district_bn", { length: 100 }).notNull(), // জেলা (বাংলা)
    lat: doublePrecision("lat").notNull(), // অক্ষাংশ (Latitude)
    lng: doublePrecision("lng").notNull(), // দ্রাঘিমাংশ (Longitude)
  },
  // স্টপেজের নাম দিয়ে সার্চ দ্রুত করার জন্য ইনডেক্স (Django: db_index=True)।
  (table) => [index("stops_name_en_idx").on(table.nameEn), index("stops_name_bn_idx").on(table.nameBn)],
);

// রুট ও স্টপেজের মধ্যবর্তী টেবিল: sequence কলাম দিয়ে কাউন্টারের ক্রম নিশ্চিত হয়।
export const routeStops = pgTable(
  "route_stops",
  {
    id: serial("id").primaryKey(), // রো-আইডি
    routeId: integer("route_id").notNull(), // কোন রুট
    stopId: integer("stop_id").notNull(), // কোন স্টপেজ
    sequence: integer("sequence").notNull(), // ১ থেকে শুরু করে ক্রমিক নম্বর
    offsetMinutes: integer("offset_minutes").notNull(), // শুরু থেকে এই স্টপে পৌঁছার সময়
  },
  // (route_id, sequence) ইনডেক্স: পুরো রুট একটাই range scan এ পাওয়া যায়।
  (table) => [index("route_stops_route_seq_idx").on(table.routeId, table.sequence)],
);

// বাস টেবিল: অপারেটর, সময়সূচি, ধরন এবং GPS ডিভাইসের সর্বশেষ অ্যাঙ্কর পয়েন্ট।
export const buses = pgTable(
  "buses",
  {
    id: serial("id").primaryKey(), // বাসের স্থায়ী আইডি
    slug: varchar("slug", { length: 100 }).notNull().unique(), // ট্র্যাকিং URL-এর জন্য স্লাগ
    nameEn: varchar("name_en", { length: 120 }).notNull(), // বাসের নাম (যেমন Ena Transport)
    nameBn: varchar("name_bn", { length: 120 }).notNull(), // বাসের নাম (বাংলা)
    operatorEn: varchar("operator_en", { length: 120 }).notNull(), // পরিচালক প্রতিষ্ঠান
    operatorBn: varchar("operator_bn", { length: 120 }).notNull(), // পরিচালক (বাংলা)
    registrationNo: varchar("registration_no", { length: 40 }).notNull(), // নিবন্ধন নম্বর
    routeId: integer("route_id").notNull(), // বাস কোন রুটে চলছে
    serviceType: varchar("service_type", { length: 20 }).notNull(), // ac | non_ac
    seatCount: integer("seat_count").notNull(), // মোট আসন
    amenities: text("amenities").notNull(), // কমা-দিয়ে আলাদা করা সুবিধার key গুলো
    ratingX10: integer("rating_x10").notNull(), // রেটিং x10 (যেমন 47 = 4.7)
    departureTime: varchar("departure_time", { length: 8 }).notNull(), // ছাড়ার সময় HH:MM
    isActive: boolean("is_active").notNull().default(true), // আজ রাস্তায় আছে কি না
    accentColor: varchar("accent_color", { length: 16 }).notNull(), // UI কার্ডের রঙ
    tripStartMinute: integer("trip_start_minute").notNull(), // সিমুলেশনের ফেজ অফসেট
    loopSeconds: integer("loop_seconds").notNull(), // কত সেকেন্ডে রুট সম্পূর্ণ হয়
    baseSpeedKph: integer("base_speed_kph").notNull(), // GPS ডিভাইসের গড় গতি
    deviceLat: doublePrecision("device_lat").notNull(), // ডিভাইসের সর্বশেষ অক্ষাংশ
    deviceLng: doublePrecision("device_lng").notNull(), // ডিভাইসের সর্বশেষ দ্রাঘিমাংশ
    deviceUpdatedAt: timestamp("device_updated_at", { withTimezone: true }).notNull(), // শেষ GPS ping
  },
  // নাম ও সক্রিয় অবস্থা দিয়ে ফিল্টার দ্রুত করার ইনডেক্স।
  (table) => [
    index("buses_name_en_idx").on(table.nameEn),
    index("buses_name_bn_idx").on(table.nameBn),
    index("buses_active_idx").on(table.isActive),
  ],
);

// TypeScript-এ টেবিলের ধরন বের করার সহায়ক টাইপ (DRF Serializer-এর মতো)।
export type RouteRow = typeof routes.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type RouteStopRow = typeof routeStops.$inferSelect;
export type BusRow = typeof buses.$inferSelect;
