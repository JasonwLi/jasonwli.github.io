/**
 * Landmark dataset (C5). EXACTLY the 72 verified entries of .plan/landmarks_72.json
 * (Wikidata QIDs, coordinates, archetype, variant, tier and near_place copied verbatim;
 * near_place slugs verified against public/travel-data.json). Enforced by
 *   node --experimental-strip-types src/three/monuments/dev/check-landmarks.ts
 *
 * Shape (plan spec): { id, name, lat, lon, arch, params?, fame 1-3 } plus the verified
 * fields. `form` names the archetype sub-mesh drawn for the landmark (monuments/
 * archetypes.ts; the 18 most famous point at detailed hero models, `*-hero`, monuments/hero/); `parts` adds extra archetype instances sharing the landmark's frame
 * (x/z in units of the landmark's size, s = relative size).
 *
 * `visited` is computed at runtime (landmarkVisited): the near_place slug is a travel
 * location, or the landmark lies within 60 km of one. Dependency-free on purpose so the
 * node check can import it.
 */

export const ARCHETYPES = [
  'pyramid',
  'obelisk',
  'temple-columns',
  'dome',
  'tower',
  'spire/cathedral',
  'bridge',
  'statue',
  'wall',
  'pagoda/torii',
  'arch',
  'mountain-peak',
  'waterfall',
  'canyon',
  'rock',
] as const
export type Archetype = (typeof ARCHETYPES)[number]

export interface LandmarkPart {
  arch: Archetype
  form: string
  x: number
  z: number
  s: number
}

export interface Landmark {
  id: string
  name: string
  qid: string
  lat: number
  lon: number
  arch: Archetype
  /** archetype sub-mesh key */
  form: string
  /** 3 = world-famous (verified tier 1), 2 = notable (tier 2) */
  fame: 1 | 2 | 3
  tier: 1 | 2
  /** travel location slug this landmark belongs to (null = not visited) */
  nearPlace: string | null
  variant?: string
  relatedPlace?: string
  params?: Record<string, number>
  parts?: LandmarkPart[]
  /**
   * Preferred facing (rad): the turn of the model's front (+z) about its up axis, as drawn
   * by Monuments; negative turns the front toward the viewer's lower-left, i.e. into the
   * upper-left key light (material.ts sorts facets by the light's ground bearing), so the
   * signature face is always on the lit side. Every hero sets it; others default to a
   * small per-landmark negative turn. (The Golden Gate model is already laid -0.5 rad on
   * the diagonal, so its +0.2 nets a near-broadside span with the towers' faces lit.)
   */
  face?: number
}

export const LANDMARKS: Landmark[] = [
  { id: "great-pyramid-of-giza", name: "Great Pyramid of Giza", qid: "Q37200", lat: 29.97915, lon: 31.13422, arch: "pyramid", form: "giza-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "al-jizah-eg" },
  { id: "karnak-temple-complex", name: "Karnak Temple Complex", qid: "Q522862", lat: 25.71833, lon: 32.65833, arch: "temple-columns", form: "hypostyle", fame: 2, tier: 2, nearPlace: "luxor-eg", variant: "hypostyle hall + obelisk", parts: [{ arch: "obelisk", form: "obelisk", x: 1.05, z: 0.25, s: 0.62 }] },
  { id: "abu-simbel-temples", name: "Abu Simbel Temples", qid: "Q134140", lat: 22.33694, lon: 31.62556, arch: "temple-columns", form: "abu-simbel-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "abu-sunbul-eg", variant: "rock-cut facade with 4 seated colossi" },
  { id: "pharos-of-alexandria", name: "Pharos of Alexandria (site: Citadel of Qaitbay)", qid: "Q43244", lat: 31.21417, lon: 29.885, arch: "tower", form: "pharos", fame: 2, tier: 2, nearPlace: "alexandria-eg", variant: "stepped pharos" },
  { id: "white-desert", name: "White Desert", qid: "Q2556953", lat: 27.27734, lon: 28.20044, arch: "rock", form: "mushroom", fame: 2, tier: 2, nearPlace: "qasr-al-farafirah-eg", variant: "chalk mushroom formations" },
  { id: "mount-sinai", name: "Mount Sinai", qid: "Q377485", lat: 28.5384, lon: 33.9752, arch: "mountain-peak", form: "peak", fame: 2, tier: 2, nearPlace: "dhahab-eg" },
  { id: "petra-al-khazneh", name: "Petra — Al-Khazneh (Treasury)", qid: "Q1259626", lat: 30.32206, lon: 35.45145, arch: "temple-columns", form: "petra-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "petra-jo", variant: "rock-cut facade" },
  { id: "wadi-rum", name: "Wadi Rum", qid: "Q40729", lat: 29.5765, lon: 35.41993, arch: "rock", form: "mesa", fame: 3, tier: 1, nearPlace: "al-quwayrah-jo", variant: "sandstone mesas / red desert" },
  { id: "baalbek-temple-of-bacchus", name: "Baalbek — Temple of Bacchus", qid: "Q1991217", lat: 34.00607, lon: 36.20394, arch: "temple-columns", form: "peristyle-sand", fame: 2, tier: 2, nearPlace: "baalbek-lb" },
  { id: "colosseum", name: "Colosseum", qid: "Q10285", lat: 41.89028, lon: 12.49222, arch: "arch", form: "colosseum-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "vatican-city-va", variant: "amphitheatre ring" },
  { id: "st-peter-s-basilica", name: "St. Peter's Basilica", qid: "Q12512", lat: 41.90222, lon: 12.45342, arch: "dome", form: "st-peters-hero", face: -0.4, fame: 2, tier: 2, nearPlace: "vatican-city-va" },
  { id: "parthenon", name: "Parthenon", qid: "Q10288", lat: 37.97153, lon: 23.7266, arch: "temple-columns", form: "parthenon-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "vyronas-gr" },
  { id: "hagia-sophia", name: "Hagia Sophia", qid: "Q12506", lat: 41.00833, lon: 28.98, arch: "dome", form: "hagia-sophia-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "eminoenue-tr", variant: "dome + 4 minarets" },
  { id: "aspendos-theatre", name: "Aspendos Theatre", qid: "Q633757", lat: 36.93889, lon: 31.17222, arch: "arch", form: "theatre", fame: 2, tier: 2, nearPlace: "serik-tr", variant: "roman theatre" },
  { id: "amphitheatre-of-el-jem", name: "Amphitheatre of El Jem", qid: "Q2914326", lat: 35.29639, lon: 10.70694, arch: "arch", form: "ring-sand", fame: 2, tier: 2, nearPlace: "el-jem-tn", variant: "amphitheatre ring" },
  { id: "great-mosque-of-kairouan", name: "Great Mosque of Kairouan", qid: "Q1255269", lat: 35.68139, lon: 10.10389, arch: "tower", form: "minaret", fame: 2, tier: 2, nearPlace: "kairouan-tn", variant: "square minaret" },
  { id: "florence-cathedral", name: "Florence Cathedral", qid: "Q191739", lat: 43.77306, lon: 11.25694, arch: "dome", form: "florence", fame: 2, tier: 2, nearPlace: "florence-it", variant: "brunelleschi dome + campanile" },
  { id: "milan-cathedral", name: "Milan Cathedral", qid: "Q18068", lat: 45.46397, lon: 9.19058, arch: "spire/cathedral", form: "gothic", fame: 2, tier: 2, nearPlace: "milano-it", variant: "gothic pinnacles" },
  { id: "mount-vesuvius", name: "Mount Vesuvius", qid: "Q524", lat: 40.82261, lon: 14.42919, arch: "mountain-peak", form: "vesuvius", fame: 2, tier: 2, nearPlace: "portici-it", variant: "volcano with smoke" },
  { id: "eiffel-tower", name: "Eiffel Tower", qid: "Q243", lat: 48.8583, lon: 2.29448, arch: "tower", form: "eiffel-hero", face: -0.4, fame: 3, tier: 1, nearPlace: null, variant: "lattice tower" },
  { id: "big-ben", name: "Big Ben (Elizabeth Tower)", qid: "Q41225", lat: 51.50067, lon: -0.12457, arch: "tower", form: "big-ben-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "city-of-westminster-gb", variant: "clock tower" },
  { id: "brandenburg-gate", name: "Brandenburg Gate", qid: "Q82425", lat: 52.51627, lon: 13.37772, arch: "arch", form: "gate", fame: 2, tier: 2, nearPlace: "heinersdorf-de", variant: "columned gate + quadriga" },
  { id: "neuschwanstein-castle", name: "Neuschwanstein Castle", qid: "Q4152", lat: 47.55749, lon: 10.74944, arch: "spire/cathedral", form: "fairytale", fame: 2, tier: 2, nearPlace: null, variant: "fairytale castle", relatedPlace: "munich-de" },
  { id: "prague-castle-st-vitus-cathedral", name: "Prague Castle / St. Vitus Cathedral", qid: "Q193369", lat: 50.09083, lon: 14.40056, arch: "spire/cathedral", form: "prague", fame: 2, tier: 2, nearPlace: "mala-strana-cz", variant: "castle + St Vitus spires" },
  { id: "hungarian-parliament-building", name: "Hungarian Parliament Building", qid: "Q11819", lat: 47.50694, lon: 19.04556, arch: "dome", form: "parliament", fame: 2, tier: 2, nearPlace: "budapest-hu", variant: "gothic revival dome on river" },
  { id: "stari-most", name: "Stari Most", qid: "Q188528", lat: 43.33728, lon: 17.81503, arch: "bridge", form: "stone-arch", fame: 2, tier: 2, nearPlace: "vrgorac-hr", variant: "single stone arch" },
  { id: "walls-of-dubrovnik", name: "Walls of Dubrovnik", qid: "Q931733", lat: 42.64, lon: 18.108, arch: "wall", form: "citywall", fame: 2, tier: 2, nearPlace: "herceg-novi-me", variant: "city walls" },
  { id: "dom-luis-i-bridge", name: "Dom Luís I Bridge", qid: "Q1322447", lat: 41.13972, lon: -8.60944, arch: "bridge", form: "iron-arch", fame: 2, tier: 2, nearPlace: "porto-pt", variant: "iron arch" },
  { id: "belem-tower", name: "Belém Tower", qid: "Q215003", lat: 38.69139, lon: -9.21583, arch: "tower", form: "belem", fame: 2, tier: 2, nearPlace: "belas-pt", variant: "manueline fort tower" },
  { id: "helsinki-cathedral", name: "Helsinki Cathedral", qid: "Q738015", lat: 60.17039, lon: 24.95212, arch: "dome", form: "helsinki", fame: 2, tier: 2, nearPlace: "helsinki-fi", variant: "white neoclassical dome" },
  { id: "sagrada-familia", name: "Sagrada Família", qid: "Q48435", lat: 41.40369, lon: 2.17433, arch: "spire/cathedral", form: "sagrada", fame: 3, tier: 1, nearPlace: null, variant: "many spires" },
  { id: "stonehenge", name: "Stonehenge", qid: "Q39671", lat: 51.17889, lon: -1.82611, arch: "rock", form: "henge", fame: 3, tier: 1, nearPlace: null, variant: "megalith ring" },
  { id: "mount-teide", name: "Mount Teide", qid: "Q38954", lat: 28.27264, lon: -16.64361, arch: "mountain-peak", form: "cone", fame: 2, tier: 2, nearPlace: "san-isidro-es", variant: "volcano" },
  { id: "statue-of-liberty", name: "Statue of Liberty", qid: "Q9202", lat: 40.68921, lon: -74.04443, arch: "statue", form: "liberty-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "new-york-city-us" },
  { id: "golden-gate-bridge", name: "Golden Gate Bridge", qid: "Q44440", lat: 37.81972, lon: -122.47861, arch: "bridge", form: "golden-gate-hero", face: 0.2, fame: 3, tier: 1, nearPlace: "daly-city-us", variant: "suspension bridge" },
  { id: "space-needle", name: "Space Needle", qid: "Q5317", lat: 47.6204, lon: -122.3491, arch: "tower", form: "saucer", fame: 2, tier: 2, nearPlace: "seattle-us", variant: "saucer-top tower" },
  { id: "cn-tower", name: "CN Tower", qid: "Q134883", lat: 43.64275, lon: -79.38715, arch: "tower", form: "needle", fame: 2, tier: 2, nearPlace: "toronto-ca", variant: "needle tower" },
  { id: "niagara-falls", name: "Niagara Falls (Horseshoe Falls)", qid: "Q1373778", lat: 43.07731, lon: -79.07562, arch: "waterfall", form: "horseshoe", fame: 3, tier: 1, nearPlace: "niagara-falls-ca" },
  { id: "grand-canyon", name: "Grand Canyon", qid: "Q118841", lat: 36.0975, lon: -112.09528, arch: "canyon", form: "canyon", fame: 3, tier: 1, nearPlace: "meadview-us" },
  { id: "pyramid-of-the-sun", name: "Pyramid of the Sun", qid: "Q29238", lat: 19.6925, lon: -98.8438, arch: "pyramid", form: "stepped", fame: 2, tier: 2, nearPlace: "colonia-el-salado-mx", variant: "stepped mesoamerican" },
  { id: "chichen-itza-el-castillo", name: "Chichén Itzá — El Castillo", qid: "Q1128327", lat: 20.68289, lon: -88.56861, arch: "pyramid", form: "castillo", fame: 3, tier: 1, nearPlace: null, variant: "stepped mesoamerican" },
  { id: "machu-picchu", name: "Machu Picchu", qid: "Q676203", lat: -13.16333, lon: -72.54556, arch: "wall", form: "machu-picchu-hero", face: -0.4, fame: 3, tier: 1, nearPlace: null, variant: "inca terraces + Huayna Picchu peak", relatedPlace: "cusco-pe" },
  { id: "el-misti", name: "El Misti", qid: "Q572865", lat: -16.29639, lon: -71.41056, arch: "mountain-peak", form: "snowcone", fame: 2, tier: 2, nearPlace: "arequipa-pe", variant: "volcano" },
  { id: "christ-the-redeemer", name: "Christ the Redeemer", qid: "Q79961", lat: -22.95192, lon: -43.21046, arch: "statue", form: "christ-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "rio-de-janeiro-br" },
  { id: "iguazu-falls", name: "Iguazu Falls", qid: "Q36332", lat: -25.69528, lon: -54.43667, arch: "waterfall", form: "cascades", fame: 3, tier: 1, nearPlace: null },
  { id: "el-penon-de-guatape", name: "El Peñón de Guatapé", qid: "Q2244727", lat: 6.21945, lon: -75.17916, arch: "rock", form: "monolith", fame: 2, tier: 2, nearPlace: "san-vicente-co", variant: "monolith" },
  { id: "diamond-head", name: "Diamond Head", qid: "Q944686", lat: 21.25972, lon: -157.81175, arch: "mountain-peak", form: "crater", fame: 2, tier: 2, nearPlace: "halawa-heights-us", variant: "volcanic crater" },
  { id: "mount-fuji", name: "Mount Fuji", qid: "Q39231", lat: 35.36056, lon: 138.7275, arch: "mountain-peak", form: "fuji-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "odawara-jp", variant: "snow-capped volcano" },
  { id: "tokyo-tower", name: "Tokyo Tower", qid: "Q183536", lat: 35.65861, lon: 139.74556, arch: "tower", form: "lattice-red", fame: 2, tier: 2, nearPlace: "tokyo-jp", variant: "lattice tower (red/white)" },
  { id: "fushimi-inari-taisha", name: "Fushimi Inari-taisha", qid: "Q714828", lat: 34.9672, lon: 135.77339, arch: "pagoda/torii", form: "torii", fame: 2, tier: 2, nearPlace: "muko-jp", variant: "torii gate" },
  { id: "taipei-101", name: "Taipei 101", qid: "Q83101", lat: 25.03361, lon: 121.56472, arch: "tower", form: "taipei101", fame: 2, tier: 2, nearPlace: "taipei-tw", variant: "pagoda-segmented skyscraper" },
  { id: "gyeongbokgung", name: "Gyeongbokgung", qid: "Q482485", lat: 37.57988, lon: 126.9768, arch: "pagoda/torii", form: "hall", fame: 2, tier: 2, nearPlace: "goyang-si-kr", variant: "palace hall" },
  { id: "great-wall-of-china", name: "Great Wall of China (Badaling)", qid: "Q798826", lat: 40.35428, lon: 116.00649, arch: "wall", form: "great-wall-hero", face: -0.4, fame: 3, tier: 1, nearPlace: null, variant: "wall section + watchtower" },
  { id: "forbidden-city", name: "Forbidden City", qid: "Q80290", lat: 39.91583, lon: 116.39083, arch: "pagoda/torii", form: "hall-gold", fame: 2, tier: 2, nearPlace: null, variant: "palace hall" },
  { id: "marina-bay-sands", name: "Marina Bay Sands", qid: "Q548679", lat: 1.2825, lon: 103.86, arch: "tower", form: "mbs", fame: 2, tier: 2, nearPlace: "singapore-sg", variant: "three towers + skypark" },
  { id: "petronas-towers", name: "Petronas Towers", qid: "Q83063", lat: 3.15778, lon: 101.71167, arch: "tower", form: "twin", fame: 2, tier: 2, nearPlace: "kuala-lumpur-my", variant: "twin towers" },
  { id: "borobudur", name: "Borobudur", qid: "Q42798", lat: -7.60793, lon: 110.20384, arch: "pyramid", form: "borobudur", fame: 3, tier: 1, nearPlace: "sleman-id", variant: "stepped stupa mandala" },
  { id: "mount-agung", name: "Mount Agung", qid: "Q158470", lat: -8.34194, lon: 115.50778, arch: "mountain-peak", form: "cone", fame: 2, tier: 2, nearPlace: "ubud-id", variant: "volcano" },
  { id: "wat-arun", name: "Wat Arun", qid: "Q724970", lat: 13.74369, lon: 100.48892, arch: "pagoda/torii", form: "prang", fame: 2, tier: 2, nearPlace: "watthana-th", variant: "khmer prang" },
  { id: "wat-rong-khun", name: "Wat Rong Khun", qid: "Q496543", lat: 19.82424, lon: 99.76329, arch: "pagoda/torii", form: "whitetemple", fame: 2, tier: 2, nearPlace: "chiang-rai-th", variant: "white temple" },
  { id: "angkor-wat", name: "Angkor Wat", qid: "Q43473", lat: 13.4125, lon: 103.86667, arch: "pagoda/torii", form: "angkor-hero", face: -0.4, fame: 3, tier: 1, nearPlace: null, variant: "five khmer towers" },
  { id: "taj-mahal", name: "Taj Mahal", qid: "Q9141", lat: 27.175, lon: 78.04194, arch: "dome", form: "taj-hero", face: -0.4, fame: 3, tier: 1, nearPlace: null, variant: "onion dome + 4 minarets" },
  { id: "tirumala-venkateswara-temple", name: "Tirumala Venkateswara Temple", qid: "Q9375937", lat: 13.68306, lon: 79.34694, arch: "pagoda/torii", form: "gopuram", fame: 2, tier: 2, nearPlace: "tirupati-in", variant: "dravidian gopuram" },
  { id: "mount-everest", name: "Mount Everest", qid: "Q513", lat: 27.98806, lon: 86.925, arch: "mountain-peak", form: "snowpeak", fame: 3, tier: 1, nearPlace: null },
  { id: "sydney-opera-house", name: "Sydney Opera House", qid: "Q45178", lat: -33.85706, lon: 151.2149, arch: "dome", form: "opera-hero", face: -0.4, fame: 3, tier: 1, nearPlace: "mascot-au", variant: "shell sails" },
  { id: "uluru", name: "Uluru", qid: "Q33910", lat: -25.345, lon: 131.03611, arch: "rock", form: "uluru", fame: 3, tier: 1, nearPlace: null, variant: "monolith" },
  { id: "great-barrier-reef", name: "Great Barrier Reef (Cairns section)", qid: "Q7343", lat: -16.4, lon: 145.8, arch: "rock", form: "reef", fame: 3, tier: 1, nearPlace: "palm-cove-au", variant: "reef / coral atoll marker" },
  { id: "the-twelve-apostles", name: "The Twelve Apostles", qid: "Q475623", lat: -38.66583, lon: 143.10444, arch: "rock", form: "stacks", fame: 2, tier: 2, nearPlace: null, variant: "sea stacks", relatedPlace: "anglesea-au" },
  { id: "mount-kilimanjaro", name: "Mount Kilimanjaro", qid: "Q7296", lat: -3.07583, lon: 37.35333, arch: "mountain-peak", form: "kili", fame: 3, tier: 1, nearPlace: null, variant: "snow-capped volcano" },
  { id: "victoria-falls", name: "Victoria Falls", qid: "Q43278", lat: -17.92478, lon: 25.85806, arch: "waterfall", form: "chasm", fame: 3, tier: 1, nearPlace: null },
  { id: "moai-ahu-tongariki", name: "Moai — Ahu Tongariki", qid: "Q3448354", lat: -27.12583, lon: -109.27694, arch: "statue", form: "moai", fame: 3, tier: 1, nearPlace: null, variant: "moai row" },
  { id: "st-basil-s-cathedral", name: "St. Basil's Cathedral", qid: "Q129846", lat: 55.7525, lon: 37.62306, arch: "spire/cathedral", form: "basils", fame: 3, tier: 1, nearPlace: null, variant: "onion domes" },
]

/** Visited radius (plan spec). */
export const VISITED_KM = 60

function havKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Distance in km to the nearest place, and its index (-1 when there are none). */
export function nearestPlace(l: { lat: number; lon: number }, places: readonly { lat: number; lon: number }[]) {
  let best = -1
  let km = Infinity
  for (let i = 0; i < places.length; i++) {
    const d = havKm(l.lat, l.lon, places[i].lat, places[i].lon)
    if (d < km) {
      km = d
      best = i
    }
  }
  return { index: best, km }
}

/** Visited: near_place is a travel location, or a travel location lies within 60 km. */
export function landmarkVisited(
  l: Landmark,
  places: readonly { slug: string; lat: number; lon: number }[],
): boolean {
  if (l.nearPlace && places.some((p) => p.slug === l.nearPlace)) return true
  return nearestPlace(l, places).km <= VISITED_KM
}
