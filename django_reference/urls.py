# =====================================================================
# Django URLconf — REST এন্ডপয়েন্ট রাউটিং
# ---------------------------------------------------------------------
# Next.js-এর src/app/api/*/route.ts ফাইলগুলোর হুবহু সমতুল্য path.
# প্রোজেক্টের মূল urls.py তে: path("api/", include("django_reference.urls"))
# =====================================================================

from django.urls import path  # URL প্যাটার্ন ডিফাইন করার ফাংশন
from .views import BusListAPIView, BusDetailAPIView, SearchAPIView, LiveAPIView, RoutePathAPIView  # চারটি কনট্রোলার

# app_name দিয়ে namespace তৈরি করি, ফলে reverse('buses:bus-list') সম্ভব।
app_name = "buses"

# প্রতিটি path-এর সাথে মন্তব্যে Next.js-এর সংশ্লিষ্ট ফাইল উল্লেখ করা হলো।
urlpatterns = [
    path("buses", BusListAPIView.as_view(), name="bus-list"),  # src/app/api/buses/route.ts
    path("buses/<slug:slug>", BusDetailAPIView.as_view(), name="bus-detail"),  # src/app/api/buses/[slug]/route.ts
    path("search", SearchAPIView.as_view(), name="search"),  # src/app/api/search/route.ts
    path("live", LiveAPIView.as_view(), name="live"),  # src/app/api/live/route.ts
    path("routes/<int:route_id>/path", RoutePathAPIView.as_view(), name="route-path"),  # src/app/api/routes/[id]/path/route.ts
    # health: load balancer / preview healthcheck-এর জন্য সাধারণ readiness probe.
    # path("health", HealthAPIView.as_view(), name="health"),  # src/app/api/health/route.ts
]
