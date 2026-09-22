import { getLanguage, moment, requireApiVersion } from "obsidian";

type Dict = Record<string, string>;

const en: Dict = {
	"cmd.openActive": "Open active HTML file in the interactive preview",
	"badge.interactive": "Interactive",
	"badge.sourceDef": "Source definition: {0}",
	"settings.clickBehavior": "Click behavior",
	"settings.clickBehavior.desc": "Where the interactive HTML opens when the thumbnail is clicked.",
	"settings.mode.tab": "New tab",
	"settings.mode.modal": "Modal",
	"settings.mode.inline": "Inline expand",
	"settings.takeover": "Take over .html file opening",
	"settings.takeover.desc":
		"Open .html/.htm files in the interactive view on click or double click. Conflicts with other HTML viewer plugins — reload the plugin after changing.",
	"settings.sameOrigin": "Allow same origin",
	"settings.sameOrigin.desc":
		"Add allow-same-origin to the sandbox so previews can use localStorage. Leave off unless an artifact needs it.",
	"settings.inlineHeight": "Inline expand height",
	"settings.inlineHeight.desc": "Iframe height in pixels for inline expand mode.",
	"view.defaultTitle": "Archify Preview",
	"view.title": "Archify: {0}",
	"view.refresh": "Refresh",
	"view.sourceDef": "Source definition",
	"view.openBrowser": "Open in browser",
	"view.openWindow": "Open in new window",
	"view.collapse": "Collapse",
	"notice.fileNotFound": "Archify HTML Preview: file not found: {0}",
	"notice.noSourceJson": "No sibling source definition: {0}",
	"notice.openFailed": "Could not open {0} in a browser. Its absolute path was copied to the clipboard — paste it into the address bar.",
};

const zh: Dict = {
	"cmd.openActive": "在交互预览中打开当前 HTML 文件",
	"badge.interactive": "交互版",
	"badge.sourceDef": "源定义：{0}",
	"settings.clickBehavior": "点击行为",
	"settings.clickBehavior.desc": "点击缩略图后，交互版 HTML 的打开位置。",
	"settings.mode.tab": "新标签页",
	"settings.mode.modal": "模态窗",
	"settings.mode.inline": "内联展开",
	"settings.takeover": "接管 .html 文件打开",
	"settings.takeover.desc": "点击或双击 .html/.htm 文件时用交互视图打开。与其他 HTML 预览类插件互斥，修改后需重载插件生效。",
	"settings.sameOrigin": "允许同源",
	"settings.sameOrigin.desc": "为沙箱添加 allow-same-origin，使预览页可使用 localStorage。除非产物需要，否则保持关闭。",
	"settings.inlineHeight": "内联展开高度",
	"settings.inlineHeight.desc": "内联展开模式下 iframe 的高度（像素）。",
	"view.defaultTitle": "Archify 预览",
	"view.title": "Archify：{0}",
	"view.refresh": "刷新",
	"view.sourceDef": "查看源定义",
	"view.openBrowser": "在浏览器打开",
	"view.openWindow": "在新窗口打开",
	"view.collapse": "收起",
	"notice.fileNotFound": "Archify HTML 预览：找不到文件：{0}",
	"notice.noSourceJson": "未找到同名源定义：{0}",
	"notice.openFailed": "无法在浏览器中打开：{0}；已把绝对路径复制到剪贴板，可直接粘贴到地址栏。",
};

const zhTw: Dict = {
	"cmd.openActive": "在互動預覽中開啟目前 HTML 檔案",
	"badge.interactive": "互動版",
	"badge.sourceDef": "原始定義：{0}",
	"settings.clickBehavior": "點擊行為",
	"settings.clickBehavior.desc": "點擊縮圖後，互動版 HTML 的開啟位置。",
	"settings.mode.tab": "新分頁",
	"settings.mode.modal": "模態視窗",
	"settings.mode.inline": "內聯展開",
	"settings.takeover": "接管 .html 檔案開啟",
	"settings.takeover.desc": "點擊或雙擊 .html/.htm 檔案時以互動檢視開啟。與其他 HTML 預覽外掛互斥，變更後需重新載入外掛生效。",
	"settings.sameOrigin": "允許同源",
	"settings.sameOrigin.desc": "為沙箱加入 allow-same-origin，使預覽頁可使用 localStorage。除非產物需要，否則保持關閉。",
	"settings.inlineHeight": "內聯展開高度",
	"settings.inlineHeight.desc": "內聯展開模式下 iframe 的高度（像素）。",
	"view.defaultTitle": "Archify 預覽",
	"view.title": "Archify：{0}",
	"view.refresh": "重新整理",
	"view.sourceDef": "檢視原始定義",
	"view.openBrowser": "在瀏覽器開啟",
	"view.openWindow": "在新視窗開啟",
	"view.collapse": "收起",
	"notice.fileNotFound": "Archify HTML 預覽：找不到檔案：{0}",
	"notice.noSourceJson": "未找到同名原始定義：{0}",
	"notice.openFailed": "無法在瀏覽器中開啟：{0}；已把絕對路徑複製到剪貼簿，可直接貼到網址列。",
};

const ja: Dict = {
	"cmd.openActive": "アクティブな HTML ファイルをインタラクティブプレビューで開く",
	"badge.interactive": "インタラクティブ",
	"badge.sourceDef": "ソース定義: {0}",
	"settings.clickBehavior": "クリック時の動作",
	"settings.clickBehavior.desc": "サムネイルをクリックしたとき、インタラクティブ HTML をどこに開くか。",
	"settings.mode.tab": "新しいタブ",
	"settings.mode.modal": "モーダル",
	"settings.mode.inline": "インライン展開",
	"settings.takeover": ".html ファイルのオープンを引き継ぐ",
	"settings.takeover.desc":
		".html/.htm ファイルのクリック/ダブルクリックでインタラクティブビューを開きます。他の HTML ビュープラグと競合します。変更後にプラグインを再読み込みしてください。",
	"settings.sameOrigin": "同一オリジンを許可",
	"settings.sameOrigin.desc":
		"サンドボックスに allow-same-origin を追加し、プレビューで localStorage を使えるようにします。必要な場合以外はオフのままにしてください。",
	"settings.inlineHeight": "インライン展開の高さ",
	"settings.inlineHeight.desc": "インライン展開モードの iframe の高さ（ピクセル）。",
	"view.defaultTitle": "Archify プレビュー",
	"view.title": "Archify: {0}",
	"view.refresh": "再読み込み",
	"view.sourceDef": "ソース定義を開く",
	"view.openBrowser": "ブラウザで開く",
	"view.openWindow": "新しいウィンドウで開く",
	"view.collapse": "折りたたむ",
	"notice.fileNotFound": "Archify HTML プレビュー: ファイルが見つかりません: {0}",
	"notice.noSourceJson": "対応するソース定義がありません: {0}",
	"notice.openFailed": "ブラウザで開けません: {0}。絶対パスをクリップボードにコピーしました。",
};

const STRINGS: Record<string, Dict> = { en, zh, "zh-tw": zhTw, ja };

/**
 * Detect the interface language of the app and return it in canonical form.
 * `getLanguage()` requires Obsidian 1.8.7+; older builds are routed to
 * `moment.locale()` instead, which Obsidian keeps in sync with the UI language.
 */
function getLocale(): string {
	let raw = "";
	if (requireApiVersion("1.8.7")) {
		raw = getLanguage();
	} else {
		raw = moment.locale() ?? "en";
	}
	const norm = raw.toLowerCase();
	if (STRINGS[norm]) return norm;
	const base = norm.split("-")[0];
	if (STRINGS[base]) return base;
	return "en";
}

/** Translate `key`, substituting `{0}`, `{1}`, ... with `params`. */
export function t(key: string, ...params: string[]): string {
	const locale = getLocale();
	let s = STRINGS[locale]?.[key] ?? en[key] ?? key;
	params.forEach((p, i) => {
		s = s.replace(`{${i}}`, p);
	});
	return s;
}
