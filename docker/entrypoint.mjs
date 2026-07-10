#!/usr/bin/env node
/**
 * Container entrypoint for the الجامع server image.
 *
 * 1. Ensures both databases exist on the data volume, downloading any missing
 *    one from the public Hugging Face dataset with resume (Range + If-Range/
 *    ETag, 416 recovery) and a free-disk preflight.
 * 2. While downloading (first boot only), serves a friendly "preparing" page on
 *    $PORT so load balancers / CapRover health checks get a 200 and users see
 *    progress instead of a connection error.
 * 3. Hands the port to the real API server and forwards signals for clean stop.
 *
 * Env: DATA_DIR (/data), PORT (80), GEMINI_API_KEY (optional),
 *      DATASET_URL (override the HF base URL).
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DATA_DIR = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 80);
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const DATASET = process.env.DATASET_URL
  || "https://huggingface.co/datasets/emadjumaah/hadith-kg/resolve/main";
const DB_FILES = [
  { name: "hadith-kg.db", size: 1_634_877_440 },
  { name: "hadith-app.db", size: 2_900_860_928 },
];

const log = (m) => console.log(`[jami] ${m}`);
const dbPath = (n) => path.join(DATA_DIR, n);
const ready = (f) => { try { return fs.statSync(dbPath(f.name)).size === f.size; } catch { return false; } };

const progress = { active: false, pct: 0, file: "", done: 0, total: 0 };

async function download(file, onProgress) {
  const dest = dbPath(file.name), part = dest + ".part", etagFile = part + ".etag";
  let start = 0;
  try { start = fs.statSync(part).size; } catch { /* fresh */ }
  if (start > file.size) { await fsp.rm(part, { force: true }); start = 0; }
  let etag = null;
  try { etag = fs.readFileSync(etagFile, "utf8").trim() || null; } catch { /* none */ }
  if (start && !etag) start = 0;

  const headers = start ? { Range: `bytes=${start}-`, "If-Range": etag } : {};
  const res = await fetch(`${DATASET}/${file.name}`, { headers });
  if (res.status === 416) {
    await fsp.rm(part, { force: true }); await fsp.rm(etagFile, { force: true });
    return download(file, onProgress);
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${file.name}`);
  if (start && res.status === 200) start = 0;
  const tag = res.headers.get("etag");
  if (tag) await fsp.writeFile(etagFile, tag);

  const out = fs.createWriteStream(part, { flags: start ? "a" : "w" });
  let got = start;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise((r) => out.once("drain", r));
    onProgress(got);
  }
  await new Promise((ok) => out.end(ok));
  if (fs.statSync(part).size !== file.size) throw new Error(`${file.name}: size mismatch after download`);
  await fsp.rename(part, dest);
  await fsp.rm(etagFile, { force: true });
}

async function ensureDbs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const missing = DB_FILES.filter((f) => !ready(f));
  if (!missing.length) { log("databases present on volume"); return; }

  const need = missing.reduce((s, f) => s + f.size, 0);
  try {
    const st = await fsp.statfs(DATA_DIR);
    const free = st.bavail * st.bsize;
    if (free < need + 1_000_000_000)
      throw new Error(`insufficient disk on ${DATA_DIR}: need ~${(need / 1e9).toFixed(1)} GB, free ${(free / 1e9).toFixed(1)} GB`);
  } catch (e) { if (String(e.message).includes("insufficient")) throw e; }

  log(`downloading ${missing.length} database(s) from Hugging Face (~${(need / 1e9).toFixed(1)} GB, one time)…`);
  progress.active = true;
  progress.total = DB_FILES.reduce((s, f) => s + f.size, 0);
  let base = DB_FILES.filter((f) => ready(f)).reduce((s, f) => s + f.size, 0);
  for (const file of missing) {
    progress.file = file.name;
    let lastLog = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        await download(file, (got) => {
          progress.done = base + got;
          progress.pct = Math.min(100, progress.done / progress.total * 100);
          const now = Date.now();
          if (now - lastLog > 5000) {
            lastLog = now;
            log(`${file.name}: ${progress.pct.toFixed(1)}% (${(progress.done / 1e9).toFixed(2)}/${(progress.total / 1e9).toFixed(2)} GB)`);
          }
        });
        break;
      } catch (e) {
        if (attempt >= 6) throw e;
        log(`retry ${attempt} for ${file.name}: ${e.message}`);
        await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
    base += file.size;
  }
  progress.active = false;
  log("all databases ready");
}

/** Minimal page served on $PORT during first-boot download. */
function bootstrapServer() {
  const srv = http.createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200).end("ok"); return; }
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(progress));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "retry-after": "10" });
    res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10"><title>الجامع — التحضير</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b}
.c{text-align:center;width:min(520px,86vw)}.l{font-size:34px;font-weight:700}.l span{color:#0d5c50}
.bar{height:12px;border-radius:99px;background:#e1e0d9;overflow:hidden;margin:22px 0 10px}
.f{height:100%;background:#0d5c50;border-radius:99px;transition:width .4s;width:${progress.pct.toFixed(1)}%}
.m{color:#52514e;font-size:14px}</style></head><body><div class="c">
<div class="l">الجامِع<span>.</span></div>
<div class="bar"><div class="f"></div></div>
<div class="m">جارٍ تنزيل قاعدة المعرفة لأول مرة (${(progress.total / 1e9 || 4.5).toFixed(1)} غ.ب تقريباً)… ${progress.pct.toFixed(0)}٪<br>تُحدَّث هذه الصفحة تلقائياً.</div>
</div></body></html>`);
  });
  return new Promise((resolve) => srv.listen(PORT, "0.0.0.0", () => resolve(srv)));
}

function startServer() {
  const args = [
    path.join(APP_ROOT, "js/server/server.mjs"),
    "--app", dbPath("hadith-app.db"),
    "--kg", dbPath("hadith-kg.db"),
    "--static", path.join(APP_ROOT, "js/apps/dashboard/dist"),
    "--port", String(PORT), "--host", "0.0.0.0",
  ];
  log(`starting API server on 0.0.0.0:${PORT}`);
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  const stop = (sig) => { try { child.kill(sig); } catch { /* gone */ } };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  const needDownload = DB_FILES.some((f) => !ready(f));
  let boot = null;
  if (needDownload) boot = await bootstrapServer();
  await ensureDbs();
  if (boot) await new Promise((r) => boot.close(r));   // release the port
  startServer();
}

main().catch((e) => { console.error(`[jami] fatal: ${e.message}`); process.exit(1); });
