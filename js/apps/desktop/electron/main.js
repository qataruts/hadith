/**
 * الجامع — desktop shell (Electron).
 *
 * Runs the existing API server (js/server/server.mjs) as a child process and
 * loads its dashboard in the window. The two databases (~4.5 GB) are NOT
 * bundled — they are downloaded once from the public Hugging Face dataset to
 * the user's app-data folder, with a resumable progress screen. A settings
 * screen stores the user's own Gemini API key (used only for semantic search
 * and chat; the rest of the app works without it).
 */
import { app, BrowserWindow, ipcMain, Menu, shell, utilityProcess } from "electron";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = app.getPath("userData");
const SETTINGS = path.join(DATA_DIR, "settings.json");

// Resource paths differ between `electron .` (dev) and a packaged build.
const res = app.isPackaged
  ? {
      server: path.join(process.resourcesPath, "server", "server.mjs"),
      static: path.join(process.resourcesPath, "dashboard"),
    }
  : {
      server: path.resolve(HERE, "../../../server/server.mjs"),
      static: path.resolve(HERE, "../../../apps/dashboard/dist"),
    };

const DATASET = "https://huggingface.co/datasets/emadjumaah/hadith-kg/resolve/main";
const DB_FILES = [
  { name: "hadith-kg.db", url: `${DATASET}/hadith-kg.db`, size: 1_634_877_440 },
  { name: "hadith-app.db", url: `${DATASET}/hadith-app.db`, size: 2_900_860_928 },
];

let win, serverProc, serverPort;

// ── settings ────────────────────────────────────────────────────────────────
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2));
  return next;
}

// ── database provisioning ─────────────────────────────────────────────────────
const dbPath = (name) => path.join(DATA_DIR, name);
const dbReady = (f) => {
  try { return fs.statSync(dbPath(f.name)).size === f.size; } catch { return false; }
};
const allDbsReady = () => DB_FILES.every(dbReady);

/** Stream a file from HF with resume (Range + If-Range/ETag) + progress. */
async function downloadFile(file, onProgress) {
  const dest = dbPath(file.name);
  const part = dest + ".part";
  const etagFile = part + ".etag";
  let start = 0;
  try { start = fs.statSync(part).size; } catch { /* fresh */ }
  if (start > file.size) { await fsp.rm(part, { force: true }); start = 0; }
  let etag = null;
  try { etag = fs.readFileSync(etagFile, "utf8").trim() || null; } catch { /* none */ }
  if (start && !etag) start = 0;   // can't validate an old .part → restart

  const headers = start ? { Range: `bytes=${start}-`, "If-Range": etag } : {};
  const res = await fetch(file.url, { headers });
  if (res.status === 416) {        // remote no longer honors our range → restart
    await fsp.rm(part, { force: true });
    await fsp.rm(etagFile, { force: true });
    return downloadFile(file, onProgress);
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${file.name}`);
  if (start && res.status === 200) start = 0;  // remote changed → full body, overwrite
  const newTag = res.headers.get("etag");
  if (newTag) await fsp.writeFile(etagFile, newTag);

  const out = fs.createWriteStream(part, { flags: start ? "a" : "w" });
  let received = start;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    await new Promise((ok, no) => out.write(value, (e) => (e ? no(e) : ok())));
    onProgress(received);
  }
  await new Promise((ok) => out.end(ok));
  if (fs.statSync(part).size !== file.size)
    throw new Error(`${file.name}: حجم غير مطابق بعد التنزيل`);
  await fsp.rename(part, dest);
  await fsp.rm(etagFile, { force: true });
}

async function provisionDbs(send) {
  const total = DB_FILES.reduce((s, f) => s + f.size, 0);
  // disk-space preflight: what's still missing + 1 GB working margin
  const missing = DB_FILES.filter((f) => !dbReady(f)).reduce((s, f) => s + f.size, 0);
  try {
    const st = await fsp.statfs(DATA_DIR);
    const free = st.bavail * st.bsize;
    if (free < missing + 1_000_000_000)
      throw new Error(
        `المساحة الحرة غير كافية: يلزم ${(missing / 1e9).toFixed(1)} غ.ب تقريباً والمتاح ${(free / 1e9).toFixed(1)} غ.ب`);
  } catch (e) {
    if (String(e.message).includes("المساحة")) throw e;
    /* statfs unsupported → skip preflight */
  }
  let base = 0;
  for (const file of DB_FILES) {
    if (dbReady(file)) { base += file.size; continue; }
    let lastEmit = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        await downloadFile(file, (received) => {
          const now = Date.now();
          if (now - lastEmit < 200) return;
          lastEmit = now;
          send("dl:progress", {
            file: file.name,
            done: base + received, total,
            pct: Math.min(100, ((base + received) / total) * 100),
          });
        });
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
        send("dl:retry", { file: file.name, attempt, error: String(e.message ?? e) });
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
    base += file.size;
  }
}

// ── server lifecycle ──────────────────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let serverCrashes = 0;
async function startServer() {
  serverPort = await freePort();
  const key = readSettings().geminiKey || "";
  const proc = utilityProcess.fork(
    res.server,
    ["--app", dbPath("hadith-app.db"), "--kg", dbPath("hadith-kg.db"),
     "--static", res.static, "--port", String(serverPort),
     "--host", "127.0.0.1"],
    { env: { ...process.env, GEMINI_API_KEY: key }, stdio: "pipe" },
  );
  serverProc = proc;
  proc.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  proc.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
  // crash monitor: unexpected exit → restart (twice), then error screen
  proc.on("exit", async (code) => {
    if (proc !== serverProc) return;      // deliberate stop/restart
    serverProc = null;
    if (serverCrashes++ < 2) {
      try {
        const base = await startServer();
        if (win && !win.isDestroyed()) win.loadURL(base);
        return;
      } catch { /* fall through to error screen */ }
    }
    if (win && !win.isDestroyed()) {
      await win.loadFile(path.join(HERE, "ui", "loading.html"));
      send("dl:error", { error: `توقف المحرك بشكل غير متوقع (رمز ${code}).` });
    }
  });

  const base = `http://127.0.0.1:${serverPort}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/stats`);
      if (r.ok) { serverCrashes = 0; return base; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("لم يصبح المحرك جاهزاً في الوقت المتوقع");
}

function stopServer() {
  const p = serverProc;
  serverProc = null;                      // marks the exit as deliberate
  try { p?.kill(); } catch { /* already gone */ }
}
let restartChain = Promise.resolve();
function restartServer() {
  restartChain = restartChain.then(async () => {
    stopServer();
    try {
      const base = await startServer();
      if (win && !win.isDestroyed()) win.loadURL(base);
    } catch (e) {
      if (win && !win.isDestroyed()) {
        await win.loadFile(path.join(HERE, "ui", "loading.html"));
        send("dl:error", { error: String(e.message ?? e) });
      }
    }
  });
  return restartChain;
}

// ── windows ────────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, backgroundColor: "#f9f9f7",
    title: "الجامع — الشبكة المعرفية للحديث الشريف",
    webPreferences: { preload: path.join(HERE, "preload.cjs") },
  });
  Menu.setApplicationMenu(buildMenu());
  return win;
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
    win.webContents.send(channel, payload);
};

let booting = false;
async function boot() {
  if (booting) return;                          // retry button / activate re-entry
  booting = true;
  try {
    if (!win || win.isDestroyed()) createWindow();
    win.focus();
    if (!allDbsReady()) {
      await win.loadFile(path.join(HERE, "ui", "loading.html"));
      send("dl:need", { files: DB_FILES });     // page is loaded — deliver directly
      try {
        await provisionDbs(send);
        send("dl:done", {});
      } catch (e) {
        send("dl:error", { error: String(e.message ?? e) });
        return;
      }
    }
    if (serverProc && serverPort) {           // server already running (mac re-activate)
      await win.loadURL(`http://127.0.0.1:${serverPort}`);
      return;
    }
    send("dl:starting", {});
    try {
      const base = await startServer();
      if (win && !win.isDestroyed()) await win.loadURL(base);
    } catch (e) {
      if (win && !win.isDestroyed()) {
        await win.loadFile(path.join(HERE, "ui", "loading.html"));
        send("dl:error", { error: String(e.message ?? e) });
      }
    }
  } finally {
    booting = false;
  }
}

function openSettings() {
  const s = new BrowserWindow({
    width: 520, height: 400, parent: win, modal: true, resizable: false,
    title: "الإعدادات", backgroundColor: "#f9f9f7",
    webPreferences: { preload: path.join(HERE, "preload.cjs") },
  });
  s.setMenuBarVisibility(false);
  s.loadFile(path.join(HERE, "ui", "settings.html"));
  s.webContents.once("did-finish-load", () =>
    s.webContents.send("settings:load", { geminiKey: readSettings().geminiKey || "" }));
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "ملف",
      submenu: [
        { label: "الإعدادات (مفتاح Gemini)", accelerator: "CmdOrCtrl+,", click: openSettings },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "عرض",
      submenu: [
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      label: "مساعدة",
      submenu: [
        { label: "المستودع على GitHub", click: () => shell.openExternal("https://github.com/qataruts/hadith") },
        { label: "قاعدة البيانات على Hugging Face", click: () => shell.openExternal("https://huggingface.co/datasets/emadjumaah/hadith-kg") },
      ],
    },
  ]);
}

// ── ipc ──────────────────────────────────────────────────────────────────────
ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:save", async (_e, patch) => {
  writeSettings(patch);
  await restartServer();       // pick up the new key
  return true;
});
ipcMain.handle("app:retry", () => boot());

// ── app ────────────────────────────────────────────────────────────────────────
app.whenReady().then(boot);
app.on("window-all-closed", () => { if (process.platform !== "darwin") { stopServer(); app.quit(); } });
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length) return;
  if (booting) {
    // download still running headless (mac: window closed) → re-show progress
    createWindow();
    await win.loadFile(path.join(HERE, "ui", "loading.html"));
    send("dl:need", { files: DB_FILES });
  } else {
    boot();
  }
});
app.on("before-quit", stopServer);
