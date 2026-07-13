import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { request } from "node:https";
import { execFileSync } from "node:child_process";

const ES_URL = "https://www.voidtools.com/ES-1.1.0.30.x64.zip";
const EVERYTHING_URL = "https://www.voidtools.com/Everything-1.4.1.1032.x64.zip";
const EVERYTHING_VERSION = "1.4.1.1032";
const LICENSE_URL = "https://www.voidtools.com/License.txt";
const resourceDir = resolve("src-tauri/resources/search");
mkdirSync(resourceDir, { recursive: true });

const versionMarker = resolve(resourceDir, ".everything-version");
const preparedVersion = existsSync(versionMarker) ? readFileSync(versionMarker, "utf8").trim() : "";
if (preparedVersion !== EVERYTHING_VERSION) {
  rmSync(resolve(resourceDir, "everything.exe"), { force: true });
  rmSync(resolve(resourceDir, "Everything.lng"), { force: true });
}

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

function extract(zip, destination) {
  if (process.platform === "win32") {
    execFileSync("tar.exe", ["-xf", zip, "-C", destination], { stdio: "inherit" });
    return;
  }
  execFileSync("unzip", ["-o", zip, "-d", destination], { stdio: "inherit" });
}

async function prepareArchive(url, executable) {
  const target = resolve(resourceDir, executable);
  if (existsSync(target)) return;
  const tmpZip = resolve(resourceDir, `${executable}.zip`);
  try {
    await download(url, tmpZip);
    extract(tmpZip, dirname(target));
  } finally {
    rmSync(tmpZip, { force: true });
  }
  if (!existsSync(target)) throw new Error(`${executable} missing after extraction`);
}

try {
  await prepareArchive(ES_URL, "es.exe");
  await prepareArchive(EVERYTHING_URL, "everything.exe");
  if (!existsSync(resolve(resourceDir, "Everything-LICENSE.txt"))) {
    await download(LICENSE_URL, resolve(resourceDir, "Everything-LICENSE.txt"));
  }
  writeFileSync(versionMarker, `${EVERYTHING_VERSION}\n`);
} catch (error) {
  console.error(`[search-tools] unable to prepare Everything: ${error.message}`);
  process.exitCode = 1;
}
