import { useId, useLayoutEffect, useRef, useState } from 'react';
import { List, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  completedSessionIds,
  sessionAttempts,
  isAttemptPassed,
  type Session,
  type MemoryProblem,
} from '@/lib/memory';

export function SessionQuestionList({
  session,
  problems,
  disabled,
  onSelect,
}: {
  session: Session;
  problems: MemoryProblem[];
  disabled?: boolean;
  onSelect: (id: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const completed = new Set(completedSessionIds(session));
  const attempts = sessionAttempts(session);
  useLayoutEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function close() {
    dialog.current?.close();
    setOpen(false);
  }
  const needle = query.trim().toLowerCase();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <List className="size-4" />
        本轮题目{' '}
        <span className="tabular-nums text-muted-foreground">
          {completed.size}/{session.queue.length}
        </span>
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto rounded-2xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            本轮题目
          </h2>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭本轮题目"
            onClick={close}
          >
            <X />
          </Button>
        </div>
        <p
          id={descriptionId}
          className="my-4 text-sm leading-6 text-muted-foreground"
        >
          已完成 {completed.size} / {session.queue.length}{' '}
          题。点击任一题继续查看或编辑，各题草稿自动保存。已完成题可重新提交，不重复计数或更新
          FSRS。
        </p>
        <Input
          aria-label="搜索本轮题目"
          placeholder="搜索题号或题名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-4"
        />
        <div className="max-h-[55dvh] overflow-y-auto rounded-xl border">
          {session.queue.map((id, index) => {
            const p = problems.find((p) => p.id === id);
            if (!p) return null;
            const label =
              p.track === 'multimodal'
                ? `MM ${p.trackSequence ?? p.id.replace('mm-', '')}`
                : `LC ${p.lc}`;
            if (!`${label} ${p.title} ${p.id}`.toLowerCase().includes(needle))
              return null;
            const a = attempts[id];
            const done = completed.has(id);
            const current = session.attempt?.problemId === id;
            const status = done
              ? '已完成'
              : isAttemptPassed(a) && !a?.recorded
                ? '待评分'
                : a
                  ? '进行中'
                  : '未开始';
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  if (onSelect(id)) close();
                }}
                className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${current ? 'bg-accent' : ''}`}
              >
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {label}
                    {current && ' · 当前题'}
                  </span>
                  <span className="text-sm">{p.title}</span>
                  {a?.hints.length ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {done ? '曾查看提示' : '已看提示 · 需要重学'}
                    </span>
                  ) : null}
                  {a?.result && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {a.result.status === 'accepted'
                        ? '最近提交通过'
                        : '最近提交未通过'}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs ${done ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
                >
                  {status}
                </span>
              </button>
            );
          })}
        </div>
      </dialog>
    </>
  );
}
