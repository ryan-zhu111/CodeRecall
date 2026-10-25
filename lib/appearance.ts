export type Appearance = { theme: 'light' | 'dark'; fontSize: number };
export const APPEARANCE_KEY = 'acm-quick-drill:appearance-v1';
export const MIN_CODE_SIZE = 12;
export const MAX_CODE_SIZE = 24;
export const DEFAULT_APPEARANCE: Appearance = { theme: 'light', fontSize: 16 };

export function parseAppearance(raw: string | null): Appearance {
  try {
    const data = JSON.parse(raw ?? 'null');
    return {
      theme: data?.theme === 'dark' ? 'dark' : 'light',
      fontSize:
        typeof data?.fontSize === 'number' && Number.isFinite(data.fontSize)
          ? Math.min(
              MAX_CODE_SIZE,
              Math.max(MIN_CODE_SIZE, Math.round(data.fontSize)),
            )
          : DEFAULT_APPEARANCE.fontSize,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

// Apply the saved choice before first paint; this contains no user-generated code.
export const appearanceBootstrap = `(()=>{try{const d=JSON.parse(localStorage.getItem("${APPEARANCE_KEY}")||'null');const theme=d?.theme==='dark'?'dark':'light';const size=typeof d?.fontSize==='number'&&Number.isFinite(d.fontSize)?Math.max(${MIN_CODE_SIZE},Math.min(${MAX_CODE_SIZE},Math.round(d.fontSize))):${DEFAULT_APPEARANCE.fontSize};document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.setProperty('--code-font-size',size+'px');}catch{}})();`;
