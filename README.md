# CJK Emphasis Fix

一个 Obsidian 插件，修复中文、日文、韩文文本里，加粗和斜体标记因 CommonMark flanking 规则而无法渲染的问题。

## 问题是什么

CommonMark 规定：强调的闭合标记 `**` 是「right-flanking」的，必须满足「前面不是标点，或者后面是空白/标点」。中文句子里标点紧贴文字，于是：

```markdown
前面**文字。**继续写     ← 闭合 ** 前面是「。」，后面是「继」，渲染失败
```

在 Live Preview 里会直接显示字面的 `**`，文字也不加粗。

已验证的边界：

| 写法 | 结果 |
| --- | --- |
| `**文字。**x` | 失败（本文要修的） |
| `**文字。**`（行尾） | 正常 |
| `**文字。**，`（后接标点） | 正常 |
| `**文字。** x`（后接空格） | 正常 |
| `** 文字。**`（标记内有空格） | 失败，属另一类问题 |

## 它做什么

1. **实时预览修复**：扫描当前视口内的行，找出「CJK 相关、但解析器没认出来」的强调，补上加粗/斜体样式并隐藏 `**` 标记。光标停在那一行时保留标记，方便编辑。源码模式（Source mode）不生效。
2. **源码修复命令**：把 `**文字。**继续` 改写成 `**文字**。继续`——标点移出标记外。这样导出 PDF、在其他编辑器里打开、发布到网页时也能正常渲染。命令面板里有「扫描当前笔记中的 CJK 强调问题」和「一键修复当前笔记中的 CJK 强调」，设置页也有按钮。

不会动 `行内代码`、`$$数学公式$$` 和代码围栏内的内容。

## 安装

```text
<vault>/.obsidian/plugins/cjk-emphasis-fix/
├── main.js
├── manifest.json
└── versions.json
```

或者直接用仓库里的脚本：

```bash
./install.sh "/path/to/vault"
```

脚本会复制三个文件，并把插件加进该 vault 的 `community-plugins.json`（自动启用）。

## 设置

- **启用实时预览修复**：总开关。
- **光标所在行显示标记**：关掉后 `**` 始终隐藏。
- **修复当前笔记**：对打开的笔记执行一次源码修复。

## 验证记录

在本机 Obsidian 1.12.7 实测：

- 插件开启，测试笔记第 1 节的 `前面**文字。**继续写` 正常加粗、星号不可见；
- 插件关闭后同一行恢复字面 `**文字。**`，说明确实是插件在起作用。

## 已知限制

- 只处理 `*` / `**` / `***`。`==高亮==`、`~~删除线~~` 的解析规则不同，暂不覆盖。
- 源码修复采用「标点移到标记外」策略，视觉上句末标点不再加粗；这是中文排版的常见做法。
- 不做阅读视图处理：Obsidian 阅读视图本来就正常。

## 开发

```bash
npm install
npm run build     # tsc 类型检查 + esbuild 打包到 main.js
npm test          # 扫描器单元测试（纯函数，不依赖 Obsidian）
```

## 背景资料

- [CommonMark issue #650](https://github.com/commonmark/commonmark-spec/issues/650)：上游问题，7 年未解决
- [Obsidian 论坛讨论](https://forum.obsidian.md/t/parsers-problems-with-bold-italic-highlight-markers-and-whitespaces-and-punctuation-marks/105107)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)：规范层面的修复方案
