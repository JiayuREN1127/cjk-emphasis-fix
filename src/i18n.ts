import { moment } from "obsidian";

const en = {
  pluginTitle: "CJK Emphasis Fix",
  commandScan: "Scan current note for CJK emphasis issues",
  commandFix: "Fix CJK emphasis in current note",
  noticeNoIssues: "No CJK emphasis issues found.",
  noticeFound: (count: number) => `Found ${count} CJK emphasis issue(s).`,
  noticeFixed: (count: number) => `Fixed ${count} CJK emphasis issue(s).`,
  noticeNoNote: "Open a note first.",
  settingEnableName: "Enable Live Preview fix",
  settingEnableDesc:
    "Render bold, italic, highlight, and strikethrough next to CJK punctuation in Live Preview. Source mode is not affected.",
  settingMarkersName: "Show markers on the cursor line",
  settingMarkersDesc:
    "Keep the ** markers visible while the cursor is on that line so they stay editable. Turn off to always hide them.",
  settingFixName: "Fix current note",
  settingFixDesc:
    "Rewrite `**text。**next` as `**text**。next` so the formatting also renders when exported or opened in other editors.",
  settingRewriteName: "Enable source rewrite (experimental)",
  settingRewriteDesc:
    "Adds the commands that rewrite note text. Off by default. Known to misjudge complex multi-line structures such as links, HTML, YAML and fenced code, so back up the note first. The plugin never rewrites automatically; it only runs when you invoke the command or button.",
  noticeRewriteDisabled: "Source rewrite is disabled. Enable it in settings first.",
  buttonFix: "Fix",
};

const zh: typeof en = {
  pluginTitle: "CJK 强调修复",
  commandScan: "扫描当前笔记中的 CJK 强调问题",
  commandFix: "一键修复当前笔记中的 CJK 强调",
  noticeNoIssues: "没有需要修复的 CJK 强调。",
  noticeFound: (count: number) => `发现 ${count} 处 CJK 强调问题。`,
  noticeFixed: (count: number) => `已修复 ${count} 处 CJK 强调。`,
  noticeNoNote: "请先打开一个笔记。",
  settingEnableName: "启用实时预览修复",
  settingEnableDesc:
    "在实时预览中正确渲染 CJK 标点旁的加粗、斜体、高亮和删除线。源码模式不受影响。",
  settingMarkersName: "光标所在行显示标记",
  settingMarkersDesc:
    "光标停在某一行时保留 ** 标记，方便直接编辑；关掉后标记始终隐藏。",
  settingFixName: "修复当前笔记",
  settingFixDesc:
    "把 `**文字。**继续` 改成 `**文字**。继续`，这样导出或换编辑器打开也能正常渲染。",
  settingRewriteName: "启用源码改写（实验性）",
  settingRewriteDesc:
    "启用后会注册改写笔记原文的命令，默认关闭。已知会误判多行链接、HTML、YAML、围栏代码等复杂结构，使用前请先备份笔记。插件不会自动运行，只有你手动执行命令或点击按钮时才会改写。",
  noticeRewriteDisabled: "源码改写未启用，请先在设置中打开。",
  buttonFix: "执行修复",
};

export type Strings = typeof en;

function currentLanguage(): string {
  try {
    // moment.locale() reflects the Obsidian interface language and has been
    // part of the API far longer than getLanguage(), keeping minAppVersion low.
    return (moment.locale() || "en").toLowerCase();
  } catch {
    return "en";
  }
}

export function t(): Strings {
  return currentLanguage().startsWith("zh") ? zh : en;
}
