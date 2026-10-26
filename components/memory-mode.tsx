import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileInput,
  LoaderCircle,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Upload,
} from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AppearanceControls } from '@/components/appearance-settings';
import { ResetLearningDialog } from '@/components/reset-learning-dialog';
import { HelperCodeDialog } from '@/components/helper-code-dialog';
import { AddSessionQuestions } from '@/components/add-session-questions';
import {
  scopeLabels,
  problemsInScope,
  type ProblemScope,
} from '@/lib/problem-collections';
import { SolutionContent } from '@/components/solution-content';
import { useSolutions } from '@/components/solution-overrides';
import { learningGeneration, isCurrentLearning } from '@/lib/learning-storage';
import {
  MEMORY_KEY,
  Rating,
  acceptAttempt,
  addSessionProblems,
  availableSessionProblems,
  dayKey,
  dueIds,
  editAttempt,
  emptyMemory,
  finishAttempt,
  intervalLabel,
  isAttemptPassed,
  parseMemory,
  previewGrades,
  revealHint,
  startSession,
  skipAttempt,
  sessionPool,
  type Grade,
  type MemoryProblem,
  type MemoryStore,
} from '@/lib/memory';

const PythonEditor = lazy(() =>
  import('@/components/python-editor').then((module) => ({
    default: module.PythonEditor,
  })),
);

const PythonCodeBlock = lazy(() =>
  import('@/components/python-code-block').then((module) => ({
    default: module.PythonCodeBlock,
  })),
);

type Case = { input: string; expected: string };
type Result = {
  status: 'idle' | 'running' | 'accepted' | 'wrong' | 'error';
  text: string;
};
const idle: Result = {
  status: 'idle',
  text: '从空白开始默写。输入模板和编辑辅助不算提示；通过本题检查后，按真实回忆情况评分。',
};
const grades: Array<{
  grade: Grade;
  title: string;
  detail: string;
  style: string;
}> = [
  {
    grade: Rating.Again,
    title: '需要重学',
    detail: '忘记了 / 需要帮助',
    style:
      'border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400 dark:border-rose-900 dark:bg-rose-950/35 dark:text-rose-200 dark:hover:border-rose-700',
  },
  {
    grade: Rating.Hard,
    title: '困难',
    detail: '独立完成，但回忆费力',
    style:
      'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-200 dark:hover:border-amber-700',
  },
  {
    grade: Rating.Good,
    title: '记得',
    detail: '独立、正常完成',
    style:
      'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-200 dark:hover:border-emerald-700',
  },
  {
    grade: Rating.Easy,
    title: '轻松',
    detail: '独立、熟练完成',
    style:
      'border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-400 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-200 dark:hover:border-sky-700',
  },
];
const memoryLabel = (p: MemoryProblem) =>
  p.track === 'multimodal'
    ? `MM${String(p.trackSequence ?? Number(p.id.slice(3)) - 50).padStart(2, '0')}`
    : `LC${p.lc}`;

const dateLabel = (s: string) =>
  new Date(s).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function StatementText({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code
        key={index}
        className="rounded bg-muted px-1 py-0.5 font-mono text-[.94em] font-semibold text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export function MemoryMode({
  payload,
  onExit,
  onReset,
}: {
  payload: { problems: MemoryProblem[]; prelude: string };
  onExit: () => void;
  onReset: () => string | null;
}) {
  const { overrides } = useSolutions();
  const problems = useMemo(
    () => payload.problems.map((p) => ({ ...p, ...overrides[p.id] })),
    [payload.problems, overrides],
  );
  const [studyTrack, setStudyTrack] = useState<ProblemScope>('all');
  const studyProblems = problemsInScope(problems, studyTrack);
  const [store, setStore] = useState<MemoryStore>(emptyMemory);
  const storeRef = useRef<MemoryStore | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [reviewAmount, setReviewAmount] = useState(0);
  const [newAmount, setNewAmount] = useState(1);
  const [tests, setTests] = useState<Record<string, Case[]> | null>(null);
  const [testError, setTestError] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [showApproach, setShowApproach] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [result, setResult] = useState<Result>(idle);
  const workerRef = useRef<Worker | null>(null);
  const runningRef = useRef(false);
  const runRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef<string | null>(null);
  const attempt = store.session?.attempt;
  const problem = problems.find((p) => p.id === attempt?.problemId);
  const defaultProblem = payload.problems.find(
    (p) => p.id === attempt?.problemId,
  );
  const due = dueIds(store, studyProblems, now);
  const fresh = studyProblems.filter((p) => !store.cards[p.id]);
  const today = store.reviews.filter(
    (r) => dayKey(new Date(r.at)) === dayKey(now),
  );
  const passed = isAttemptPassed(attempt);
  const structureMode = problem?.judgeMode === 'structure';
  const checksReady = studyTrack === 'multimodal' || !!tests;
  const preview = problem ? previewGrades(store, problem.id, now) : null;

  function stopRun() {
    runRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (runningRef.current) {
      workerRef.current?.terminate();
      workerRef.current = null;
    }
    runningRef.current = false;
  }
  function commit(change: (current: MemoryStore) => MemoryStore) {
    if (!storeRef.current) return false;
    try {
      if (
        generationRef.current === null ||
        !isCurrentLearning(localStorage, generationRef.current)
      ) {
        stopRun();
        return false;
      }
      const raw = localStorage.getItem(MEMORY_KEY);
      const latest = raw
        ? parseMemory(raw, new Set(problems.map((p) => p.id)))
        : emptyMemory();
      if (latest.revision !== storeRef.current.revision) {
        stopRun();
        storeRef.current = latest;
        setStore(latest);
        setActive(false);
        setError('另一标签页更新了学习记录，已同步最新进度。请重新继续本轮。');
        return false;
      }
      const next = change(storeRef.current);
      if (next === storeRef.current) return true;
      const saved = { ...next, revision: crypto.randomUUID() };
      localStorage.setItem(MEMORY_KEY, JSON.stringify(saved));
      storeRef.current = saved;
      setStore(saved);
      setNow(new Date());
      setError('');
      return true;
    } catch {
      setError(
        '学习记录未能保存，请检查浏览器存储空间。当前记录未被覆盖，可先导出备份后重试。',
      );
      return false;
    }
  }
  useEffect(() => {
    mountedRef.current = true;
    try {
      generationRef.current = learningGeneration(localStorage);
      const raw = localStorage.getItem(MEMORY_KEY);
      const saved = raw
        ? parseMemory(raw, new Set(problems.map((p) => p.id)))
        : emptyMemory();
      storeRef.current = saved;
      setStore(saved);
      setReviewAmount(Math.min(5, dueIds(saved, problems, new Date()).length));
      setReady(true);
    } catch {
      setError(
        '现有学习记录无法读取，已保留原数据。请先导出记录，或导入有效的学习记录。',
      );
    }
    fetch(`${import.meta.env.BASE_URL}review-tests.json`)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<{ problems: Record<string, Case[]> }>;
      })
      .then((data) => {
        if (
          !problems
            .filter((p) => p.track === 'leetcode')
            .every(
              (p) =>
                Array.isArray(data.problems?.[p.id]) &&
                data.problems[p.id].length >= 2,
            )
        )
          throw Error();
        if (mountedRef.current) setTests(data.problems);
      })
      .catch(() => {
        if (mountedRef.current)
          setTestError('测试集未能加载，请刷新页面重试。你的学习进度已保留。');
      });
    const tick = setInterval(() => setNow(new Date()), 30_000);
    const sync = (e: StorageEvent) => {
      if (e.key !== MEMORY_KEY) return;
      stopRun();
      setActive(false);
      setShowAnswer(false);
      setShowApproach(false);
      try {
        const saved = e.newValue
          ? parseMemory(e.newValue, new Set(problems.map((p) => p.id)))
          : emptyMemory();
        storeRef.current = saved;
        setStore(saved);
        setReady(true);
        setNotice('已同步另一标签页的学习记录。');
      } catch {
        setError('另一标签页的记录无法读取，请刷新后重试。');
        setReady(false);
      }
    };
    window.addEventListener('storage', sync);
    return () => {
      mountedRef.current = false;
      clearInterval(tick);
      window.removeEventListener('storage', sync);
      stopRun();
      workerRef.current?.terminate();
    };
    // Payload is immutable for this mounted learning view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stopRun();
    setShowAnswer(false);
    setShowApproach(false);
    setCustomInput(problem?.sampleInput ?? '');
    setResult(idle);
  }, [attempt?.id]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [active, attempt?.id]);

  function changeCode(
    code: string,
    kind: 'starter' | 'input' | 'draft' | 'reference' = 'draft',
  ) {
    stopRun();
    setResult(idle);
    commit((s) => editAttempt(s, code, kind));
  }
  function hint(kind: 'approach' | 'answer') {
    if (commit((s) => revealHint(s, kind, new Date()))) {
      if (kind === 'approach') setShowApproach(true);
      else setShowAnswer(true);
    }
  }
  function finish(grade: Grade) {
    stopRun();
    const ok = commit((s) => finishAttempt(s, grade, problems, new Date()));
    if (ok && !storeRef.current?.session?.attempt) {
      setActive(false);
      setNotice(
        '本轮完成。下一次从空白重新默写；到期题会继续出现在待复习列表中。',
      );
    }
  }
  function skip() {
    stopRun();
    const ok = commit((s) => skipAttempt(s, problems, new Date()));
    if (!ok) return;
    setResult(idle);
    const hasNext = !!storeRef.current?.session?.attempt;
    setActive(hasNext);
    setNotice(
      hasNext
        ? '已跳过本题，草稿已暂存，不新增评分。可通过“添加题目”重新加入；已有提示记录保留。'
        : '本轮已结束，草稿已暂存。可通过“添加题目”重新加入已跳过的题，或在下一轮学习。',
    );
  }

  function addQuestions(ids: string[]) {
    let count = 0;
    const ok = commit((current) => {
      const next = addSessionProblems(current, problems, ids, new Date());
      count =
        (next.session?.queue.length ?? 0) -
        (current.session?.queue.length ?? 0);
      return next;
    });
    if (!ok) return '未能加入本轮，请查看页面提示并重试。';
    if (!count) return '所选题目已不可添加，请关闭后重新选择。';
    setNotice(
      `已将 ${count} 道题追加到本轮末尾；重新加入的题已撤销跳过标记。已有评分和复习安排保留。`,
    );
    return null;
  }
  function run(allTests: boolean) {
    if (!problem || !attempt || (!structureMode && !tests)) return;
    stopRun();
    if (allTests && !commit((s) => editAttempt(s, attempt.code, attempt.kind)))
      return;
    const id = ++runRef.current,
      attemptId = attempt.id,
      code = attempt.code;
    const worker =
      workerRef.current ??
      new Worker(`${import.meta.env.BASE_URL}python-worker.js`);
    workerRef.current = worker;
    runningRef.current = true;
    setResult({
      status: 'running',
      text: structureMode
        ? '正在检查 Python 语法、必需接口和未完成占位符…'
        : allTests
          ? `正在运行 ${tests![problem.id].length} 组测试…首次运行会加载 Python 环境。`
          : '正在运行自定义输入…',
    });
    worker.onmessage = (event) => {
      if (event.data.id !== id || id !== runRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      runningRef.current = false;
      const data = event.data;
      if (data.error || data.stderr) {
        setResult({
          status: 'error',
          text: [data.error, data.stderr].filter(Boolean).join('\n'),
        });
        return;
      }
      if (structureMode) {
        if (data.accepted === true)
          commit((s) => acceptAttempt(s, attemptId, code, 0, 'structure'));
        setResult({
          status: data.accepted === true ? 'accepted' : 'wrong',
          text:
            (data.stdout || '结构检查未通过') +
            (data.accepted === true
              ? '\n结构检查不验证张量数值与 shape，请根据独立默写情况评分。'
              : ''),
        });
        return;
      }
      if (!allTests) {
        setResult({ status: 'idle', text: data.stdout || '（程序没有输出）' });
        return;
      }
      if (data.accepted === true) {
        commit((s) => acceptAttempt(s, attemptId, code, data.total));
        setResult({
          status: 'accepted',
          text: `通过本站全部 ${data.total} 组测试。${storeRef.current?.session?.attempt?.hints.length ? '本题已查看提示，仍记为需要重学。' : '请按真实回忆情况选择评分。'}`,
        });
      } else
        setResult({
          status: 'wrong',
          text: data.stdout || '测试未通过，请继续修改代码。',
        });
    };
    worker.onerror = () => {
      if (id !== runRef.current) return;
      stopRun();
      setResult({
        status: 'error',
        text: 'Python 环境加载失败，请检查网络后重试。',
      });
    };
    worker.postMessage({
      id,
      mode: structureMode ? 'structure' : allTests ? 'judge' : 'execute',
      code: structureMode ? code : `${payload.prelude}\n\n${code}`,
      stdin: customInput,
      cases: !structureMode && allTests ? tests![problem.id] : undefined,
      requiredSymbols: problem.requiredSymbols ?? [],
      problemId: problem.id,
      normalizer: problem.normalizer,
    });
    timerRef.current = setTimeout(() => {
      if (id !== runRef.current) return;
      stopRun();
      setResult({
        status: 'error',
        text: '运行超过 45 秒，已停止。首次加载较慢时可重试；也请检查死循环。',
      });
    }, 45_000);
  }
  function exportProgress() {
    const raw =
      localStorage.getItem(MEMORY_KEY) ?? JSON.stringify(emptyMemory());
    const url = URL.createObjectURL(
      new Blob([raw], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `coderecall-memory-${dayKey(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importProgress(file: File) {
    try {
      const generation = learningGeneration(localStorage);
      if (file.size > 20_000_000) throw Error('文件过大');
      const saved = parseMemory(
        await file.text(),
        new Set(problems.map((p) => p.id)),
      );
      if (!mountedRef.current || !isCurrentLearning(localStorage, generation))
        return;
      if (
        !window.confirm(
          `导入 ${Object.keys(saved.cards).length} 道题、${saved.reviews.length} 次复习记录？这会替换当前学习记录，建议先导出。`,
        )
      )
        return;
      if (!isCurrentLearning(localStorage, generation)) return;
      stopRun();
      saved.revision = crypto.randomUUID();
      localStorage.setItem(MEMORY_KEY, JSON.stringify(saved));
      storeRef.current = saved;
      setStore(saved);
      setReady(true);
      setActive(false);
      setError('');
      setNotice('学习记录已导入。');
    } catch (e) {
      setError(
        `无法导入：${e instanceof Error ? e.message : '文件格式不正确'}。现有记录未改动。`,
      );
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="site-header sticky top-0 z-30 border-b border-border text-foreground backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="size-8 shrink-0" />
            <h1 className="text-base font-semibold tracking-tight">
              CodeRecall · 码上记
            </h1>
            <span className="hidden border-l pl-3 text-xs text-muted-foreground sm:block">
              记忆模式
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AppearanceControls compact />
            <span
              className="mx-1 hidden h-5 w-px bg-border sm:block"
              aria-hidden="true"
            />
            {(attempt || !!store.session?.skipped?.length) && (
              <AddSessionQuestions
                problems={sessionPool(store, problems)}
                eligibleIds={availableSessionProblems(store, problems).map(
                  (p) => p.id,
                )}
                queuedIds={store.session?.queue ?? []}
                skippedIds={store.session?.skipped ?? []}
                resumeRound={!attempt}
                disabled={!ready}
                onAdd={addQuestions}
              />
            )}
            {active && (
              <Button
                size="sm"
                variant="ghost"
                onClick={skip}
                title="仅本轮跳过，暂存草稿，不新增评分"
              >
                <SkipForward className="size-4" />
                跳过本题
              </Button>
            )}
            {active && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                aria-label="保存并暂停"
                title="保存并暂停"
                onClick={() => {
                  stopRun();
                  setResult(idle);
                  setActive(false);
                }}
              >
                <Pause className="size-4" />
                <span className="hidden sm:inline">保存并暂停</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="rounded-full border-border bg-transparent px-4 text-foreground hover:bg-muted"
              onClick={() => {
                stopRun();
                onExit();
              }}
            >
              题库练习
            </Button>
          </div>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="mx-auto max-w-6xl border-b border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-800 dark:text-rose-200"
        >
          {error}
        </div>
      )}
      {testError && (
        <div
          role="alert"
          className="mx-auto max-w-6xl bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200"
        >
          {testError}
        </div>
      )}
      {!active || !attempt || !problem ? (
        <div className="mx-auto max-w-[1120px] px-5 pb-10 pt-12 md:px-8 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-[34px] font-semibold leading-[1.18] tracking-[-.035em] sm:text-[46px] lg:text-[56px]">
              把代码写进长期记忆。
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              今天练多少，由你决定。
              <span className="inline-block">先复习到期题，再学新题。</span>
            </p>
          </div>
          {notice && (
            <p
              role="status"
              className="mt-8 rounded-xl bg-accent p-4 text-sm text-accent-foreground"
            >
              {notice}
            </p>
          )}
          <div className="my-10 grid grid-cols-2 gap-x-6 gap-y-7 border-b pb-9 md:my-12 md:grid-cols-4 md:gap-x-10">
            {[
              {
                label: '现在待复习',
                value: due.length,
                sub: '逾期题会一直保留',
              },
              {
                label: '今日已练',
                value: new Set(today.map((r) => r.problemId)).size,
                sub: `共 ${today.length} 次复习记录`,
              },
              {
                label: '已开始学习',
                value: Object.keys(store.cards).length,
                sub: '独立于题库完成标记',
              },
              {
                label: '本轮范围待学',
                value: fresh.length,
                sub: `${scopeLabels[studyTrack]} · ${studyProblems.length} 题`,
              },
            ].map((x) => (
              <div key={x.label} className="text-center">
                <p className="text-xs text-muted-foreground">{x.label}</p>
                <p className="my-2 text-[32px] font-semibold leading-tight tracking-tight tabular-nums">
                  {x.value}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    题
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">{x.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid items-center gap-8 md:grid-cols-[1.15fr_1fr] md:gap-12 lg:gap-16">
            <section className="rounded-[24px] bg-muted p-6 sm:p-8">
              <h3 className="text-[22px] font-semibold tracking-tight">
                {attempt ? '继续未完成的这一轮' : '安排这一轮'}
              </h3>
              {attempt ? (
                <>
                  <p className="my-4 text-sm leading-7 text-muted-foreground">
                    已完成 {store.session!.index} /{' '}
                    {store.session!.queue.length} 题，当前为{' '}
                    {problem ? memoryLabel(problem) : ''} · {problem?.title}
                    。草稿、提示记录和已安排的复习时间都会保留。
                    {!!store.session?.skipped?.length &&
                      ` 本轮已跳过 ${store.session.skipped.length} 题，不计入完成数量。`}
                  </p>
                  <Button
                    className="h-11 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={!ready || (!structureMode && !tests)}
                    onClick={() => {
                      setActive(true);
                      setResult(idle);
                    }}
                  >
                    继续默写
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    不用固定打卡，也不用一次清空待复习题。
                  </p>
                  <label className="mt-5 block space-y-2 text-sm">
                    <span>本轮题库</span>
                    <select
                      aria-label="记忆题库范围"
                      value={studyTrack}
                      className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onChange={(event) => {
                        const track = event.target.value as typeof studyTrack;
                        setStudyTrack(track);
                        const pool = problemsInScope(problems, track);
                        setReviewAmount(
                          Math.min(5, dueIds(store, pool, new Date()).length),
                        );
                        setNewAmount(
                          Math.min(
                            1,
                            pool.filter((p) => !store.cards[p.id]).length,
                          ),
                        );
                      }}
                    >
                      {Object.entries(scopeLabels).map(([scope, label]) => (
                        <option key={scope} value={scope}>
                          {label} ·{' '}
                          {
                            problemsInScope(problems, scope as ProblemScope)
                              .length
                          }{' '}
                          题
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="my-6 grid grid-cols-2 gap-4">
                    <label className="space-y-2 text-sm">
                      <span>
                        复习到期题{' '}
                        <span className="text-xs text-muted-foreground">
                          / {due.length}
                        </span>
                      </span>
                      <Input
                        className="h-12 rounded-xl border-input bg-card"
                        aria-label="复习到期题数量"
                        type="number"
                        min={0}
                        max={due.length}
                        value={Math.min(reviewAmount, due.length)}
                        onChange={(e) =>
                          setReviewAmount(
                            Math.max(
                              0,
                              Math.min(
                                due.length,
                                Math.floor(Number(e.target.value) || 0),
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="space-y-2 text-sm">
                      <span>
                        学习新题{' '}
                        <span className="text-xs text-muted-foreground">
                          / {fresh.length}
                        </span>
                      </span>
                      <Input
                        className="h-12 rounded-xl border-input bg-card"
                        aria-label="学习新题数量"
                        type="number"
                        min={0}
                        max={fresh.length}
                        value={Math.min(newAmount, fresh.length)}
                        onChange={(e) =>
                          setNewAmount(
                            Math.max(
                              0,
                              Math.min(
                                fresh.length,
                                Math.floor(Number(e.target.value) || 0),
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div
                    className="mb-5 flex flex-wrap items-center gap-2"
                    aria-label="快速选择学习量"
                  >
                    <span className="mr-1 text-xs text-muted-foreground">
                      快速选择
                    </span>
                    {[5, 10, 20].map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-full border border-border px-3 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
                        aria-label={`快速选择 ${amount} 题，到期题优先`}
                        disabled={!ready || due.length + fresh.length === 0}
                        onClick={() => {
                          const reviews = Math.min(amount, due.length);
                          setReviewAmount(reviews);
                          setNewAmount(
                            Math.min(amount - reviews, fresh.length),
                          );
                        }}
                      >
                        {amount} 题
                      </Button>
                    ))}
                  </div>
                  <Button
                    className="h-11 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={
                      !ready ||
                      !checksReady ||
                      Math.min(reviewAmount, due.length) +
                        Math.min(newAmount, fresh.length) ===
                        0
                    }
                    onClick={() => {
                      if (
                        commit((s) =>
                          startSession(
                            s,
                            studyProblems,
                            reviewAmount,
                            newAmount,
                            new Date(),
                          ),
                        ) &&
                        storeRef.current?.session?.attempt
                      ) {
                        setActive(true);
                        setNotice('');
                      }
                    }}
                  >
                    {!checksReady && !testError ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        准备测试集
                      </>
                    ) : (
                      <>
                        开始这一轮 ·{' '}
                        {Math.min(reviewAmount, due.length) +
                          Math.min(newAmount, fresh.length)}{' '}
                        题
                      </>
                    )}
                  </Button>
                </>
              )}
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                在所选题库内，到期题优先，新题按题库顺序。未来到期的题不会提前塞进这一轮。
              </p>
            </section>
            <section className="px-1 text-foreground sm:px-3 md:px-0">
              <h3 className="mb-6 text-[22px] font-semibold tracking-tight">
                每次默写，都是一次回忆。
              </h3>
              <div className="space-y-6 text-sm leading-7">
                <p>
                  <span className="block font-semibold">从空白开始</span>
                  <span className="text-muted-foreground">
                    完整写出解法。输入已处理模板和编辑辅助都可以使用，不算提示。
                  </span>
                </p>
                <p>
                  <span className="block font-semibold">如实记录回忆</span>
                  <span className="text-muted-foreground">
                    独立通过检查后评分。查看核心思路或答案，会立即记为“需要重学”。
                  </span>
                </p>
                <p>
                  <span className="block font-semibold">在合适的时候复习</span>
                  <span className="text-muted-foreground">
                    FSRS
                    根据每次回忆安排下次复习。逾期题会保留，不清零，也不自动记为失败。
                  </span>
                </p>
              </div>
              <details className="mt-6 text-xs leading-6 text-muted-foreground">
                <summary className="w-fit cursor-pointer text-primary hover:underline">
                  了解复习间隔
                </summary>
                <p className="mt-2">
                  新题与重学题先安排 10
                  分钟的短期复习；之后根据真实回忆记录计算间隔。
                </p>
              </details>
            </section>
          </div>
          <section className="mt-12 overflow-hidden border-t bg-background md:mt-16">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-6">
              <h3 className="text-xl font-semibold tracking-tight">复习安排</h3>
              <span className="text-xs text-muted-foreground">
                {Object.keys(store.cards).length
                  ? '按下次复习时间排序'
                  : '完成第一题后，就会出现复习安排'}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {problems
                .filter((p) => store.cards[p.id])
                .sort(
                  (a, b) =>
                    Date.parse(store.cards[a.id].due) -
                    Date.parse(store.cards[b.id].due),
                )
                .map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b py-4 text-sm last:border-b-0"
                  >
                    <span>
                      <span className="mr-3 inline-block min-w-12 text-xs tabular-nums text-muted-foreground">
                        {memoryLabel(p)}
                      </span>
                      {p.title}
                    </span>
                    <span
                      className={`text-xs ${Date.parse(store.cards[p.id].due) <= now.getTime() ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
                    >
                      {Date.parse(store.cards[p.id].due) <= now.getTime()
                        ? '已到期 · '
                        : ''}
                      {dateLabel(store.cards[p.id].due)} · 已练{' '}
                      {store.cards[p.id].reps} 次
                    </span>
                  </div>
                ))}
              {!Object.keys(store.cards).length && (
                <p className="px-5 py-9 text-center text-sm text-muted-foreground">
                  先选一个小目标，从今天的第一题开始。
                </p>
              )}
            </div>
          </section>
          {!!Object.keys(store.skippedDrafts ?? {}).length && (
            <details className="mt-8 rounded-xl border p-5">
              <summary className="cursor-pointer text-sm font-medium">
                跳过的草稿 · {Object.keys(store.skippedDrafts!).length} 题
              </summary>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                保留每题最近一次跳过时的代码；下一轮仍从空白默写，完成该题评分后删除暂存草稿。
              </p>
              {problems
                .filter((p) => Object.hasOwn(store.skippedDrafts!, p.id))
                .map((p) => (
                  <details key={p.id} className="mt-4 border-t pt-4">
                    <summary className="cursor-pointer text-sm">
                      {memoryLabel(p)} · {p.title}
                    </summary>
                    <Suspense
                      fallback={
                        <p className="mt-3 text-xs text-muted-foreground">
                          正在加载草稿…
                        </p>
                      }
                    >
                      <PythonCodeBlock
                        code={store.skippedDrafts![p.id] || '# 空白草稿'}
                        className="mt-3 max-h-80 rounded-lg p-4"
                      />
                    </Suspense>
                  </details>
                ))}
            </details>
          )}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-xs text-muted-foreground">
            <div className="max-w-xl leading-6">
              <p>
                记录保存在当前浏览器，可导出后在其他浏览器导入。全部{' '}
                {problems.length}
                题均支持记忆模式；算法题运行测试，多模态题检查语法与接口结构。
              </p>
              <p className="mt-1">{dayKey(now)} · 北京时间</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={exportProgress}>
                <Download className="size-3.5" />
                导出学习记录
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => importRef.current?.click()}
              >
                <Upload className="size-3.5" />
                导入
              </Button>
              <ResetLearningDialog
                onExport={exportProgress}
                onReset={() => {
                  stopRun();
                  return onReset();
                }}
              />
            </div>
          </footer>
        </div>
      ) : (
        <>
          {notice && (
            <p
              role="status"
              className="mx-auto max-w-[1600px] bg-accent px-5 py-3 text-sm text-accent-foreground"
            >
              {notice}
            </p>
          )}
          <div className="border-b bg-background">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-8">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium tabular-nums">
                  第 {store.session!.index + 1} / {store.session!.queue.length}{' '}
                  题
                  {!!store.session?.skipped?.length && (
                    <span className="ml-3 text-xs font-normal text-muted-foreground">
                      已跳过 {store.session.skipped.length} 题
                    </span>
                  )}
                </span>
                <div
                  className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${(store.session!.index / store.session!.queue.length) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {store.cards[problem.id] && !attempt.recorded
                    ? '到期复习'
                    : '完整默写'}
                </span>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${attempt.hints.length ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200' : 'text-muted-foreground'}`}
              >
                {attempt.hints.length
                  ? '已看提示 · 已记录需要重学'
                  : '独立回忆中 · 输入模板不算提示'}
              </span>
            </div>
          </div>
          <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[minmax(300px,.9fr)_minmax(0,1.5fr)]">
            <article className="min-w-0 space-y-6 border-b bg-card p-5 md:p-8 lg:max-h-[calc(100dvh-120px)] lg:overflow-y-auto lg:border-r lg:border-b-0">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {memoryLabel(problem)}
                </p>
                <h2 className="text-2xl font-semibold leading-snug tracking-tight md:text-[28px]">
                  {problem.title}
                </h2>
              </div>
              <section className="space-y-3 text-sm leading-7 text-foreground/85">
                {problem.statement.map((s, i) => (
                  <p key={i}>
                    <StatementText text={s} />
                  </p>
                ))}
              </section>
              <section className="border-y py-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  {structureMode ? '张量 Shape / 输入约定' : '输入约定'}
                </h3>
                <p className="text-sm leading-6">{problem.inputContract}</p>
              </section>
              {structureMode ? (
                <section className="rounded-xl bg-muted p-4 text-sm leading-6 text-foreground/85">
                  <h3 className="mb-2 font-semibold">网页检查范围</h3>
                  <p>检查 Python 语法、必需函数 / 类接口和未完成占位符。</p>
                  <p className="mt-2">
                    必需接口：<code>{problem.requiredSymbols?.join('、')}</code>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {problem.runtimeHint}
                  </p>
                </section>
              ) : (
                <section className="overflow-hidden rounded-xl bg-muted text-foreground">
                  <div className="grid grid-cols-2">
                    <div className="border-r border-border p-4">
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        样例输入
                      </p>
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-6">
                        {problem.sampleInput.trimEnd()}
                      </pre>
                    </div>
                    <div className="p-4">
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        样例输出
                      </p>
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-6">
                        {problem.expectedOutput}
                      </pre>
                    </div>
                  </div>
                </section>
              )}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() =>
                    showApproach ? setShowApproach(false) : hint('approach')
                  }
                >
                  <span className="flex items-center gap-2">
                    <Eye className="size-4" />
                    {showApproach ? '收起核心思路' : '查看核心思路'}
                  </span>
                  <span className="text-xs font-normal">计为需要重学</span>
                </Button>
                {showApproach && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm leading-7">
                    <SolutionContent
                      key={`${attempt.id}:approach`}
                      problemId={problem.id}
                      field="approach"
                      defaultValue={
                        defaultProblem?.approach ?? problem.approach
                      }
                    />
                    <p className="mt-3 text-xs text-muted-foreground">
                      {problem.complexity}
                    </p>
                  </div>
                )}
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() =>
                    showAnswer ? setShowAnswer(false) : hint('answer')
                  }
                >
                  <span className="flex items-center gap-2">
                    <Eye className="size-4" />
                    {showAnswer ? '收起参考答案' : '查看参考答案'}
                  </span>
                  <span className="text-xs font-normal">计为需要重学</span>
                </Button>
                {showAnswer && (
                  <div className="overflow-hidden rounded-lg border bg-card">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                      <span className="text-xs text-muted-foreground">
                        {overrides[problem.id]?.referenceCode !== undefined
                          ? '我的参考答案'
                          : '精简注释版 · main'}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          changeCode(problem.referenceCode, 'reference')
                        }
                      >
                        载入编辑器
                      </Button>
                    </div>
                    <div className="p-4">
                      <SolutionContent
                        key={`${attempt.id}:answer`}
                        problemId={problem.id}
                        field="referenceCode"
                        defaultValue={
                          defaultProblem?.referenceCode ?? problem.referenceCode
                        }
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs leading-6 text-muted-foreground">
                  返回题库只暂停本轮，不记为提示；仅在记忆模式点击“查看核心思路”或“查看参考答案”时记录重学。已有提示记录不会因重置代码而清除。
                </p>
              </div>
            </article>
            <section className="min-w-0 bg-card text-foreground lg:max-h-[calc(100dvh-120px)] lg:overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Code2 className="size-4 text-muted-foreground" />
                  {structureMode ? 'PyTorch · 完整默写' : 'Python 3 · 完整默写'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {!structureMode && (
                    <HelperCodeDialog code={payload.prelude} />
                  )}
                  {problem.inputStarterCode && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-primary hover:bg-muted hover:text-primary"
                      onClick={() =>
                        changeCode(
                          problem.inputStarterCode ?? problem.starterCode,
                          'input',
                        )
                      }
                    >
                      <FileInput className="size-4" />
                      输入已处理模板
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-foreground/85 hover:bg-muted hover:text-foreground"
                    onClick={() => changeCode(problem.starterCode, 'starter')}
                  >
                    <RotateCcw className="size-4" />
                    重置
                  </Button>
                </div>
              </div>
              <p
                id="memory-editor-shortcuts"
                className="border-b border-border bg-muted/25 px-4 py-2 text-[11px] leading-5 text-muted-foreground"
              >
                Python 高亮 · 缩进参考线 · 自动缩进 / 括号配对 · Ctrl + Space
                补全 · Tab 选中 / 缩进 · Shift + Tab 减少缩进
                <span className="ml-2 text-muted-foreground">
                  编辑辅助不算提示
                </span>
              </p>
              <Suspense
                fallback={
                  <div className="grid h-[440px] place-items-center text-sm text-muted-foreground">
                    正在加载 Python 编辑器…
                  </div>
                }
              >
                <PythonEditor
                  attemptId={attempt.id}
                  value={attempt.code}
                  onChange={changeCode}
                  onRun={() => run(true)}
                />
              </Suspense>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border px-5 py-3">
                <span className="text-[11px] text-muted-foreground">
                  {structureMode
                    ? '语法 / 接口结构检查'
                    : `${tests?.[problem.id].length} 组测试`}{' '}
                  · Ctrl + Enter 提交
                </span>
                <Button
                  disabled={
                    result.status === 'running' || (!structureMode && !tests)
                  }
                  className="rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                  size="sm"
                  onClick={() => run(true)}
                >
                  {result.status === 'running' ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {structureMode ? '检查结构' : '提交全部测试'}
                </Button>
              </div>
              {!structureMode && (
                <details className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    自定义输入（仅调试，不计为通过）
                  </summary>
                  <Textarea
                    aria-label="记忆模式自定义输入"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    className="my-3 min-h-20 border-border bg-muted font-mono text-xs text-foreground"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={result.status === 'running'}
                    onClick={() => run(false)}
                  >
                    运行自定义输入
                  </Button>
                </details>
              )}
              <div
                role="status"
                className={`whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-6 ${result.status === 'accepted' ? 'text-emerald-700 dark:text-emerald-400' : result.status === 'error' || result.status === 'wrong' ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'}`}
              >
                {result.text}
              </div>
              <div className="border-t border-border bg-muted/25 p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-muted-foreground" />
                  这次回忆得怎么样？
                </h3>
                {attempt.recorded ? (
                  <>
                    <p className="mb-4 text-xs leading-6 text-amber-800 dark:text-amber-200">
                      已按“需要重学”记录，下次复习：
                      {dateLabel(store.cards[problem.id].due)}
                      。可以继续练习，通过测试也不会改变本次评分。
                    </p>
                    <Button
                      className="h-10 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => finish(Rating.Again)}
                    >
                      结束本题，继续
                      <ArrowRight className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                      {grades.map((g) => (
                        <button
                          key={g.grade}
                          type="button"
                          disabled={
                            (g.grade !== Rating.Again && !passed) ||
                            result.status === 'running'
                          }
                          onClick={() => finish(g.grade)}
                          className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ${g.style}`}
                        >
                          <span className="block text-sm font-semibold">
                            {g.title}
                          </span>
                          <span className="mt-1 block text-[10px] leading-4">
                            {g.detail}
                          </span>
                          <span className="mt-2 block text-xs font-medium">
                            {preview
                              ? intervalLabel(preview[g.grade].card.due, now)
                              : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      {passed
                        ? structureMode
                          ? '结构检查通过。张量数值与 shape 未验证，请根据独立默写情况评分。'
                          : '已通过本站测试，请如实评分。测试覆盖不等同于力扣官方判题。'
                        : structureMode
                          ? '“困难、记得、轻松”需独立默写并通过结构检查。完全想不起来时，可直接选择“需要重学”。'
                          : '“困难、记得、轻松”需独立通过全部测试。完全想不起来时，可直接选择“需要重学”。'}
                    </p>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      )}
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="导入学习记录文件"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProgress(file);
          e.target.value = '';
        }}
      />
    </main>
  );
}
