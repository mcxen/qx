import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "src-tauri/resources/generated/screencap-shutter.wav");
const sampleRate = 44_100;
const duration = 0.18;
const sampleCount = Math.round(sampleRate * duration);
const pcm = Buffer.alloc(sampleCount * 2);
let seed = 0x51a7c0de;

for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate;
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  const noise = (seed / 0xffff_ffff) * 2 - 1;
  const first = Math.exp(-time * 52)
    * (0.68 * noise + 0.32 * Math.sin(time * 2 * Math.PI * 1_850));
  const secondTime = Math.max(0, time - 0.045);
  const second = time >= 0.045
    ? Math.exp(-secondTime * 72)
      * (0.48 * noise + 0.28 * Math.sin(secondTime * 2 * Math.PI * 1_260))
    : 0;
  const sample = Math.max(-1, Math.min(1, (first + second) * 0.72));
  pcm.writeInt16LE(Math.round(sample * 32_767), index * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([header, pcm]));

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
