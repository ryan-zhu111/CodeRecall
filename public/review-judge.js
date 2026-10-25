// Output contracts match the ACM statements, including their ordering rules.
self.matchesReviewOutput = function (actual, expected, mode, problemId, input) {
  const clean = (value) =>
    String(value)
      .trim()
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
  if (problemId === 'lc-1') {
    const values = String(input).trim().split(/\s+/).map(Number);
    const [n, target, ...nums] = values;
    const out = String(actual).trim().split(/\s+/).map(Number);
    return (
      out.length === 2 &&
      out.every(Number.isInteger) &&
      out[0] >= 0 &&
      out[0] < out[1] &&
      out[1] < n &&
      nums[out[0]] + nums[out[1]] === target
    );
  }
  if (mode === 'sort-numbers') {
    const tokens = (value) =>
      String(value).trim()
        ? String(value)
            .trim()
            .split(/\s+/)
            .map(Number)
            .sort((a, b) => a - b)
        : [];
    const a = tokens(actual),
      b = tokens(expected);
    return (
      a.length === b.length &&
      a.every((x, i) => Number.isFinite(x) && x === b[i])
    );
  }
  const a = clean(actual),
    b = clean(expected);
  if (mode === 'sort-lines') {
    a.sort();
    b.sort();
  }
  return JSON.stringify(a) === JSON.stringify(b);
};
