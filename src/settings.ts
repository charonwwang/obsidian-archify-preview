import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { t } from "./i18n";
import type ArchifyHtmlPreviewPlugin from "./main";

export type OpenMode = "tab" | "modal" | "inline";

export interface ArchifyHtmlPreviewSettings {
	/** Where a click on a linked thumbnail opens the interactive HTML. */
	openMode: OpenMode;
	/** Take over opening of `.html` / `.htm` files (conflicts with other HTML viewers). */
	registerHtmlExtension: boolean;
	/** Add `allow-same-origin` to the sandbox (enables localStorage, weakens isolation). */
	sandboxAllowSameOrigin: boolean;
	/** Iframe height (px) used by inline expand mode. */
	inlineHeight: number;
}

export const DEFAULT_SETTINGS: ArchifyHtmlPreviewSettings = {
	openMode: "tab",
	registerHtmlExtension: false,
	sandboxAllowSameOrigin: false,
	inlineHeight: 560,
};

export class ArchifySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ArchifyHtmlPreviewPlugin) {
		super(app, plugin);
	}

	/**
	 * Declarative definitions (Obsidian 1.13+): they drive rendering and make
	 * the settings discoverable in the app's settings search. `display()` below
	 * is the imperative fallback for older versions; 1.13+ never calls it.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t("settings.clickBehavior"),
				desc: t("settings.clickBehavior.desc"),
				control: {
					type: "dropdown",
					key: "openMode",
					defaultValue: "tab",
					options: {
						tab: t("settings.mode.tab"),
						modal: t("settings.mode.modal"),
						inline: t("settings.mode.inline"),
					},
				},
			},
			{
				name: t("settings.takeover"),
				desc: t("settings.takeover.desc"),
				control: { type: "toggle", key: "registerHtmlExtension", defaultValue: false },
			},
			{
				name: t("settings.sameOrigin"),
				desc: t("settings.sameOrigin.desc"),
				control: { type: "toggle", key: "sandboxAllowSameOrigin", defaultValue: false },
			},
			{
				name: t("settings.inlineHeight"),
				desc: t("settings.inlineHeight.desc"),
				control: { type: "slider", key: "inlineHeight", defaultValue: 560, min: 320, max: 1080, step: 20 },
			},
		];
	}

	/** Storage bridge for the declarative settings (keys match the settings interface). */
	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	setControlValue(key: string, value: unknown): void {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		void this.plugin.saveSettings();
	}

	/** Imperative fallback for Obsidian versions older than 1.13. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.clickBehavior"))
			.setDesc(t("settings.clickBehavior.desc"))
			.addDropdown((d) =>
				d
					.addOption("tab", t("settings.mode.tab"))
					.addOption("modal", t("settings.mode.modal"))
					.addOption("inline", t("settings.mode.inline"))
					.setValue(this.plugin.settings.openMode)
					.onChange(async (v) => {
						this.plugin.settings.openMode = v as OpenMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.takeover"))
			.setDesc(t("settings.takeover.desc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.registerHtmlExtension).onChange(async (v) => {
					this.plugin.settings.registerHtmlExtension = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("settings.sameOrigin"))
			.setDesc(t("settings.sameOrigin.desc"))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.sandboxAllowSameOrigin).onChange(async (v) => {
					this.plugin.settings.sandboxAllowSameOrigin = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("settings.inlineHeight"))
			.setDesc(t("settings.inlineHeight.desc"))
			.addSlider((s) =>
				s
					.setLimits(320, 1080, 20)
					.setValue(this.plugin.settings.inlineHeight)
					.onChange(async (v) => {
						this.plugin.settings.inlineHeight = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
