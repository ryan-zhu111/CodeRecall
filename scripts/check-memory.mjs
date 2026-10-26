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
const memoryModule = encode(
  transpile('lib/memory.ts').replace(
    "'ts-fsrs'",
    JSON.stringify(import.meta.resolve('ts-fsrs')),
  ),
);
const m = await import(memoryModule);
const learning = await import(
  encode(
    transpile('lib/learning-storage.ts').replace(
      "'./memory'",
      JSON.stringify(memoryModule),
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
const skipPool = problems.slice(0, 3);
let skipped = m.editAttempt(
  m.startSession(m.emptyMemory(), skipPool, 0, 1, now),
  '# unfinished draft',
);
const beforeSkip = skipped;
skipped = m.skipAttempt(skipped, data.problems, now);
assert.equal(
  skipped.session.attempt,
  null,
  'skipping the only scheduled question ends the round without replacement',
);
assert.equal(skipped.session.queue.length, 0, 'skip reduces this round by one');
assert.equal(skipped.session.index, 0, 'skipping is not completion');
assert.equal(skipped.cards, beforeSkip.cards, 'skip does not change FSRS');
assert.equal(
  skipped.reviews,
  beforeSkip.reviews,
  'skip adds no review or hint',
);
assert.equal(skipped.skippedDrafts[skipPool[0].id], '# unfinished draft');
skipped = m.parseMemory(JSON.stringify(skipped), ids);
assert.equal(
  skipped.session.attempt,
  null,
  'refresh does not refill an ended round',
);
let multiSkip = m.startSession(m.emptyMemory(), skipPool, 0, 2, now);
multiSkip = m.skipAttempt(multiSkip, data.problems, now);
assert.deepEqual(
  multiSkip.session.queue,
  [skipPool[1].id],
  'only the existing next question remains',
);
assert.equal(
  multiSkip.session.attempt.problemId,
  skipPool[1].id,
  'skip continues the existing queue',
);
multiSkip = m.parseMemory(JSON.stringify(multiSkip), ids);
multiSkip = m.skipAttempt(multiSkip, data.problems, now);
assert.equal(
  m.parseMemory(JSON.stringify(multiSkip), ids).session.attempt,
  null,
  'round ends even when more unlearned questions exist in the pool',
);
assert.equal(
  m.startSession(skipped, skipPool, 0, 1, now).session.attempt.code,
  skipPool[0].starterCode,
  'next round starts blank and includes skipped questions',
);
const hintedSkip = m.revealHint(
  m.startSession(m.emptyMemory(), skipPool, 0, 1, now),
  'approach',
  now,
);
assert.equal(
  m.skipAttempt(hintedSkip, data.problems, now).reviews,
  hintedSkip.reviews,
  'skip preserves existing hint record',
);
assert.equal(m.sessionProblemStatus(skipped, skipPool[0].id), 'skipped');
assert.ok(
  m
    .availableSessionProblems(skipped, data.problems)
    .some((p) => p.id === skipPool[0].id),
  'directly skipped question is addable',
);
const pendingSkip = m.skipAttempt(
  m.editAttempt(hintedSkip, ''),
  data.problems,
  now,
);
const skipFollowupRound = m.startSession(
  pendingSkip,
  skipPool.slice(1),
  0,
  1,
  now,
);
const restoredRound = m.parseMemory(JSON.stringify(skipFollowupRound), ids);
assert.equal(
  m.sessionProblemStatus(restoredRound, skipPool[0].id),
  'skipped',
  'empty skipped draft preserves skip status across rounds and refresh',
);
assert.ok(
  m
    .availableSessionProblems(restoredRound, data.problems)
    .some((p) => p.id === skipPool[0].id),
  'previously skipped question remains addable even with an existing FSRS card',
);
const readded = m.addSessionProblems(
  restoredRound,
  data.problems,
  [skipPool[0].id],
  now,
);
assert.equal(readded.session.queue.at(-1), skipPool[0].id);
assert.equal(
  readded.session.attempt,
  restoredRound.session.attempt,
  'manual re-add preserves current attempt',
);
assert.equal(
  readded.cards,
  restoredRound.cards,
  'manual re-add preserves previous FSRS cards',
);
assert.equal(
  readded.reviews,
  restoredRound.reviews,
  'manual re-add preserves review history',
);
assert.equal(
  m.sessionProblemStatus(readded, skipPool[0].id),
  'queued',
  'queued state wins over pending skip',
);
assert.equal(
  m.addSessionProblems(readded, data.problems, [skipPool[0].id], now),
  readded,
  'cannot add a queued question twice',
);
const completedAt = new Date(now.getTime() + 86400000);
let completedSkip = m.startSession(
  pendingSkip,
  [skipPool[0]],
  1,
  0,
  completedAt,
);
completedSkip = m.editAttempt(completedSkip, 'synthetic recalled solution');
completedSkip = m.acceptAttempt(
  completedSkip,
  completedSkip.session.attempt.id,
  'synthetic recalled solution',
  2,
);
completedSkip = m.finishAttempt(
  completedSkip,
  m.Rating.Good,
  data.problems,
  completedAt,
);
const afterCompletion = m.startSession(
  completedSkip,
  skipPool.slice(1),
  0,
  1,
  completedAt,
);
assert.equal(
  m.sessionProblemStatus(afterCompletion, skipPool[0].id),
  'learned',
  'completed attempts clear pending skip status',
);
assert.ok(
  !m
    .availableSessionProblems(afterCompletion, data.problems)
    .some((p) => p.id === skipPool[0].id),
  'completed learned question remains disabled',
);
// Round navigation: independent drafts, out-of-order completion and safe retries.
{
  const bank = problems.slice(0, 4);
  let round = m.startSession(m.emptyMemory(), bank, 0, 3, now);
  round = m.editAttempt(round, 'first draft');
  const firstAttempt = round.session.attempt;
  round = m.switchSessionProblem(round, bank, bank[1].id, now);
  round = m.editAttempt(round, 'second draft');
  round = m.revealHint(round, 'approach', now);
  const hintedReviews = round.reviews;
  round = m.switchSessionProblem(round, bank, bank[2].id, now);
  assert.equal(
    round.session.index,
    0,
    'jumping ahead does not count completion',
  );
  assert.equal(round.reviews, hintedReviews, 'switching does not grade');
  assert.equal(
    m.acceptAttempt(round, firstAttempt.id, firstAttempt.code, 2),
    round,
    'old question result is ignored',
  );
  round = m.editAttempt(round, 'third solution');
  round = m.acceptAttempt(round, round.session.attempt.id, 'third solution', 2);
  round = m.saveAttemptResult(
    round,
    round.session.attempt.id,
    'third solution',
    { status: 'accepted', text: 'passed synthetic checks' },
  );
  round = m.finishAttempt(round, m.Rating.Good, bank, now);
  assert.deepEqual(m.completedSessionIds(round.session), [bank[2].id]);
  assert.equal(round.session.index, 1);
  assert.equal(
    round.session.attempt.id,
    firstAttempt.id,
    'wraps to the existing earlier attempt',
  );
  assert.equal(round.session.attempt.code, 'first draft');
  round = m.parseMemory(JSON.stringify(round), ids);
  round = m.switchSessionProblem(round, bank, bank[2].id, now);
  assert.equal(
    round.session.attempt.result.status,
    'accepted',
    'refresh keeps saved judge result',
  );
  const oldCards = round.cards,
    oldReviews = round.reviews;
  round = m.editAttempt(round, 'wrong retry');
  round = m.saveAttemptResult(round, round.session.attempt.id, 'wrong retry', {
    status: 'wrong',
    text: 'synthetic failure',
  });
  round = m.revealHint(round, 'answer', now);
  round = m.finishAttempt(round, m.Rating.Again, bank, now);
  assert.equal(
    round.cards,
    oldCards,
    'completed-question retry does not change FSRS',
  );
  assert.equal(
    round.reviews,
    oldReviews,
    'completed-question hints and retries do not grade again',
  );
  assert.equal(
    round.session.index,
    1,
    'failed retry does not undo or duplicate completion',
  );
  round = m.switchSessionProblem(round, bank, bank[2].id, now);
  assert.equal(round.session.attempt.code, 'wrong retry');
  assert.equal(round.session.attempt.result.status, 'wrong');
  round = m.editAttempt(round, 'correct retry');
  round = m.acceptAttempt(round, round.session.attempt.id, 'correct retry', 2);
  round = m.finishAttempt(round, m.Rating.Easy, bank, now);
  assert.equal(
    round.reviews,
    oldReviews,
    'successful retry also does not grade again',
  );
  round = m.acceptAttempt(
    round,
    round.session.attempt.id,
    round.session.attempt.code,
    2,
  );
  round = m.finishAttempt(round, m.Rating.Good, bank, now);
  assert.equal(round.session.attempt.code, 'second draft');
  assert.deepEqual(round.session.attempt.hints, ['approach']);
  const beforeHintFinish = round.reviews.length;
  round = m.finishAttempt(round, m.Rating.Again, bank, now);
  assert.equal(round.reviews.length, beforeHintFinish);
  assert.equal(round.session.index, 3);
  assert.equal(round.session.attempt, null);
  round = m.parseMemory(JSON.stringify(round), ids);
  const appended = m.addSessionProblems(round, bank, [bank[3].id], now);
  assert.equal(appended.session.attempt.problemId, bank[3].id);
  assert.equal(m.parseMemory(JSON.stringify(appended), ids).session.index, 3);
  const reopened = m.switchSessionProblem(round, bank, bank[0].id, now);
  assert.equal(
    reopened.session.attempt.code,
    'first draft',
    'completed round remains browsable',
  );
  assert.equal(
    m.startSession(reopened, bank, 0, 1, now).session.queue[0],
    bank[3].id,
    'can start a new round after browsing completed work',
  );

  let skippedRound = m.startSession(m.emptyMemory(), bank, 0, 3, now);
  skippedRound = m.editAttempt(skippedRound, 'keep earlier draft');
  skippedRound = m.switchSessionProblem(skippedRound, bank, bank[1].id, now);
  skippedRound = m.skipAttempt(skippedRound, bank, now);
  assert.deepEqual(skippedRound.session.queue, [bank[0].id, bank[2].id]);
  assert.equal(skippedRound.session.attempt.problemId, bank[2].id);
  skippedRound = m.skipAttempt(skippedRound, bank, now);
  assert.equal(
    skippedRound.session.attempt.code,
    'keep earlier draft',
    'skip wraps to earlier unfinished drafts',
  );
  assert.equal(
    m.parseMemory(JSON.stringify(skippedRound), ids).session.index,
    0,
  );

  let legacy = m.startSession(m.emptyMemory(), bank, 0, 2, now);
  legacy = m.finishAttempt(legacy, m.Rating.Again, bank, now);
  delete legacy.session.attempts;
  delete legacy.session.completed;
  const legacyDraft = legacy.session.attempt;
  legacy = m.parseMemory(JSON.stringify(legacy), ids);
  const legacyReviews = legacy.reviews;
  legacy = m.switchSessionProblem(legacy, bank, bank[0].id, now);
  legacy = m.revealHint(legacy, 'answer', now);
  legacy = m.parseMemory(JSON.stringify(legacy), ids);
  legacy = m.finishAttempt(legacy, m.Rating.Again, bank, now);
  assert.equal(
    legacy.session.attempt.id,
    legacyDraft.id,
    'legacy active attempt survives upgrade',
  );
  assert.equal(
    legacy.reviews.length,
    legacyReviews.length,
    'legacy completed question cannot be graded again',
  );
  const corrupt = JSON.parse(JSON.stringify(legacy));
  corrupt.session.completed.push(bank[0].id);
  assert.throws(
    () => m.parseMemory(JSON.stringify(corrupt), ids),
    'duplicate completion is rejected',
  );
}
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

// Exercise factory reset against real FSRS data and legacy editor formats.
let practiced = m.startSession(m.emptyMemory(), [p, multimodal[0]], 0, 2, now);
practiced = m.revealHint(practiced, 'approach', now);
practiced = m.finishAttempt(practiced, m.Rating.Again, [p, multimodal[0]], now);
practiced = m.revealHint(practiced, 'answer', now);
practiced = m.editAttempt(practiced, '# unfinished multimodal solution');
practiced.revision = 'before-reset';
const appearanceKey = 'acm-quick-drill:appearance-v1';
const originalEntries = [
  [m.MEMORY_KEY, JSON.stringify(practiced)],
  [learning.SOLVED_KEY, JSON.stringify([1, p.id, multimodal[0].id])],
  [
    learning.DRAFTS_KEY,
    JSON.stringify({ 1: 'legacy numbered draft', [p.id]: 'legacy draft' }),
  ],
  [
    learning.VERSIONED_DRAFTS_KEY,
    JSON.stringify({
      [`original:${p.id}`]: { kind: 'draft', code: 'old edition draft' },
      [editor.draftKey(p.id)]: { kind: 'draft', code: 'current draft' },
    }),
  ],
  [learning.LEARNING_RESET_KEY, 'previous-generation'],
  [appearanceKey, JSON.stringify({ theme: 'dark', fontSize: 21 })],
  ['another-app:important', 'keep me'],
];
function mockStorage(entries, failAt = 0) {
  const values = new Map(entries);
  let writes = 0;
  const beforeWrite = () => {
    writes++;
    if (writes === failAt) throw new Error('simulated storage failure');
  };
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      beforeWrite();
      values.set(key, value);
    },
    removeItem: (key) => {
      beforeWrite();
      values.delete(key);
    },
  };
}
const resetStorage = mockStorage(originalEntries);
const oldGeneration = learning.learningGeneration(resetStorage);
assert.equal(learning.isCurrentLearning(resetStorage, oldGeneration), true);
learning.resetLearningProgress(resetStorage);
const resetMemory = m.parseMemory(
  resetStorage.getItem(m.MEMORY_KEY),
  new Set(data.problems.map((p) => p.id)),
);
assert.deepEqual(
  resetMemory.cards,
  {},
  'all algorithm and multimodal cards are reset',
);
assert.deepEqual(resetMemory.reviews, [], 'review history is reset');
assert.equal(resetMemory.session, null, 'unfinished round and code are reset');
assert.ok(resetMemory.revision && resetMemory.revision !== practiced.revision);
assert.equal(learning.learningGeneration(resetStorage), resetMemory.revision);
assert.equal(
  learning.isCurrentLearning(resetStorage, oldGeneration),
  false,
  'stale tabs and pending imports are rejected',
);
assert.equal(
  learning.isCurrentLearning(resetStorage, resetMemory.revision),
  true,
);
for (const key of [
  learning.SOLVED_KEY,
  learning.DRAFTS_KEY,
  learning.VERSIONED_DRAFTS_KEY,
])
  assert.equal(
    resetStorage.getItem(key),
    null,
    `${key} must not survive reset`,
  );
for (const key of [appearanceKey, 'another-app:important'])
  assert.equal(
    resetStorage.getItem(key),
    new Map(originalEntries).get(key),
    `${key} is preserved`,
  );
const migratedAfterReset = editor.migrateDrafts(
  data.problems,
  JSON.parse(resetStorage.getItem(learning.DRAFTS_KEY) ?? '{}'),
  JSON.parse(resetStorage.getItem(learning.VERSIONED_DRAFTS_KEY) ?? '{}'),
);
assert.deepEqual(
  migratedAfterReset,
  {},
  'refresh cannot resurrect historical drafts',
);
assert.equal(
  editor.getEditorCode(p, migratedAfterReset[editor.draftKey(p.id)]),
  p.starterCode,
);
assert.deepEqual(
  m.dueIds(resetMemory, data.problems, now),
  [],
  'nothing is due after reset',
);
const newRound = m.startSession(
  resetMemory,
  data.problems,
  0,
  data.problems.length,
  now,
);
assert.equal(
  newRound.session.queue.length,
  data.problems.length,
  'all questions become new again',
);
assert.equal(newRound.session.attempt.code, data.problems[0].starterCode);
learning.resetLearningProgress(resetStorage);
assert.notEqual(
  learning.learningGeneration(resetStorage),
  resetMemory.revision,
  'repeated reset invalidates the preceding generation too',
);

// Inject a one-off failure at every mutation, including the final generation
// write, to ensure original data is restored rather than partly cleared.
for (let failAt = 1; failAt <= 5; failAt++) {
  const failingStorage = mockStorage(originalEntries, failAt);
  assert.throws(
    () => learning.resetLearningProgress(failingStorage),
    /原记录已保留/,
  );
  assert.deepEqual(
    failingStorage.values,
    new Map(originalEntries),
    `reset rollback at write ${failAt}`,
  );
  assert.equal(learning.isCurrentLearning(failingStorage, oldGeneration), true);
}
const newUserEntries = [[appearanceKey, 'existing preferences']];
const failedNewUser = mockStorage(newUserEntries, 5);
assert.throws(
  () => learning.resetLearningProgress(failedNewUser),
  /原记录已保留/,
);
assert.deepEqual(
  failedNewUser.values,
  new Map(newUserEntries),
  'rollback removes newly created values when no previous records existed',
);
const unreadableStorage = mockStorage(originalEntries);
unreadableStorage.getItem = () => {
  throw new Error('storage read blocked');
};
assert.throws(
  () => learning.resetLearningProgress(unreadableStorage),
  /storage read blocked/,
);
assert.deepEqual(
  unreadableStorage.values,
  new Map(originalEntries),
  'snapshot failure does not change any data',
);
const corruptStorage = mockStorage([[m.MEMORY_KEY, '{invalid JSON']]);
learning.resetLearningProgress(corruptStorage);
assert.equal(
  m.parseMemory(corruptStorage.getItem(m.MEMORY_KEY), ids).session,
  null,
  'reset also recovers from corrupt learning data',
);
const failedRollback = mockStorage(originalEntries);
const storeValue = failedRollback.setItem;
failedRollback.setItem = (key, value) => {
  if (
    key === learning.LEARNING_RESET_KEY ||
    value === new Map(originalEntries).get(m.MEMORY_KEY)
  )
    throw new Error('persistent storage failure');
  storeValue(key, value);
};
assert.throws(
  () => learning.resetLearningProgress(failedRollback),
  /重置未完整完成/,
  'rollback failure is explicit rather than reported as success',
);
console.log(
  'PASS: FSRS scheduling, hint enforcement, full-test gating, 15 multimodal cards and structure grading, stale result rejection, daily queue, refresh, overdue reviews, draft migration, answer removal, factory reset, generation invalidation and storage rollback.',
);
