/**
 * شجرة الإسناد — the isnad tree of a meaning group as a layered SVG DAG.
 * Top = النبي ﷺ, then the sahabi layer, generations downward to the book
 * authors. Edge width ∝ how many chains traverse it; the madār (pivot
 * narrator all routes converge through) is crowned. Hover a node to light
 * its routes; click opens the rawi page.
 */
import { esc, fmt } from "../util.js";

const NODE_W = 148, NODE_H = 34, GAP_Y = 74, PAD = 24;

export function renderTree(tree) {
  const { nodes, edges, madar } = tree;
  const byId = new Map(nodes.map((n) => [n.rawiId, n]));

  // ── layering: round average transmission depth, prophet pinned at 0
  for (const n of nodes) n.layer = n.role === "prophet" ? 0 : Math.max(1, Math.round(n.depth));
  // authors sink to the deepest layer so books line up on one shelf
  const maxLayer = Math.max(...nodes.map((n) => n.layer));
  for (const n of nodes) if (n.role === "author") n.layer = maxLayer;

  const layers = [];
  for (const n of nodes) (layers[n.layer] ??= []).push(n);

  // ── crossing reduction: 3 barycenter sweeps over predecessor positions
  const preds = new Map(), succs = new Map();
  for (const e of edges) {
    (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)).push(e.from);
    (succs.get(e.from) ?? succs.set(e.from, []).get(e.from)).push(e.to);
  }
  const pos = new Map();
  layers.forEach((L) => L?.forEach((n, i) => pos.set(n.rawiId, i)));
  for (let sweep = 0; sweep < 3; sweep++) {
    for (const L of layers) {
      if (!L) continue;
      L.sort((a, b) => {
        const bary = (n) => {
          const ps = (sweep % 2 ? succs : preds).get(n.rawiId) ?? [];
          return ps.length
            ? ps.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / ps.length
            : pos.get(n.rawiId) ?? 0;
        };
        return bary(a) - bary(b);
      });
      L.forEach((n, i) => pos.set(n.rawiId, i));
    }
  }

  // Array.from visits holes (sparse layers) as 0 — plain .map would skip them
  const widest = Math.max(1, ...Array.from(layers, (L) => L?.length ?? 0));
  const W = Math.max(720, widest * (NODE_W + 18) + PAD * 2);
  const H = (layers.length - 1) * GAP_Y + NODE_H + PAD * 2;
  const xy = new Map();
  layers.forEach((L, li) => {
    if (!L) return;
    const step = (W - PAD * 2) / (L.length + 1);
    L.forEach((n, i) => xy.set(n.rawiId, {
      x: PAD + step * (i + 1),
      y: PAD + li * GAP_Y + NODE_H / 2,
    }));
  });

  const maxE = Math.max(...edges.map((e) => e.count));
  const paths = edges.map((e) => {
    const a = xy.get(e.from), b = xy.get(e.to);
    if (!a || !b) return "";
    const w = 1 + Math.min(5, Math.log2(e.count + 1) * 1.6);
    const opacity = 0.25 + 0.55 * (e.count / maxE);
    const my = (a.y + b.y) / 2;
    return `<path d="M${a.x},${a.y + NODE_H / 2} C${a.x},${my} ${b.x},${my} ${b.x},${b.y - NODE_H / 2}"
      fill="none" stroke="var(--accent)" stroke-width="${w}" opacity="${opacity}"
      data-from="${e.from}" data-to="${e.to}"
      ><title>${esc(byId.get(e.from)?.name ?? "")} ← ${esc(byId.get(e.to)?.name ?? "")} (${fmt(e.count)} طريقاً)</title></path>`;
  });

  const nodeEls = nodes.map((n) => {
    const p = xy.get(n.rawiId);
    if (!p) return "";
    const isMadar = madar && n.rawiId === madar.rawiId;
    const fill = n.role === "prophet" ? "var(--accent)"
      : n.role === "sahabi" ? "var(--gold-soft)"
      : n.role === "author" ? "var(--surface-2)" : "var(--surface)";
    const stroke = n.role === "break" ? "var(--critical)"
      : n.role === "sahabi" ? "var(--gold)"
      : isMadar ? "var(--accent)" : "var(--hairline)";
    const dash = n.role === "break" ? `stroke-dasharray="4 3"` : "";
    const ink = n.role === "prophet" ? "var(--accent-ink)" : "var(--ink)";
    const cps = Array.from(n.name);   // code points — never split surrogates/diacritics
    const label = cps.length > 17 ? cps.slice(0, 16).join("") + "…" : n.name;
    const inner = `
      <rect x="${p.x - NODE_W / 2}" y="${p.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}"
        rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${isMadar ? 2 : 1.2}" ${dash}/>
      <text x="${p.x}" y="${p.y + 1}" text-anchor="middle" dominant-baseline="middle"
        fill="${ink}" font-size="12.5" font-weight="${n.role === "sahabi" || isMadar ? 600 : 400}">${esc(label)}</text>
      ${isMadar ? `<text x="${p.x}" y="${p.y - NODE_H / 2 - 6}" text-anchor="middle"
        fill="var(--accent)" font-size="10.5" font-weight="700">◈ مدار الحديث</text>` : ""}
      <title>${esc(n.name)}${n.rank ? ` — ${esc(n.rank)}` : ""}${n.tabaka ? ` — الطبقة ${n.tabaka}` : ""} — في ${fmt(n.count)} طريق</title>`;
    return n.role === "prophet" || n.role === "break" || !n.rawiId
      ? `<g class="tnode" data-id="${n.rawiId}">${inner}</g>`
      : `<a href="#/rawi/${n.rawiId}"><g class="tnode" data-id="${n.rawiId}" style="cursor:pointer">${inner}</g></a>`;
  });

  return `
  <div class="tree-scroll" style="overflow:auto;border:1px solid var(--hairline);border-radius:var(--radius);background:var(--surface)">
    <svg class="isnad-tree" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
         font-family="var(--font-ui)" direction="rtl">
      <g class="tree-edges">${paths.join("")}</g>
      <g>${nodeEls.join("")}</g>
    </svg>
  </div>`;
}

/** Bind hover + keyboard focus: light every edge touching the active node. */
export function bindTree(container) {
  const svg = container.querySelector(".isnad-tree");
  if (!svg) return;
  const light = (id) =>
    svg.querySelectorAll("path[data-from]").forEach((p) => {
      const hit = id != null && (p.dataset.from === id || p.dataset.to === id);
      p.style.stroke = hit ? "var(--gold)" : "";
      p.style.opacity = hit ? "0.95" : "";
    });
  const idOf = (e) => e.target.closest?.(".tnode")?.dataset.id ?? null;
  svg.addEventListener("mouseover", (e) => { const id = idOf(e); if (id) light(id); });
  svg.addEventListener("mouseout", (e) => { if (idOf(e)) light(null); });
  svg.addEventListener("focusin", (e) => { const id = idOf(e); if (id) light(id); });
  svg.addEventListener("focusout", () => light(null));
}
