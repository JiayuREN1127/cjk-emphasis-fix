# CJK Emphasis Fix

Render bold and italic next to CJK punctuation in Obsidian Live Preview.

[中文说明](README_CN.md)

## The problem

CommonMark requires the closing `**` of an emphasis run to be *right-flanking*: either the character before it is not punctuation, or the character after it is whitespace or punctuation. Chinese, Japanese, and Korean text is written without spaces, so the marker often lands exactly where both conditions fail:

```markdown
前面**文字。**继续写
```

Here the closing `**` is preceded by `。` and followed by `继`. No mainstream parser accepts that run, so the line renders as literal asterisks instead of bold text.

This is [CommonMark issue #650](https://github.com/commonmark/commonmark-spec/issues/650), open since 2017.

### What is broken and what is not

| Markdown | Renders? |
| --- | --- |
| `**text。**next` | No — bold/italic case this plugin fixes |
| `==text。==next` | No — highlight |
| `~~text。~~next` | No — strikethrough |
| `**text。**` at end of line | Yes |
| `**text。**，` followed by punctuation | Yes |
| `**text。** next` followed by a space | Yes |
| `** text。**` with a space inside the markers | No — a separate, invalid-markup case |

Highlight and strikethrough suffer from the same problem because their parsers use the same delimiter-flanking logic as emphasis.

## What the plugin does

**1. Live Preview rendering.** It scans each visible line, finds CJK emphasis that the parser rejected, applies the matching styling — bold, italic, bold+italic, highlight, or strikethrough — and hides the delimiters. Markers come back when the cursor is on that line so they remain editable. Source mode is untouched.

Obsidian does not only miss these runs; sometimes it pairs the closing delimiter with a later one and styles the rest of the paragraph. When that happens, the plugin also restores the over-styled tail to normal weight, so only the text you marked is emphasised.

**2. Source rewriting.** `**文字。**继续` is valid as far as this plugin is concerned, but it still breaks when you export to PDF or open the file in another Markdown editor. The command **Fix CJK emphasis in current note** rewrites it as:

```markdown
**文字**。继续
```

The same rewrite applies to `==`, `~~`, and `*`. The punctuation moves outside the delimiters, which is standard practice in Chinese typesetting. Inline code, `$$math$$`, and fenced code blocks are left alone.

Both commands are also available from the settings tab.

## Installation

### Manual

```text
<vault>/.obsidian/plugins/cjk-emphasis-fix/
├── main.js
├── manifest.json
└── versions.json
```

Enable it under **Settings → Community plugins**. The repository ships an `install.sh` that copies the files and enables the plugin in one step:

```bash
./install.sh "/path/to/vault"
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Enable Live Preview fix | On | Master switch for the editor rendering fix. |
| Show markers on the cursor line | On | Keeps `**` visible while editing that line. |
| Fix current note | — | Runs the source rewrite on the open note. |

## Limitations

- Covers `*`, `**`, `***`, `==`, and `~~`. Underscore emphasis (`_text_`) is not handled, because CJK notes almost never use it.
- The source rewrite moves trailing punctuation outside the delimiters, so the punctuation itself is no longer styled. This matches common Chinese typesetting but is a deliberate trade-off.
- Reading view needs no fix: Obsidian already renders these lines correctly there.

## Development

```bash
npm install
npm run build     # type-check, then bundle to main.js
npm test          # parser tests, no Obsidian needed
```

The scanner is a pure function set in `src/scanner.ts`; the editor integration lives in `src/extension.ts` and uses only the public `registerEditorExtension` API.

The code avoids regular-expression lookbehind on purpose, because iOS versions before 16.4 do not support it and the plugin targets mobile as well.

## Background

- [CommonMark issue #650](https://github.com/commonmark/commonmark-spec/issues/650)
- [Obsidian forum thread on parser quirks](https://forum.obsidian.md/t/parsers-problems-with-bold-italic-highlight-markers-and-whitespaces-and-punctuation-marks/105107)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly) — a spec-level fix for CJK emphasis
- [obsidian-cjk-bold-fix](https://github.com/ebibibi/obsidian-cjk-bold-fix) — an earlier plugin that patches the same Live Preview behaviour; this project adds source-level rewriting and code/math masking

## License

MIT
