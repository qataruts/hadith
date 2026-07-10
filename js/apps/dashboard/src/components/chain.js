/**
 * Sanad chain — vertical, top = musannif (author), bottom = sahabi.
 * Pseudo-narrators (break markers, stubs) render as dashed markers, not people.
 */
import { esc, rankBadge, isBreakMarker } from "../util.js";

export function renderChain(sanad) {
  const nodes = (sanad.chain ?? []).map((c, i) => {
    const isAuthor = c.pos === 0;
    const isBreak = isBreakMarker(c.name ?? "");
    const isSahabi = /صحابي/.test(c.rank ?? "");
    const cls = ["chain-node", isAuthor && "is-author", isBreak && "is-break",
                 isSahabi && "is-sahabi"].filter(Boolean).join(" ");
    const name = isBreak
      ? `<span class="chain-name muted">⌁ ${esc(c.name)}</span>`
      : `<span class="chain-name"><a href="#/rawi/${c.rawiId}">${esc(c.name ?? `راوٍ ${c.rawiId}`)}</a></span>`;
    const meta = isAuthor
      ? `<span class="chain-meta">المصنّف</span>`
      : isBreak ? "" :
        `<span class="chain-meta">${c.tabaka ? `الطبقة ${c.tabaka}` : ""}</span> ${rankBadge(c.rank)}`;
    return `<div class="${cls}">
      <span class="chain-dot"></span><span class="chain-line"></span>
      ${name} ${meta}
    </div>`;
  });
  return `<div class="chain">${nodes.join("")}</div>`;
}
