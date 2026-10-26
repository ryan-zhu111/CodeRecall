import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ListPlus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MemoryProblem } from '@/lib/memory';

export function AddSessionQuestions({
  problems,
  eligibleIds,
  queuedIds,
  skippedIds,
  resumeRound,
  disabled,
  onAdd,
}: {
  problems: MemoryProblem[];
  eligibleIds: string[];
  queuedIds: string[];
  skippedIds: string[];
  resumeRound?: boolean;
  disabled?: boolean;
  onAdd: (ids: string[]) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
  const queued = new Set(queuedIds);
  const skipped = new Set(skippedIds);
  const selected = picked.filter((id) => eligible.has(id));
  const needle = query.trim().toLowerCase();
  const label = (p: MemoryProblem) =>
    p.track === 'multimodal'
      ? `MM ${p.trackSequence ?? p.id.replace('mm-', '')}`
      : `LC ${p.lc}`;
  const visible = problems.filter((p) =>
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
          列出本轮范围内的全部题目。绿色表示已在本轮或已学过，不能勾选；新题和标为“已跳过”的题仍可添加。按勾选顺序追加到队尾。重新加入已跳过的题会撤销跳过标记，从空白模板开始，原评分和草稿保留。
        </p>
        {resumeRound && (
          <p className="mb-4 rounded-lg bg-muted p-3 text-sm">
            本轮已结束，加入题目后可继续这一轮。
          </p>
        )}
        {open && (
          <>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                aria-label="搜索本轮题库中的题目"
                placeholder="搜索题号或题名"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border">
              {visible.map((p) => {
                const locked = !eligible.has(p.id);
                const status = locked
                  ? queued.has(p.id)
                    ? '已在本轮'
                    : '已学过'
                  : skipped.has(p.id)
                    ? '已跳过'
                    : '';
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 border-b px-4 py-3 last:border-0 ${locked ? 'cursor-not-allowed bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' : 'cursor-pointer hover:bg-muted'}`}
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
                      className={`w-16 shrink-0 text-xs ${locked ? '' : 'text-muted-foreground'}`}
                    >
                      {label(p)}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">{p.title}</span>
                    {status && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${locked ? 'bg-emerald-100 dark:bg-emerald-900/50' : 'bg-muted text-muted-foreground'}`}
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
                    ? '没有找到匹配的题目，试试其他题号或题名。'
                    : '本轮题库没有题目。'}
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
                已选 {selected.length} 题 · {eligible.size} 题可添加 / 共{' '}
                {problems.length} 题
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
