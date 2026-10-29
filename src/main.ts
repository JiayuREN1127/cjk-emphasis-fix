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

export default class CJKEmphasisFixPlugin extends Plugin {
	settings: CJKEmphasisSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		await this.loadSettings();
		applySettings(this.settings);

		this.registerEditorExtension(cjkEmphasisExtension());
		this.addSettingTab(new CJKEmphasisSettingTab(this.app, this));

		this.addCommand({
			id: "scan-current-note",
			name: "扫描当前笔记中的 CJK 强调问题",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) {
					const fixes = findDocumentFixes(view.data);
					new Notice(
						fixes.length === 0
							? "没有需要修复的 CJK 强调。"
							: `发现 ${fixes.length} 处 CJK 强调问题。`,
					);
					console.log("[CJK Emphasis Fix] fixable ranges:", fixes);
				}
				return true;
			},
		});

		this.addCommand({
			id: "fix-current-note",
			name: "一键修复当前笔记中的 CJK 强调",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) {
					const fixes = findDocumentFixes(view.data);
					if (fixes.length === 0) {
						new Notice("没有需要修复的 CJK 强调。");
						return true;
					}
					view.editor.transaction({
						changes: fixes.map((fix) => ({
							from: view.editor.offsetToPos(fix.from),
							to: view.editor.offsetToPos(fix.to),
							text: fix.replacement,
						})),
					});
					new Notice(`已修复 ${fixes.length} 处 CJK 强调。`);
				}
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
		containerEl.empty();

		new Setting(containerEl)
			.setName("启用实时预览修复")
			.setDesc(
				"在实时预览（Live Preview）中把 CJK 标点旁的加粗、斜体正确渲染出来。源码模式不受影响。",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreviewFix)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreviewFix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("光标所在行显示标记")
			.setDesc(
				"光标停在某一行时显示 `**` 标记，方便直接编辑；关掉后标记始终隐藏。",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keepMarkersNearCursor)
					.onChange(async (value) => {
						this.plugin.settings.keepMarkersNearCursor = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("修复当前笔记")
			.setDesc(
				"把 `**文字。**继续` 这类在导出或其他编辑器中无法渲染的写法，改成 `**文字**。继续`。",
			)
			.addButton((button) =>
				button.setButtonText("执行修复").onClick(() => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!view) {
						new Notice("请先打开一个笔记。");
						return;
					}
					const fixes = findDocumentFixes(view.data);
					if (fixes.length === 0) {
						new Notice("没有需要修复的 CJK 强调。");
						return;
					}
					view.editor.transaction({
						changes: fixes.map((fix) => ({
							from: view.editor.offsetToPos(fix.from),
							to: view.editor.offsetToPos(fix.to),
							text: fix.replacement,
						})),
					});
					new Notice(`已修复 ${fixes.length} 处 CJK 强调。`);
				}),
			);
	}
}
