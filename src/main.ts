import {
  Plugin,
  MarkdownView,
  Notice,
  PluginSettingTab,
  App,
  Setting,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { cjkEmphasisExtension } from "./extension";
import { findDocumentFixes } from "./scanner";
import {
  CJKEmphasisSettings,
  DEFAULT_SETTINGS,
  applySettings,
} from "./settings";
import { t } from "./i18n";

export default class CJKEmphasisFixPlugin extends Plugin {
	settings: CJKEmphasisSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadSettings();
		applySettings(this.settings);

		this.registerEditorExtension(cjkEmphasisExtension());
		this.addSettingTab(new CJKEmphasisSettingTab(this.app, this));

		const strings = t();

		this.addCommand({
			id: "scan-current-note",
			name: strings.commandScan,
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) {
					const fixes = findDocumentFixes(view.data);
					new Notice(
						fixes.length === 0
							? strings.noticeNoIssues
							: strings.noticeFound(fixes.length),
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "fix-current-note",
			name: strings.commandFix,
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) this.fixView(view, strings);
				return true;
			},
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		applySettings(this.settings);
		this.refreshEditors();
	}

	fixView(view: MarkdownView, strings = t()): void {
		const fixes = findDocumentFixes(view.data);
		if (fixes.length === 0) {
			new Notice(strings.noticeNoIssues);
			return;
		}
		view.editor.transaction({
			changes: fixes.map((fix) => ({
				from: view.editor.offsetToPos(fix.from),
				to: view.editor.offsetToPos(fix.to),
				text: fix.replacement,
			})),
		});
		new Notice(strings.noticeFixed(fixes.length));
	}

	/** Force every open markdown editor to rebuild its decorations. */
	private refreshEditors() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const cm = (view.editor as unknown as { cm?: EditorView }).cm;
			if (!cm) return;
			cm.dispatch({ selection: cm.state.selection });
		});
	}
}

class CJKEmphasisSettingTab extends PluginSettingTab {
	plugin: CJKEmphasisFixPlugin;

	constructor(app: App, plugin: CJKEmphasisFixPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const strings = t();
		containerEl.empty();

		new Setting(containerEl)
			.setName(strings.settingEnableName)
			.setDesc(strings.settingEnableDesc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreviewFix)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreviewFix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(strings.settingMarkersName)
			.setDesc(strings.settingMarkersDesc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keepMarkersNearCursor)
					.onChange(async (value) => {
						this.plugin.settings.keepMarkersNearCursor = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(strings.settingFixName)
			.setDesc(strings.settingFixDesc)
			.addButton((button) =>
				button.setButtonText(strings.buttonFix).onClick(() => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!view) {
						new Notice(strings.noticeNoNote);
						return;
					}
					this.plugin.fixView(view, strings);
				}),
			);
	}
}
