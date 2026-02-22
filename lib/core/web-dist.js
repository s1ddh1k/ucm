const fs = require("fs");
const path = require("path");

const SCRIPT_SRC_RE = /<script[^>]+src="([^"]+)"/gi;
const LINK_HREF_RE = /<link[^>]+href="([^"]+)"/gi;

function normalizeAssetRef(ref) {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("data:")) {
    return null;
  }

  const withoutHash = trimmed.split("#")[0];
  const withoutQuery = withoutHash.split("?")[0];
  return withoutQuery.replace(/^\/+/, "").replace(/^\.\//, "");
}

function collectAssetRefs(indexHtml) {
  const refs = new Set();
  let match = null;
  SCRIPT_SRC_RE.lastIndex = 0;
  while ((match = SCRIPT_SRC_RE.exec(indexHtml)) !== null) {
    const normalized = normalizeAssetRef(match[1]);
    if (normalized && normalized !== "index.html") refs.add(normalized);
  }
  LINK_HREF_RE.lastIndex = 0;
  while ((match = LINK_HREF_RE.exec(indexHtml)) !== null) {
    const normalized = normalizeAssetRef(match[1]);
    if (normalized && normalized !== "index.html") refs.add(normalized);
  }
  return [...refs];
}

function validateWebDist(distDir, opts = {}) {
  const requireScript = opts.requireScript !== false;
  const indexPath = path.join(distDir, "index.html");

  let html = "";
  try {
    const indexStat = fs.statSync(indexPath);
    if (!indexStat.isFile()) {
      return { ok: false, reason: "index.html is not a file", missingAssets: [] };
    }
    html = fs.readFileSync(indexPath, "utf-8");
  } catch (e) {
    return { ok: false, reason: `index.html missing (${e.message})`, missingAssets: [] };
  }

  if (!html.includes('id="root"')) {
    return { ok: false, reason: "index.html missing root mount node", missingAssets: [] };
  }

  const refs = collectAssetRefs(html);
  const scripts = refs.filter((ref) => ref.endsWith(".js") || ref.endsWith(".mjs"));
  if (requireScript && scripts.length === 0) {
    return { ok: false, reason: "no bundled script reference in index.html", missingAssets: [] };
  }

  const distPrefix = distDir + path.sep;
  const missingAssets = [];
  for (const ref of refs) {
    const assetPath = path.resolve(distDir, ref);
    if (assetPath !== distDir && !assetPath.startsWith(distPrefix)) {
      missingAssets.push(ref);
      continue;
    }
    if (!fs.existsSync(assetPath)) {
      missingAssets.push(ref);
    }
  }

  if (missingAssets.length > 0) {
    return {
      ok: false,
      reason: "missing referenced assets",
      missingAssets,
    };
  }

  return {
    ok: true,
    reason: null,
    missingAssets: [],
    assetRefs: refs,
    indexPath,
  };
}

module.exports = {
  collectAssetRefs,
  normalizeAssetRef,
  validateWebDist,
};
