/**
 * شجرة الإسناد — interactive isnad graph.
 *
 * - Backbone first: only narrators carrying multiple routes are shown, laid
 *   out top-down (النبي ﷺ → صحابة → طبقات → مصنّفو الكتب).
 * - Expand on demand: nodes with hidden routes show a "+N" pill; clicking it
 *   grows that branch in place (highest-traffic first).
 * - Pan by dragging, wheel-zoom at the cursor, toolbar (⊕ ⊖ fit fullscreen).
 * - Click a narrator → rich dossier popup (full record, simplified);
 *   double-click → his full page. Edge width = routes through that link;
 *   the madār is crowned.
 *
 * mountIsnadTree(container, tree, { budget, fetchRawi }) → { destroy }
 */
import { esc, fmt, rankBadge, hijri } from "../util.js";

const NODE_W = 150, NODE_H = 34, GAP_Y = 86, PAD = 30, MIN_GAP_X = 24;
const EXPAND_STEP = 12;

// ── graph math ─────────────────────────────────────────────────────────────

function backboneSet(tree, budget) {
  const keep = new Set([0]);
  if (tree.madar) keep.add(tree.madar.rawiId);
  const ranked = [...tree.nodes]
    .filter((n) => n.rawiId !== 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  for (const n of ranked) {
    if (keep.size >= budget) break;
    keep.add(n.rawiId);
  }
  return keep;
}

function layout(nodes, edges) {
  const layer = new Map(nodes.map((n) => [n.rawiId, n.rawiId === 0 ? 0 : 1]));
  const succ = new Map(), pred = new Map();
  for (const e of edges) {
    (succ.get(e.from) ?? succ.set(e.from, []).get(e.from)).push(e.to);
    (pred.get(e.to) ?? pred.set(e.to, []).get(e.to)).push(e.from);
  }
  for (let it = 0; it < nodes.length; it++) {
    let changed = false;
    for (const e of edges) {
      const want = (layer.get(e.from) ?? 1) + 1;
      if (want > (layer.get(e.to) ?? 1)) { layer.set(e.to, want); changed = true; }
    }
    if (!changed) break;
  }
  const maxLayer = Math.max(1, ...layer.values());
  for (const n of nodes)
    if (!(succ.get(n.rawiId)?.length) && n.rawiId !== 0) layer.set(n.rawiId, maxLayer);

  const layers = [];
  for (const n of nodes) (layers[layer.get(n.rawiId)] ??= []).push(n);
  const dense = layers.filter(Boolean);

  const pos = new Map();
  dense.forEach((L) => L.forEach((n, i) => pos.set(n.rawiId, i)));
  const bary = (id, dir) => {
    const ns = (dir === "up" ? pred : succ).get(id) ?? [];
    return ns.length ? ns.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / ns.length : pos.get(id);
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const dir = sweep % 2 ? "down" : "up";
    for (const L of dense) {
      L.sort((a, b) => bary(a.rawiId, dir) - bary(b.rawiId, dir));
      L.forEach((n, i) => pos.set(n.rawiId, i));
    }
  }
  const widest = Math.max(1, ...dense.map((L) => L.length));
  const W = Math.max(680, widest * (NODE_W + MIN_GAP_X) + PAD * 2);
  const H = (dense.length - 1) * GAP_Y + NODE_H + PAD * 2;
  const xy = new Map();
  dense.forEach((L, li) => {
    const step = (W - PAD * 2) / (L.length + 1);
    L.forEach((n, i) => xy.set(n.rawiId, { x: PAD + step * (i + 1), y: PAD + li * GAP_Y + NODE_H / 2 }));
  });
  return { xy, W, H };
}

// ── component ─────────────────────────────────────────────────────────────────

export function mountIsnadTree(container, tree, { budget = 46, fetchRawi } = {}) {
  const all = { nodes: tree.nodes, edges: tree.edges };
  const byId = new Map(all.nodes.map((n) => [n.rawiId, n]));
  const neighbors = new Map(); // id -> Set(ids) via any edge
  for (const e of all.edges) {
    (neighbors.get(e.from) ?? neighbors.set(e.from, new Set()).get(e.from)).add(e.to);
    (neighbors.get(e.to) ?? neighbors.set(e.to, new Set()).get(e.to)).add(e.from);
  }

  const visible = backboneSet(tree, budget);
  const cam = { k: 1, tx: 0, ty: 0 };
  let firstFit = true;
  const rawiCache = new Map();
  let popSeq = 0;   // invalidates stale popup fetches (wrong-narrator race)

  container.classList.add("tree-wrap");
  container.innerHTML = `
    <div class="tree-toolbar">
      <button data-act="fs" title="ملء الشاشة">⛶</button>
      <button data-act="fit" title="ملاءمة العرض">⌂</button>
      <button data-act="zin" title="تكبير">+</button>
      <button data-act="zout" title="تصغير">−</button>
      <span class="tree-note" id="tnote"></span>
    </div>
    <div class="tree-stage">
      <svg class="isnad-tree" direction="rtl" font-family="var(--font-ui)">
        <g class="cam"><g class="edges"></g><g class="nodes"></g></g>
      </svg>
      <div class="rawi-pop" hidden></div>
    </div>`;
  const stage = container.querySelector(".tree-stage");
  const svg = container.querySelector("svg");
  const gCam = svg.querySelector(".cam");
  const gEdges = svg.querySelector(".edges");
  const gNodes = svg.querySelector(".nodes");
  const pop = container.querySelector(".rawi-pop");
  const note = container.querySelector("#tnote");

  let world = { xy: new Map(), W: 0, H: 0 };

  const applyCam = () =>
    gCam.setAttribute("transform", `translate(${cam.tx},${cam.ty}) scale(${cam.k})`);

  function fit() {
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / world.W, r.height / world.H, 1.4);
    cam.k = Math.max(0.08, k * 0.96);
    cam.tx = (r.width - world.W * cam.k) / 2;
    cam.ty = 12;
    applyCam();
  }

  function hiddenCount(id) {
    let h = 0;
    for (const nb of neighbors.get(id) ?? []) if (!visible.has(nb)) h++;
    return h;
  }

  function render(keepNodeId) {
    const beforeScreen = keepNodeId != null && world.xy.get(keepNodeId)
      ? { x: world.xy.get(keepNodeId).x * cam.k + cam.tx, y: world.xy.get(keepNodeId).y * cam.k + cam.ty }
      : null;

    const vNodes = all.nodes.filter((n) => visible.has(n.rawiId));
    const vEdges = all.edges.filter((e) => visible.has(e.from) && visible.has(e.to));
    world = layout(vNodes, vEdges);

    const maxE = Math.max(1, ...vEdges.map((e) => e.count));
    gEdges.innerHTML = vEdges.map((e) => {
      const a = world.xy.get(e.from), b = world.xy.get(e.to);
      if (!a || !b) return "";
      const w = 1 + Math.min(6, Math.log2(e.count + 1) * 1.7);
      const op = 0.2 + 0.5 * (e.count / maxE);
      const my = (a.y + b.y) / 2;
      return `<path d="M${a.x},${a.y + NODE_H / 2} C${a.x},${my} ${b.x},${my} ${b.x},${b.y - NODE_H / 2}"
        fill="none" stroke="var(--accent)" stroke-width="${w.toFixed(1)}" opacity="${op.toFixed(2)}"
        data-from="${e.from}" data-to="${e.to}"><title>${esc(byId.get(e.from)?.name ?? "")} ← ${esc(byId.get(e.to)?.name ?? "")} · ${fmt(e.count)} طريق</title></path>`;
    }).join("");

    const madarId = tree.madar?.rawiId;
    gNodes.innerHTML = vNodes.map((n) => {
      const p = world.xy.get(n.rawiId);
      if (!p) return "";
      const isMadar = n.rawiId === madarId;
      const fill = n.role === "prophet" ? "var(--accent)"
        : n.role === "sahabi" ? "var(--gold-soft)"
        : n.role === "author" ? "var(--surface-2)" : "var(--surface)";
      const stroke = n.role === "break" ? "var(--critical)"
        : n.role === "sahabi" ? "var(--gold)" : isMadar ? "var(--accent)" : "var(--hairline)";
      const dash = n.role === "break" ? `stroke-dasharray="4 3"` : "";
      const ink = n.role === "prophet" ? "var(--accent-ink)" : "var(--ink)";
      const cps = Array.from(n.name ?? "");
      const label = cps.length > 18 ? cps.slice(0, 17).join("") + "…" : (n.name ?? "");
      const hid = hiddenCount(n.rawiId);
      const clickable = n.role !== "prophet" && n.role !== "break";
      return `<g class="tnode ${clickable ? "clickable" : ""}" data-id="${n.rawiId}" ${clickable ? 'tabindex="0" role="button"' : ""}>
        <rect x="${p.x - NODE_W / 2}" y="${p.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}"
          rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${isMadar ? 2 : 1.2}" ${dash}/>
        <text x="${p.x}" y="${p.y + 1}" text-anchor="middle" dominant-baseline="middle"
          fill="${ink}" font-size="12.5" font-weight="${n.role === "sahabi" || isMadar ? 600 : 400}">${esc(label)}</text>
        ${isMadar ? `<text x="${p.x}" y="${p.y - NODE_H / 2 - 6}" text-anchor="middle" fill="var(--accent)" font-size="10.5" font-weight="700">◈ مدار الحديث</text>` : ""}
        ${hid ? `<g class="expand" data-expand="${n.rawiId}"><rect x="${p.x - 22}" y="${p.y + NODE_H / 2 - 3}" width="44" height="17" rx="8" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="0.8"/>
          <text x="${p.x}" y="${p.y + NODE_H / 2 + 6}" text-anchor="middle" dominant-baseline="middle" fill="var(--accent)" font-size="10.5" font-weight="600">+${fmt(hid)}</text></g>` : ""}
      </g>`;
    }).join("");

    note.textContent = `${fmt(vNodes.length)} من ${fmt(all.nodes.length)} راوياً — اضغط +N لتوسيع فرع`;

    if (beforeScreen && keepNodeId != null && world.xy.get(keepNodeId)) {
      const p = world.xy.get(keepNodeId);
      cam.tx = beforeScreen.x - p.x * cam.k;
      cam.ty = beforeScreen.y - p.y * cam.k;
      applyCam();
    } else if (firstFit) {
      firstFit = false;
      fit();
    } else {
      applyCam();
    }
  }

  function expand(id) {
    const hidden = [...(neighbors.get(id) ?? [])]
      .filter((nb) => !visible.has(nb))
      .sort((a, b) => (byId.get(b)?.count ?? 0) - (byId.get(a)?.count ?? 0))
      .slice(0, EXPAND_STEP);
    for (const nb of hidden) visible.add(nb);
    render(id);
  }

  // ── popup ──────────────────────────────────────────────────────────────────
  async function showPopup(id, anchorEl) {
    const n = byId.get(id);
    if (!n || !fetchRawi) return;
    const seq = ++popSeq;
    const fresh = () => seq === popSeq && !pop.hidden && pop.isConnected;
    pop.hidden = false;
    pop.innerHTML = `<div class="skeleton" style="height:120px;width:280px"></div>`;
    placePopup(anchorEl);
    let r = rawiCache.get(id);
    if (!r) {
      try { r = await fetchRawi(id); rawiCache.set(id, r); }
      catch { if (fresh()) pop.innerHTML = `<div class="muted">تعذر التحميل</div>`; return; }
    }
    if (!fresh()) return;   // user moved on while we were fetching
    if (!r) { pop.innerHTML = `<div class="muted">لا ترجمة</div>`; return; }
    const flags = [
      r.isBukhari && "روى له البخاري", r.isMuslim && "روى له مسلم",
      r.hasTadlis && "مدلِّس", r.hasIkhtilat && "اختلط", r.isStub && "ترجمة ناقصة",
    ].filter(Boolean);
    const meta = [
      r.tabaka ? `الطبقة ${fmt(r.tabaka)}` : null,
      (r.deathYear || r.deathYearRaw) ? `ت ${hijri(r.deathYear, r.deathYearRaw)}` : null,
      r.deathPlace ? esc(r.deathPlace) : null,
      r.profession ? esc(r.profession) : null,
    ].filter(Boolean).join(" · ");
    pop.innerHTML = `
      <div class="spread" style="gap:8px">
        <strong style="font-size:14.5px">${esc(r.nickname)}</strong>
        ${rankBadge(r.rank)}
      </div>
      <div class="muted" style="font-size:12px;margin-top:2px">${esc(r.name)}</div>
      ${meta ? `<div style="font-size:12.5px;margin-top:6px">${meta}</div>` : ""}
      <div class="row" style="margin-top:8px;gap:6px">
        <span class="badge">${fmt(r.chainCount)} إسناد</span>
        <span class="badge">${fmt(r.hadithCount)} حديث</span>
        <span class="badge">في هذه الشجرة: ${fmt(n.count)} طريق</span>
      </div>
      ${flags.length ? `<div class="row" style="margin-top:6px;gap:6px">${flags.map((f) => `<span class="badge">${f}</span>`).join("")}</div>` : ""}
      ${(r.aqwal ?? []).length ? `
        <div style="margin-top:10px;border-top:1px solid var(--hairline);padding-top:8px">
          ${r.aqwal.slice(0, 3).map((q) => `<div style="font-size:12.5px;margin-bottom:4px">«${esc(q.qawl)}» <span class="muted">— ${esc(q.alem)}</span></div>`).join("")}
          ${r.aqwal.length > 3 ? `<div class="muted" style="font-size:11.5px">و${fmt(r.aqwal.length - 3)} أقوال أخرى…</div>` : ""}
        </div>` : ""}
      ${(r.teachers ?? []).length || (r.students ?? []).length ? `
        <div class="muted" style="font-size:12px;margin-top:8px">
          ${r.teachers?.length ? `شيوخه: ${r.teachers.slice(0, 3).map((t) => esc(t.name)).join("، ")}${r.teachers.length > 3 ? "…" : ""}` : ""}
          ${r.students?.length ? `<br/>تلاميذه: ${r.students.slice(0, 3).map((t) => esc(t.name)).join("، ")}${r.students.length > 3 ? "…" : ""}` : ""}
        </div>` : ""}
      <div class="row" style="margin-top:10px;gap:8px">
        <a class="chip" href="#/rawi/${id}">الترجمة الكاملة ←</a>
        ${hiddenCount(id) ? `<button class="chip" data-pop-expand="${id}">توسيع طرقه هنا (+${fmt(hiddenCount(id))})</button>` : ""}
      </div>`;
    placePopup(anchorEl);
    pop.querySelector("[data-pop-expand]")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      hidePopup();
      expand(id);
    });
  }
  function placePopup(anchorEl) {
    const sr = stage.getBoundingClientRect();
    const ar = anchorEl.getBoundingClientRect();
    let x = ar.left - sr.left + ar.width / 2 - pop.offsetWidth / 2;
    let y = ar.bottom - sr.top + 8;
    x = Math.max(8, Math.min(x, sr.width - pop.offsetWidth - 8));
    if (y + pop.offsetHeight > sr.height - 8) y = ar.top - sr.top - pop.offsetHeight - 8;
    pop.style.left = `${x}px`;
    pop.style.top = `${Math.max(8, y)}px`;
  }
  const hidePopup = () => { pop.hidden = true; popSeq++; };

  // ── interactions ───────────────────────────────────────────────────────────
  let drag = null, moved = false;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".rawi-pop")) return;
    drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty };
    moved = false;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (moved) {
      cam.tx = drag.tx + dx;
      cam.ty = drag.ty + dy;
      applyCam();
      hidePopup();
    }
  });
  stage.addEventListener("pointerup", () => { drag = null; });
  stage.addEventListener("pointercancel", () => { drag = null; });
  stage.addEventListener("wheel", (e) => {
    if (e.target.closest(".rawi-pop")) return;   // let the dossier card scroll
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    const cx = e.clientX - sr.left, cy = e.clientY - sr.top;
    const factor = Math.exp(-e.deltaY * 0.0016);
    const k2 = Math.max(0.08, Math.min(3, cam.k * factor));
    cam.tx = cx - (cx - cam.tx) * (k2 / cam.k);
    cam.ty = cy - (cy - cam.ty) * (k2 / cam.k);
    cam.k = k2;
    applyCam();
    hidePopup();
  }, { passive: false });

  svg.addEventListener("click", (e) => {
    if (moved) return;                       // it was a pan, not a click
    const ex = e.target.closest(".expand");
    if (ex) { expand(Number(ex.dataset.expand)); return; }
    const g = e.target.closest(".tnode.clickable");
    if (g) showPopup(Number(g.dataset.id), g);
    else hidePopup();
  });
  svg.addEventListener("dblclick", (e) => {
    const g = e.target.closest(".tnode.clickable");
    if (g) location.hash = `#/rawi/${g.dataset.id}`;
  });
  svg.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const g = e.target.closest(".tnode.clickable");
      if (g) showPopup(Number(g.dataset.id), g);
    }
  });

  // hover: light routes through the node
  svg.addEventListener("mouseover", (e) => {
    const g = e.target.closest(".tnode");
    if (!g) return;
    const id = g.dataset.id;
    gEdges.querySelectorAll("path").forEach((p) => {
      const hit = p.dataset.from === id || p.dataset.to === id;
      p.style.stroke = hit ? "var(--gold)" : "";
      p.style.opacity = hit ? "0.95" : "";
    });
  });
  svg.addEventListener("mouseout", (e) => {
    if (e.target.closest(".tnode"))
      gEdges.querySelectorAll("path").forEach((p) => { p.style.stroke = ""; p.style.opacity = ""; });
  });

  // toolbar
  container.querySelector(".tree-toolbar").addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    if (act === "fit") fit();
    if (act === "zin" || act === "zout") {
      const sr = stage.getBoundingClientRect();
      const cx = sr.width / 2, cy = sr.height / 2;
      const k2 = Math.max(0.08, Math.min(3, cam.k * (act === "zin" ? 1.3 : 0.77)));
      cam.tx = cx - (cx - cam.tx) * (k2 / cam.k);
      cam.ty = cy - (cy - cam.ty) * (k2 / cam.k);
      cam.k = k2;
      applyCam();
    }
    if (act === "fs") {
      container.classList.toggle("tree-fullscreen");
      document.body.classList.toggle("tree-fs-open", container.classList.contains("tree-fullscreen"));
      requestAnimationFrame(fit);
    }
  });
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    if (!pop.hidden) { hidePopup(); return; }
    if (container.classList.contains("tree-fullscreen")) {
      container.classList.remove("tree-fullscreen");
      document.body.classList.remove("tree-fs-open");
      requestAnimationFrame(fit);
    }
  };
  document.addEventListener("keydown", onKey);

  render();

  return {
    destroy() {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("tree-fs-open");
      container.classList.remove("tree-wrap", "tree-fullscreen");
      container.innerHTML = "";
    },
  };
}
