import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createEmptyCard } from 'ts-fsrs';

const encode = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const transpile = (path) =>
  ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const m = await import(
  encode(
    transpile('lib/memory.ts').replace(
      "'ts-fsrs'",
      JSON.stringify(import.meta.resolve('ts-fsrs')),
    ),
  )
);
const fingerprints = encode(transpile('lib/legacy-answer-fingerprints.ts'));
const editor = await import(
  encode(
    transpile('lib/editor-state.ts').replace(
      "'./legacy-answer-fingerprints'",
      JSON.stringify(fingerprints),
    ),
  )
);
const data = JSON.parse(fs.readFileSync('public/problems.json', 'utf8'));
const problems = data.problems.filter((p) => p.track === 'leetcode');
const ids = new Set(problems.map((p) => p.id));
const now = new Date('2026-10-26T02:00:00Z');
let s = m.startSession(m.emptyMemory(), problems, 0, 2, now);
assert.equal(s.session.attempt.code, problems[0].starterCode);
assert.equal(s.session.queue.length, 2);
assert.equal(
  m.finishAttempt(s, m.Rating.Good, problems, now),
  s,
  'cannot grade good without tests',
);
s = m.editAttempt(s, problems[0].inputStarterCode, 'input');
assert.equal(s.reviews.length, 0, 'input template is not a hint');
assert.equal(s.session.attempt.hints.length, 0);
const attemptId = s.session.attempt.id;
s = m.acceptAttempt(s, attemptId, s.session.attempt.code, 8);
assert.equal(s.session.attempt.tests, 8);
s = m.editAttempt(s, 'changed');
assert.equal(
  s.session.attempt.passedCode,
  undefined,
  'editing invalidates pass',
);
assert.equal(
  m.acceptAttempt(s, attemptId, 'old code', 8),
  s,
  'stale code result is rejected',
);
assert.equal(
  m.acceptAttempt(s, 'stale attempt', 'changed', 8),
  s,
  'stale question result is rejected',
);
s = m.revealHint(s, 'approach', now);
assert.equal(s.reviews.length, 1);
assert.equal(s.reviews[0].grade, m.Rating.Again);
assert.equal(s.reviews[0].hinted, true);
const hintedDue = s.cards[problems[0].id].due;
s = m.revealHint(s, 'answer', now);
assert.equal(s.reviews.length, 1, 'two hint buttons record once');
s = m.editAttempt(s, problems[0].referenceCode, 'reference');
s = m.acceptAttempt(s, attemptId, s.session.attempt.code, 12);
s = m.finishAttempt(s, m.Rating.Easy, problems, now);
assert.equal(
  s.cards[problems[0].id].due,
  hintedDue,
  'hint cannot be promoted to easy',
);
assert.equal(s.reviews.length, 1);
assert.equal(s.session.attempt.problemId, problems[1].id);
assert.equal(
  s.session.attempt.code,
  problems[1].starterCode,
  'every new attempt starts blank',
);
assert.equal(s.session.attempt.hints.length, 0);
const roundtrip = m.parseMemory(JSON.stringify(s), ids);
assert.deepEqual(
  roundtrip,
  JSON.parse(JSON.stringify(s)),
  'refresh preserves progress and draft',
);
s = m.editAttempt(s, 'valid solution');
s = m.acceptAttempt(s, s.session.attempt.id, 'valid solution', 10);
const expected = m.scheduler.next(createEmptyCard(now), now, m.Rating.Good);
s = m.finishAttempt(s, m.Rating.Good, problems, now);
assert.equal(
  s.cards[problems[1].id].due,
  expected.card.due.toISOString(),
  'uses real FSRS result',
);
assert.equal(s.session.attempt, null);
const later = new Date('2026-11-26T02:00:00Z');
assert.equal(
  m.dueIds(s, problems, later).length,
  2,
  'overdue cards are retained',
);
s = m.startSession(s, problems, 1, 1, later);
assert.deepEqual(
  s.session.queue,
  [problems[0].id, problems[2].id],
  'due first, then unlearned',
);
assert.equal(
  s.session.attempt.code,
  problems[0].starterCode,
  'due review never reuses previous code',
);
const afterDelay = m.scheduler.next(
  s.cards[problems[0].id],
  later,
  m.Rating.Good,
);
s = m.editAttempt(s, 'recalled');
s = m.acceptAttempt(s, s.session.attempt.id, 'recalled', 10);
s = m.finishAttempt(s, m.Rating.Good, problems, later);
assert.equal(
  s.cards[problems[0].id].due,
  afterDelay.card.due.toISOString(),
  'elapsed time reaches FSRS',
);
assert.throws(() => m.parseMemory('{"version":99}', ids));
assert.throws(() =>
  m.parseMemory(
    JSON.stringify({
      ...s,
      cards: { ...s.cards, 'lc-bad': s.cards[problems[0].id] },
    }),
    ids,
  ),
);
assert.equal(m.dayKey(new Date('2026-10-25T18:00:00Z')), '2026-10-26');
assert.equal(
  m.startSession(m.emptyMemory(), problems, 0, 0, now).session,
  null,
);
const p = problems[0];
assert.equal(editor.getEditorCode(p, { kind: 'reference' }), p.referenceCode);
assert.equal(editor.getEditorCode(p, { kind: 'input' }), p.inputStarterCode);
assert.equal(editor.getEditorCode(p, { kind: 'draft', code: '' }), '');
assert.equal(
  editor.migrateDrafts(
    [p],
    {},
    { [`original:${p.id}`]: { kind: 'draft', code: 'my solution' } },
  )[editor.draftKey(p.id)].code,
  'my solution',
);
assert.equal(
  editor.migrateDrafts([p], { [p.id]: p.referenceCode }, {})[
    editor.draftKey(p.id)
  ].kind,
  'reference',
);
assert.ok(
  data.problems.every(
    (p) =>
      !Object.keys(p).some(
        (k) => k.startsWith('original') || k === 'previousReferenceCode',
      ),
  ),
);
assert.ok(!fs.existsSync('public/backups/problems-v8-original.json'));
const ctx = { self: {} };
vm.runInNewContext(fs.readFileSync('public/review-judge.js', 'utf8'), ctx);
const match = ctx.self.matchesReviewOutput;
assert.ok(
  match('0 2', '0 1', 'trim', 'lc-1', '3 4\n1 3 3\n'),
  'two-sum accepts valid alternative',
);
assert.ok(!match('0 0', '0 1', 'trim', 'lc-1', '2 4\n2 2\n'));
assert.ok(match('2  1\n3', '3 2 1', 'sort-numbers', 'lc-347', ''));
assert.ok(!match('x', '1', 'sort-numbers', 'lc-347', ''));
assert.ok(match('b\na', 'a\nb', 'sort-lines', '', ''));
assert.ok(!match('a\na', 'a', 'sort-lines', '', ''));
assert.ok(!match('hardcoded', 'expected', 'trim', '', ''));
const multimodal = data.problems.filter((p) => p.track === 'multimodal');
assert.equal(multimodal.length, 15);
let mm = m.startSession(m.emptyMemory(), multimodal, 0, 15, now);
assert.equal(
  mm.session.queue.length,
  15,
  'all multimodal tasks enter the queue',
);
assert.ok(mm.session.queue.every((id) => id.startsWith('mm-')));
assert.equal(
  m.finishAttempt(mm, m.Rating.Good, multimodal, now),
  mm,
  'structure check is required',
);
mm = m.editAttempt(mm, multimodal[0].referenceCode);
assert.equal(
  m.acceptAttempt(mm, mm.session.attempt.id, mm.session.attempt.code, 0),
  mm,
  'zero numerical tests do not count as a test pass',
);
mm = m.acceptAttempt(
  mm,
  mm.session.attempt.id,
  mm.session.attempt.code,
  0,
  'structure',
);
assert.equal(m.isAttemptPassed(mm.session.attempt), true);
let modified = m.editAttempt(mm, mm.session.attempt.code + '\n');
assert.equal(
  m.isAttemptPassed(modified.session.attempt),
  false,
  'editing revokes structure pass too',
);
mm = m.finishAttempt(mm, m.Rating.Good, multimodal, now);
assert.equal(mm.reviews[0].validation, 'structure');
assert.equal(
  mm.reviews[0].tests,
  0,
  'do not claim numerical test coverage for multimodal',
);
assert.equal(mm.session.attempt.problemId, multimodal[1].id);
mm = m.revealHint(mm, 'answer', now);
mm = m.finishAttempt(mm, m.Rating.Easy, multimodal, now);
assert.equal(
  mm.reviews.at(-1).grade,
  m.Rating.Again,
  'multimodal hints also force Again',
);
assert.equal(
  Object.keys(
    m.parseMemory(JSON.stringify(mm), new Set(data.problems.map((p) => p.id)))
      .cards,
  ).length,
  2,
);
let algorithm = m.startSession(m.emptyMemory(), problems, 0, 1, now);
assert.equal(
  m.acceptAttempt(
    algorithm,
    algorithm.session.attempt.id,
    algorithm.session.attempt.code,
    0,
    'structure',
  ),
  algorithm,
  'algorithm tasks cannot bypass test suite with a structure pass',
);
console.log(
  'PASS: FSRS scheduling, hint enforcement, full-test gating, 15 multimodal cards and structure grading, stale result rejection, daily queue, refresh, overdue reviews, draft migration and answer removal.',
);
