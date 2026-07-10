/** API client — all data access goes through here. */
const BASE = "/api";

async function get(path, params) {
  const u = new URL(BASE + path, location.origin);
  for (const [k, v] of Object.entries(params ?? {}))
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
  group: (id, limit = 30, offset = 0) => get(`/group/${id}`, { limit, offset }),
  groupTree: (id, sahabi) => get(`/group/${id}/tree`, sahabi ? { sahabi } : {}),
  rawi: (id) => get(`/rawi/${id}`),
  rawiHadiths: (id, limit = 20, offset = 0) => get(`/rawi/${id}/hadiths`, { limit, offset }),
  alem: (id, limit = 50, offset = 0) => get(`/alem/${id}`, { limit, offset }),
  alems: () => get("/alems"),
  books: () => get("/books"),
  book: (id, limit = 30, offset = 0) => get(`/book/${id}`, { limit, offset }),
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
      body: JSON.stringify({ question, history }),
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
