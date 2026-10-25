# 贡献指南

欢迎补充算法题、多模态手撕题、中文注释和测试用例。提交前先运行 [README 中的检查](README.md#开发与贡献)，并在 PR 中说明改了什么、如何验证。

## 关键文件

| 文件 | 内容 |
| --- | --- |
| `public/problems.json` | 题目、输入约定、空白模板、输入模板、参考题解 |
| `public/review-tests.json` | 记忆模式的算法测试集，按题目 `id` 索引 |
| `public/python-worker.js` | 浏览器 Python 执行与多模态结构检查 |
| `public/review-judge.js` | 算法输出比较规则 |
| `lib/memory.ts` | FSRS 调度、提示记录、尝试和评分状态 |
| `components/memory-mode.tsx` | 记忆界面与学习流程 |
| `app/page.tsx` | 题库界面与题目数据类型 |
| `scripts/check-*.{mjs,py}` | 记忆逻辑、题解和结构检查回归验证 |

## 新增或修改题目

建议复制 `problems` 数组中同类型的题目作为起点。每个 `id` 必须唯一且稳定；学习记录依赖它，不要因重排而修改已有题目的 ID。

数据字段与当前程序类型一致：

```ts
type Problem = {
  id: string;
  sequence: number;                  // 全局展示顺序
  trackSequence?: number;             // 多模态题在本题库中的顺序
  lc: number | null;                  // 力扣编号；多模态题为 null
  track: 'leetcode' | 'multimodal';
  runtime: 'python' | 'pytorch';
  judgeMode: 'sample' | 'structure';
  title: string;
  category: string;
  tags: string[];
  statement: string[];                // 每一项是一段题目描述
  approach: string;                   // 参考题解的一句话总结
  inputContract: string;
  complexity: string;
  referenceCode: string;
  starterCode: string;
  inputStarterCode?: string;
  sampleInput: string;
  expectedOutput: string;
  normalizer: 'trim' | 'sort-lines' | 'sort-numbers';
  requiredSymbols?: string[];         // 多模态检查的函数 / 类名
  runtimeHint?: string;
};
```

算法题使用 `track: "leetcode"`、`runtime: "python"`、`judgeMode: "sample"`。输入输出应明确、可复现；入口统一为 `main()`。`referenceCode` 要简洁可读，为主要变量加短中文注释；同类逻辑沿用现有变量命名。`starterCode` 只留空白结构，`inputStarterCode` 只处理输入，不应包含解题算法。

多模态题使用 `track: "multimodal"`、`runtime: "pytorch"`、`judgeMode: "structure"`，并设置 `trackSequence`、`requiredSymbols` 和 `runtimeHint`。网页检查不会执行 PyTorch；提交这类题目时，请额外提供在本地验证 shape、数值或梯度的过程。不要把结构通过描述成算法正确。

公共链表 / 二叉树辅助代码在顶层 `prelude` 中，执行题解时会自动加上。不要在每题重复粘贴同一套辅助函数。已有顶层 `collections`、版本和题解约定应保持一致；新增题目时同步题库数量。

### 算法测试集

在 `public/review-tests.json` 的 `problems` 中，以同一题目 `id` 增加测试：

```json
{
  "version": 1,
  "problems": {
    "lc-1": [
      { "input": "4 9\n2 7 11 15\n", "expected": "0 1" },
      { "input": "3 6\n3 2 4\n", "expected": "1 2" }
    ]
  }
}
```

这是结构示例，不要用它覆盖现有完整文件。每题至少需要两组测试才能开启记忆模式评分，贡献时建议覆盖普通输入、最小边界、重复值和其他适用边界。核对期望结果，避免只用同一份题解生成并验证答案。

`trim` 比较规范化后的各行，`sort-lines` 忽略行间顺序，`sort-numbers` 按数值排序比较。根据题目的输出约定选择，不能用更宽松的规则掩盖错误；特殊判题规则位于 `public/review-judge.js`。

### 扩展范围时需要同步

目前支持 `leetcode` 和 `multimodal` 两类。增加第三类题库时，还需调整类型、筛选项、标签和检查方式，并补充测试。目前部分界面文案和回归断言明确使用 100 / 15 / 115 等数量；增加题目时，应同步更新相应文案、断言和 README，而不是仅追加 JSON。

检查以下位置：`components/memory-mode.tsx`、`scripts/check-memory.mjs`、`scripts/check-review-tests.py`、`scripts/check-structure.py`，以及题库的 `collections` 元数据。保留既有题目 ID，不要把新增的普通算法题误计入“Hot 100”。

## 提交前检查

```bash
npm run typecheck
npm test
npm run test:answers
npm run build
```

`test:answers` 需要本地 Python 3.10+。界面修改还应在桌面和窄屏下检查深浅色主题、字号同步、编辑器输入和运行按钮。

不要提交个人学习记录、导出的记忆 JSON、浏览器存储、密钥、`.env`、`node_modules` 或构建输出。新增题目请注明原题 / 论文 / 官方资料来源，仅贡献有权分享的内容。
