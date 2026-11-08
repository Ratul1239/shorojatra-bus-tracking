# =====================================================================
# Django ORM মডেল — PostgreSQL স্কিমার রেফারেন্স ইমপ্লিমেন্টেশন
# ---------------------------------------------------------------------
# এই ফোল্ডারটি শুধু রেফারেন্স: রানটাইমে Next.js Route Handlers + Drizzle চলে,
# কিন্তু নিচের মডেলগুলো src/db/schema.ts-এর সাথে ১:১ মিলে যায়।
# ফলে ব্যাকএন্ড Django-তে সরালে ফ্রন্টএন্ডের এক লাইনও বদলাতে হয় না।
# =====================================================================

from django.db import models  # Django ORM-এর বেস ক্লাস ও ফিল্ড টাইপ


class Stop(models.Model):
    """একটি কাউন্টার/স্টপেজ: দুই ভাষার নাম + ম্যাপের স্থানাঙ্ক।"""

    slug = models.CharField(max_length=80, unique=True)  # URL-বান্ধব ইউনিক নাম
    name_en = models.CharField(max_length=100)  # ইংরেজি নাম
    name_bn = models.CharField(max_length=100)  # বাংলা নাম
    district_en = models.CharField(max_length=100)  # জেলার নাম (ইংরেজি)
    district_bn = models.CharField(max_length=100)  # জেলার নাম (বাংলা)
    lat = models.FloatField()  # অক্ষাংশ (Latitude)
    lng = models.FloatField()  # দ্রাঘিমাংশ (Longitude)

    class Meta:
        db_table = "stops"  # Drizzle স্কিমার টেবিল নামের সাথে হুবহু মিল
        indexes = [  # নাম দিয়ে সার্চ দ্রুত করার ইনডেক্স
            models.Index(fields=["name_en"], name="stops_name_en_idx"),
            models.Index(fields=["name_bn"], name="stops_name_bn_idx"),
        ]

    def __str__(self):
        return self.name_en  # অ্যাডমিন প্যানেলে পড়ার উপযোগী প্রতিনিধিত্ব


class Route(models.Model):
    """একটি দিক-ভিত্তিক যাত্রাপথ, যেমন ঢাকা → খুলনা।"""

    code = models.CharField(max_length=24, unique=True)  # রুট কোড (DHK-KHL-01)
    name_en = models.CharField(max_length=160)  # রুটের ইংরেজি নাম
    name_bn = models.CharField(max_length=160)  # রুটের বাংলা নাম
    origin_en = models.CharField(max_length=80)  # শুরুর শহর (ইংরেজি)
    origin_bn = models.CharField(max_length=80)  # শুরুর শহর (বাংলা)
    destination_en = models.CharField(max_length=80)  # গন্তব্য (ইংরেজি)
    destination_bn = models.CharField(max_length=80)  # গন্তব্য (বাংলা)
    distance_km = models.IntegerField()  # মোট দূরত্ব কিলোমিটারে
    duration_minutes = models.IntegerField()  # আনুমানিক যাত্রার সময় মিনিটে
    fare_bdt = models.IntegerField()  # সর্বোচ্চ ভাড়া (টাকা)
    path_json = models.TextField(null=True, blank=True)  # আসল সড়কের জ্যামিতি [[lat,lng],...] (OSRM থেকে একবার আনা)

    class Meta:
        db_table = "routes"  # একই টেবিল: ডেটা মাইগ্রেশন ছাড়াই শেয়ার করা যায়

    def __str__(self):
        return self.code  # অ্যাডমিনে রুট কোড দেখা যাবে


class RouteStop(models.Model):
    """রুটের একটি ধাপ: কোন স্টপ, কত ক্রমে, কত মিনিটে পৌঁছাবে।"""

    route = models.ForeignKey(Route, on_delete=models.CASCADE, db_column="route_id", related_name="steps")  # মূল রুট
    stop = models.ForeignKey(Stop, on_delete=models.CASCADE, db_column="stop_id")  # এই ধাপের কাউন্টার
    sequence = models.IntegerField()  # ১ থেকে শুরু করে ক্রমিক নম্বর
    offset_minutes = models.IntegerField()  # যাত্রা শুরু থেকে এই স্টপে পৌঁছার সময়

    class Meta:
        db_table = "route_stops"  # Drizzle-এর route_stops টেবিল
        ordering = ["sequence"]  # ডিফল্টভাবেই ক্রম অনুযায়ী সাজা থাকবে
        indexes = [models.Index(fields=["route", "sequence"], name="route_stops_route_seq_idx")]  # range scan দ্রুত


class Bus(models.Model):
    """একটি বাস: অপারেটর, সময়সূচি, সুবিধা ও GPS ডিভাইসের শেষ অ্যাঙ্কর।"""

    slug = models.CharField(max_length=100, unique=True)  # ট্র্যাকিং URL-এর স্লাগ
    name_en = models.CharField(max_length=120)  # বাসের নাম (ইংরেজি)
    name_bn = models.CharField(max_length=120)  # বাসের নাম (বাংলা)
    operator_en = models.CharField(max_length=120)  # পরিচালক প্রতিষ্ঠান
    operator_bn = models.CharField(max_length=120)  # পরিচালক (বাংলা)
    registration_no = models.CharField(max_length=40)  # নিবন্ধন নম্বর
    route = models.ForeignKey(Route, on_delete=models.PROTECT, db_column="route_id", related_name="buses")  # বর্তমান রুট
    service_type = models.CharField(max_length=20, default="ac")  # ac | non_ac
    seat_count = models.IntegerField()  # মোট আসন সংখ্যা
    amenities = models.TextField()  # কমা দিয়ে আলাদা করা সুবিধার key
    rating_x10 = models.IntegerField(default=45)  # রেটিং × ১০ (float এড়িয়ে integer)
    departure_time = models.CharField(max_length=8)  # ছাড়ার সময় "HH:MM"
    is_active = models.BooleanField(default=True, db_index=True)  # আজ রাস্তায় আছে কি না
    accent_color = models.CharField(max_length=16)  # UI কার্ডের রঙ
    trip_start_minute = models.IntegerField()  # লাইভ সিমুলেশনের ফেজ অফসেট
    loop_seconds = models.IntegerField()  # কত সেকেন্ডে রুট সম্পূর্ণ হয়
    base_speed_kph = models.IntegerField()  # GPS ডিভাইসের গড় গতি
    device_lat = models.FloatField()  # সর্বশেষ পাওয়া অক্ষাংশ
    device_lng = models.FloatField()  # সর্বশেষ পাওয়া দ্রাঘিমাংশ
    device_updated_at = models.DateTimeField()  # শেষ GPS ping-এর সময়

    class Meta:
        db_table = "buses"  # Drizzle স্কিমার buses টেবিল
        indexes = [  # নাম সার্চ ও সচল বাস ফিল্টারের ইনডেক্স
            models.Index(fields=["name_en"], name="buses_name_en_idx"),
            models.Index(fields=["name_bn"], name="buses_name_bn_idx"),
            models.Index(fields=["is_active"], name="buses_active_idx"),
        ]

    def __str__(self):
        return self.name_en  # অ্যাডমিনে বাসের নাম
