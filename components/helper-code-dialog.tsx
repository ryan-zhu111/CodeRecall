import {
  lazy,
  Suspense,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Code2, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PythonCodeBlock = lazy(() =>
  import('@/components/python-code-block').then((m) => ({
    default: m.PythonCodeBlock,
  })),
);

const helpers = [
  ['Node', '链表节点：val 保存值，next 指向下一个节点。'],
  ['build_list(a)', '把数组 a 转成链表，返回头节点。'],
  ['print_list(h)', '从头节点 h 开始，输出链表中的值。'],
  ['chain(a, tail)', '把数组 a 转成链表，并连接到 tail。'],
  ['build_cycle(a, pos)', '建立链表，把尾节点连到下标 pos；pos < 0 时无环。'],
  ['T', '二叉树节点：val 保存值，left、right 指向左右子节点。'],
  ['build_tree(v)', '按层序数组建树，字符串 null 表示空节点。'],
  ['find(r, v)', '在以 r 为根的树中查找值为 v 的节点。'],
  ['serialize(r)', '把树转成层序列表，去掉末尾多余的 null。'],
];

export function HelperCodeDialog({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [open]);
  function close() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setMessage('');
          setOpen(true);
        }}
        title="查看网站自动提供的链表和二叉树辅助代码，不算提示"
      >
        <Code2 className="size-4" />
        公共辅助代码
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-4xl overflow-auto rounded-2xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            公共辅助代码
          </h2>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭公共辅助代码"
            onClick={close}
          >
            <X />
          </Button>
        </div>
        <p
          id={descriptionId}
          className="my-4 text-sm leading-6 text-muted-foreground"
        >
          算法题运行时，网站会自动加入以下代码，无需重复默写。查看这些通用辅助函数不算提示；复制到本地
          Python 运行时，可以一并带上。
        </p>
        {open && (
          <>
            <dl className="mb-5 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              {helpers.map(([name, description]) => (
                <div key={name} className="contents">
                  <dt className="font-mono font-semibold">{name}</dt>
                  <dd className="mb-2 leading-6 text-muted-foreground sm:mb-0">
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                以下为当前实际运行的公共代码（只读）
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                    setMessage('已复制公共代码。');
                  } catch {
                    setMessage('复制失败，请直接选中下方代码复制。');
                  }
                }}
              >
                <Copy className="size-3.5" />
                复制代码
              </Button>
            </div>
            {message && (
              <p role="status" className="mb-3 text-xs text-muted-foreground">
                {message}
              </p>
            )}
            <Suspense
              fallback={
                <p className="p-4 text-sm text-muted-foreground">
                  正在加载代码…
                </p>
              }
            >
              <PythonCodeBlock
                code={code}
                className="overflow-auto rounded-xl border p-4"
              />
            </Suspense>
          </>
        )}
      </dialog>
    </>
  );
}
