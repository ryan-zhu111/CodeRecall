import { useMemo } from 'react';
import { highlightPython } from '@/lib/python-highlight';

export function PythonCodeBlock({
  code,
  className = '',
}: {
  code: string;
  className?: string;
}) {
  const tokens = useMemo(() => highlightPython(code), [code]);
  return (
    <pre
      className={`python-code-block overflow-auto ${className}`}
      style={{
        backgroundColor: 'var(--code-bg)',
        color: 'var(--code-fg)',
        fontFamily: 'var(--font-code)',
        fontSize: 'var(--code-font-size)',
        fontWeight: 'var(--code-font-weight)',
        fontVariantLigatures: 'none',
        lineHeight: 'var(--code-line-height)',
        tabSize: 4,
      }}
      data-testid="python-reference-code"
    >
      <code>
        {tokens.map((token, index) =>
          token.className ? (
            <span
              key={index}
              className={token.className}
              style={{ color: token.color }}
            >
              {token.text}
            </span>
          ) : (
            token.text
          ),
        )}
      </code>
    </pre>
  );
}
