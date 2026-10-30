# CJK Emphasis Fix

修复 Obsidian 实时预览里，中文、日文、韩文标点旁的加粗和斜体被显示为字面星号的问题。

[English](README.md)

## 问题

CommonMark 要求强调的闭合 `**` 右侧满足「前一个字符不是标点，或后一个字符是空白/标点」。中日韩文本不用空格分词，标记很容易同时踩中两个条件：

```markdown
前面**文字。**继续写
```

闭合的 `**` 前面是 `。`，后面是 `继`。主流解析器都不认这种写法，于是整行退化成字面星号。这是 [CommonMark issue #650](https://github.com/commonmark/commonmark-spec/issues/650)，从 2017 年挂到现在。

### 哪些坏、哪些不坏

| 写法 | 能否渲染 |
| --- | --- |
| `**文字。**继续` | 不能，加粗/斜体 |
| `==文字。==继续` | 不能，高亮 |
| `~~文字。~~继续` | 不能，删除线 |
| `**文字。**`（行尾） | 能 |
| `**文字。**，`（后接标点） | 能 |
| `**文字。** 继续`（后接空格） | 能 |
| `** 文字。**`（标记内有空格） | 不能，但属于另一类错误写法 |

高亮和删除线也会坏，因为它们的解析器复用了和强调同一套分隔符 flanking 规则。

## 插件做了什么

**跟随主题。** 插件不自造样式：渲染用的 span 直接挂 Obsidian 自己的 `cm-strong`、`cm-em`、`cm-highlight`、`cm-strikethrough` 类，主题的加粗配色、字重、高亮底色都会原样生效。解析器多染的那部分则用 Obsidian 核心变量还原成普通文本，各主题的配色都不受影响。

**1. 实时预览渲染。** 逐行扫描可见区域，找出解析器没认出来的 CJK 标记，补上加粗、斜体、粗斜体、高亮或删除线样式，并隐藏分隔符。光标停在该行时标记会恢复显示，方便编辑。源码模式不受影响。

插件无法替换 Obsidian 的解析器，而它有时会把闭合标记和后面更远的标记配成一对，导致整段都被加粗。插件会在渲染层把多出来的那部分样式压回普通文本，取色用 Obsidian 自己的主题变量，所以主题只会把加粗样式作用在你标记的那段。**插件不会修改你的笔记文本。**

**2. 源码改写。** `**文字。**继续` 在本插件下能正常看，但导出 PDF 或换编辑器打开时仍然坏。命令「一键修复当前笔记中的 CJK 强调」会改成：

```markdown
**文字**。继续
```

标点移到标记外，这也是中文排版的常见做法。行内代码、`$$公式$$`、代码围栏中的内容不会被修改。设置页也有同样的按钮。

## 安装

### 手动

```text
<vault>/.obsidian/plugins/cjk-emphasis-fix/
├── main.js
├── manifest.json
└── versions.json
```

在 **设置 → 第三方插件** 中启用。仓库里附带 `install.sh`，一条命令完成复制和启用：

```bash
./install.sh "/path/to/vault"
```

## 设置

| 项目 | 默认 | 说明 |
| --- | --- | --- |
| 启用实时预览修复 | 开 | 编辑器渲染修复的总开关 |
| 光标所在行显示标记 | 开 | 编辑该行时保留 `**` 可见 |
| 修复当前笔记 | — | 对当前打开的笔记执行源码改写 |

## 限制

- 只覆盖 `*`、`**`、`***`。高亮（`==`）和删除线（`~~`）的解析规则不同，暂不处理。
- 可选的「一键修复当前笔记」命令会把 `**文字。**继续` 改写成 `**文字**。继续`，使导出到 Obsidian 之外也能正常渲染。它只在你主动运行时执行，插件不会自动改动文本。
- 阅读视图不需要修，Obsidian 在那里本来就渲染正常。

## 开发

```bash
npm install
npm run build     # 类型检查 + 打包到 main.js
npm test          # 扫描器测试，不需要启动 Obsidian
```

扫描器是 `src/scanner.ts` 里的纯函数；编辑器集成在 `src/extension.ts`，只用公开的 `registerEditorExtension` API。

代码刻意避开了正则 lookbehind，因为 iOS 16.4 以下不支持，而插件要兼顾移动端。

## 背景资料

- [CommonMark issue #650](https://github.com/commonmark/commonmark-spec/issues/650)
- [Obsidian 论坛相关讨论](https://forum.obsidian.md/t/parsers-problems-with-bold-italic-highlight-markers-and-whitespaces-and-punctuation-marks/105107)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)：规范层面的修复方案
- [obsidian-cjk-bold-fix](https://github.com/ebibibi/obsidian-cjk-bold-fix)：更早的同源问题修复插件（仅修改实时预览显示）；本项目额外提供源码改写与代码/公式保护

## 许可

MIT
