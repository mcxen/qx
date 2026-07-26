import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "src-tauri/resources/generated/screencap-shutter.wav");

const targetTriples = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};
const triple = targetTriples[`${process.platform}-${process.arch}`];
if (!triple || !ffmpegPath) {
  throw new Error(`ffmpeg-static does not provide a supported Qx binary for ${process.platform}-${process.arch}`);
}
const ffmpeg = await readFile(ffmpegPath);
if (ffmpeg.length < 1_000_000) {
  throw new Error("Downloaded FFmpeg binary is incomplete");
}

const screenshotSound = await readFile(output);
if (screenshotSound.length < 1_000) {
  throw new Error(`Bundled screenshot sound is missing or incomplete: ${output}`);
}

if (process.platform === "darwin") {
  const signature = spawnSync("codesign", ["--verify", "--strict", ffmpegPath], {
    stdio: "ignore",
  });
  if (signature.status !== 0) {
    throw new Error("Downloaded FFmpeg binary failed its macOS code-signature check");
  }
}
const extension = process.platform === "win32" ? ".exe" : "";
const sidecar = resolve(root, `src-tauri/binaries/qx-ffmpeg-${triple}${extension}`);
await mkdir(dirname(sidecar), { recursive: true });
await copyFile(ffmpegPath, sidecar);
await chmod(sidecar, 0o755);

const metadataDir = resolve(root, "src-tauri/resources/generated/ffmpeg");
await mkdir(metadataDir, { recursive: true });
const binaryLicense = `${ffmpegPath}.LICENSE`;
let licensePath = resolve(root, "node_modules/ffmpeg-static/LICENSE");
try {
  await readFile(binaryLicense);
  licensePath = binaryLicense;
} catch {
  // The package-level GPL notice remains the authoritative fallback when the
  // release server omits its architecture-specific license companion.
}
const license = await readFile(licensePath);
if (license.length < 128) {
  throw new Error("FFmpeg license companion is missing or incomplete");
}
await writeFile(resolve(metadataDir, "LICENSE.txt"), license);
await writeFile(
  resolve(metadataDir, "SHA256.txt"),
  `${createHash("sha256").update(ffmpeg).digest("hex")}  qx-ffmpeg-${triple}${extension}\n`,
);
