// Stable download entry points; installers remain on the selected release host.
const sources = {
  cnb: "https://cnb.cool/v.ip/Qx/-/releases",
  github: "https://github.com/mcxen/qx/releases",
};

export async function onRequest({ request, params }) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  const platform = params.platform;
  if (!["macos", "windows", "manifest"].includes(platform)) return new Response(null, { status: 404 });
  const source = new URL(request.url).searchParams.get("source") === "github" ? "github" : "cnb";
  const base = sources[source];
  try {
    const response = await fetch(`${base}/latest/download/latest.json`, {
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!response.ok) throw new Error("Manifest unavailable");
    const manifest = await response.json();
    const version = String(manifest.version || "");
    if (!/^\d+\.\d+\.\d+$/.test(version) || manifest.tag !== `v${version}`) throw new Error("Invalid version");
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    if (!artifacts.some((a) => a.target === "aarch64-apple-darwin") ||
        !artifacts.some((a) => a.target === "x86_64-pc-windows-msvc")) throw new Error("Incomplete release");
    const asset = (name) => `${base}/download/v${version}/${name}`;
    const result = {
      version,
      macUrl: asset(`qx_v${version}_aarch64-apple-darwin.dmg`),
      winUrl: asset(`Qx_${version}_x64-setup.exe`),
    };
    const headers = { "Cache-Control": "public, max-age=60" };
    if (platform === "manifest") return Response.json(result, { headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: platform === "macos" ? result.macUrl : result.winUrl } });
  } catch {
    // Never combine a GitHub version with an unverified CNB mirror asset.
    if (platform === "manifest") return Response.json({ error: "Release unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return new Response(null, { status: 302, headers: { Location: source === "cnb" ? base : `${base}/latest`, "Cache-Control": "no-store" } });
  }
}
