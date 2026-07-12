/**
 * مسار الانتقال الجغرافي — a self-contained schematic map (no tiles) showing how
 * a meaning traveled between cities. Cities are placed by real lat/lng and
 * sized by how many narrators sat in them; arcs are city→city transmission
 * hops, width by frequency, pointing the direction the hadith moved.
 */
import { esc, fmt } from "../util.js";

// major hadith-transmission centres → [lat, lng]
const COORDS = {
  "المدينة": [24.47, 39.61], "مكة": [21.42, 39.83], "الكوفة": [32.03, 44.40],
  "البصرة": [30.51, 47.78], "بغداد": [33.31, 44.36], "دمشق": [33.51, 36.29],
  "مصر": [30.04, 31.24], "الإسكندرية": [31.20, 29.92], "نيسابور": [36.21, 58.79],
  "مرو": [37.66, 62.19], "بخارى": [39.77, 64.42], "سمرقند": [39.65, 66.96],
  "الري": [35.59, 51.44], "أصبهان": [32.65, 51.67], "واسط": [32.18, 46.30],
  "حمص": [34.73, 36.72], "حلب": [36.20, 37.16], "الموصل": [36.34, 43.13],
  "الرقة": [35.95, 39.01], "سر من رأى": [34.20, 43.87], "هراة": [34.35, 62.20],
  "بلخ": [36.76, 66.90], "طرسوس": [36.92, 34.90], "عسقلان": [31.67, 34.57],
  "بيت المقدس": [31.78, 35.22], "صنعاء": [15.37, 44.19], "قرطبة": [37.89, -4.78],
  "القيروان": [35.68, 10.10], "جرجان": [36.84, 54.44], "طوس": [36.48, 59.61],
  "همذان": [34.80, 48.52], "المدائن": [33.09, 44.58], "الأهواز": [31.32, 48.67],
  "طبرية": [32.79, 35.53], "دمياط": [31.42, 31.81], "الأنبار": [33.36, 43.68],
  "بيروت": [33.89, 35.50], "طبرستان": [36.2, 52.5], "سجستان": [31.0, 61.9],
  "الهاشمية": [32.05, 44.32], "هيت": [33.64, 42.83], "الأبلة": [30.50, 47.72],
  "تستر": [32.00, 48.83], "نصيبين": [37.07, 41.22], "الرملة": [31.93, 34.87],
  "طرابلس": [34.44, 35.84], "جدة": [21.54, 39.17], "الطائف": [21.27, 40.42],
  "اليمامة": [24.10, 47.30], "عدن": [12.79, 45.02], "سرخس": [36.54, 61.16],
  "ترمذ": [37.22, 67.28], "خوارزم": [41.50, 60.60], "الكرخ": [33.34, 44.36],
  "الحيرة": [31.90, 44.40], "بعلبك": [34.00, 36.21], "صور": [33.27, 35.19],
  "قنسرين": [36.00, 37.20], "آمد": [37.91, 40.23], "تبريز": [38.08, 46.30],
  "شيراز": [29.60, 52.53], "كرمان": [30.28, 57.08], "غزنة": [33.55, 68.42],
  "المصيصة": [36.96, 35.62], "الرها": [37.16, 38.79], "حران": [36.86, 39.03],
  "تكريت": [34.61, 43.68], "قم": [34.64, 50.88], "أنطاكية": [36.20, 36.16],
  "الرصافة": [33.35, 44.43], "سمنان": [35.57, 53.39],
};
const ALIAS = {
  "القاهرة": "مصر", "الفسطاط": "مصر", "الشام": "دمشق", "الحجاز": "مكة",
  "خراسان": "نيسابور", "اليمن": "صنعاء", "الأندلس": "قرطبة", "سامراء": "سر من رأى",
  "العراق": "بغداد", "فارس": "أصبهان", "المغرب": "القيروان", "افريقية": "القيروان",
  "الجزيرة": "الموصل", "قزوين": "الري",
};
function resolve(name) {
  if (!name) return null;
  const n = name.trim();
  if (COORDS[n]) return n;
  if (ALIAS[n] && COORDS[ALIAS[n]]) return ALIAS[n];
  const alt = n.startsWith("ال") ? n.slice(2) : "ال" + n;
  if (COORDS[alt]) return alt;
  if (ALIAS[alt] && COORDS[ALIAS[alt]]) return ALIAS[alt];
  return null;
}

export function renderGeoMap(data) {
  // resolve cities + flows to known coordinates
  const counts = new Map();
  let placed = 0, unplaced = 0;
  for (const [name, c] of Object.entries(data.cityCounts ?? {})) {
    const r = resolve(name);
    if (r) { counts.set(r, (counts.get(r) ?? 0) + c); placed += c; }
    else unplaced += c;
  }
  const flows = new Map();
  for (const f of data.flows ?? []) {
    const a = resolve(f.from), b = resolve(f.to);
    if (!a || !b || a === b) continue;
    flows.set(`${a}>${b}`, (flows.get(`${a}>${b}`) ?? 0) + f.count);
  }
  if (counts.size < 2)
    return `<div class="muted" style="padding:8px">لا تتوفّر مواطن جغرافية كافية لرسم المسار.</div>`;

  // project lat/lng → SVG
  const W = 760, H = 430, PAD = 46;
  const cities = [...counts.keys()];
  const lats = cities.map((c) => COORDS[c][0]), lngs = cities.map((c) => COORDS[c][1]);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats);
  const minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const spanLo = Math.max(1, maxLo - minLo), spanLa = Math.max(1, maxLa - minLa);
  const px = (lng) => PAD + ((lng - minLo) / spanLo) * (W - PAD * 2);
  const py = (lat) => PAD + ((maxLa - lat) / spanLa) * (H - PAD * 2);
  const xy = (c) => ({ x: px(COORDS[c][1]), y: py(COORDS[c][0]) });

  const maxCount = Math.max(...counts.values());
  const maxFlow = Math.max(...flows.values(), 1);

  const arcs = [...flows].map(([k, w]) => {
    const [a, b] = k.split(">");
    const p = xy(a), qy = xy(b);
    const mx = (p.x + qy.x) / 2, my = (p.y + qy.y) / 2 - Math.hypot(qy.x - p.x, qy.y - p.y) * 0.14;
    const sw = 0.8 + (w / maxFlow) * 4.5;
    const op = 0.3 + 0.5 * (w / maxFlow);
    return `<path d="M${p.x},${p.y} Q${mx},${my} ${qy.x},${qy.y}" fill="none"
      stroke="var(--accent)" stroke-width="${sw.toFixed(1)}" opacity="${op.toFixed(2)}"
      marker-end="url(#geoarrow)"><title>${esc(a)} ← ${esc(b)} · ${fmt(w)} انتقال</title></path>`;
  }).join("");

  const dots = cities.map((c) => {
    const p = xy(c), n = counts.get(c);
    const r = 3 + Math.sqrt(n / maxCount) * 11;
    return `<g class="geo-city"><circle cx="${p.x}" cy="${p.y}" r="${r.toFixed(1)}"
      fill="var(--gold-soft)" stroke="var(--gold)" stroke-width="1.4"/>
      <text x="${p.x}" y="${(p.y - r - 4).toFixed(1)}" text-anchor="middle" font-size="12"
        fill="var(--ink)" font-weight="600">${esc(c)}</text>
      <title>${esc(c)} — ${fmt(n)} راوٍ في هذا المعنى</title></g>`;
  }).join("");

  return `
    <div class="geo-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="geo-svg" font-family="var(--font-ui)" direction="ltr">
        <defs><marker id="geoarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker></defs>
        <g>${arcs}</g><g>${dots}</g>
      </svg>
    </div>
    <div class="muted" style="font-size:12.5px;margin-top:6px">
      حجم الدائرة = عدد الرواة في المدينة · سماكة السهم = عدد مرات انتقال الحديث بين المدينتين · اتجاه السهم = اتجاه الرواية.
      ${unplaced ? `(تعذّر تحديد موقع ${fmt(unplaced)} إشارة جغرافية غير معروفة)` : ""}
    </div>`;
}
