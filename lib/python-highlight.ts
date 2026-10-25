import { HighlightStyle } from '@codemirror/language';
import { pythonLanguage } from '@codemirror/lang-python';
import { highlightTree, tags } from '@lezer/highlight';

/** Shared token classes keep editable code and reference answers identical. */
export const pythonTokenColors: Record<string, string> = {
  'py-keyword': 'var(--syntax-keyword)',
  'py-control': 'var(--syntax-control)',
  'py-string': 'var(--syntax-string)',
  'py-number': 'var(--syntax-number)',
  'py-comment': 'var(--syntax-comment)',
  'py-type': 'var(--syntax-type)',
  'py-function': 'var(--syntax-function)',
  'py-variable': 'var(--syntax-variable)',
  'py-operator': 'var(--syntax-operator)',
};

export const pythonHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.bool, tags.null],
    class: 'py-keyword',
  },
  { tag: tags.controlKeyword, class: 'py-control' },
  {
    tag: [tags.string, tags.special(tags.string), tags.escape],
    class: 'py-string',
  },
  { tag: tags.number, class: 'py-number' },
  { tag: tags.comment, class: 'py-comment' },
  {
    tag: [tags.typeName, tags.className, tags.standard(tags.variableName)],
    class: 'py-type',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: 'py-function',
  },
  { tag: [tags.variableName, tags.propertyName], class: 'py-variable' },
  { tag: [tags.operator, tags.punctuation], class: 'py-operator' },
]);

export type PythonToken = { text: string; className?: string; color?: string };

const builtinTypes = new Set([
  'bool',
  'bytes',
  'bytearray',
  'complex',
  'dict',
  'float',
  'frozenset',
  'int',
  'list',
  'memoryview',
  'object',
  'set',
  'str',
  'tuple',
  'type',
]);
const builtinFunctions = new Set([
  'abs',
  'all',
  'any',
  'bin',
  'callable',
  'chr',
  'divmod',
  'enumerate',
  'eval',
  'filter',
  'format',
  'getattr',
  'hasattr',
  'hash',
  'hex',
  'id',
  'input',
  'isinstance',
  'issubclass',
  'iter',
  'len',
  'map',
  'max',
  'min',
  'next',
  'oct',
  'open',
  'ord',
  'pow',
  'print',
  'range',
  'repr',
  'reversed',
  'round',
  'setattr',
  'slice',
  'sorted',
  'sum',
  'super',
  'vars',
  'zip',
]);

type PythonTree = ReturnType<typeof pythonLanguage.parser.parse>;
export type PythonHighlightRange = {
  from: number;
  to: number;
  className: string;
};

/** Small lexical refinements, without pretending to provide language-server analysis. */
function identifierClass(
  code: string,
  tree: PythonTree,
  from: number,
  to: number,
  fallback: string,
) {
  if (fallback !== 'py-variable' && fallback !== 'py-function') return fallback;
  const node = tree.resolveInner(from, 1);
  if (node.name !== 'VariableName' || node.from !== from || node.to !== to)
    return fallback;
  const name = code.slice(from, to);
  if (name === 'self' || name === 'cls') return 'py-keyword';
  // Do not color a newly declared function, class or parameter as a builtin.
  if (
    ['FunctionDefinition', 'ClassDefinition', 'ParamList'].includes(
      node.parent?.name ?? '',
    )
  )
    return fallback;
  if (builtinTypes.has(name)) return 'py-type';
  if (builtinFunctions.has(name)) return 'py-function';
  return fallback;
}

/** Both the live editor and reference renderer use exactly these ranges. */
export function pythonHighlightRanges(
  code: string,
  tree: PythonTree = pythonLanguage.parser.parse(code),
  from = 0,
  to = code.length,
): PythonHighlightRange[] {
  const ranges: PythonHighlightRange[] = [];
  highlightTree(
    tree,
    pythonHighlight,
    (start, end, classes) => {
      const base = classes.split(' ').find((name) => name in pythonTokenColors);
      if (base)
        ranges.push({
          from: start,
          to: end,
          className: identifierClass(code, tree, start, end, base),
        });
    },
    from,
    to,
  );
  return ranges;
}

/** Parse once per source change; never use HTML injection for reference code. */
export function highlightPython(code: string): PythonToken[] {
  const tokens: PythonToken[] = [];
  let cursor = 0;
  for (const { from, to, className } of pythonHighlightRanges(code)) {
    if (from > cursor) tokens.push({ text: code.slice(cursor, from) });
    tokens.push({
      text: code.slice(from, to),
      className,
      color: className ? pythonTokenColors[className] : undefined,
    });
    cursor = to;
  }
  if (cursor < code.length) tokens.push({ text: code.slice(cursor) });
  return tokens;
}
