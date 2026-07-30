"""Census of the Photos library: how many geo-tagged, person-free photos exist."""
import json
import sys
import osxphotos

db = osxphotos.PhotosDB(dbfile="/Users/jasonli/Pictures/Photos Library.photoslibrary")
photos = db.photos(images=True, movies=False)

total = len(photos)
geo = [p for p in photos if p.location and p.location[0] is not None]

def person_free(p):
    # any named person or any detected face rectangle disqualifies
    if p.persons:
        return False
    try:
        if p.face_info:
            return False
    except Exception:
        return False
    return True

candidates = [p for p in geo if person_free(p) and not p.hidden and not p.screenshot]

by_country = {}
for p in candidates:
    place = p.place
    country = place.country_code if place else None
    name = place.name if place else None
    by_country.setdefault(country or "??", []).append(name)

summary = {
    "total_photos": total,
    "geo_tagged": len(geo),
    "person_free_geo": len(candidates),
    "countries": {k: len(v) for k, v in sorted(by_country.items(), key=lambda x: -len(x[1]))},
}
print(json.dumps(summary, indent=2))

# dump full candidate metadata for the next stage
rows = []
for p in candidates:
    place = p.place
    rows.append({
        "uuid": p.uuid,
        "date": p.date.isoformat() if p.date else None,
        "lat": p.location[0],
        "lon": p.location[1],
        "place": place.name if place else None,
        "country": place.country_code if place else None,
        "favorite": p.favorite,
        "width": p.width,
        "height": p.height,
        "uti": p.uti,
        "ismissing": p.ismissing,
    })
out = "/private/tmp/claude-501/-Users-jasonli-dev/609d9fd3-c32a-476f-9147-b3fa5a85aced/scratchpad/candidates.json"
with open(out, "w") as f:
    json.dump(rows, f, indent=1)
print(f"wrote {len(rows)} candidates to {out}", file=sys.stderr)
