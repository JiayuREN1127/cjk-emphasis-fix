export interface CJKEmphasisSettings {
  enableLivePreviewFix: boolean;
  keepMarkersNearCursor: boolean;
}

export const DEFAULT_SETTINGS: CJKEmphasisSettings = {
  enableLivePreviewFix: true,
  keepMarkersNearCursor: true,
};

let current: CJKEmphasisSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): CJKEmphasisSettings {
  return current;
}

export function applySettings(settings: Partial<CJKEmphasisSettings>): void {
  current = { ...current, ...settings };
}
