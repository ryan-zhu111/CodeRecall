import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Code2,
  Dice5,
  Eye,
  EyeOff,
  FileInput,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  TerminalSquare,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  draftKey,
  getEditorCode,
  getReference,
  migrateDrafts,
  type EditorDraft,
  type EditorDrafts,
} from '@/lib/editor-state';

import { MemoryMode } from '@/components/memory-mode';
import { AppearanceControls } from '@/components/appearance-settings';
import { BrandMark } from '@/components/brand-mark';
import {
  SOLVED_KEY,
  DRAFTS_KEY,
  VERSIONED_DRAFTS_KEY,
  LEARNING_RESET_KEY,
  learningGeneration,
  isCurrentLearning,
  resetLearningProgress,
} from '@/lib/learning-storage';

const PythonEditor = lazy(() =>
  import('@/components/python-editor').then((m) => ({
    default: m.PythonEditor,
  })),
);
const PythonCodeBlock = lazy(() =>
  import('@/components/python-code-block').then((m) => ({
    default: m.PythonCodeBlock,
  })),
);

type Normalizer = 'trim' | 'sort-lines' | 'sort-numbers';
type Track = 'leetcode' | 'multimodal';
type JudgeMode = 'sample' | 'structure';

type Problem = {
  id: string;
  sequence: number;
  trackSequence?: number;
  lc: number | null;
  track: Track;
  runtime: 'python' | 'pytorch';
  judgeMode: JudgeMode;
  title: string;
  category: string;
  tags: string[];
  statement: string[];
  approach: string;
  inputContract: string;
  complexity: string;
  referenceCode: string;
  starterCode: string;
  inputStarterCode?: string;
  sampleInput: string;
  expectedOutput: string;
  normalizer: Normalizer;
  requiredSymbols?: string[];
  runtimeHint?: string;
};

type ProblemPayload = {
  version: number;
  title: string;
  prelude: string;
  answerEdition?: string;
  answerConventions?: string[];
  collections?: Array<{ id: Track; label: string; count: number }>;
  problems: Problem[];
};

type WorkerResult = {
  id: number;
  stdout: string;
  stderr: string;
  error?: string;
  accepted?: boolean;
};

type ConsoleState = {
  status: 'idle' | 'running' | 'accepted' | 'wrong' | 'error';
  title: string;
  output: string;
  expected?: string;
  duration?: number;
};

const EMPTY_PROBLEMS: Problem[] = [];
function problemLabel(problem: Problem) {
  return problem.track === 'multimodal'
    ? `MM ${String(problem.trackSequence ?? problem.sequence - 50).padStart(2, '0')}`
    : `LC ${problem.lc}`;
}

function isProblemSolved(solved: Set<string>, problem: Problem) {
  return solved.has(problem.id);
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code
        key={`${part}-${index}`}
        className="mx-0.5 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeOutput(value: string, mode: Normalizer) {
  const clean = value.replace(/\r\n/g, '\n').trim();
  if (mode === 'sort-lines') {
    return clean
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .sort()
      .join('\n');
  }
  if (mode === 'sort-numbers') {
    return clean
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b)
      .join(' ');
  }
  return clean
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

export default function Home() {
  const [payload, setPayload] = useState<ProblemPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [trackFilter, setTrackFilter] = useState<'all' | Track>('all');
  const [category, setCategory] = useState('全部分类');
  const [statusFilter, setStatusFilter] = useState('全部状态');
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<EditorDrafts>({});
  const [storageReady, setStorageReady] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [showStatement, setShowStatement] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [memoryMode, setMemoryMode] = useState(true);
  const [consoleState, setConsoleState] = useState<ConsoleState>({
    status: 'idle',
    title: '准备就绪',
    output: '点击“运行样例”后，结果会显示在这里。首次运行会加载 Python 环境。',
  });

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const generationRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);
  const reloadAfterReset = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    runIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    // Remount both learning views, discard pending work and return to the dashboard.
    window.location.reload();
  }, []);
  const learningIsCurrent = useCallback(() => {
    if (reloadingRef.current || generationRef.current === null) return false;
    if (!isCurrentLearning(localStorage, generationRef.current)) {
      reloadAfterReset();
      return false;
    }
    return true;
  }, [reloadAfterReset]);

  function resetLearning() {
    try {
      resetLearningProgress(localStorage);
      reloadAfterReset();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '重置失败，请稍后重试。';
    }
  }

  useEffect(() => {
    try {
      generationRef.current = learningGeneration(localStorage);
    } catch {
      /* Storage unavailable. */
    }
    const syncReset = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        event.key === LEARNING_RESET_KEY &&
        event.newValue !== generationRef.current
      )
        reloadAfterReset();
    };
    window.addEventListener('storage', syncReset);
    queueMicrotask(() => {
      const stored = safeRead<Array<string | number>>(SOLVED_KEY, []);
      setSolved(
        new Set(
          stored.map((value) =>
            typeof value === 'number' || /^\d+$/.test(value)
              ? `lc-${value}`
              : value,
          ),
        ),
      );
      setDrafts(safeRead<EditorDrafts>(VERSIONED_DRAFTS_KEY, {}));
      setStorageReady(true);
    });
    fetch(`${import.meta.env.BASE_URL}problems.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`题库加载失败：${response.status}`);
        return response.json() as Promise<ProblemPayload>;
      })
      .then((data) => {
        setDrafts((current) =>
          migrateDrafts(
            data.problems,
            safeRead<Record<string, string>>(DRAFTS_KEY, {}),
            current,
          ),
        );
        setPayload(data);
        setSelectedId(data.problems[0]?.id ?? null);
        setCustomInput(data.problems[0]?.sampleInput ?? '');
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : '题库加载失败'),
      );

    return () => {
      window.removeEventListener('storage', syncReset);
      workerRef.current?.terminate();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !learningIsCurrent()) return;
    window.localStorage.setItem(SOLVED_KEY, JSON.stringify([...solved]));
  }, [solved, storageReady, learningIsCurrent]);

  useEffect(() => {
    if (!storageReady || !learningIsCurrent()) return;
    window.localStorage.setItem(VERSIONED_DRAFTS_KEY, JSON.stringify(drafts));
  }, [drafts, storageReady, learningIsCurrent]);

  const problems = payload?.problems ?? EMPTY_PROBLEMS;
  const leetcodeCount = problems.filter(
    (problem) => problem.track === 'leetcode',
  ).length;
  const multimodalCount = problems.length - leetcodeCount;
  const selected =
    problems.find((problem) => problem.id === selectedId) ?? null;
  const referenceCode = selected ? getReference(selected) : '';
  const editorDraft = selected ? drafts[draftKey(selected.id)] : undefined;
  const selectedIndex = selected
    ? problems.findIndex((problem) => problem.id === selected.id)
    : -1;
  const code = selected ? getEditorCode(selected, editorDraft) : '';
  const categories = useMemo(
    () => [
      '全部分类',
      ...Array.from(
        new Set(
          problems
            .filter(
              (problem) =>
                trackFilter === 'all' || problem.track === trackFilter,
            )
            .map((problem) => problem.category),
        ),
      ),
    ],
    [problems, trackFilter],
  );

  const filteredProblems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return problems.filter((problem) => {
      const matchesQuery =
        !needle ||
        problem.title.toLowerCase().includes(needle) ||
        problemLabel(problem).toLowerCase().includes(needle) ||
        problem.tags.some((tag) => tag.toLowerCase().includes(needle));
      const matchesTrack =
        trackFilter === 'all' || problem.track === trackFilter;
      const matchesCategory =
        category === '全部分类' || problem.category === category;
      const isSolved = isProblemSolved(solved, problem);
      const matchesStatus =
        statusFilter === '全部状态' ||
        (statusFilter === '已完成' && isSolved) ||
        (statusFilter === '未完成' && !isSolved);
      return matchesQuery && matchesTrack && matchesCategory && matchesStatus;
    });
  }, [category, problems, query, solved, statusFilter, trackFilter]);

  const solvedCount = problems.filter((problem) =>
    isProblemSolved(solved, problem),
  ).length;
  const progress = problems.length
    ? Math.round((solvedCount / problems.length) * 100)
    : 0;

  const cancelRun = useCallback(() => {
    runIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const selectProblem = useCallback(
    (problem: Problem) => {
      cancelRun();
      setSelectedId(problem.id);
      setCustomInput(problem.sampleInput);
      setShowStatement(true);
      setShowReference(false);
      setConsoleState({
        status: 'idle',
        title: '准备就绪',
        output: '代码草稿和完成进度会自动保存在当前浏览器。',
      });
    },
    [cancelRun],
  );

  const updateCode = (value: string) => {
    if (!selected || !learningIsCurrent()) return;
    if (consoleState.status === 'running') {
      cancelRun();
      setConsoleState({
        status: 'idle',
        title: '代码已修改',
        output: '请重新运行。',
      });
    }
    setDrafts((current) => ({
      ...current,
      [draftKey(selected.id)]: { kind: 'draft', code: value },
    }));
  };

  const loadEditor = (kind: EditorDraft['kind']) => {
    if (!selected || kind === 'draft' || !learningIsCurrent()) return;
    cancelRun();
    setConsoleState({
      status: 'idle',
      title: '模板已载入',
      output: '请完成代码后运行。',
    });
    setDrafts((current) => ({ ...current, [draftKey(selected.id)]: { kind } }));
  };

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        `${import.meta.env.BASE_URL}python-worker.js`,
      );
    }
    return workerRef.current;
  }, []);

  const runCode = useCallback(
    (judgeSample: boolean) => {
      if (!selected || !payload || !learningIsCurrent()) return;
      const structureMode = selected.judgeMode === 'structure';
      const runId = ++runIdRef.current;
      const worker = ensureWorker();
      const input = judgeSample ? selected.sampleInput : customInput;
      startedAtRef.current = performance.now();
      setConsoleState({
        status: 'running',
        title: structureMode
          ? '正在检查 PyTorch 代码结构'
          : judgeSample
            ? '正在评测样例'
            : '正在运行自定义输入',
        output: structureMode
          ? '正在检查 Python 语法和题目要求的函数 / 类接口…'
          : '正在浏览器中执行 Python…首次运行可能需要数秒。',
        expected:
          !structureMode && judgeSample ? selected.expectedOutput : undefined,
      });

      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (!learningIsCurrent()) return;
        if (event.data.id !== runId || runIdRef.current !== runId) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        const duration = Math.round(performance.now() - startedAtRef.current);
        const { stdout, stderr, error } = event.data;

        if (error || stderr) {
          setConsoleState({
            status: 'error',
            title: '运行出错',
            output: [stderr, error].filter(Boolean).join('\n') || '未知错误',
            duration,
          });
          return;
        }

        if (structureMode) {
          const accepted = event.data.accepted === true;
          setConsoleState({
            status: accepted ? 'accepted' : 'wrong',
            title: accepted ? '结构检查通过' : '接口尚未完成',
            output:
              stdout ||
              (accepted
                ? '语法与接口检查通过。'
                : '请完成题目要求的函数或类后再次检查。'),
            duration,
          });
          if (accepted) {
            setSolved((current) => new Set(current).add(selected.id));
          }
          return;
        }

        if (!judgeSample) {
          setConsoleState({
            status: 'idle',
            title: '运行完成',
            output: stdout || '（程序没有输出）',
            duration,
          });
          return;
        }

        const accepted =
          normalizeOutput(stdout, selected.normalizer) ===
          normalizeOutput(selected.expectedOutput, selected.normalizer);
        setConsoleState({
          status: accepted ? 'accepted' : 'wrong',
          title: accepted ? 'Accepted · 样例通过' : 'Wrong Answer · 输出不一致',
          output: stdout || '（程序没有输出）',
          expected: selected.expectedOutput,
          duration,
        });
        if (accepted) {
          setSolved((current) => new Set(current).add(selected.id));
        }
      };

      worker.postMessage({
        id: runId,
        mode: structureMode ? 'structure' : 'execute',
        code: structureMode ? code : `${payload.prelude}\n\n${code}`,
        stdin: input,
        requiredSymbols: selected.requiredSymbols ?? [],
      });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (runIdRef.current !== runId) return;
        worker.terminate();
        workerRef.current = null;
        setConsoleState({
          status: 'error',
          title: '运行超时',
          output: '程序运行超过 20 秒，已自动停止。请检查是否存在死循环。',
        });
      }, 20_000);
    },
    [code, customInput, ensureWorker, payload, selected, learningIsCurrent],
  );

  const move = (offset: number) => {
    if (!problems.length || selectedIndex < 0) return;
    const next =
      problems[(selectedIndex + offset + problems.length) % problems.length];
    selectProblem(next);
  };

  const pickRandom = () => {
    if (!problems.length) return;
    const visiblePool =
      trackFilter === 'all'
        ? problems
        : problems.filter((problem) => problem.track === trackFilter);
    const unsolved = visiblePool.filter(
      (problem) => !isProblemSolved(solved, problem),
    );
    const pool = unsolved.length ? unsolved : visiblePool;
    const next = pool[Math.floor(Math.random() * pool.length)];
    selectProblem(next);
  };

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <section className="max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
          <TerminalSquare className="mx-auto mb-4 size-10 text-destructive" />
          <h1 className="text-xl font-semibold">题库没有加载成功</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
        </section>
      </main>
    );
  }

  if (!payload || !selected) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          正在载入题库…
        </div>
      </main>
    );
  }

  if (memoryMode)
    return (
      <MemoryMode
        payload={payload}
        onExit={() => setMemoryMode(false)}
        onReset={resetLearning}
      />
    );

  return (
    <main className="study-workspace min-h-screen text-foreground">
      <header className="site-header text-foreground">
        <div className="mx-auto flex min-h-16 max-w-[1800px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="size-8 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight">
                  CodeRecall · 码上记
                </h1>
              </div>
              <p className="text-[11px] text-muted-foreground">
                把代码写进长期记忆。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AppearanceControls compact />
            <Button
              className="rounded-full px-4"
              onClick={() => {
                cancelRun();
                setConsoleState({
                  status: 'idle',
                  title: '准备就绪',
                  output: '草稿已保留，可继续运行。',
                });
                setMemoryMode(true);
              }}
            >
              <BookOpen className="size-4" />
              记忆模式
            </Button>
            <div className="hidden w-32 2xl:block">
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>学习进度</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  {solvedCount}/{problems.length}
                </span>
              </div>
              <Progress
                value={progress}
                aria-label={`已完成 ${progress}%`}
                className="[&_[data-slot=progress-track]]:bg-muted [&_[data-slot=progress-indicator]]:bg-primary"
              />
            </div>
            <Button
              variant="outline"
              className="border-border bg-muted text-foreground hover:bg-muted hover:text-foreground"
              onClick={pickRandom}
              aria-label="随机一题"
              title="随机一题"
            >
              <Dice5 />
              <span className="hidden sm:inline">随机一题</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1800px] grid-cols-1 items-start gap-4 p-3 lg:p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] xl:grid-cols-[224px_minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <aside className="hidden h-[calc(100vh-7rem)] overflow-hidden xl:block">
          <div className="border-b p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索题目 / LC / MM"
                className="h-9 bg-background pl-9"
              />
            </div>
            <NativeSelect
              value={trackFilter}
              onChange={(event) => {
                const nextTrack = event.target.value as 'all' | Track;
                setTrackFilter(nextTrack);
                setCategory('全部分类');
                if (nextTrack !== 'all' && selected.track !== nextTrack) {
                  const firstProblem = problems.find(
                    (problem) => problem.track === nextTrack,
                  );
                  if (firstProblem) selectProblem(firstProblem);
                }
              }}
              className="mt-2 w-full"
              size="sm"
              aria-label="按题库筛选"
            >
              <NativeSelectOption value="all">
                全部题库 · {problems.length}
              </NativeSelectOption>
              <NativeSelectOption value="leetcode">
                LeetCode Hot 100 · {leetcodeCount}
              </NativeSelectOption>
              <NativeSelectOption value="multimodal">
                多模态手撕 · {multimodalCount}
              </NativeSelectOption>
            </NativeSelect>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NativeSelect
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="w-full"
                size="sm"
                aria-label="按分类筛选"
              >
                {categories.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full"
                size="sm"
                aria-label="按状态筛选"
              >
                {['全部状态', '未完成', '已完成'].map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {item}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
            <span>{filteredProblems.length} 道题</span>
            <span>{progress}% 完成</span>
          </div>

          <ScrollArea className="h-[calc(100vh-17rem)]">
            <nav className="p-2" aria-label="题目列表">
              {filteredProblems.map((problem) => {
                const active = problem.id === selected.id;
                const done = isProblemSolved(solved, problem);
                return (
                  <button
                    key={problem.id}
                    type="button"
                    onClick={() => selectProblem(problem)}
                    className={`group mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground '
                        : 'hover:bg-muted'
                    }`}
                  >
                    {done ? (
                      <CheckCircle2
                        className={`size-4 shrink-0 ${active ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400'}`}
                      />
                    ) : (
                      <Circle
                        className={`size-4 shrink-0 ${active ? 'text-primary/50' : 'text-muted-foreground/45'}`}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {problem.title}
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-[11px] ${active ? 'text-muted-foreground' : 'text-muted-foreground'}`}
                      >
                        {problemLabel(problem)} · {problem.category}
                      </span>
                    </span>
                    <ChevronRight
                      className={`size-4 shrink-0 ${active ? 'opacity-80' : 'opacity-0 group-hover:opacity-40'}`}
                    />
                  </button>
                );
              })}
              {!filteredProblems.length && (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                  没有符合条件的题目
                </p>
              )}
            </nav>
          </ScrollArea>
        </aside>

        <section className="min-w-0 rounded-2xl bg-card xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
          <div className="border-b p-4 xl:hidden">
            <NativeSelect
              value={selected.id}
              onChange={(event) => {
                const problem = problems.find(
                  (p) => p.id === event.target.value,
                );
                if (problem) selectProblem(problem);
              }}
              className="w-full"
              aria-label="选择题目"
            >
              {problems.map((problem) => (
                <NativeSelectOption key={problem.id} value={problem.id}>
                  {problemLabel(problem)} · {problem.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <article className="p-5 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {problemLabel(selected)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {selected.track === 'multimodal'
                      ? '多模态手撕'
                      : 'LeetCode'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {selected.category}
                  </span>
                  {isProblemSolved(solved, selected) && (
                    <Badge className="gap-1 bg-primary text-primary-foreground">
                      <Check className="size-3" /> 已完成
                    </Badge>
                  )}
                </div>
                <h2 className="text-xl font-semibold leading-snug tracking-tight md:text-2xl">
                  <span className="mr-2 font-mono text-base font-medium text-muted-foreground">
                    {String(selected.sequence).padStart(2, '0')}
                  </span>
                  {selected.title}
                </h2>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(-1)}
                  aria-label="上一题"
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(1)}
                  aria-label="下一题"
                >
                  <ArrowRight />
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <section className="overflow-hidden border-b">
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-between rounded-none px-0 py-3.5 hover:bg-muted/60"
                  onClick={() => setShowStatement((value) => !value)}
                  aria-expanded={showStatement}
                  aria-controls="problem-statement"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <BookOpen className="size-4 text-primary" />
                    题目描述
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    {showStatement ? '收起' : '展开'}
                    {showStatement ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </span>
                </Button>
                {showStatement && (
                  <div
                    id="problem-statement"
                    className="space-y-4 pb-6 text-[15px] leading-7 text-foreground/85"
                  >
                    {selected.statement.map((paragraph, index) => (
                      <p key={`${selected.id}-statement-${index}`}>
                        {renderInlineCode(paragraph)}
                      </p>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  核心思路
                </div>
                <p className="text-[15px] leading-7 text-foreground/85">
                  {selected.approach}
                </p>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="py-2">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <FileInput className="size-4" />
                    {selected.track === 'multimodal'
                      ? '张量 Shape'
                      : '输入约定'}
                  </div>
                  <p className="text-sm leading-6">{selected.inputContract}</p>
                </div>
                <div className="py-2">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    {selected.track === 'multimodal'
                      ? '复杂度 / 关键点'
                      : '复杂度'}
                  </div>
                  <p className="font-mono text-sm leading-6">
                    {selected.complexity}
                  </p>
                </div>
              </section>

              {selected.judgeMode === 'sample' ? (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="size-4 text-primary" />
                      代表样例
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      通过样例后自动标记完成
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl bg-muted text-foreground">
                    <div className="grid sm:grid-cols-2">
                      <div className="border-b border-border p-4 sm:border-b-0 sm:border-r">
                        <div className="mb-2 text-xs text-muted-foreground">
                          输入
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-[13px] leading-6">
                          {selected.sampleInput.trimEnd()}
                        </pre>
                      </div>
                      <div className="p-4">
                        <div className="mb-2 text-xs text-muted-foreground">
                          预期输出
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-[13px] leading-6 text-emerald-700 dark:text-emerald-400">
                          {selected.expectedOutput}
                        </pre>
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="size-4 text-muted-foreground" />
                      网页检查范围
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      通过结构检查后自动标记完成
                    </span>
                  </div>
                  <div className="rounded-xl bg-muted p-4 text-sm leading-6 text-foreground/85">
                    <p>
                      <span className="font-semibold">检查内容：</span>Python
                      语法、必需函数 / 类接口、未完成占位符。
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">必需接口：</span>
                      <span className="font-mono">
                        {selected.requiredSymbols?.join('、')}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.runtimeHint}
                    </p>
                  </div>
                </section>
              )}

              <section>
                <div className="mb-4 border-t pt-5">
                  <p className="text-xs font-semibold">精简注释版 · main</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    统一模板与变量命名，主要变量配有中文注释。
                  </p>
                  <details className="mt-2 text-xs leading-5 text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">
                      统一命名与模板约定
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {payload?.answerConventions?.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  </details>
                </div>
                <Button
                  variant="ghost"
                  className="h-11 w-full justify-between rounded-xl bg-muted"
                  onClick={() => setShowReference((value) => !value)}
                >
                  <span className="flex items-center gap-2">
                    {showReference ? <EyeOff /> : <Eye />}参考题解
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    卡住时再看
                  </span>
                </Button>
                {showReference && (
                  <div className="mt-3 overflow-hidden rounded-xl border bg-muted/50">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                      <span className="text-xs text-muted-foreground">
                        {payload?.answerEdition ?? '精简注释版'}
                      </span>
                      <Button
                        size="sm"
                        className="rounded-full px-4"
                        onClick={() => loadEditor('reference')}
                      >
                        载入编辑器
                      </Button>
                    </div>
                    <Suspense
                      fallback={
                        <p className="p-4 text-sm text-muted-foreground">
                          正在加载题解…
                        </p>
                      }
                    >
                      <PythonCodeBlock
                        code={referenceCode}
                        className="max-h-[520px] p-4"
                      />
                    </Suspense>
                  </div>
                )}
              </section>
            </div>
          </article>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border bg-card text-foreground xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
          <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground/85">
              <Code2 className="size-4 text-muted-foreground" />
              {selected.track === 'multimodal'
                ? 'PyTorch · 手撕模式'
                : 'Python 3 · ACM 模式'}
              <span className="text-[11px] text-muted-foreground">
                精简注释版 ·{' '}
                {editorDraft?.kind === 'reference'
                  ? '题解'
                  : editorDraft?.kind === 'draft'
                    ? '草稿'
                    : editorDraft?.kind === 'input'
                      ? '输入已处理'
                      : '空白模板'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                id="editor-shortcuts"
                className="hidden text-[11px] text-muted-foreground md:inline"
              >
                Python 高亮 · 自动缩进 · Ctrl + Space 补全
              </span>
              {selected.inputStarterCode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-primary hover:bg-accent"
                  aria-pressed={editorDraft?.kind === 'input'}
                  title="载入统一变量命名的输入代码，保留解题部分待填写"
                  onClick={() => loadEditor('input')}
                >
                  <FileInput className="size-3.5" /> 输入已处理模板
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground/85 hover:bg-muted hover:text-foreground"
                onClick={() => loadEditor('starter')}
              >
                <RotateCcw />
                重置
              </Button>
              <Button
                size="sm"
                className="rounded-full px-4"
                disabled={consoleState.status === 'running'}
                onClick={() => runCode(true)}
              >
                {consoleState.status === 'running' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Play />
                )}
                {selected.judgeMode === 'structure' ? '检查结构' : '运行样例'}
              </Button>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="grid h-[480px] place-items-center text-sm text-muted-foreground">
                正在加载编辑器…
              </div>
            }
          >
            <PythonEditor
              value={code}
              onChange={updateCode}
              onRun={() => runCode(true)}
              attemptId={`practice-${selected.id}`}
              label={
                selected.track === 'multimodal'
                  ? 'PyTorch 代码编辑器'
                  : 'Python 代码编辑器'
              }
              describedBy="editor-shortcuts"
              testId="practice-python-editor"
              className="h-[520px] min-h-[320px] xl:h-[58vh]"
            />
          </Suspense>

          <div className="border-t border-border bg-muted/50">
            <div className="grid lg:grid-cols-2">
              <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                {selected.judgeMode === 'sample' ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <label
                        htmlFor="custom-input"
                        className="text-xs font-medium text-foreground/85"
                      >
                        自定义输入
                      </label>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setCustomInput(selected.sampleInput)}
                      >
                        恢复样例
                      </Button>
                    </div>
                    <Textarea
                      id="custom-input"
                      value={customInput}
                      onChange={(event) => setCustomInput(event.target.value)}
                      spellCheck={false}
                      className="min-h-28 resize-y border-border bg-card font-mono text-xs leading-5 text-foreground focus-visible:ring-ring/30"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 border-border bg-muted text-foreground hover:bg-muted hover:text-foreground"
                      disabled={consoleState.status === 'running'}
                      onClick={() => runCode(false)}
                    >
                      <TerminalSquare />
                      仅运行
                    </Button>
                  </>
                ) : (
                  <div className="min-h-40 rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                      <TerminalSquare className="size-4 text-muted-foreground" />
                      检查规则
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      网页端只检查语法、必需接口和未完成占位符，不执行
                      torch。数值、梯度与 shape 验证请在本地 PyTorch 环境完成。
                    </p>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      必需接口
                    </p>
                    <p className="mt-1 font-mono text-xs text-foreground">
                      {selected.requiredSymbols?.join(' · ')}
                    </p>
                  </div>
                )}
              </div>

              <div className="min-w-0 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div
                    className={`flex items-center gap-2 text-xs font-semibold ${
                      consoleState.status === 'accepted'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : consoleState.status === 'wrong' ||
                            consoleState.status === 'error'
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-foreground/85'
                    }`}
                  >
                    {consoleState.status === 'accepted' && (
                      <CheckCircle2 className="size-4" />
                    )}
                    {consoleState.status === 'running' && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    {consoleState.title}
                  </div>
                  {consoleState.duration !== undefined && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {consoleState.duration} ms
                    </span>
                  )}
                </div>
                <pre className="min-h-24 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-mono text-xs leading-5 text-foreground">
                  {consoleState.output}
                </pre>
                {consoleState.expected !== undefined &&
                  consoleState.status !== 'accepted' && (
                    <div className="mt-3">
                      <div className="mb-1 text-xs text-muted-foreground">
                        预期输出
                      </div>
                      <pre className="overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 font-mono text-xs leading-5 text-emerald-700 dark:text-emerald-400">
                        {consoleState.expected}
                      </pre>
                    </div>
                  )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
