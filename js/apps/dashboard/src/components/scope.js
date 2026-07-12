/**
 * Corpus scope — the set of active books the whole app works within.
 * Stored on the device (localStorage). Pure state, no imports, so api.js can
 * append the scope to every request without a circular dependency.
 *
 * Value: an array of bookIds, or the string "all" (no restriction).
 * Unset → treated as "all" until the default (top-30) is applied on boot.
 */
const KEY = "jami-scope";

export const PRESETS = {
  sahihayn: { label: "الصحيحان", ids: [1, 2] },
  six: { label: "الكتب الستة", ids: [1, 2, 3, 4, 5, 6] },
  nine: { label: "الكتب التسعة", ids: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
};

export function getScopeIds() {
  const raw = localStorage.getItem(KEY);
  if (!raw || raw === "all") return null;          // null = all books
  try { const a = JSON.parse(raw); return Array.isArray(a) && a.length ? a : null; }
  catch { return null; }
}
export function isScoped() { return getScopeIds() != null; }
export function setScope(idsOrAll) {
  localStorage.setItem(KEY, idsOrAll == null ? "all" : JSON.stringify([...idsOrAll]));
  dispatchEvent(new CustomEvent("scope:change"));
}
export function hasScopeSet() { return localStorage.getItem(KEY) != null; }

/** Query params to append to scope-aware requests. */
export function scopeParam() {
  const ids = getScopeIds();
  return ids ? { books: ids.join(",") } : {};
}
