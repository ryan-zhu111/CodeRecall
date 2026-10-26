import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ListPlus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MemoryProblem, SessionProblemStatus } from '@/lib/memory';
import {
  scopeLabels,
  problemsInScope,
  type ProblemScope,
} from '@/lib/problem-collections';

export function AddSessionQuestions({
  problems,
  eligibleIds,
  questionStates,
  resumeRound,
  disabled,
  onAdd,
}: {
  problems: MemoryProblem[];
  eligibleIds: string[];
  questionStates: Record<string, SessionProblemStatus>;
  resumeRound?: boolean;
  disabled?: boolean;
  onAdd: (ids: string[]) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ProblemScope>('all');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    searchRef.current?.focus();
  }, [open]);
  const eligible = new Set(eligibleIds);
  const selected = picked.filter((id) => eligible.has(id));
  const needle = query.trim().toLowerCase();
  const label = (p: MemoryProblem) =>
    p.track === 'multimodal'
      ? `MM ${p.trackSequence ?? p.id.replace('mm-', '')}`
      : `LC ${p.lc}`;
  const scoped = problemsInScope(problems, scope);
  const categories = [
    ...new Set(
      scoped.map((p) => p.category).filter((value): value is string => !!value),
    ),
  ];
  const visible = scoped.filter(
    (p) =>
      (!category || p.category === category) &&
      `${p.id} ${label(p)} ${p.title}`.toLowerCase().includes(needle),
  );
  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setScope('all');
          setCategory('');
          setPicked([]);
          setError('');
          setOpen(true);
        }}
      >
        <ListPlus className="size-4" />
        添加题目
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto rounded-2xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            从题库添加题目
          </h2>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭添加题目"
            onClick={close}
          >
            <X />
          </Button>
        </div>
        <p
          id={descriptionId}
          className="my-4 text-sm leading-6 text-muted-foreground"
        >
          从全部 {problems.length}{' '}
          题中选题，不受本轮题库范围限制。绿色表示已在本轮或已学过，不能勾选；新题和标为“已跳过”的题仍可添加，未完成的跳过题跨轮保留。按勾选顺序追加到队尾，切换筛选保留已选题目。当前草稿和学习记录保留；重新加入已跳过的题从空白模板开始。
        </p>
        {resumeRound && (
          <p className="mb-4 rounded-lg bg-muted p-3 text-sm">
            本轮已结束，加入题目后可继续这一轮。
          </p>
        )}
        {open && (
          <>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>题库类型</span>
                <select
                  value={scope}
                  onChange={(event) => {
                    setScope(event.target.value as ProblemScope);
                    setCategory('');
                  }}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {Object.entries(scopeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label} ·{' '}
                      {problemsInScope(problems, value as ProblemScope).length}{' '}
                      题
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span>题目分类</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="">全部分类 · {scoped.length} 题</option>
                  {categories.map((value) => (
                    <option key={value} value={value}>
                      {value} ·{' '}
                      {scoped.filter((p) => p.category === value).length} 题
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                aria-label="搜索全部题库中的题目"
                placeholder="搜索题号或题名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border">
              {visible.map((p) => {
                const locked = !eligible.has(p.id);
                const state = questionStates[p.id] ?? 'new';
                const green = state === 'queued' || state === 'learned';
                const status = {
                  queued: '已在本轮',
                  learned: '已学过',
                  skipped: '已跳过',
                  new: locked ? '暂不可添加' : '',
                }[state];
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 border-b px-4 py-3 last:border-0 ${locked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted'} ${green ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' : ''}`}
                  >
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setPicked((current) =>
                          e.target.checked
                            ? [...current, p.id]
                            : current.filter((id) => id !== p.id),
                        )
                      }
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span
                      className={`w-16 shrink-0 text-xs ${green ? '' : 'text-muted-foreground'}`}
                    >
                      {label(p)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">{p.title}</span>
                    {status && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${green ? 'bg-emerald-100 dark:bg-emerald-900/50' : 'bg-muted text-muted-foreground'}`}
                      >
                        {status}
                      </span>
                    )}
                  </label>
                );
              })}
              {!visible.length && (
                <p className="p-6 text-center text-sm leading-6 text-muted-foreground">
                  {problems.length
                    ? '没有找到匹配的题目，试试其他分类、题号或题名。'
                    : '题库没有题目。'}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                已选 {selected.length} 题 · 当前显示 {visible.length} / 全部{' '}
                {problems.length} 题
                <span className="mt-1 block text-xs">
                  当前筛选可添加{' '}
                  {visible.filter((p) => eligible.has(p.id)).length} 题
                </span>
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={close}>
                  取消
                </Button>
                <Button
                  disabled={!selected.length || disabled}
                  onClick={() => {
                    const message = onAdd(selected);
                    if (message) setError(message);
                    else close();
                  }}
                >
                  加入本轮（{selected.length}）
                </Button>
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
