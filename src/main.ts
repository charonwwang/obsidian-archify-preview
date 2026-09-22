import { MarkdownPostProcessorContext, MarkdownView, Plugin, TAbstractFile, TFile, normalizePath } from "obsidian";
import { t } from "./i18n";
import { HTML_LINK_RE, parseArchifyMeta, resolveVaultFile } from "./resolve";
import { ArchifyHtmlPreviewSettings, ArchifySettingTab, DEFAULT_SETTINGS } from "./settings";
import {
	ArchifyHtmlModal,
	ArchifyHtmlView,
	InlineFrameChild,
	VIEW_TYPE_ARCHIFY_HTML,
	installClipboardBridge,
} from "./view";

/** Per-anchor context captured during markdown enhancement. */
interface AnchorInfo {
	sourcePath: string;
	ctx: MarkdownPostProcessorContext;
}

/** Naming pattern of Archify browser-evidence sidecar thumbnails. */
const SIDECAR_RE = /\.visual-check\.\d+x\d+\.(light|dark)\.png$/i;

export default class ArchifyHtmlPreviewPlugin extends Plugin {
	settings: ArchifyHtmlPreviewSettings = DEFAULT_SETTINGS;

	/** Enhancement metadata attached to thumbnail anchors. */
	private anchors = new WeakMap<HTMLAnchorElement, AnchorInfo>();
	/** Inline frames currently attached to a thumbnail anchor. */
	private inlineChildren = new WeakMap<Element, InlineFrameChild>();

	async onload(): Promise<void> {
		await this.loadSettings();

		// Let sandboxed artifacts use the real clipboard (share / copy link).
		installClipboardBridge();

		this.registerView(VIEW_TYPE_ARCHIFY_HTML, (leaf) => new ArchifyHtmlView(leaf, this));

		if (this.settings.registerHtmlExtension) {
			this.registerExtensions(["html", "htm"], VIEW_TYPE_ARCHIFY_HTML);
		}

		this.registerMarkdownPostProcessor((el, ctx) => this.enhanceLinkedHtml(el, ctx));

		// Intercept clicks at the WINDOW capture phase — the very first point of
		// the event lifecycle. This beats Obsidian's built-in image zoom, link
		// navigation and editor (Live Preview) handlers regardless of where they
		// are registered, so the open-mode setting is always respected.
		this.registerDomEvent(window, "click", (evt) => this.handleGlobalClick(evt), true);

		this.addCommand({
			id: "open-active-html-in-archify-preview",
			name: t("cmd.openActive"),
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || !HTML_LINK_RE.test(f.path)) return false;
				if (!checking) void this.openInPreview(f);
				return true;
			},
		});

		this.addSettingTab(new ArchifySettingTab(this.app, this));
	}

	onunload(): void {
		// Views, listeners and post-processors are released automatically;
		// frame Blob URLs are released by their owners (view / modal / child).
	}

	// ------------------------------------------------------------------
	// Markdown enhancement
	// ------------------------------------------------------------------

	/**
	 * Detect `[![thumbnail](x.png)](x.html)` cards produced by Archify and
	 * mark them up: badge, fixed thumbnail, anchor metadata. Click routing
	 * itself happens in {@link handleGlobalClick}.
	 */
	private enhanceLinkedHtml(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		for (const anchor of Array.from(el.querySelectorAll("a"))) {
			const img = anchor.querySelector("img");
			const href = anchor.getAttribute("href");
			if (!img || !href || !HTML_LINK_RE.test(href) || anchor.dataset.archifyEnhanced) continue;

			const target = resolveVaultFile(this.app, href, ctx.sourcePath);
			if (!target) continue;

			const imgSrc = img.getAttribute("src") ?? "";
			// Fix broken thumbnails: re-resolve "relative to the note" the same way.
			const imgFile = resolveVaultFile(this.app, imgSrc, ctx.sourcePath);
			if (imgFile) img.setAttribute("src", this.app.vault.getResourcePath(imgFile));

			const meta = parseArchifyMeta(this.app, imgSrc, target);
			anchor.dataset.archifyEnhanced = "1";
			anchor.addClass("archify-linked-html");
			this.anchors.set(anchor, { sourcePath: ctx.sourcePath, ctx });

			const badge = anchor.createDiv({ cls: "archify-badge" });
			const label = [t("badge.interactive")];
			if (meta.visualCheck) label.push(`${meta.visualCheck.size} ${meta.visualCheck.theme}`);
			badge.setText(label.join(" · "));
			if (meta.sourceJsonPath) badge.setAttr("title", t("badge.sourceDef", meta.sourceJsonPath));
		}
	}

	// ------------------------------------------------------------------
	// Click routing
	// ------------------------------------------------------------------

	/**
	 * Window-capture click interceptor for Archify cards and thumbnails.
	 *
	 * Two matching strategies, in order:
	 *   1. An anchor whose href points at an (X)HTML file (the standard card).
	 *   2. An Archify `*.visual-check.<W>x<H>.<theme>.png` thumbnail even when
	 *      the anchor DOM is missing or hijacked (Live Preview widgets) — the
	 *      sibling `<name>.html` is derived from the sidecar naming convention.
	 */
	private handleGlobalClick(evt: MouseEvent): void {
		const el = evt.target;
		if (!(el instanceof Element)) return;

		let target: TFile | null = null;
		let anchor: HTMLAnchorElement | null = null;
		let info: AnchorInfo | undefined;

		const maybeAnchor = el.closest("a");
		if (maybeAnchor instanceof HTMLAnchorElement) {
			anchor = maybeAnchor;
			const href = anchor.getAttribute("href") ?? anchor.getAttribute("data-href") ?? "";
			if (HTML_LINK_RE.test(href)) {
				info = this.anchors.get(anchor);
				const sourcePath =
					info?.sourcePath ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? "";
				target = resolveVaultFile(this.app, href, sourcePath);
			}
		}
		if (!target) {
			const img = el.closest("img");
			if (img instanceof HTMLImageElement) target = this.targetFromSidecar(img);
		}
		if (!target) return; // not an Archify card — keep default behaviour

		// Never fight the user: skip text selection and modifier clicks.
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed && sel.toString().trim()) return;
		const forceTab = evt.ctrlKey || evt.metaKey;

		evt.preventDefault();
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		if (this.settings.openMode === "inline" && !forceTab) {
			this.toggleInline(anchor ?? (el.closest("img") as Element | null) ?? el, target, info?.ctx);
		} else if (this.settings.openMode === "modal" && !forceTab) {
			new ArchifyHtmlModal(this.app, this, target).open();
		} else {
			void this.openInPreview(target);
		}
	}

	/**
	 * Derive the interactive HTML from an Archify sidecar thumbnail name:
	 * `<name>.visual-check.<W>x<H>.<theme>.png` → `<name>.html` (same folder).
	 */
	private targetFromSidecar(img: HTMLImageElement): TFile | null {
		const src = img.getAttribute("src") ?? "";
		if (!src) return null;

		let f: TAbstractFile | null = null;
		try {
			// vault resource URLs embed the vault path: app://<id>/<path>?...
			const path = decodeURIComponent(new URL(src).pathname.replace(/^\//, ""));
			f = this.app.vault.getAbstractFileByPath(normalizePath(path));
		} catch {
			f = null;
		}
		if (!(f instanceof TFile)) {
			let name = src.split(/[\\/]/).pop() ?? "";
			try {
				name = decodeURIComponent(name);
			} catch {
				// keep raw
			}
			name = name.split("?")[0];
			f = this.app.vault.getFiles().find((x) => x.name === name) ?? null;
		}
		if (!(f instanceof TFile) || !SIDECAR_RE.test(f.name)) return null;

		const base = f.path.replace(SIDECAR_RE, "");
		const candidates = [`${base}.html`, `${base}.htm`, `${base}.xhtml`];
		for (const p of candidates) {
			const hit = this.app.vault.getAbstractFileByPath(normalizePath(p));
			if (hit instanceof TFile) return hit;
		}
		return null;
	}

	// ------------------------------------------------------------------
	// Actions
	// ------------------------------------------------------------------

	async openInPreview(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_ARCHIFY_HTML,
			state: { file: file.path },
			active: true,
		});
	}

	private toggleInline(key: Element, target: TFile, ctx?: MarkdownPostProcessorContext): void {
		const host = key.closest("p") ?? key;
		const existing = this.inlineChildren.get(key);
		if (existing) {
			existing.destroy();
			existing.containerEl.remove();
			this.inlineChildren.delete(key);
			return;
		}

		const wrap = createDiv({ cls: "archify-inline-wrap" });
		host.insertAdjacentElement("afterend", wrap);

		const child = new InlineFrameChild(wrap, this, target);
		this.inlineChildren.set(key, child);
		if (ctx) {
			ctx.addChild(child);
		} else {
			child.load(); // no render context (e.g. Live Preview) — manage manually
		}
	}

	// ------------------------------------------------------------------
	// Settings
	// ------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<ArchifyHtmlPreviewSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
		// The floating-window mode was removed; fall back to the modal.
		if ((this.settings.openMode as string) === "float") {
			this.settings.openMode = "modal";
			void this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
