# =====================================================================
# Django REST Framework Serializer — সম্পূর্ণ স্থানীয়কৃত API আউটপুট
# ---------------------------------------------------------------------
# Next.js-এর src/lib/catalog.ts toBusDto() ঠিক এই একই কনট্র্যাক্ট তৈরি করে।
# ভাষা serializer-এর context থেকে আসে (LocaleMiddleware বা ?lang=)।
# =====================================================================

from rest_framework import serializers  # DRF-এর Serializer বেস ক্লাস
from .models import Bus, Route, RouteStop, Stop  # আমাদের চারটি মডেল

# ভাষা অনুযায়ী নাম বাছাই করার ছোট সহায়ক ফাংশন (DRY)।
def pick(instance, field, lang):
    """lang='bn' হলে *_bn ফিল্ড, নাহলে *_en ফিল্ড ফেরত দিই।"""
    suffix = "bn" if lang == "bn" else "en"  # ভাষার suffix নির্ধারণ
    return getattr(instance, f"{field}_{suffix}", "")  # getattr দিয়ে নিরাপদ access


# UI/API লেবেলের অভিধান: Next.js-এর src/lib/i18n.ts-এর সমতুল্য।
LABELS = {
    "bn": {"ac": "এসি", "non_ac": "নন-এসি", "active": "রাস্তায় চলছে", "inactive": "ডিপো / রক্ষণাবেক্ষণ", "next_stop": "পরবর্তী কাউন্টার"},
    "en": {"ac": "AC", "non_ac": "Non-AC", "active": "On the road", "inactive": "Depot / maintenance", "next_stop": "Next counter"},
}


class StopSerializer(serializers.ModelSerializer):
    """একটি কাউন্টারের স্থানীয়কৃত রিপ্রেজেন্টেশন।"""

    name = serializers.SerializerMethodField()  # ভাষা অনুযায়ী নাম গণনা করি
    district = serializers.SerializerMethodField()  # ভাষা অনুযায়ী জেলা

    class Meta:
        model = Stop  # কোন মডেল থেকে আসছে
        fields = ["id", "name", "district", "lat", "lng"]  # API তে যা যা যাবে

    def get_name(self, obj):
        return pick(obj, "name", self.context.get("lang", "bn"))  # বাংলা/ইংরেজি নাম

    def get_district(self, obj):
        return pick(obj, "district", self.context.get("lang", "bn"))  # বাংলা/ইংরেজি জেলা


class RouteStopSerializer(serializers.ModelSerializer):
    """রুটের একটি ধাপ: ক্রমিক নম্বর, সময় ও কাউন্টারের তথ্য।"""

    stop = StopSerializer(read_only=True)  # nested serializer: অতিরিক্ত JOIN এড়াই select_related দিয়ে
    name = serializers.SerializerMethodField()  # সরাসরি নামও পাঠাই (ক্লায়েন্ট সুবিধা)

    class Meta:
        model = RouteStop  # ধাপের মডেল
        fields = ["sequence", "offset_minutes", "stop", "name"]  # ক্রম + সময় + স্টপ

    def get_name(self, obj):
        return pick(obj.stop, "name", self.context.get("lang", "bn"))  # স্টপের নাম


class BusSerializer(serializers.ModelSerializer):
    """বাসের সম্পূর্ণ DTO: ভাষা, রুট, ক্রম, লাইভ ফ্রেমসহ।"""

    name = serializers.SerializerMethodField()  # স্থানীয়কৃত নাম
    operator = serializers.SerializerMethodField()  # স্থানীয়কৃত অপারেটর
    route_name = serializers.SerializerMethodField()  # স্থানীয়কৃত রুট
    origin = serializers.SerializerMethodField()  # স্থানীয়কৃত শুরুর শহর
    destination = serializers.SerializerMethodField()  # স্থানীয়কৃত গন্তব্য
    service_type_label = serializers.SerializerMethodField()  # এসি / নন-এসি লেবেল
    status_label = serializers.SerializerMethodField()  # সচল / অসচল লেবেল
    stops = serializers.SerializerMethodField()  # ক্রম অনুযায়ী সব কাউন্টার
    live = serializers.SerializerMethodField()  # সর্বশেষ GPS ফ্রেম (cache থেকে)

    class Meta:
        model = Bus  # বাস মডেল
        fields = [  # Next.js BusDto-র সাথে মিল রেখে ফিল্ড তালিকা
            "id", "slug", "name", "operator", "registration_no", "route_name", "origin",
            "destination", "departure_time", "seat_count", "rating_x10", "service_type_label",
            "status_label", "accent_color", "stops", "live",
        ]

    def get_name(self, obj):
        return pick(obj, "name", self.context["lang"])  # ভাষাভিত্তিক নাম

    def get_operator(self, obj):
        return pick(obj, "operator", self.context["lang"])  # ভাষাভিত্তিক অপারেটর

    def get_route_name(self, obj):
        return pick(obj.route, "name", self.context["lang"])  # ভাষাভিত্তিক রুট নাম

    def get_origin(self, obj):
        return pick(obj.route, "origin", self.context["lang"])  # শুরুর শহর

    def get_destination(self, obj):
        return pick(obj.route, "destination", self.context["lang"])  # গন্তব্য শহর

    def get_service_type_label(self, obj):
        return LABELS[self.context["lang"]].get(obj.service_type, obj.service_type)  # allow-list লেবেল

    def get_status_label(self, obj):
        key = "active" if obj.is_active else "inactive"  # বাস চলছে কি না
        return LABELS[self.context["lang"]][key]  # অনূদিত স্ট্যাটাস

    def get_stops(self, obj):
        # prefetch_related('route__steps__stop') ব্যবহার করলে N+1 query হয় না।
        steps = obj.route.steps.select_related("stop").all()  # ক্রম অনুযায়ী সব ধাপ
        return RouteStopSerializer(steps, many=True, context=self.context).data  # nested JSON

    def get_live(self, obj):
        # প্রোডাকশনে Redis-এ cache করা সর্বশেষ ফ্রেম; এখানে service ফাংশন কল।
        from .views import get_live_frame  # সার্ভিস লেয়ার থেকে লাইভ অবস্থান
        return get_live_frame(obj, self.context["lang"])  # lat/lng/speed/next_stop
