import { App, ItemView, MarkdownRenderChild, Modal, Notice, Platform, TFile, ViewStateResult, WorkspaceLeaf, normalizePath } from "obsidian";
import { t } from "./i18n";
import type ArchifyHtmlPreviewPlugin from "./main";

export const VIEW_TYPE_ARCHIFY_HTML = "archify-html-preview-view";

export interface FrameHandle {
	frame: HTMLIFrameElement;
	dispose: () => void;
}

// ----------------------------------------------------------------------
// Sandboxed frame + runtime shims
// ----------------------------------------------------------------------

/**
 * Runtime shim injected into every artifact.
 *
 * Self-contained Archify artifacts are rendered in an opaque-origin sandbox,
 * where two things break: `localStorage` throws (an unguarded access can kill
 * the whole script) and `navigator.clipboard` does not exist at all. This shim
 * restores both: storage is backed by memory, and clipboard writes are
 * forwarded to the plugin frame via `postMessage`, where they really work.
 */
function injectRuntimeShim(html: string): string {
	const shim =
		"<script>" +
		"(function(){" +
		"try{window.localStorage.getItem('__archify__');}catch(e){" +
		"var m={};function S(){}" +
		"S.prototype.getItem=function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;};" +
		"S.prototype.setItem=function(k,v){m[k]=String(v);};" +
		"S.prototype.removeItem=function(k){delete m[k];};" +
		"S.prototype.clear=function(){m={};};" +
		"S.prototype.key=function(i){var a=Object.keys(m);return i<a.length?a[i]:null;};" +
		"Object.defineProperty(S.prototype,'length',{get:function(){return Object.keys(m).length;}});" +
		"try{Object.defineProperty(window,'localStorage',{value:new S(),configurable:true});}catch(_){}" +
		"try{Object.defineProperty(window,'sessionStorage',{value:new S(),configurable:true});}catch(_){}}" +
		"}" +
		"try{if(!navigator.clipboard||typeof navigator.clipboard.writeText!=='function'){" +
		"var n=0;var b={writeText:function(t){return new Promise(function(res,rej){" +
		"var id='archify-clip-'+(++n)+'-'+Date.now();" +
		"function onM(ev){var d=ev.data;if(!d||d.archifyClipboard!==id)return;window.removeEventListener('message',onM);d.ok?res():rej(new Error(d.error||'copy failed'));}" +
		"window.addEventListener('message',onM);" +
		"try{window.parent.postMessage({archifyClipboardWrite:id,text:t},'*');}catch(_){rej(new Error('bridge failed'));}" +
		"setTimeout(function(){window.removeEventListener('message',onM);rej(new Error('copy timeout'));},3000);" +
		"});},readText:function(){return Promise.reject(new Error('unsupported'));}};" +
		"Object.defineProperty(navigator,'clipboard',{value:b,configurable:true});}}catch(_){}" +
		"})();" +
		"</script>";

	if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + shim);
	if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + shim + "</head>");
	return shim + html;
}

/** Shape of the `postMessage` requests sent by the sandboxed shim. */
interface ClipboardRequest {
	archifyClipboardWrite?: unknown;
	text?: unknown;
}

/**
 * Best-effort clipboard write. `navigator.clipboard` first. Sandboxed-frame
 * copy requests arrive via `postMessage`, so they carry no user gesture into
 * this frame and the Clipboard API may reject; on the desktop runtime we then
 * fall back to Electron's clipboard, which needs no gesture. Returns false
 * only when neither path is available.
 */
async function writeClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to the Electron clipboard fallback
	}
	try {
		const clip = getRendererClipboard();
		if (clip) {
			clip.writeText(text);
			return true;
		}
	} catch {
		// Electron bridge unavailable or threw — report failure below
	}
	return false;
}

/**
 * Answer clipboard requests coming from sandboxed preview frames. Runs in the
 * plugin frame, which has real clipboard access. Install once per plugin load.
 */
let clipboardBridgeInstalled = false;
export function installClipboardBridge(): void {
	if (clipboardBridgeInstalled) return;
	clipboardBridgeInstalled = true;
	window.addEventListener("message", (ev) => {
		const d = ev.data as ClipboardRequest | null;
		if (!d || typeof d.archifyClipboardWrite !== "string") return;
		// Only serve opaque-origin (sandboxed) senders.
		if (ev.origin !== "null") return;
		const id = d.archifyClipboardWrite;
		const text = typeof d.text === "string" ? d.text : "";
		const source = ev.source as Window | null;
		const reply = (ok: boolean, error?: string) => {
			source?.postMessage({ archifyClipboard: id, ok, error }, "*");
		};
		void writeClipboard(text).then((ok) => reply(ok, ok ? undefined : "copy failed"));
	});
}

/**
 * Render a self-contained HTML artifact inside a sandboxed iframe.
 *
 * The content is served from a Blob URL so the behaviour is identical on
 * desktop and mobile, and the frame runs in an opaque origin unless the user
 * opted into `allow-same-origin`.
 */
export async function createSandboxedFrame(plugin: ArchifyHtmlPreviewPlugin, file: TFile): Promise<FrameHandle> {
	const raw = await plugin.app.vault.read(file);
	const content = injectRuntimeShim(raw);
	const blob = new Blob([content], { type: "text/html" });
	const url = URL.createObjectURL(blob);

	const frame = createEl("iframe", { cls: "archify-html-frame" });
	// Sandbox tokens: keep the origin opaque (unless the user opts out) while
	// unblocking everything an interactive artifact legitimately needs —
	// exports (downloads), share links (popups / windows that escape the
	// sandbox), confirm dialogs, form inputs (copy-link fields) and printing.
	const tokens = [
		"allow-scripts",
		"allow-downloads",
		"allow-popups",
		"allow-popups-to-escape-sandbox",
		"allow-modals",
		"allow-forms",
		"allow-presentation",
	];
	if (plugin.settings.sandboxAllowSameOrigin) tokens.push("allow-same-origin");
	frame.setAttribute("sandbox", tokens.join(" "));
	// Feature delegation: clipboard (share / copy link), fullscreen, media.
	frame.setAttribute(
		"allow",
		"clipboard-read; clipboard-write; fullscreen; picture-in-picture; autoplay; encrypted-media"
	);
	frame.setAttribute("title", file.basename);
	frame.src = url;

	return { frame, dispose: () => URL.revokeObjectURL(url) };
}

// ----------------------------------------------------------------------
// Actions shared by every surface
// ----------------------------------------------------------------------

/**
 * Open a vault file in the user's browser.
 *
 * Strategy order is deliberate:
 *   1. Spawn a real browser executable — verifiable, it either throws or runs.
 *   2. Obsidian's `openWithDefaultApp`.
 *   3. Electron's shell, with every call raced against a timeout so a bridge
 *      that never settles cannot quietly swallow the whole action.
 *   4. The `app://` resource URL in the host window.
 * Success is silent; only a total failure is reported.
 */
export async function openInSystemBrowser(app: App, file: TFile): Promise<void> {
	const fsPath = getFsPath(app, file);
	let ok = false;

	try {
		if (Platform.isDesktopApp && fsPath) ok = openViaChildProcess(fsPath);

		if (!ok) {
			const openWith = (app as unknown as { openWithDefaultApp?: (p: string) => unknown }).openWithDefaultApp;
			if (typeof openWith === "function") {
				openWith.call(app, file.path);
				ok = true;
			}
		}

		if (!ok && Platform.isDesktopApp) ok = await tryElectronShell(fsPath);

		if (!ok) ok = !!window.open(app.vault.getResourcePath(file), "_blank");
	} catch {
		ok = false;
	}

	// Silent on success. On failure the path is copied so the user can still
	// paste it into a browser manually.
	if (!ok) {
		await writeClipboard(fsPath || file.path);
		new Notice(t("notice.openFailed", file.name));
	}
}

/**
 * Open `fsPath` by launching a known browser executable directly.
 *
 * The OS-association routes (openWithDefaultApp / shell.*) can all resolve
 * "successfully" while opening nothing, with no error to show. Spawning a
 * concrete process is verifiable: it either throws or it does not. Order:
 * Edge / Chrome / Firefox (well-known install locations), then the OS opener
 * (`explorer.exe` on Windows, `open` on macOS, `xdg-open` on Linux).
 */
function openViaChildProcess(fsPath: string): boolean {
	try {
		const req = getRendererRequire();
		if (!req) return false;
		const cp = req("child_process") as
			| { spawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => { unref?: () => void } }
			| undefined;
		const fsMod = req("fs") as { existsSync: (p: string) => boolean } | undefined;
		if (!cp || !fsMod) return false;
		const url = "file:///" + encodeURI(fsPath.replace(/\\/g, "/"));

		const spawnDetached = (exe: string, args: string[]): boolean => {
			try {
				const child = cp.spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
				child.unref?.();
				return true;
			} catch {
				return false;
			}
		};
		const firstExisting = (paths: string[]): string | null => {
			for (const p of paths) {
				try {
					if (p && fsMod.existsSync(p)) return p;
				} catch {
					// unreadable path — skip
				}
			}
			return null;
		};

		const proc = getRendererProcess();
		switch (proc?.platform) {
			case "win32": {
				const la = proc?.env?.LOCALAPPDATA ?? "";
				const exe =
					firstExisting([
						"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
						"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
						"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
						"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
						la ? la + "\\Google\\Chrome\\Application\\chrome.exe" : "",
						"C:\\Program Files\\Mozilla Firefox\\firefox.exe",
						"C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
					]) ?? "";
				if (exe) return spawnDetached(exe, [url]);
				// No known browser found — ask the OS shell to resolve the default.
				return spawnDetached("explorer.exe", [fsPath]);
			}
			case "darwin":
				return spawnDetached("open", [fsPath]);
			default:
				return spawnDetached("xdg-open", [fsPath]);
		}
	} catch {
		return false;
	}
}

/** Best-effort external open through Electron's shell, always bounded in time. */
async function tryElectronShell(fsPath: string): Promise<boolean> {
	const shell = getShell();
	if (!shell || !fsPath) return false;
	if (typeof shell.openPath === "function") {
		if (await raceTimeout(shell.openPath(fsPath))) return true;
	}
	if (typeof shell.openExternal === "function") {
		const url = "file:///" + encodeURI(fsPath.replace(/\\/g, "/"));
		if (await raceTimeout(shell.openExternal(url))) return true;
	}
	return false;
}

/**
 * Await `p` but give up after 1200 ms. Some Electron bridges expose a shell
 * object whose methods never settle; without this guard a single hung promise
 * silently swallowed the entire "open in browser" action.
 */
function raceTimeout(p: unknown): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (okFlag: boolean) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(okFlag);
		};
		const timer = window.setTimeout(() => finish(false), 1200);
		try {
			Promise.resolve(p).then((v) => finish(!(typeof v === "string" && v)), () => finish(false));
		} catch {
			finish(false);
		}
	});
}

/**
 * Open the artifact in a real OS window owned by the app (a popped-out leaf).
 *
 * This is the escape hatch that cannot silently fail: it never touches the OS
 * shell or a file association, so it works even when "open in browser" is
 * blocked by the sandbox / installer / default-app settings.
 */
export async function openInObsidianWindow(app: App, file: TFile): Promise<void> {
	try {
		const leaf = app.workspace.getLeaf("window");
		await leaf.setViewState({ type: VIEW_TYPE_ARCHIFY_HTML, state: { file: file.path }, active: true });
	} catch {
		// A detached window is not available in this build; nothing to report.
	}
}

interface ShellBridge {
	openExternal?: (u: string) => unknown;
	openPath?: (p: string) => unknown;
}

/** Minimal shape of the Electron `clipboard` module used as a gesture-less fallback. */
interface RendererClipboard {
	writeText: (text: string) => void;
}

/** Minimal shape of the renderer `process` object exposed by the desktop app. */
interface RendererProcess {
	platform?: string;
	env?: Record<string, string | undefined>;
}

/**
 * Typed accessor for the Node `require` exposed by the desktop runtime.
 * Resolved through `window` so the code type-checks without Node typings
 * and never produces `any`-typed calls.
 */
function getRendererRequire(): ((id: string) => unknown) | undefined {
	const g = window as unknown as { require?: (id: string) => unknown };
	return typeof g.require === "function" ? g.require : undefined;
}

function getRendererProcess(): RendererProcess | undefined {
	return (window as unknown as { process?: RendererProcess }).process;
}

function getShell(): ShellBridge | null {
	try {
		const req = getRendererRequire();
		if (!req) return null;
		const electron = req("electron") as { shell?: ShellBridge; clipboard?: RendererClipboard } | undefined;
		return electron?.shell ?? null;
	} catch {
		return null;
	}
}

/** Electron's clipboard module — a gesture-less clipboard fallback on desktop. */
function getRendererClipboard(): RendererClipboard | undefined {
	try {
		const req = getRendererRequire();
		if (!req) return undefined;
		const electron = req("electron") as { clipboard?: RendererClipboard } | undefined;
		return electron?.clipboard;
	} catch {
		return undefined;
	}
}

function getFsPath(app: App, file: TFile): string {
	try {
		const adapter = app.vault.adapter as { getFullPath?: (p: string) => string };
		return typeof adapter.getFullPath === "function" ? adapter.getFullPath(file.path) : "";
	} catch {
		return "";
	}
}

/** Open the sibling `<name>.archify.json` source definition, if present. */
export async function openSourceDefinition(app: App, file: TFile): Promise<void> {
	const base = file.path.replace(/\.html?$/i, "");
	const f = app.vault.getAbstractFileByPath(normalizePath(`${base}.archify.json`));
	if (f instanceof TFile) {
		await app.workspace.getLeaf("tab").openFile(f);
	} else {
		new Notice(t("notice.noSourceJson", `${base}.archify.json`));
	}
}

// ----------------------------------------------------------------------
// Drag / resize helpers
// ----------------------------------------------------------------------

/** Make `target` draggable by dragging `handle` (moves as a fixed overlay). */
export function makeDraggable(handle: HTMLElement, target: HTMLElement): void {
	handle.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 0) return;
		if ((evt.target as Element).closest?.("button")) return;
		evt.preventDefault();
		evt.stopPropagation();
		const rect = target.getBoundingClientRect();
		const ox = evt.clientX - rect.left;
		const oy = evt.clientY - rect.top;
		target.addClass("archify-drag-fixed");
		// Pin the measured size: leaving a flex-centred element without it makes
		// the element collapse to its content width once it becomes fixed.
		target.style.width = `${Math.round(rect.width)}px`;
		target.style.left = `${rect.left}px`;
		target.style.top = `${rect.top}px`;

		// Pointer capture keeps move/up events flowing to `handle` even when
		// the cursor is over the sandboxed iframe (which would otherwise eat
		// the pointerup and leave the panel glued to the mouse). Never let it
		// throw: a failed capture must not abort the drag setup.
		installInteractionSafety();
		let captured = true;
		try {
			handle.setPointerCapture(evt.pointerId);
		} catch {
			captured = false;
		}
		target.classList.add("archify-interacting");

		const move = (e: PointerEvent) => {
			if (e.buttons === 0) {
				up();
				return;
			}
			target.style.left = `${Math.min(Math.max(0, e.clientX - ox), window.innerWidth - 80)}px`;
			target.style.top = `${Math.min(Math.max(0, e.clientY - oy), window.innerHeight - 40)}px`;
		};
		let done = false;
		const up = () => {
			if (done) return;
			done = true;
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up, true);
			window.removeEventListener("pointercancel", up, true);
			target.classList.remove("archify-interacting");
			try {
				handle.releasePointerCapture(evt.pointerId);
			} catch {
				// already released
			}
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
		if (!captured) window.addEventListener("pointermove", move);
		// Backup end-of-drag hooks, in case capture is unavailable and the
		// pointerup lands elsewhere (over the iframe, another window, ...).
		window.addEventListener("pointerup", up, true);
		window.addEventListener("pointercancel", up, true);
	});
}

/**
 * Make `target` resizable by dragging `handle`. With `lockWidth` only the
 * height changes (used by inline expand). `onRelease` fires on drag end.
 */
export function makeResizable(
	handle: HTMLElement,
	target: HTMLElement,
	minW: number,
	minH: number,
	lockWidth = false,
	onRelease?: (width: number, height: number) => void
): void {
	handle.addEventListener("pointerdown", (evt) => {
		if (evt.button !== 0) return;
		evt.preventDefault();
		evt.stopPropagation();
		const rect = target.getBoundingClientRect();
		const startW = rect.width;
		const startH = rect.height;
		const sx = evt.clientX;
		const sy = evt.clientY;

		installInteractionSafety();
		let captured = true;
		try {
			handle.setPointerCapture(evt.pointerId);
		} catch {
			captured = false;
		}
		target.classList.add("archify-interacting");

		const move = (e: PointerEvent) => {
			if (e.buttons === 0) {
				up();
				return;
			}
			const maxW = Math.max(minW, window.innerWidth - 40);
			const maxH = Math.max(minH, window.innerHeight - 60);
			if (!lockWidth) {
				target.style.width = `${Math.max(minW, Math.min(startW + (e.clientX - sx), maxW))}px`;
			}
			target.style.height = `${Math.max(minH, Math.min(startH + (e.clientY - sy), maxH))}px`;
		};
		let done = false;
		const up = () => {
			if (done) return;
			done = true;
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up, true);
			window.removeEventListener("pointercancel", up, true);
			target.classList.remove("archify-interacting");
			try {
				handle.releasePointerCapture(evt.pointerId);
			} catch {
				// already released
			}
			const r = target.getBoundingClientRect();
			onRelease?.(r.width, r.height);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
		if (!captured) window.addEventListener("pointermove", move);
		// Backup end-of-resize hooks (see makeDraggable).
		window.addEventListener("pointerup", up, true);
		window.addEventListener("pointercancel", up, true);
	});
}

/**
 * Safety net: if anything ever leaves an element flagged as interacting
 * (lost pointer, plugin reload mid-drag), clear it on the next pointerup /
 * window blur so the iframe never stays click-through disabled.
 */
let safetyInstalled = false;
function installInteractionSafety(): void {
	if (safetyInstalled) return;
	safetyInstalled = true;
	const clear = () => {
		document
			.querySelectorAll(".archify-interacting")
			.forEach((el) => el.classList.remove("archify-interacting"));
	};
	window.addEventListener("pointerup", clear, true);
	window.addEventListener("pointercancel", clear, true);
	window.addEventListener("blur", clear);
}

// ----------------------------------------------------------------------
// Toolbar (buttons depend on the surface)
// ----------------------------------------------------------------------

export interface ToolbarHandlers {
	/** Vault path shown on the left; omitted on compact surfaces. */
	path?: string;
	onRefresh?: () => void;
	onSource?: () => void;
	/** Best-effort: hand the file to the OS default application. */
	onSystem?: () => void;
	/** Guaranteed: pop the preview out into an OS window owned by the app. */
	onWindow?: () => void;
	/** "Collapse" — inline expand only. */
	onCollapse?: () => void;
}

/**
 * Right-aligned action bar. Each surface only passes the actions that make
 * sense for it: the modal already has its own close button, so it never gets a
 * collapse button, and only inline previews collapse.
 */
export function buildToolbar(host: HTMLElement, h: ToolbarHandlers): HTMLElement {
	const bar = host.createDiv({ cls: "archify-toolbar" });
	if (h.path) bar.createSpan({ text: h.path, cls: "archify-path" });
	const add = (label: string, fn: () => void) => {
		const b = bar.createEl("button", { text: label, cls: "archify-btn" });
		b.addEventListener("click", fn);
	};
	if (h.onRefresh) add(t("view.refresh"), h.onRefresh);
	if (h.onSource) add(t("view.sourceDef"), h.onSource);
	if (h.onSystem) add(t("view.openBrowser"), h.onSystem);
	if (h.onWindow) add(t("view.openWindow"), h.onWindow);
	if (h.onCollapse) add(t("view.collapse"), h.onCollapse);
	return bar;
}

// ----------------------------------------------------------------------
// Custom view (new tab)
// ----------------------------------------------------------------------

export class ArchifyHtmlView extends ItemView {
	private file: TFile | null = null;
	private disposeFrame: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: ArchifyHtmlPreviewPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_ARCHIFY_HTML;
	}

	getDisplayText(): string {
		return this.file ? t("view.title", this.file.basename) : t("view.defaultTitle");
	}

	getIcon(): string {
		return "globe";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("archify-preview-view");
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = state as { file?: string } | null;
		if (s && typeof s.file === "string") {
			await this.renderPath(s.file);
		}
	}

	getState(): Record<string, unknown> {
		return { file: this.file ? this.file.path : null };
	}

	async renderPath(path: string): Promise<void> {
		const abs = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(abs instanceof TFile)) {
			new Notice(t("notice.fileNotFound", path));
			return;
		}
		this.file = abs;
		if (this.disposeFrame) this.disposeFrame();
		this.disposeFrame = null;
		this.contentEl.empty();

		buildToolbar(this.contentEl, {
			path: abs.path,
			onRefresh: () => void this.renderPath(abs.path),
			onSource: () => void openSourceDefinition(this.app, abs),
			onSystem: () => {
				void openInSystemBrowser(this.app, abs);
			},
			onWindow: () => {
				void openInObsidianWindow(this.app, abs);
			},
		});

		const { frame, dispose } = await createSandboxedFrame(this.plugin, abs);
		this.disposeFrame = dispose;
		this.contentEl.appendChild(frame);
	}

	async onClose(): Promise<void> {
		if (this.disposeFrame) this.disposeFrame();
		this.disposeFrame = null;
		this.contentEl.empty();
	}
}

// ----------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------

export class ArchifyHtmlModal extends Modal {
	private disposeFrame: (() => void) | null = null;

	constructor(app: ConstructorParameters<typeof Modal>[0], private plugin: ArchifyHtmlPreviewPlugin, private file: TFile) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("archify-preview-modal");
		this.setTitle(this.file.basename);
		// Drag by the title bar, resize via the corner grip.
		makeDraggable(this.titleEl, this.modalEl);

		buildToolbar(this.contentEl, {
			path: this.file.path,
			onRefresh: () => void this.render(),
			onSource: () => void openSourceDefinition(this.app, this.file),
			onSystem: () => {
				void openInSystemBrowser(this.app, this.file);
			},
			onWindow: () => {
				void openInObsidianWindow(this.app, this.file);
			},
		});

		const box = this.contentEl.createDiv({ cls: "archify-frame-box" });
		await this.render(box);
	}

	private async render(box?: HTMLElement): Promise<void> {
		if (this.disposeFrame) this.disposeFrame();
		this.disposeFrame = null;
		const host = box ?? this.contentEl.querySelector<HTMLElement>(".archify-frame-box");
		if (!host) return;
		host.querySelector(".archify-html-frame")?.remove();
		host.querySelector(".archify-resize-handle")?.remove();

		const { frame, dispose } = await createSandboxedFrame(this.plugin, this.file);
		this.disposeFrame = dispose;
		host.appendChild(frame);
		const grip = host.createDiv({ cls: "archify-resize-handle" });
		makeResizable(grip, frame, 480, 320);
	}

	onClose(): void {
		if (this.disposeFrame) this.disposeFrame();
		this.disposeFrame = null;
		this.contentEl.empty();
	}
}

// ----------------------------------------------------------------------
// Inline expand
// ----------------------------------------------------------------------

/** Owns an inline iframe inside a markdown section and releases its Blob URL. */
export class InlineFrameChild extends MarkdownRenderChild {
	private disposeFrame: (() => void) | null = null;

	constructor(containerEl: HTMLElement, private plugin: ArchifyHtmlPreviewPlugin, private file: TFile) {
		super(containerEl);
	}

	onload(): void {
		void this.setup();
	}

	private async setup(): Promise<void> {
		buildToolbar(this.containerEl, {
			onSource: () => void openSourceDefinition(this.plugin.app, this.file),
			onSystem: () => {
				void openInSystemBrowser(this.plugin.app, this.file);
			},
			onWindow: () => {
				void openInObsidianWindow(this.plugin.app, this.file);
			},
			onCollapse: () => this.collapse(),
		});

		const { frame, dispose } = await createSandboxedFrame(this.plugin, this.file);
		frame.style.height = `${this.plugin.settings.inlineHeight}px`;
		this.disposeFrame = dispose;
		this.containerEl.appendChild(frame);

		// Drag the bottom grip to adjust the height; the value is remembered.
		const grip = this.containerEl.createDiv({ cls: "archify-inline-grip" });
		makeResizable(grip, frame, 0, 160, true, (_w, h) => {
			this.plugin.settings.inlineHeight = Math.round(h);
			void this.plugin.saveSettings();
		});
	}

	/** Explicit teardown for the toggle-off path. */
	destroy(): void {
		this.unload();
	}

	/** "Collapse" action from the inline toolbar. */
	collapse(): void {
		this.containerEl.remove();
		this.destroy();
	}

	onunload(): void {
		if (this.disposeFrame) this.disposeFrame();
		this.disposeFrame = null;
	}
}
