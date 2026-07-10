/**
 * Render hadith plain text + relational markup (character offsets) into HTML:
 *   mentions  → clickable narrator links (#/rawi/:id)
 *   matn span → highlighted
 *   aya spans → Quranic style
 * Uses a boundary-event sweep so nested/overlapping spans compose correctly.
 */
import { esc } from "../util.js";

export function renderNass(h, { linkRawis = true } = {}) {
  const text = h.nass ?? "";
  const marks = [];
  if (h.matnStart != null) marks.push({ s: h.matnStart, e: h.matnEnd, cls: "matn" });
  for (const [s, e] of h.ayas ?? []) marks.push({ s, e, cls: "aya" });
  for (const [rid, s, e] of h.mentions ?? [])
    marks.push({ s, e, cls: "rawi", rid });

  const bounds = new Set([0, text.length]);
  for (const m of marks) { bounds.add(m.s); bounds.add(m.e); }
  const pts = [...bounds].sort((a, b) => a - b);

  let out = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const [s, e] = [pts[i], pts[i + 1]];
    if (s >= e) continue;
    const seg = esc(text.slice(s, e));
    const active = marks.filter((m) => m.s <= s && m.e >= e);
    let piece = seg;
    // innermost first: aya inside matn, mention wraps its own text
    if (active.some((m) => m.cls === "aya")) piece = `<span class="aya">${piece}</span>`;
    const mention = active.find((m) => m.cls === "rawi");
    if (mention)
      piece = linkRawis && mention.rid != null
        ? `<a class="rawi-link" href="#/rawi/${mention.rid}">${piece}</a>`
        : `<span class="rawi-link">${piece}</span>`;
    if (active.some((m) => m.cls === "matn")) piece = `<span class="matn">${piece}</span>`;
    out += piece;
  }
  return out;
}
