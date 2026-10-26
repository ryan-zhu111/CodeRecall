import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type SolutionField = 'approach' | 'referenceCode';
type Overrides = Record<string, Partial<Record<SolutionField, string>>>;
const STORAGE_KEY = 'acm-quick-drill:solutions-v1';

function readOverrides(raw: string | null): Overrides {
  if (raw === null) return {};
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 1 ||
    !data.problems ||
    typeof data.problems !== 'object' ||
    Array.isArray(data.problems)
  )
    throw new Error('自定义题解格式不正确');
  const result: Overrides = {};
  for (const [id, value] of Object.entries(data.problems)) {
    if (
      !/^(lc|mm)-[a-z0-9-]+$/.test(id) ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      throw new Error('自定义题解格式不正确');
    const item: Partial<Record<SolutionField, string>> = {};
    for (const [field, content] of Object.entries(value)) {
      if (
        (field !== 'approach' && field !== 'referenceCode') ||
        typeof content !== 'string'
      )
        throw new Error('自定义题解格式不正确');
      item[field] = content;
    }
    result[id] = item;
  }
  return result;
}

type Solutions = {
  overrides: Overrides;
  ready: boolean;
  save: (
    id: string,
    field: SolutionField,
    value: string | undefined,
    expected: string | undefined,
  ) => string | null;
};
const Context = createContext<Solutions | null>(null);

export function SolutionProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const read = () => {
      try {
        setOverrides(readOverrides(localStorage.getItem(STORAGE_KEY)));
        setError('');
      } catch {
        setError(
          '自定义题解无法读取，原数据已保留。请检查浏览器存储权限；当前显示上次读取的内容或内置版本。',
        );
      } finally {
        setReady(true);
      }
    };
    read();
    const sync = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === STORAGE_KEY || event.key === null)
      )
        read();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const save = useCallback<Solutions['save']>((id, field, value, expected) => {
    try {
      // Merge with the latest storage so editing one question cannot erase another.
      const latest = readOverrides(localStorage.getItem(STORAGE_KEY));
      if (latest[id]?.[field] !== expected) {
        setOverrides(latest);
        return '这项内容已在其他页面修改。你的编辑仍在，请先复制保留，再取消编辑并重新打开最新版本。';
      }
      const item = { ...latest[id] };
      if (value === undefined) delete item[field];
      else item[field] = value;
      if (Object.keys(item).length) latest[id] = item;
      else delete latest[id];
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, problems: latest }),
      );
      setOverrides(latest);
      setError('');
      return null;
    } catch {
      return '保存失败，编辑内容仍在。请检查浏览器存储权限和剩余空间后重试。';
    }
  }, []);

  return (
    <Context.Provider value={{ overrides, ready, save }}>
      {error && (
        <p
          role="alert"
          className="border-b bg-background px-5 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {children}
    </Context.Provider>
  );
}

export function useSolutions() {
  const context = useContext(Context);
  if (!context) throw new Error('SolutionProvider is required');
  return context;
}
