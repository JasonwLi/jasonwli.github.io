"""Merge export_plan + photos_manifest into the site's travel.json with clean display names."""
import json
import os
import math
from datetime import date


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))

BASE = os.environ.get("PIPELINE_BASE", os.path.expanduser("~/dev/personal-website/.pipeline"))
OUT = "/Users/jasonli/dev/personal-website/public/travel-data.json"

# slug → display name (and optional country override)
NAMES = {
    "east-melbourne-au": "Melbourne",
    "goyang-si-kr": "Seoul",
    "al-jizah-eg": "Cairo",
    "nicaj-shale-al": "Theth",
    "gjirokaster-al": "Gjirokastër",
    "al-quwayrah-jo": "Wadi Rum",
    "qasr-al-farafirah-eg": "White Desert",
    "mae-wang-th": "Chiang Mai",
    "mascot-au": "Sydney",
    "la-goulette-tn": "Tunis",
    "herceg-novi-me": "Herceg Novi",
    "eminoenue-tr": "Istanbul",
    "vrgorac-hr": "Dalmatia",
    "al-bawiti-eg": "Bahariya Oasis",
    "cowes-au": "Phillip Island",
    "colonia-el-salado-mx": "Mexico City",
    "sleman-id": "Yogyakarta",
    "san-vicente-co": "Medellín & Guatapé",
    "belas-pt": "Lisbon",
    "al-jubayhah-jo": "Amman",
    "yarada-in": "Visakhapatnam",
    "jdaidet-el-matn-lb": "Beirut",
    "city-of-westminster-gb": "London",
    "heinersdorf-de": "Berlin",
    "abu-sunbul-eg": "Abu Simbel",
    "vrutok-mk": "Mavrovo",
    "morwell-au": "Wilsons Promontory",
    "vatican-city-va": ("Rome", "IT"),
    "kuah-my": "Langkawi",
    "peregian-springs-au": "Noosa",
    "krushopek-mk": "Skopje",
    "thu-dau-mot-vn": "Ho Chi Minh City",
    "paradise-us": "Las Vegas",
    "kobilja-glava-ba": "Sarajevo",
    "portici-it": "Naples",
    "surfers-paradise-au": "Gold Coast",
    "chetput-in": "Chennai",
    "vyronas-gr": "Athens",
    "watthana-th": "Bangkok",
    "north-bay-village-us": "Miami",
    "daly-city-us": "San Francisco",
    "niederrad-de": "Frankfurt",
    "nakatsugawa-jp": "Nakasendō Trail",
    "muko-jp": "Kyoto",
    "anglesea-au": "Great Ocean Road",
    "toolooa-au": "Gladstone",
    "balmoral-au": "Brisbane",
    "wang-nuea-th": "Lampang",
    "karak-city-jo": "Karak",
    "odawara-jp": "Hakone",
    "mesaria-gr": "Santorini",
    "nagoya-shi-jp": "Nagoya",
    "meadview-us": "Grand Canyon",
    "halawa-heights-us": "Oʻahu",
    "teigebyen-no": "Oslo",
    "san-isidro-es": "Tenerife",
    "san-isidro-pe": "Lima",
    "milano-it": "Milan",
    "dhahab-eg": "Dahab",
    "sao-paulo-br": "São Paulo",
    "amstelveen-nl": "Amsterdam",
    "serik-tr": "Belek",
    "rawai-th": "Phuket",
    "wushan-cn": "Guangzhou",
    "guangsheng-cn": "Dujiangyan",
    "mala-strana-cz": "Prague",
}

MERGE = {
    "abu-sunbul-eg-2": "abu-sunbul-eg",
    "al-bawiti-eg-2": "al-bawiti-eg",
    "siwa-oasis-eg-2": "siwa-oasis-eg",
    "siwa-oasis-eg-3": "siwa-oasis-eg",
}

plan = json.load(open(f"{BASE}/export_plan.json"))
manifest = json.load(open(f"{BASE}/photos_manifest.json"))

by_slug = {p["slug"]: p["cluster"] for p in plan}
locations = {}

for p in plan:
    slug = p["slug"]
    # locations keep their ping even when no photo survived the people filter
    photos = manifest.get(slug, [])
    primary = MERGE.get(slug, slug)
    c = by_slug[primary] if primary in by_slug else p["cluster"]
    if primary not in locations:
        override = NAMES.get(primary, c["city"])
        name, cc = override if isinstance(override, tuple) else (override, c["cc"])
        locations[primary] = {
            "slug": primary,
            "name": name,
            "region": c["admin"],
            "cc": cc,
            "lat": c["lat"],
            "lon": c["lon"],
            "first": c["first"],
            "last": c["last"],
            "count": c["count"],
            "photos": [],
        }
    loc = locations[primary]
    src = by_slug.get(slug, c)
    loc["first"] = min(loc["first"], src["first"])
    loc["last"] = max(loc["last"], src["last"])
    for ph in photos:
        # file paths are stored relative to public/photos/
        # photos reconstructed from a published data file remember their real dir
        d = ph.get("_dir", slug)
        loc["photos"].append({k: v for k, v in ph.items() if k != "_dir"} | {"file": f"{d}/{ph['file']}"})

# group locations within 50 km; the member with the most photos anchors the
# group and keeps its name and coordinates
groups = []
for loc in sorted(locations.values(), key=lambda l: -l["count"]):
    anchor = next((g for g in groups if haversine_km(g, loc) < 50), None)
    if anchor is None:
        groups.append(loc)
    else:
        anchor["photos"].extend(loc["photos"])
        anchor["first"] = min(anchor["first"], loc["first"])
        anchor["last"] = max(anchor["last"], loc["last"])
        anchor["count"] += loc["count"]
        print(f"grouped {loc['name']} → {anchor['name']}")

for loc in groups:
    loc["photos"] = loc["photos"][:5]
    del loc["count"]

out = {
    "generated": date.today().isoformat(),
    "locations": sorted(groups, key=lambda l: l["first"]),
}
with open(OUT, "w") as f:
    json.dump(out, f)

n = len(out["locations"])
np = sum(len(l["photos"]) for l in out["locations"])
nc = len({l["cc"] for l in out["locations"]})
print(f"travel.json: {n} locations, {np} photos, {nc} countries")
