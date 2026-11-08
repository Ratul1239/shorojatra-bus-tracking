// =====================================================================
// Next.js কনফিগারেশন: নিরাপত্তা হেডার + তথ্য-ফাঁস রোধ
// ---------------------------------------------------------------------
// Django তে এটি SecurityMiddleware (SECURE_CONTENT_TYPE_NOSNIFF ইত্যাদি) এর সমতুল্য।
// =====================================================================

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "X-Powered-By: Next.js" হেডার বন্ধ: সার্ভারের প্রযুক্তি-তথ্য অকারণে ফাঁস করি না।
  poweredByHeader: false,
  // সব রেসপন্সে নিরাপত্তা হেডার যোগ করি।
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // ব্রাউজারকে Content-Type অনুমান করতে দিই না (MIME sniffing আক্রমণ রোধ)।
          { key: "X-Content-Type-Options", value: "nosniff" },
          // অন্য সাইটে যাওয়ার সময় শুধু origin পাঠাই, পুরো URL/কুয়েরি নয়।
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // ক্যামেরা/মাইক্রোফোন/লোকেশন API ব্যবহারের অনুমতি বন্ধ।
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
