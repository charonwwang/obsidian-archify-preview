import { App, PluginSettingTab, Setting } from "obsidian";
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
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.inlineHeight = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
