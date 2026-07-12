/** API client — all data access goes through here. */
import { scopeParam, getScopeIds } from "./components/scope.js";
const BASE = "/api";

// the book scope governs the whole app; only a few person/record lookups where a
// book filter is meaningless stay corpus-wide (a critic's judgements, a rawi's
// bio + relations, the topic taxonomy, a single hadith view, name search).
const UNSCOPED = /^\/(alem|topic|books?|hadith\/\d+$|search\/rawis)/;

async function get(path, params) {
  const u = new URL(BASE + path, location.origin);
  const merged = UNSCOPED.test(path) ? params : { ...scopeParam(), ...params };
  for (const [k, v] of Object.entries(merged ?? {}))
    if (v != null && v !== "") u.searchParams.set(k, v);
  const res = await fetch(u);
  if (res.status === 404) return null;   // pages render their own not-found state
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  stats: () => get("/stats"),
  searchHadiths: (q, limit = 20) => get("/search/hadiths", { q, limit }),
  searchGroups: (q, limit = 20) => get("/search/groups", { q, limit }),
  searchRawis: (q, limit = 20) => get("/search/rawis", { q, limit }),
  semanticGroups: (q, limit = 10) => get("/semantic/groups", { q, limit }),
  hadith: (id) => get(`/hadith/${id}`),
  hadithWhy: (id) => get(`/hadith/${id}/why`),
  hadithItibar: (id, rawi) => get(`/hadith/${id}/itibar`, rawi ? { rawi } : {}),
  hadithContact: (id) => get(`/hadith/${id}/contact`),
  hadithNav: (id) => get(`/hadith/${id}/nav`),
  bookHadithNo: (bookId, no) => get(`/book/${bookId}/no/${no}`),
  group: (id, limit = 30, offset = 0) => get(`/group/${id}`, { limit, offset }),
  groupTree: (id, params) => get(`/group/${id}/tree`, params ?? {}),
  groupMatns: (id) => get(`/group/${id}/matns`),
  groupGeo: (id) => get(`/group/${id}/geo`),
  groupEdge: (id, from, to, filters = {}) => get(`/group/${id}/edge`, { from, to, ...filters }),
  groupBoard: (id, rawi) => get(`/group/${id}/board`, rawi ? { rawi } : {}),
  groupIcma: (id) => get(`/group/${id}/icma`),
  rawi: (id) => get(`/rawi/${id}`),
  rawiHadiths: (id, limit = 20, offset = 0) => get(`/rawi/${id}/hadiths`, { limit, offset }),
  alem: (id, limit = 50, offset = 0) => get(`/alem/${id}`, { limit, offset }),
  alems: () => get("/alems"),
  books: () => get("/books"),
  book: (id, limit = 30, offset = 0) => get(`/book/${id}`, { limit, offset }),
  tafarrud: (grade, offset = 0) => get("/tafarrud", { grade, offset, limit: 40 }),
  quiz: () => get("/quiz"),
  topics: (parent) => get("/topics", parent ? { parent } : {}),
  topic: (id) => get(`/topic/${id}`),
};

/** POST /api/chat with SSE streaming. Calls handlers as events arrive. */
export async function chatStream({ question, history }, { onSources, onDelta, onDone, onError }, signal) {
  let ended = false;
  const finish = (fn, ...a) => { if (!ended) { ended = true; fn?.(...a); } };
  let res;
  try {
    res = await fetch(BASE + "/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history, books: getScopeIds() ?? undefined }),
      signal,
    });
  } catch (e) {
    if (!signal?.aborted) finish(onError, String(e.message ?? e));
    return;
  }
  if (!res.ok || !res.body) {
    finish(onError, `HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  const handle = (line) => {
    if (!line.startsWith("data: ")) return;
    let ev;
    try { ev = JSON.parse(line.slice(6)); } catch { return; }
    if (ev.type === "sources") onSources?.(ev.sources);
    else if (ev.type === "delta") onDelta?.(ev.text);
    else if (ev.type === "error") finish(onError, ev.error);
    else if (ev.type === "done") finish(onDone);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop();
      for (const line of lines) handle(line);
    }
    carry += dec.decode();
    if (carry) handle(carry);
  } catch (e) {
    if (!signal?.aborted) finish(onError, String(e.message ?? e));
    return;
  }
  finish(onDone);   // safety net for streams that die without a terminal event
}
