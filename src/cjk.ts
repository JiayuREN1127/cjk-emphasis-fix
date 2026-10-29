export function isCJKCharacter(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0x3100 && code <= 0x312f) ||
    (code >= 0x31a0 && code <= 0x31bf) ||
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x2f00 && code <= 0x2fdf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3200 && code <= 0x32ff) ||
    (code >= 0x3300 && code <= 0x33ff)
  );
}

export function isFullwidthPunctuation(code: number): boolean {
  return (
    (code >= 0x3001 && code <= 0x3002) ||
    (code >= 0x3008 && code <= 0x3011) ||
    (code >= 0x3014 && code <= 0x301b) ||
    (code >= 0xff01 && code <= 0xff0f) ||
    (code >= 0xff1a && code <= 0xff20) ||
    (code >= 0xff3b && code <= 0xff40) ||
    (code >= 0xff5b && code <= 0xff65)
  );
}

export function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

export function isWhitespace(code: number | undefined): boolean {
  return code !== undefined && /\s/u.test(String.fromCodePoint(code));
}

export function isPunctuation(code: number | undefined): boolean {
  if (code === undefined) return false;
  return isAsciiPunctuation(code) || isFullwidthPunctuation(code);
}

export function isWhitespaceOrPunctuation(code: number | undefined): boolean {
  return isWhitespace(code) || isPunctuation(code);
}

export function hasCJKRelatedContent(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (isCJKCharacter(code) || isFullwidthPunctuation(code))) {
      return true;
    }
  }
  return false;
}
