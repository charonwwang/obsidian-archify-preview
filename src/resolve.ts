import { App, TFile, normalizePath } from "obsidian";

/** Matches links that point at an (X)HTML document. */
export const HTML_LINK_RE = /\.html?$/i;

/** Naming heuristics for [Archify](https://github.com/tt-a1i/archify) output bundles. */
export interface ArchifyMeta {
	/** Parsed from `*.visual-check.<width>x<height>.<theme>.png` sidecar names. */
	visualCheck: { size: string; theme: string } | null;
	/** Path of the sibling source definition, when present. */
	sourceJsonPath: string | null;
}

/**
 * Resolve a link target to a vault file.
 *
 * Resolution order deliberately mirrors the semantics of the tools that
 * produce Archify bundles (paths relative to the containing note) before
 * falling back to Obsidian's own resolution:
 *
 *   1. Relative to the containing note — both `./x.html` and bare `x.html`
 *      (GitHub / WorkBuddy semantics; essential because `.html` files are
 *      usually NOT in Obsidian's link index and cannot be found any other way).
 *   2. Vault-absolute paths (`/dir/x.html`).
 *   3. `metadataCache.getFirstLinkpathDest()` (Obsidian shortest-path semantics).
 */
export function resolveVaultFile(app: App, link: string, sourcePath: string): TFile | null {
	let p = link.split("#")[0].split("?")[0];
	try {
		p = decodeURIComponent(p);
	} catch {
		// keep the raw value when it is not URL-encoded
	}
	if (!p) return null;
	// External / resource URLs (app:, http:, https:, data:, ...) are not vault files.
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null;
	p = p.replace(/\\/g, "/");

	const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";

	// 1) relative to the containing note
	if (!p.startsWith("/")) {
		const rel = joinRelative(dir, p);
		const f = app.vault.getAbstractFileByPath(rel);
		if (f instanceof TFile) return f;
	}

	// 2) vault-absolute path
	const direct = app.vault.getAbstractFileByPath(normalizePath(p.replace(/^\/+/, "")));
	if (direct instanceof TFile) return direct;

	// 3) Obsidian's own link resolution as a last resort
	return app.metadataCache.getFirstLinkpathDest(p, sourcePath);
}

/** Join `rel` onto vault folder `dir`, collapsing `.` and `..` segments. */
function joinRelative(dir: string, rel: string): string {
	const segs = (dir ? dir.split("/") : []).concat(rel.split("/"));
	const out: string[] = [];
	for (const seg of segs) {
		if (!seg || seg === ".") continue;
		if (seg === "..") out.pop();
		else out.push(seg);
	}
	return normalizePath(out.join("/"));
}

/** Detect Archify bundle conventions around a linked HTML artifact. */
export function parseArchifyMeta(app: App, imgSrc: string, target: TFile): ArchifyMeta {
	let visualCheck: ArchifyMeta["visualCheck"] = null;
	let clean = imgSrc;
	try {
		clean = decodeURIComponent(imgSrc);
	} catch {
		// keep raw
	}
	const m = clean.match(/\.visual-check\.(\d+x\d+)\.(light|dark)\.png$/i);
	if (m) visualCheck = { size: m[1], theme: m[2].toLowerCase() };

	// Source definition lookup. Archify keeps the typed source beside the
	// artifact; names evolved across versions:
	//   1. `<name>.json` — the typed source beside `<name>.html`, including the
	//      current `<name>.<type>.json` convention (`x.workflow.html` →
	//      `x.workflow.json`).
	//   2. `<name>.archify.json` — the legacy sidecar name used by older
	//      bundles (and the plugin's own demo).
	//   3. `candidate.json` — the Archify skill's default source filename in
	//      its per-diagram work folder (`<slug>.html` + `candidate.json`).
	const base = target.path.replace(/\.html?$/i, "");
	const dir = target.path.includes("/") ? target.path.slice(0, target.path.lastIndexOf("/")) : "";
	const candidates = [`${base}.json`, `${base}.archify.json`, `${dir ? dir + "/" : ""}candidate.json`];
	let sourceJsonPath: string | null = null;
	for (const p of candidates) {
		const json = app.vault.getAbstractFileByPath(normalizePath(p));
		if (json instanceof TFile) {
			sourceJsonPath = json.path;
			break;
		}
	}

	return {
		visualCheck,
		sourceJsonPath,
	};
}
