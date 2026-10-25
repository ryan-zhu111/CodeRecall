import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Download, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ResetLearningDialogProps = {
  onReset: () => string | null;
  onExport: () => void;
};

export function ResetLearningDialog({
  onReset,
  onExport,
}: ResetLearningDialogProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const resettingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !step) return;
    if (!dialog.open) dialog.showModal();
    // A repeated Enter must land on cancellation at either confirmation.
    cancelRef.current?.focus();
  }, [step]);

  function close() {
    dialogRef.current?.close();
    setStep(0);
    setError('');
  }

  function reset() {
    if (step !== 2 || resettingRef.current) return;
    resettingRef.current = true;
    try {
      const message = onReset();
      if (message) setError(message);
      else close();
    } catch {
      setError('未能完成重置，请检查浏览器存储权限后重试。');
    } finally {
      resettingRef.current = false;
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          setError('');
          setStep(1);
        }}
      >
        <RotateCcw className="size-3.5" />
        重置记忆
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40 sm:p-8"
        onCancel={close}
        onClose={() => setStep(0)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.repeat) event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              确认 {step || 1} / 2
            </p>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {step === 2 ? '最后确认：清空全部学习数据' : '重置记忆？'}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭重置确认"
            onClick={close}
          >
            <X />
          </Button>
        </div>

        {step === 2 ? (
          <div id={descriptionId} className="mt-5 space-y-3 text-sm leading-6">
            <p>
              确认后，全部题目会恢复为未学习、未完成，复习计划、学习记录和代码草稿都会清空。
            </p>
            <p className="font-medium text-destructive">
              此操作无法撤销。未导出的记录和草稿无法找回。
            </p>
            <p className="text-muted-foreground">
              仅重置当前浏览器、当前网站的数据，题库、参考题解、主题和字号保持不变。
            </p>
          </div>
        ) : (
          <div id={descriptionId} className="mt-5 space-y-4 text-sm leading-6">
            <p>恢复到没刷过题的状态，将清空：</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>FSRS 记忆状态、复习历史和下次复习安排。</li>
              <li>未完成的学习轮次及其中的代码。</li>
              <li>题库完成标记、代码草稿和旧版草稿。</li>
            </ul>
            <p className="text-muted-foreground">
              仅影响当前浏览器、当前网站，不影响其他浏览器、网站或用户。
              题库、参考题解、主题和字号会保留。
            </p>
            <div className="rounded-xl bg-muted p-4">
              <p className="mb-3 text-muted-foreground">
                如需保留记忆记录，可先导出。导出文件包含记忆模式记录和未完成轮次，不包含题库草稿或完成标记，请自行保存需要的代码。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  try {
                    onExport();
                    setError('');
                  } catch {
                    setError('导出失败，请检查浏览器权限后重试。');
                  }
                }}
              >
                <Download className="size-3.5" />
                先导出学习记录
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm leading-6 text-destructive">
            {error}
          </p>
        )}

        {step === 2 ? (
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            {/* Move the destructive action away from the first confirmation. */}
            <Button
              variant="destructive"
              onClick={(event) => {
                if (event.detail > 1) return;
                reset();
              }}
            >
              确认清空，重新开始
            </Button>
            <Button ref={cancelRef} variant="outline" onClick={close}>
              取消，保留记录
            </Button>
          </div>
        ) : (
          <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
            <Button ref={cancelRef} variant="outline" onClick={close}>
              取消
            </Button>
            <Button
              onClick={() => {
                setError('');
                setStep(2);
              }}
            >
              我已了解，继续
            </Button>
          </div>
        )}
      </dialog>
    </>
  );
}
