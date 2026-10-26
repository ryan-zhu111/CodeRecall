import { lazy, Suspense, useId, useState } from 'react';
import { Pencil, RotateCcw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  useSolutions,
  type SolutionField,
} from '@/components/solution-overrides';

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

export function SolutionContent({
  problemId,
  field,
  defaultValue,
}: {
  problemId: string;
  field: SolutionField;
  defaultValue: string;
}) {
  const { overrides, ready, save } = useSolutions();
  const custom = overrides[problemId]?.[field];
  const value = custom ?? defaultValue;
  const title = field === 'approach' ? '核心思路' : '参考答案';
  const helpId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expected, setExpected] = useState(custom);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function begin() {
    setDraft(value);
    setExpected(custom);
    setEditing(true);
    setMessage('');
    setError('');
  }
  function persist(next: string | undefined) {
    const failure = save(problemId, field, next, editing ? expected : custom);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
    setError('');
    setMessage(
      next === undefined
        ? '已恢复内置默认内容。'
        : '已保存到当前浏览器，题库和记忆模式已同步。',
    );
  }
  function saveDraft() {
    if (!draft.trim()) {
      setError(`${title}不能为空。`);
      return;
    }
    persist(draft === defaultValue ? undefined : draft);
  }
  function reset() {
    if (
      window.confirm(
        `将本题的${title}恢复为内置默认内容？当前自定义内容和未保存的修改将被移除，学习进度不受影响。`,
      )
    )
      persist(undefined);
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {editing
            ? '编辑中 · 尚未保存'
            : custom !== undefined
              ? '我的版本'
              : '内置版本'}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {editing ? (
            <>
              <Button size="sm" onClick={saveDraft}>
                <Save className="size-3.5" />
                保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                <X className="size-3.5" />
                取消
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={!ready}
              onClick={begin}
              aria-label={`编辑${title}`}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={
              !ready ||
              (custom === undefined && (!editing || draft === defaultValue))
            }
            onClick={reset}
            aria-label={`重置${title}更改`}
          >
            <RotateCcw className="size-3.5" />
            重置更改
          </Button>
        </div>
      </div>
      {editing ? (
        <>
          <p
            id={helpId}
            className="mb-3 text-xs leading-5 text-muted-foreground"
          >
            仅保存在当前浏览器；保存后用于题库和记忆模式。Ctrl + Enter 保存。
          </p>
          {field === 'approach' ? (
            <Textarea
              autoFocus
              aria-label="编辑核心思路"
              aria-describedby={helpId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  saveDraft();
                }
              }}
              className="min-h-32 text-sm leading-7"
            />
          ) : (
            <Suspense
              fallback={
                <p className="py-4 text-sm text-muted-foreground">
                  正在加载编辑器…
                </p>
              }
            >
              <PythonEditor
                value={draft}
                onChange={setDraft}
                onRun={saveDraft}
                attemptId={`solution:${problemId}`}
                label="编辑参考答案"
                describedBy={helpId}
                testId="solution-python-editor"
                className="max-h-[32rem] overflow-auto rounded-lg border"
              />
            </Suspense>
          )}
        </>
      ) : field === 'approach' ? (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground/85">
          {value}
        </p>
      ) : (
        <Suspense
          fallback={
            <p className="py-4 text-sm text-muted-foreground">正在加载题解…</p>
          }
        >
          <PythonCodeBlock
            code={value}
            className="max-h-[32rem] overflow-auto"
          />
        </Suspense>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
