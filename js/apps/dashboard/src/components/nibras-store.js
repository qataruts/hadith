/** نبراس multi-chat store — vanilla pub/sub over localStorage (ported from the
 * Quran «نِبراس» chat.ts). Per-device, no accounts; newest 40 chats kept.
 * A chat's "material" (the hadith it has gathered) is re-derived each turn as the
 * deduped union of everything its messages retrieved — compose draws only on it. */
const KEY = "jami:nibras:chats";
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

let chats = load();
const subs = new Set();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function emit() {
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  if (chats.length > 40) chats = chats.slice(0, 40);
  try { localStorage.setItem(KEY, JSON.stringify(chats)); } catch { /* quota / private mode */ }
  subs.forEach((f) => f());
}

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function getChats() { return chats; }
export function getChat(id) { return chats.find((c) => c.id === id); }

export function createChat() {
  const id = rid();
  chats.unshift({ id, title: "محادثة جديدة", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  emit();
  return id;
}
export function deleteChat(id) { chats = chats.filter((c) => c.id !== id); emit(); }
export function renameChat(id, title) { const c = getChat(id); if (c) { c.title = title; emit(); } }

export function addMessage(chatId, msg) {
  const c = getChat(chatId);
  if (!c) return null;
  const id = rid();
  c.messages.push({ id, ...msg });
  c.updatedAt = Date.now();
  emit();
  return id;
}
export function patchMessage(chatId, msgId, patch) {
  const c = getChat(chatId);
  const m = c?.messages.find((x) => x.id === msgId);
  if (m) { Object.assign(m, patch); c.updatedAt = Date.now(); emit(); }
}

/** The accumulated material of a chat: the deduped union (by hadithId) of every
 * hadith any message in the thread retrieved. Compose draws ONLY from this. */
export function chatMaterial(chat) {
  const ahadith = new Map();
  for (const m of chat.messages)
    for (const h of m.ahadith ?? []) if (!ahadith.has(h.hadithId)) ahadith.set(h.hadithId, h);
  return { ahadith: [...ahadith.values()] };
}

/** The most recent generated draft in the chat (for «وسّع/نقّح» continuation). */
export function lastDraft(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--)
    if (chat.messages[i].draft) return chat.messages[i].draft;
  return "";
}
