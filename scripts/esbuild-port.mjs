/**
 * Cross-platform esbuild port for repository quality gates.
 *
 * Using the JavaScript API avoids spawning Unix binaries or Windows `.cmd`
 * shims, which have different process-launch semantics.
 */
import { buildSync } from "esbuild";

function formatBuildError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

export function bundleNodeModule({ root, entry, outfile }) {
  try {
    buildSync({
      absWorkingDir: root,
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: formatBuildError(error) };
  }
}
