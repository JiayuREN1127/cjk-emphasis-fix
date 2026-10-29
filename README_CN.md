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
| `**文字。**继续` | 不能，本插件修的正是这个 |
| `**文字。**`（行尾） | 能 |
| `**文字。**，`（后接标点） | 能 |
| `**文字。** 继续`（后接空格） | 能 |
| `** 文字。**`（标记内有空格） | 不能，但属于另一类错误写法 |

## 插件做了什么

**1. 实时预览渲染。** 逐行扫描可见区域，找出解析器没认出来的 CJK 强调，补上加粗/斜体样式并隐藏 `**` 标记。光标停在该行时标记会恢复显示，方便编辑。源码模式不受影响。

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
- 源码改写会把句末标点移到标记外，标点本身不再加粗。这是有意的取舍。
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

## 许可

MIT
