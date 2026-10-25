import { useEffect, useRef } from 'react';
import {
  Compartment,
  EditorState,
  Transaction,
  countColumn,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  tooltips,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completeFromList,
  ifNotIn,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxTree,
} from '@codemirror/language';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { useAppearance } from '@/components/appearance-settings';
import {
  pythonHighlightRanges,
  pythonTokenColors,
} from '@/lib/python-highlight';

const indentation = (text: string) =>
  countColumn(text.match(/^[\t ]*/)?.[0] ?? '', 4);

const keywordCompletion = ifNotIn(
  ['String', 'FormatString', 'Comment', 'PropertyName'],
  completeFromList(
    [
      'return',
      'yield',
      'break',
      'continue',
      'pass',
      'raise',
      'assert',
      'with',
      'as',
      'lambda',
      'except',
      'finally',
      'elif',
      'else',
      'in',
      'is',
      'not',
      'and',
      'or',
      'True',
      'False',
      'None',
      'global',
      'nonlocal',
      'del',
      'async',
      'await',
      'match',
      'case',
    ].map((label) => ({ label, type: 'keyword', boost: 1 })),
  ),
);

function guideDecorations(view: EditorView) {
  const doc = view.state.doc;
  const decorations = [];
  const visited = new Set<number>();
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = doc.lineAt(pos);
      if (!visited.has(line.from)) {
        visited.add(line.from);
        let columns = indentation(line.text);
        // Continue guides through blank lines inside a block, without extending
        // them past the next dedent. Backgrounds move with the actual code lines.
        if (!line.text.trim()) {
          let before = line.number - 1,
            after = line.number + 1;
          while (before > 0 && !doc.line(before).text.trim()) before--;
          while (after <= doc.lines && !doc.line(after).text.trim()) after++;
          const previous = before > 0 ? doc.line(before).text : '';
          const previousIndent =
            indentation(previous) + (previous.trimEnd().endsWith(':') ? 4 : 0);
          columns = Math.max(
            columns,
            after <= doc.lines
              ? Math.min(previousIndent, indentation(doc.line(after).text))
              : previousIndent,
          );
        }
        const depth = Math.min(64, Math.floor(columns / 4));
        if (depth) {
          decorations.push(
            Decoration.line({
              attributes: {
                class: 'cm-indent-guides',
                'data-indent-depth': String(depth),
                style: `background-image:${Array(depth).fill('linear-gradient(var(--code-guide),var(--code-guide))').join(',')};background-position:${Array.from({ length: depth }, (_, i) => `calc(6px + ${i * 4}ch) 0`).join(',')};background-size:1px 100%;background-repeat:no-repeat`,
              },
            }).range(line.from),
          );
        }
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = guideDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = guideDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const syntaxColors = ViewPlugin.fromClass(
  class {
    tree: ReturnType<typeof syntaxTree>;
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const tree = syntaxTree(update.state);
      if (update.docChanged || update.viewportChanged || tree !== this.tree) {
        this.tree = tree;
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      const code = view.state.doc.toString();
      const marks = view.visibleRanges.flatMap(({ from, to }) =>
        pythonHighlightRanges(code, this.tree, from, to).map((range) =>
          Decoration.mark({ class: range.className }).range(
            range.from,
            range.to,
          ),
        ),
      );
      return Decoration.set(marks, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--code-fg)',
    backgroundColor: 'var(--code-bg)',
    fontSize: 'var(--code-font-size)',
    fontWeight: 'var(--code-font-weight)',
    fontFamily: 'var(--font-code)',
    fontVariantLigatures: 'none',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-code)',
    fontVariantLigatures: 'none',
    lineHeight: 'var(--code-line-height)',
  },
  '.cm-content': {
    padding: '16px 0',
    caretColor: 'var(--code-cursor)',
    minHeight: '100%',
  },
  '.cm-line': { padding: '0 6px' },
  '.cm-gutters': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-gutter)',
    borderRight: '1px solid var(--code-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 10px',
    minWidth: '38px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--code-active)',
    color: 'var(--code-fg)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-cursor)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--code-selection)' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--code-selection)',
    outline: '1px solid var(--code-guide)',
  },
  '.cm-tooltip': {
    fontFamily: 'var(--font-code)',
    border: '1px solid var(--code-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-fg)',
    overflow: 'hidden',
    boxShadow: '0 8px 24px #0f172a18',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-code)',
    fontSize: 'var(--code-font-size)',
    fontWeight: 'var(--code-font-weight)',
    maxHeight: '220px',
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--code-selection)',
    color: 'var(--code-fg)',
  },
  ...Object.fromEntries(
    Object.entries(pythonTokenColors).map(([name, color]) => [
      `.${name}`,
      { color },
    ]),
  ),
});

/** Only Python built-ins, generic syntax and the current document feed completion.
 * No solution, approach, or prior attempt is passed into this editor. */
export function PythonEditor({
  value,
  onChange,
  onRun,
  attemptId,
  label = '记忆模式 Python 代码编辑器',
  describedBy = 'memory-editor-shortcuts',
  className = '',
  testId = 'memory-python-editor',
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  attemptId: string;
  label?: string;
  describedBy?: string;
  className?: string;
  testId?: string;
}) {
  const { theme: appearanceTheme, fontSize } = useAppearance();
  const darkMode = useRef(new Compartment());
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ value, onChange, onRun });
  callbacks.current = { value, onChange, onRun };
  const syncing = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: callbacks.current.value,
        extensions: [
          python(),
          pythonLanguage.data.of({ autocomplete: keywordCompletion }),
          syntaxColors,
          darkMode.current.of(
            EditorView.darkTheme.of(appearanceTheme === 'dark'),
          ),
          theme,
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          indentUnit.of('    '),
          EditorState.tabSize.of(4),
          indentGuides,
          autocompletion({ activateOnTyping: true, defaultKeymap: false }),
          tooltips({ position: 'fixed' }),
          EditorView.contentAttributes.of({
            'aria-label': label,
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          }),
          EditorState.phrases.of({
            Completions: '代码补全',
            'No completions': '没有补全建议',
          }),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: (editor) => {
                if (editor.composing) return false;
                callbacks.current.onRun();
                return true;
              },
            },
            { key: 'Tab', run: acceptCompletion },
            ...completionKeymap,
            ...closeBracketsKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Recreate the state for each attempt, so Undo cannot restore a previous answer.
  }, [attemptId, label, describedBy]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: darkMode.current.reconfigure(
        EditorView.darkTheme.of(appearanceTheme === 'dark'),
      ),
    });
    // Font changes need a new measurement, not a new document or undo history.
    const frame = requestAnimationFrame(() => view.requestMeasure());
    return () => cancelAnimationFrame(frame);
  }, [appearanceTheme, fontSize, attemptId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncing.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: 0 },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      syncing.current = false;
    }
  });

  return (
    <div
      ref={hostRef}
      className={`h-[480px] min-h-[320px] resize-y overflow-hidden ${className}`}
      data-testid={testId}
    />
  );
}
