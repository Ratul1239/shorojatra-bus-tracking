# =====================================================================
# Django REST Framework Views — REST কনট্রোলার + ক্যাশিং/স্কেলিং
# ---------------------------------------------------------------------
# Next.js Route Handlers-এর (src/app/api/*/route.ts) সরাসরি সমতুল্য।
# ১০০০+ ইউজারের জন্য: Redis cache, ETag/304, select_related/prefetch_related,
# কোনো per-request DB WRITE নেই, এবং Throttling দিয়ে abuse রোধ।
# =====================================================================

import hashlib  # ETag তৈরির জন্য হ্যাশ
import math  # জ্যামিতি গণনায় sqrt/atan2
import time  # monotonically increasing সময়
from django.core.cache import cache  # Redis/Memcached ব্যাকএন্ড (production)
from django.utils.decorators import method_decorator  # class-based view-এ decorator
from django.views.decorators.cache import cache_page  # response-level cache
from rest_framework.response import Response  # DRF JSON Response
from rest_framework.throttling import AnonRateThrottle  # per-IP rate limit
from rest_framework.views import APIView  # REST বেস ভিউ
from .models import Bus, Route, RouteStop  # প্রয়োজনীয় মডেল
from .serializers import BusSerializer  # স্থানীয়কৃত serializer

# Query param থেকে ভাষা বের করার allow-list ফাংশন (ইনজেকশন প্রতিরোধ)।
def get_lang(request):
    """?lang=bn|en; অন্য যেকোনো মান ডিফল্ট বাংলায় ফিরে যায়।"""
    value = request.query_params.get("lang", "bn")  # query string পড়ি
    return "en" if value == "en" else "bn"  # শুধু দুটি অনুমোদিত মান

# ইনপুট পরিচ্ছন্নকরণ: দৈর্ঘ্য সীমা + কন্ট্রোল ক্যারেক্টার বাদ (XSS/DoS রোধ)।
def clean(value):
    """ইউজারের লেখা সর্বোচ্চ ৮০ অক্ষর এবং নিরাপদ অক্ষরে সীমাবদ্ধ করি।"""
    text = (value or "")[:80]  # দৈর্ঘ্য ক্যাপ
    return "".join(ch for ch in text if ch.isprintable() and ch not in "<>\"'`;")  # বিপজ্জনক চিহ্ন বাদ

# রুট "Dhaka to Khulna" বা "ঢাকা থেকে খুলনা" ভাগ করার ফাংশন।
def parse_route(from_text, to_text):
    """একটি ইনপুটে দুটি শহর থাকলে ভেঙে (from, to) টিউপল দিই।"""
    if from_text and not to_text:  # গন্তব্য ফাঁকা কিন্তু origin-এ পুরো বাক্য
        for separator in [" to ", " → ", " -> ", " থেকে ", " টু ", " - "]:
            if separator in from_text:  # separator পাওয়া গেলে
                parts = from_text.split(separator)  # দুই ভাগে ভাগ
                return parts[0].strip(), parts[-1].strip()  # প্রথম ও শেষ অংশ
    return from_text, to_text  # আগেই দুটি আলাদা ইনপুট ছিল


# ---- লাইভ GPS ইঞ্জিন: রুট জ্যামিতি + সময় → বর্তমান lat/lng ----
def get_live_frame(bus, lang):
    """প্রতি ভিউয়ারের জন্য DB না লিখে নির্ণয়যোগ্য ফ্রেম গণনা করি।"""
    cache_key = f"live:{bus.id}:{lang}:{int(time.time() // 2)}"  # ২ সেকেন্ড bucket
    cached = cache.get(cache_key)  # ১০০০ পোল → একটিমাত্র গণনা (singleflight-সম)
    if cached:
        return cached  # HIT: Redis থেকে সরাসরি ফেরত

    steps = list(bus.route.steps.select_related("stop").all())  # ক্রমিক কাউন্টার
    points = [(s.stop.lat, s.stop.lng) for s in steps]  # পলিলাইন
    lengths = []  # প্রতিটি সেগমেন্টের দৈর্ঘ্য
    cumulative = [0.0]  # শুরু থেকে cumulative দূরত্ব
    for i in range(len(points) - 1):  # পরপর দুটি স্টপ
        dx = (points[i + 1][1] - points[i][1]) * 111.32  # দ্রাঘিমাংশ → কিমি
        dy = (points[i + 1][0] - points[i][0]) * 110.57  # অক্ষাংশ → কিমি
        lengths.append(max(math.sqrt(dx * dx + dy * dy), 0.01))  # শূন্য দৈর্ঘ্য এড়াই
        cumulative.append(cumulative[-1] + lengths[-1])  # যোগ করে রাখি
    total = cumulative[-1] or 1.0  # মোট রুট দৈর্ঘ্য

    seconds = time.time() + bus.trip_start_minute * 37  # প্রতি বাসের ফেজ অফসেট
    phase = (seconds % bus.loop_seconds) / bus.loop_seconds  # ০..১
    moving = 0.94  # শেষ ৬% সময় গন্তব্যে অপেক্ষা (Next.js live.ts-এর সাথে মিল)
    progress = min(phase / moving, 1.0)  # শুধু সামনের দিকে ০ → ১ (আগের ping-pong বাগ ফিক্স)
    travelled = progress * total  # অতিক্রান্ত দূরত্ব

    index = 0  # বর্তমান সেগমেন্ট
    while index < len(lengths) - 1 and cumulative[index + 1] < travelled:
        index += 1  # পরের সেগমেন্টে যাই
    ratio = (travelled - cumulative[index]) / lengths[index]  # সেগমেন্টের ভগ্নাংশ
    a, b = points[index], points[min(index + 1, len(points) - 1)]  # দুই প্রান্ত
    lat = a[0] + (b[0] - a[0]) * ratio  # অক্ষাংশ interpolate
    lng = a[1] + (b[1] - a[1]) * ratio  # দ্রাঘিমাংশ interpolate

    next_stop = steps[-1].stop  # ডিফল্ট গন্তব্য
    for i, distance in enumerate(cumulative):  # পরবর্তী কাউন্টার খোঁজা
        if distance > travelled + 0.5:
            next_stop = steps[i].stop  # পাওয়া গেল
            break
    name = next_stop.name_bn if lang == "bn" else next_stop.name_en  # স্থানীয়কৃত নাম

    frame = {  # Next.js LiveDto-র সাথে মিল রেখে ফিল্ড
        "busId": bus.id,
        "lat": round(lat, 5),
        "lng": round(lng, 5),
        "travelledKm": round(travelled, 3),  # রুটের শুরু থেকে অতিক্রান্ত কিমি (ম্যাপে পেরিয়ে আসা পথের জন্য)
        "speedKph": bus.base_speed_kph,
        "progressPct": round(progress * 100),
        "nextStop": name,
        "status": "active" if bus.is_active else "inactive",
        "lastSyncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    cache.set(cache_key, frame, timeout=2)  # ২ সেকেন্ড TTL
    return frame  # নতুন ফ্রেম


# ---- সাধারণ API খাম: ভাষা + labels + generatedAt ----
def envelope(request, data, ttl):
    """সব এন্ডপয়েন্টে একই কাঠামো: language, labels, cacheTtlSeconds, data।"""
    lang = get_lang(request)  # বর্তমান ভাষা
    return Response({  # DRF Response স্বয়ংক্রিয়ভাবে JSON-এ রূপান্তরিত হয়
        "language": lang,
        "labels": {"brand": "শরোযাত্রা" if lang == "bn" else "ShoroJatra"},
        "cacheTtlSeconds": ttl,
        "data": data,
    })


# @method_decorator(cache_page(30)) → CDN/Reverse proxy ৩০ সেকেন্ড ক্যাশ করতে পারে।
@method_decorator(cache_page(30), name="dispatch")
class BusListAPIView(APIView):
    """GET /api/buses?lang=bn — আজ রাস্তায় সচল বাসের তালিকা।"""

    throttle_classes = [AnonRateThrottle]  # প্রতি IP-তে rate limit (abuse রোধ)

    def get(self, request):
        lang = get_lang(request)  # ভাষা নির্ধারণ
        # select_related/prefetch_related: N+1 query না করে ৩টি query-তেই সব ডেটা।
        buses = Bus.objects.filter(is_active=True).select_related("route").prefetch_related("route__steps__stop")
        serializer = BusSerializer(buses, many=True, context={"lang": lang})  # স্থানীয়কৃত আউটপুট
        return envelope(request, {"buses": serializer.data, "count": len(serializer.data)}, 60)


class BusDetailAPIView(APIView):
    """GET /api/buses/<slug>?lang=bn — একটি বাসের বিস্তারিত।"""

    def get(self, request, slug):
        lang = get_lang(request)  # ভাষা
        bus = Bus.objects.filter(slug=clean(slug)).select_related("route").first()  # parameterised query
        if not bus:
            return Response({"ok": False, "message": "Bus not found"}, status=404)  # স্পষ্ট 404
        serializer = BusSerializer(bus, context={"lang": lang})  # একটিমাত্র অবজেক্ট
        return envelope(request, {"bus": serializer.data}, 60)


class SearchAPIView(APIView):
    """GET /api/search — রুট-ক্রম সার্চ অথবা নাম ভিত্তিক সার্চ।"""

    throttle_classes = [AnonRateThrottle]  # সার্চেও rate limit

    def get(self, request):
        lang = get_lang(request)  # ভাষা
        mode = request.query_params.get("mode", "active")  # query param
        if mode not in ("route", "name", "active"):
            mode = "active"  # allow-list: অবাঞ্ছিত branch বন্ধ
        from_text, to_text = parse_route(clean(request.query_params.get("from")), clean(request.query_params.get("to")))
        query = clean(request.query_params.get("q"))  # নাম সার্চের টেক্সট
        buses = Bus.objects.select_related("route").prefetch_related("route__steps__stop")  # বেস queryset

        if mode == "route":  # ক) রুট ভিত্তিক সার্চ
            if not from_text or not to_text:  # দুটি শহরই আবশ্যক
                return envelope(request, {"results": [], "count": 0, "message": "origin & destination required"}, 10)
            matched_ids = []  # মেলা বাসের আইডি
            for route in Route.objects.prefetch_related("steps__stop"):  # সব রুট
                names = [(s.stop.name_en + "|" + s.stop.name_bn).lower() for s in route.steps.all()]  # দুই ভাষার নাম
                from_idx = next((i for i, n in enumerate(names) if from_text.lower() in n), -1)  # শুরুর অবস্থান
                to_idx = next((i for i in range(len(names) - 1, -1, -1) if to_text.lower() in names[i]), -1)  # গন্তব্য
                if from_idx >= 0 and to_idx > from_idx:  # দিক ও ক্রম যাচাই
                    matched_ids.extend(route.buses.values_list("id", flat=True))  # ওই রুটের বাস
            buses = buses.filter(id__in=matched_ids)  # শুধু মেলা বাস
        elif mode == "name":  # খ) নাম ভিত্তিক সার্চ
            if not query:  # খালি হলে ফলাফল নেই
                return envelope(request, {"results": [], "count": 0, "message": "name required"}, 10)
            buses = buses.filter(name_en__icontains=query) | buses.filter(name_bn__icontains=query) | buses.filter(operator_en__icontains=query)
        else:  # গ) সচল বহর
            buses = buses.filter(is_active=True)

        serializer = BusSerializer(buses, many=True, context={"lang": lang})  # স্থানীয়কৃত ফলাফল
        return envelope(request, {"mode": mode, "results": serializer.data, "count": len(serializer.data)}, 10)


class LiveAPIView(APIView):
    """GET /api/live?bus=1&lang=bn — ৫ সেকেন্ড পোলিংয়ের হালকা ফ্রেম।"""

    throttle_classes = [AnonRateThrottle]  # per-IP throttle

    def get(self, request):
        lang = get_lang(request)  # ভাষা
        bus_key = clean(request.query_params.get("bus"))  # ঐচ্ছিক বাস ফিল্টার
        buses = Bus.objects.select_related("route").prefetch_related("route__steps__stop")  # বেস queryset
        if bus_key:  # একটি বাস চাইলে
            buses = buses.filter(slug=bus_key) | buses.filter(pk=bus_key if bus_key.isdigit() else None)
        frames = [get_live_frame(bus, lang) for bus in buses]  # ২ সেকেন্ড ক্যাশ ভিত্তিক গণনা
        etag = hashlib.md5(f"{lang}:{bus_key}:{int(time.time() // 2)}".encode()).hexdigest()  # bucket ETag
        if request.META.get("HTTP_IF_NONE_MATCH") == f'"{etag}"':
            return Response(status=304)  # ডেটা বদলায়নি → body নেই, bandwidth সাশ্রয়
        response = envelope(request, {"frames": frames, "pollingIntervalSeconds": 5}, 2)  # ছোট পেলোড
        response["ETag"] = f'"{etag}"'  # পরের পোলে If-None-Match হিসেবে যাবে
        response["Cache-Control"] = "public, max-age=0, s-maxage=2, stale-while-revalidate=8"  # CDN নির্দেশ
        return response


class RoutePathAPIView(APIView):
    """GET /api/routes/<id>/path — রুটের সড়ক-পথ [[lat,lng],...] (৩D ম্যাপ একবার নেয়, দীর্ঘ ক্যাশযোগ্য)।"""

    throttle_classes = [AnonRateThrottle]  # প্রতি IP-তে rate limit

    def get(self, request, route_id):
        import json  # JSON পার্স (path_json সংরক্ষিত স্ট্রিং)
        route = Route.objects.filter(pk=route_id).first()  # parameterised query
        if not route:
            return Response({"ok": False, "message": "Route not found"}, status=404)  # স্পষ্ট 404
        try:
            path = json.loads(route.path_json) if route.path_json else None  # আসল সড়ক
        except ValueError:
            path = None  # ভাঙা JSON হলে fallback
        if not path:  # না থাকলে স্টপগুলোর সরলরেখা
            path = [[s.stop.lat, s.stop.lng] for s in route.steps.select_related("stop").all()]
        response = Response({"routeId": route.id, "hasRoadGeometry": bool(route.path_json), "path": path})
        response["Cache-Control"] = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"  # CDN ক্যাশ
        return response
