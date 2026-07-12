/**
 * Sanad chain X-ray — vertical, top = musannif (author), bottom = sahabi.
 * Each narrator dot is colored by his reliability; the connecting segment takes
 * the weaker of its two ends, so the chain visibly weakens/breaks at its weak
 * link. The weakest narrator is flagged. Names are buttons → dossier card.
 * Pseudo-narrators (breaks/stubs) render as dashed markers, not people.
 */
import { esc, fmt, rankBadge, isBreakMarker, rankSev, rankVar, edgeVar } from "../util.js";

export function renderChain(sanad, { idx = 0, book, bookId, noInBook } = {}) {
  const chain = sanad.chain ?? [];
  // find the weakest real narrator (highest severity) to flag it
  let weakIdx = -1, weakSev = -1;
  chain.forEach((c, i) => {
    if (isBreakMarker(c.name ?? "") || c.pos === 0) return;
    const s = rankSev(c.rank ?? "").sev;
    if (s > weakSev) { weakSev = s; weakIdx = i; }
  });

  const nodes = chain.map((c, i) => {
    const isAuthor = c.pos === 0;
    const isBreak = isBreakMarker(c.name ?? "");
    const nxt = chain[i + 1];
    const segColor = nxt ? edgeVar(c.rank ?? "", nxt.rank ?? "") : "transparent";
    const rk = isBreak ? "var(--critical)" : rankVar(c.rank ?? "");
    const cls = ["chain-node", isAuthor && "is-author", isBreak && "is-break",
                 i === weakIdx && weakSev >= 4 && "weakest"].filter(Boolean).join(" ");
    const name = isBreak
      ? `<span class="chain-name muted">⌁ ${esc(c.name)}</span>`
      : `<span class="chain-name"><button class="rawi-node" data-rawi="${c.rawiId}" data-graph="${idx}">${esc(c.name ?? `راوٍ ${c.rawiId}`)}</button></span>`;
    const meta = isAuthor
      ? `<span class="chain-meta">المصنّف</span>`
      : isBreak ? ""
      : `<span class="chain-meta">${c.tabaka ? `ط${c.tabaka}` : ""}</span> ${rankBadge(c.rank)}${i === weakIdx && weakSev >= 4 ? ` <span class="weakest-tag">أضعف حلقة</span>` : ""}`;
    return `<div class="${cls}" style="--rk:${rk};--seg:${segColor}">
      <span class="chain-dot"></span><span class="chain-line"></span>
      ${name} ${meta}
    </div>`;
  });
  // the isnad is only complete when it lands in a book — show it as the terminal
  // above the author (the collector who recorded it)
  if (book) {
    const bname = bookId ? `<a href="#/book/${bookId}">${esc(book)}</a>` : esc(book);
    nodes.unshift(`<div class="chain-node is-book" style="--rk:var(--gold);--seg:var(--gold)">
      <span class="chain-dot"></span><span class="chain-line"></span>
      <span class="chain-name">${bname}</span>
      <span class="chain-meta">الكتاب${noInBook ? ` · رقم ${fmt(noInBook)}` : ""}</span>
    </div>`);
  }
  return `<div class="chain">${nodes.join("")}</div>`;
}
