import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Minus, Moon, Plus, Sun, Type } from 'lucide-react';
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  MAX_CODE_SIZE,
  MIN_CODE_SIZE,
  parseAppearance,
  type Appearance,
} from '@/lib/appearance';

type AppearanceContextValue = Appearance & {
  setFontSize: (value: number) => void;
  toggleTheme: () => void;
  storageError: boolean;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function applyAppearance(value: Appearance) {
  document.documentElement.classList.toggle('dark', value.theme === 'dark');
  document.documentElement.style.setProperty(
    '--code-font-size',
    `${value.fontSize}px`,
  );
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_APPEARANCE);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const saved = parseAppearance(localStorage.getItem(APPEARANCE_KEY));
      setSettings(saved);
      applyAppearance(saved);
    } catch {
      setStorageError(true);
    }
    const sync = (event: StorageEvent) => {
      if (
        event.storageArea !== localStorage ||
        (event.key !== APPEARANCE_KEY && event.key !== null)
      )
        return;
      const next = parseAppearance(event.newValue);
      setSettings(next);
      applyAppearance(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const update = useCallback((next: Appearance) => {
    setSettings(next);
    applyAppearance(next);
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, []);

  return (
    <AppearanceContext.Provider
      value={{
        ...settings,
        storageError,
        setFontSize: (fontSize) =>
          update({
            ...settings,
            fontSize: Math.max(
              MIN_CODE_SIZE,
              Math.min(MAX_CODE_SIZE, Math.round(fontSize)),
            ),
          }),
        toggleTheme: () =>
          update({
            ...settings,
            theme: settings.theme === 'light' ? 'dark' : 'light',
          }),
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider is required');
  return value;
}

export function AppearanceControls({ compact = false }: { compact?: boolean }) {
  const { theme, fontSize, setFontSize, toggleTheme, storageError } =
    useAppearance();
  const button =
    'grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-30';
  return (
    <div className="flex shrink-0 items-center gap-2" aria-label="显示设置">
      <div
        className="flex h-9 items-center rounded-full bg-muted px-1"
        title="代码字号 · 所有编辑器和题解同步，自动保存"
      >
        {!compact && (
          <Type
            className="mx-1.5 hidden size-3.5 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className={button}
          onClick={() => setFontSize(fontSize - 1)}
          disabled={fontSize <= MIN_CODE_SIZE}
          aria-label="减小代码字号"
        >
          <Minus className="size-3.5" />
        </button>
        <output
          aria-label="当前代码字号"
          aria-live="polite"
          className="w-12 text-center text-xs font-semibold tabular-nums"
        >
          {fontSize} px
        </output>
        <button
          type="button"
          className={button}
          onClick={() => setFontSize(fontSize + 1)}
          disabled={fontSize >= MAX_CODE_SIZE}
          aria-label="增大代码字号"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <button
        type="button"
        className={`${button} size-9 bg-muted`}
        onClick={toggleTheme}
        aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
        title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
      >
        {theme === 'light' ? (
          <Moon className="size-4" />
        ) : (
          <Sun className="size-4" />
        )}
      </button>
      {storageError && (
        <span role="status" className="max-w-28 text-[10px] text-destructive">
          浏览器禁止保存，设置仅本次有效
        </span>
      )}
    </div>
  );
}
