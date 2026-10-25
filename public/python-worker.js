const PYODIDE_VERSION = '0.27.7';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
importScripts('./review-judge.js');

let pyodidePromise;

async function getPyodide() {
  if (!pyodidePromise) {
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_BASE });
  }
  return pyodidePromise;
}

self.onmessage = async (event) => {
  const {
    id,
    code,
    stdin,
    mode = 'execute',
    requiredSymbols = [],
    cases = [],
    normalizer = 'trim',
    problemId,
  } = event.data;
  const stdout = [];
  const stderr = [];

  try {
    const pyodide = await getPyodide();
    if (mode === 'judge') {
      if (cases.length < 2) throw new Error('本题测试集未准备好，请刷新重试。');
      for (let index = 0; index < cases.length; index++) {
        stdout.length = 0;
        stderr.length = 0;
        const test = cases[index];
        const lines = String(test.input).replace(/\r\n/g, '\n').split('\n');
        let cursor = 0,
          outputLength = 0;
        pyodide.setStdin({
          stdin: () => (cursor < lines.length ? lines[cursor++] : null),
          isatty: false,
        });
        pyodide.setStdout({
          batched: (value) => {
            outputLength += value.length;
            if (outputLength > 200000)
              throw new Error('输出过长，请检查循环。');
            stdout.push(value);
          },
        });
        pyodide.setStderr({ batched: (value) => stderr.push(value) });
        const globals = pyodide.runPython("dict(__name__='__main__')");
        globals.set('_judge_input', test.input);
        pyodide.runPython(
          'import sys, io\n_judge_stdin = sys.stdin\nsys.stdin = io.StringIO(_judge_input)',
          { globals },
        );
        try {
          await pyodide.runPythonAsync(code, { globals });
        } finally {
          pyodide.runPython('sys.stdin = _judge_stdin', { globals });
          globals.destroy();
        }
        const actual = stdout.join('\n');
        if (
          stderr.length ||
          !self.matchesReviewOutput(
            actual,
            test.expected,
            normalizer,
            problemId,
            test.input,
          )
        ) {
          self.postMessage({
            id,
            accepted: false,
            total: cases.length,
            passed: index,
            stderr: stderr.join('\n'),
            stdout: `第 ${index + 1} / ${cases.length} 组测试未通过\n输入：\n${test.input}\n期望输出：\n${test.expected || '（空）'}\n实际输出：\n${actual || '（空）'}`,
          });
          return;
        }
      }
      self.postMessage({
        id,
        accepted: true,
        total: cases.length,
        stdout: '全部测试通过',
        stderr: '',
      });
      return;
    }
    const lines = String(stdin ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    let cursor = 0;

    pyodide.setStdin({
      stdin: () => (cursor < lines.length ? lines[cursor++] : ''),
      isatty: false,
    });
    pyodide.setStdout({ batched: (value) => stdout.push(value) });
    pyodide.setStderr({ batched: (value) => stderr.push(value) });

    const globals = pyodide.runPython("dict(__name__='__main__')");
    if (mode === 'structure') {
      const required = pyodide.toPy(requiredSymbols);
      try {
        globals.set('_source', code);
        globals.set('_required', required);
        const result = pyodide.runPython(
          `
import ast, json
_tree = ast.parse(_source)
_found = {
    node.name for node in _tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
}
_missing = [name for name in _required if name not in _found]
_placeholder = any(
    isinstance(node, ast.Pass)
    or (
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Constant)
        and node.value.value is Ellipsis
    )
    or (
        isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id == 'NotImplementedError'
    )
    for node in ast.walk(_tree)
)
json.dumps({
    "missing": _missing,
    "placeholder": _placeholder,
    "found": sorted(_found),
}, ensure_ascii=False)
`,
          { globals },
        );
        const check = JSON.parse(String(result));
        const accepted = check.missing.length === 0 && !check.placeholder;
        const messages = accepted
          ? [
              'Python 语法检查通过',
              `已找到接口：${requiredSymbols.join('、')}`,
              '提示：张量数值与 shape 仍需在本地 PyTorch 环境测试。',
            ]
          : [
              check.missing.length
                ? `缺少接口：${check.missing.join('、')}`
                : '接口名称已找到',
              check.placeholder
                ? '代码中仍包含 pass、... 或 NotImplementedError。'
                : '请继续完成实现。',
            ];
        self.postMessage({
          id,
          stdout: messages.join('\n'),
          stderr: '',
          accepted,
        });
        return;
      } finally {
        required.destroy();
        globals.destroy();
      }
    }

    try {
      await pyodide.runPythonAsync(code, { globals });
    } finally {
      globals.destroy();
    }

    self.postMessage({
      id,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
    });
  } catch (error) {
    self.postMessage({
      id,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
