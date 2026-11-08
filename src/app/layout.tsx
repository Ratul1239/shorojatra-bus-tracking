// =====================================================================
// রুট লেআউট (Server Component)
// ---------------------------------------------------------------------
// ১) কুকি থেকে ভাষা পড়ে <html lang> সেট করি (SSR-ও সঠিক ভাষায় হয়)।
// ২) LanguageProvider দিয়ে সব ক্লায়েন্ট কম্পোনেন্টে ভাষা শেয়ার করি।
// ৩) হেডার/ফুটার একবারই রেন্ডার হয়, পেজগুলো শুধু main-এ বদলে।
// =====================================================================

import type { Metadata } from "next"; // SEO মেটাডাটা টাইপ
import type { ReactNode } from "react"; // children টাইপ
import "./globals.css"; // গ্লোবাল ডিজাইন সিস্টেম
import { Header } from "@/components/Header"; // সাইট হেডার
import { Footer } from "@/components/Footer"; // সাইট ফুটার
import { LanguageProvider } from "@/components/LanguageProvider"; // ভাষা কনটেক্সট
import { getServerLang } from "@/lib/server-lang"; // কুকি-ভিত্তিক ভাষা

// ব্রাউজার ট্যাব ও সার্চ ইঞ্জিনের জন্য মেটাডাটা।
export const metadata: Metadata = {
  title: "ShoroJatra · শরোযাত্রা | Live Bus Tracking",
  description: "Route search, bus name search and 5-second live GPS tracking for intercity buses in Bangladesh.",
};

// async কম্পোনেন্ট: Next.js 16-এ cookies() await করতে হয়।
export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getServerLang(); // 'bn' ডিফল্ট, 'en' কুকি থাকলে ইংরেজি
  return (
    <html lang={lang}>
      <body className="antialiased">
        {/* Provider সব পেজকে ঘিরে রাখে ⇒ ভাষা টগল সম্পূর্ণ সাইটে প্রযোজ্য */}
        <LanguageProvider initialLang={lang}>
          <Header />
          <main className="min-h-[60vh]">{children}</main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
