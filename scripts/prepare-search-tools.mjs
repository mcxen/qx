import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { request } from "node:https";

const ES_URL = "https://www.voidtools.com/ES-1.1.0.30.x64.zip";
const resourceDir = resolve("src-tauri/resources/search");
const target = resolve(resourceDir, "es.exe");

if (existsSync(target)) {
  process.exit(0);
}

mkdirSync(resourceDir, { recursive: true });

const tmpZip = resolve(resourceDir, "es.zip");

function download(url, dest) {
  return new Promise((resolveDownload, reject) => {
    const req = request(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolveDownload(download(res.headers.location, dest));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      pipeline(res, createWriteStream(dest)).then(resolveDownload, reject);
    });
    req.on("error", reject);
    req.end();
  });
}

try {
  await download(ES_URL, tmpZip);
  const { execa } = await import("execa").catch(() => ({ execa: null }));
  if (execa) {
    await execa("unzip", ["-o", tmpZip, "-d", dirname(target)]);
  } else {
    const { execFileSync } = await import("node:child_process");
    execFileSync("unzip", ["-o", tmpZip, "-d", dirname(target)], { stdio: "inherit" });
  }
} catch (error) {
  console.warn(`[search-tools] unable to prepare Everything CLI: ${error.message}`);
}
