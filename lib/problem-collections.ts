export const scopeLabels = {
  all: '全部题库',
  leetcode: '全部算法题',
  hot100: 'LeetCode Hot 100',
  codetop: 'CodeTop 前20',
  multimodal: '多模态手撕',
};
export type ProblemScope = keyof typeof scopeLabels;
type CollectionProblem = {
  track: string;
  hot100?: boolean;
  codeTopRank?: number;
};

export function inProblemScope(p: CollectionProblem, scope: ProblemScope) {
  if (scope === 'all') return true;
  if (scope === 'hot100') return p.hot100 === true;
  if (scope === 'codetop') return p.codeTopRank !== undefined;
  return p.track === scope;
}

export function problemsInScope<T extends CollectionProblem>(
  problems: T[],
  scope: ProblemScope,
): T[] {
  const result = problems.filter((p) => inProblemScope(p, scope));
  return scope === 'codetop'
    ? result.sort((a, b) => a.codeTopRank! - b.codeTopRank!)
    : result;
}
