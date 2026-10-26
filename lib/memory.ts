import {
  createEmptyCard,
  fsrs,
  Rating,
  type CardInput,
  type Grade,
  type ReviewLog,
} from 'ts-fsrs';

export { Rating };
export type { Grade };
export const MEMORY_KEY = 'acm-quick-drill:memory-v1';
// FSRS-6 (ts-fsrs 5.4.2). One short relearning step; long intervals use FSRS.
export const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
});
export type MemoryProblem = {
  id: string;
  lc: number | null;
  track: string;
  title: string;
  statement: string[];
  approach: string;
  inputContract: string;
  complexity: string;
  referenceCode: string;
  starterCode: string;
  inputStarterCode?: string;
  sampleInput: string;
  expectedOutput: string;
  normalizer: string;
  judgeMode?: 'sample' | 'structure';
  requiredSymbols?: string[];
  runtimeHint?: string;
  trackSequence?: number;
};
export type SavedCard = Omit<CardInput, 'due' | 'last_review'> & {
  due: string;
  last_review?: string;
};
export type Review = {
  id: string;
  problemId: string;
  at: string;
  grade: Grade;
  hinted: boolean;
  seconds: number;
  tests: number;
  validation?: 'tests' | 'structure';
  log: Omit<ReviewLog, 'due' | 'review'> & { due: string; review: string };
};
export type Attempt = {
  id: string;
  problemId: string;
  startedAt: string;
  code: string;
  kind: 'starter' | 'input' | 'draft' | 'reference';
  hints: Array<'approach' | 'answer'>;
  recorded: boolean;
  passedCode?: string;
  tests: number;
  validation?: 'tests' | 'structure';
};
export type Session = {
  queue: string[];
  pool?: string[];
  skipped?: string[];
  index: number;
  startedAt: string;
  attempt: Attempt | null;
};
export type MemoryStore = {
  version: 1;
  revision: string;
  cards: Record<string, SavedCard>;
  reviews: Review[];
  skippedDrafts?: Record<string, string>;
  session: Session | null;
};

export const emptyMemory = (): MemoryStore => ({
  version: 1,
  revision: '',
  cards: {},
  reviews: [],
  session: null,
});
const stamp = (date: Date) => date.toISOString();
const uniqueId = () => crypto.randomUUID();
export const dayKey = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export function dueIds(
  store: MemoryStore,
  problems: MemoryProblem[],
  now: Date,
) {
  return problems
    .filter(
      (p) =>
        store.cards[p.id] &&
        new Date(store.cards[p.id].due).getTime() <= now.getTime(),
    )
    .sort(
      (a, b) =>
        Date.parse(store.cards[a.id].due) - Date.parse(store.cards[b.id].due),
    )
    .map((p) => p.id);
}
export function freshAttempt(problem: MemoryProblem, now: Date): Attempt {
  return {
    id: uniqueId(),
    problemId: problem.id,
    startedAt: stamp(now),
    code: problem.starterCode,
    kind: 'starter',
    hints: [],
    recorded: false,
    tests: 0,
  };
}
export function startSession(
  store: MemoryStore,
  problems: MemoryProblem[],
  reviews: number,
  fresh: number,
  now: Date,
): MemoryStore {
  if (store.session?.attempt) return store;
  const cap = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const queue = [
    ...dueIds(store, problems, now).slice(0, cap(reviews)),
    ...problems
      .filter((p) => !store.cards[p.id])
      .slice(0, cap(fresh))
      .map((p) => p.id),
  ];
  if (!queue.length) return store;
  const first = problems.find((p) => p.id === queue[0])!;
  return {
    ...store,
    session: {
      queue,
      pool: problems.map((p) => p.id),
      skipped: [],
      index: 0,
      startedAt: stamp(now),
      attempt: freshAttempt(first, now),
    },
  };
}
export function editAttempt(
  store: MemoryStore,
  code: string,
  kind: Attempt['kind'] = 'draft',
): MemoryStore {
  if (!store.session?.attempt) return store;
  return {
    ...store,
    session: {
      ...store.session,
      attempt: {
        ...store.session.attempt,
        code,
        kind,
        passedCode: undefined,
        tests: 0,
        validation: undefined,
      },
    },
  };
}

export function sessionPool(store: MemoryStore, problems: MemoryProblem[]) {
  const session = store.session;
  if (!session) return [];
  // Old saved rounds only identify their scope through queued question tracks.
  const tracks = new Set(
    problems.filter((p) => session.queue.includes(p.id)).map((p) => p.track),
  );
  return problems.filter((p) =>
    session.pool ? session.pool.includes(p.id) : tracks.has(p.track),
  );
}

export function availableSessionNewProblems(
  store: MemoryStore,
  problems: MemoryProblem[],
) {
  const session = store.session;
  if (!session?.attempt) return [];
  const excluded = new Set([...session.queue, ...(session.skipped ?? [])]);
  return sessionPool(store, problems).filter(
    (p) => !store.cards[p.id] && !excluded.has(p.id),
  );
}

export function addSessionNewProblems(
  store: MemoryStore,
  problems: MemoryProblem[],
  ids: string[],
): MemoryStore {
  if (!store.session?.attempt) return store;
  const eligible = new Set(
    availableSessionNewProblems(store, problems).map((p) => p.id),
  );
  const added = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!added.length) return store;
  return {
    ...store,
    session: {
      ...store.session,
      queue: [...store.session.queue, ...added],
      pool: sessionPool(store, problems).map((p) => p.id),
    },
  };
}

export function skipAttempt(
  store: MemoryStore,
  problems: MemoryProblem[],
  now: Date,
): MemoryStore {
  const session = store.session;
  const attempt = session?.attempt;
  if (!session || !attempt) return store;
  const skipped = [...(session.skipped ?? []), attempt.problemId];
  const queue = session.queue.filter((id) => id !== attempt.problemId);
  const pool = sessionPool(store, problems);
  const excluded = new Set([...queue, ...skipped]);
  const replacement = [
    ...dueIds(store, pool, now),
    ...pool.filter((p) => !store.cards[p.id]).map((p) => p.id),
  ].find((id) => !excluded.has(id));
  if (replacement) queue.push(replacement);
  const next = problems.find((p) => p.id === queue[session.index]);
  return {
    ...store,
    skippedDrafts: {
      ...store.skippedDrafts,
      [attempt.problemId]: attempt.code,
    },
    session: {
      ...session,
      queue,
      pool: pool.map((p) => p.id),
      skipped,
      attempt: next ? freshAttempt(next, now) : null,
    },
  };
}
export function acceptAttempt(
  store: MemoryStore,
  attemptId: string,
  code: string,
  tests: number,
  validation: 'tests' | 'structure' = 'tests',
): MemoryStore {
  const attempt = store.session?.attempt;
  if (
    !attempt ||
    attempt.id !== attemptId ||
    attempt.code !== code ||
    (validation === 'tests' && tests < 2) ||
    (validation === 'structure' && !attempt.problemId.startsWith('mm-'))
  )
    return store;
  return {
    ...store,
    session: {
      ...store.session!,
      attempt: { ...attempt, passedCode: code, tests, validation },
    },
  };
}
export function previewGrades(
  store: MemoryStore,
  problemId: string,
  now: Date,
) {
  return scheduler.repeat(store.cards[problemId] ?? createEmptyCard(now), now);
}
export function isAttemptPassed(attempt?: Attempt | null) {
  return (
    !!attempt &&
    attempt.passedCode === attempt.code &&
    (attempt.validation === 'structure'
      ? attempt.problemId.startsWith('mm-')
      : attempt.tests >= 2)
  );
}
function record(store: MemoryStore, grade: Grade, now: Date): MemoryStore {
  const a = store.session?.attempt;
  if (!a || a.recorded) return store;
  if (grade !== Rating.Again && (a.hints.length || !isAttemptPassed(a)))
    return store;
  const { card, log } = scheduler.next(
    store.cards[a.problemId] ?? createEmptyCard(now),
    now,
    grade,
  );
  return {
    ...store,
    cards: {
      ...store.cards,
      [a.problemId]: {
        ...card,
        due: stamp(card.due),
        last_review: card.last_review ? stamp(card.last_review) : undefined,
      },
    },
    reviews: [
      ...store.reviews,
      {
        id: a.id,
        problemId: a.problemId,
        at: stamp(now),
        grade,
        hinted: a.hints.length > 0,
        seconds: Math.max(
          0,
          Math.round((now.getTime() - Date.parse(a.startedAt)) / 1000),
        ),
        tests: a.tests,
        validation: a.validation,
        log: { ...log, due: stamp(log.due), review: stamp(log.review) },
      },
    ],
    session: { ...store.session!, attempt: { ...a, recorded: true } },
  };
}
export function revealHint(
  store: MemoryStore,
  kind: 'approach' | 'answer',
  now: Date,
): MemoryStore {
  const a = store.session?.attempt;
  if (!a || a.hints.includes(kind)) return store;
  const hinted = {
    ...store,
    session: {
      ...store.session!,
      attempt: { ...a, hints: [...a.hints, kind] },
    },
  };
  return record(hinted, Rating.Again, now);
}
export function finishAttempt(
  store: MemoryStore,
  grade: Grade,
  problems: MemoryProblem[],
  now: Date,
): MemoryStore {
  const next = record(store, grade, now);
  const session = next.session;
  if (!session?.attempt?.recorded) return store;
  const index = session.index + 1;
  const problem = problems.find((p) => p.id === session.queue[index]);
  const skippedDrafts = next.skippedDrafts
    ? { ...next.skippedDrafts }
    : undefined;
  if (skippedDrafts) delete skippedDrafts[session.attempt.problemId];
  return {
    ...next,
    ...(skippedDrafts ? { skippedDrafts } : {}),
    session: {
      ...session,
      index,
      attempt: problem ? freshAttempt(problem, now) : null,
    },
  };
}
export function intervalLabel(due: Date | string, now: Date) {
  const minutes = Math.max(
    0,
    Math.round((new Date(due).getTime() - now.getTime()) / 60000),
  );
  if (!minutes) return '现在';
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时后`;
  return `${Math.round(minutes / 1440)} 天后`;
}
export function parseMemory(raw: string, validIds: Set<string>): MemoryStore {
  const data = JSON.parse(raw);
  const validDate = (s: unknown) =>
    typeof s === 'string' && Number.isFinite(Date.parse(s));
  const finite = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (
    !data ||
    data.version !== 1 ||
    typeof data.revision !== 'string' ||
    !data.cards ||
    typeof data.cards !== 'object' ||
    Array.isArray(data.cards) ||
    !Array.isArray(data.reviews)
  )
    throw new Error('学习记录格式不正确');
  for (const [id, value] of Object.entries(data.cards)) {
    const c = value as SavedCard;
    if (
      !validIds.has(id) ||
      !c ||
      !validDate(c.due) ||
      (c.last_review !== undefined && !validDate(c.last_review)) ||
      ![0, 1, 2, 3].includes(c.state as number) ||
      c.difficulty > 10 ||
      c.stability > 1_000_000 ||
      ![
        'stability',
        'difficulty',
        'elapsed_days',
        'scheduled_days',
        'learning_steps',
        'reps',
        'lapses',
      ].every((k) => finite((c as unknown as Record<string, unknown>)[k]))
    )
      throw new Error('学习卡片数据不完整');
  }
  const ids = new Set<string>();
  if (
    data.skippedDrafts !== undefined &&
    (!data.skippedDrafts ||
      typeof data.skippedDrafts !== 'object' ||
      Array.isArray(data.skippedDrafts) ||
      !Object.entries(data.skippedDrafts).every(
        ([id, code]) => validIds.has(id) && typeof code === 'string',
      ))
  )
    throw new Error('跳过的草稿数据不完整');
  for (const r of data.reviews) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      ids.has(r.id) ||
      !validIds.has(r.problemId) ||
      !validDate(r.at) ||
      ![1, 2, 3, 4].includes(r.grade) ||
      typeof r.hinted !== 'boolean' ||
      !finite(r.tests) ||
      ![undefined, 'tests', 'structure'].includes(r.validation) ||
      !finite(r.seconds) ||
      !r.log ||
      !validDate(r.log.due) ||
      !validDate(r.log.review)
    )
      throw new Error('复习历史数据不完整');
    ids.add(r.id);
  }
  if (data.session !== null) {
    const s = data.session;
    if (
      !s ||
      !Array.isArray(s.queue) ||
      (!s.queue.length && !(Array.isArray(s.skipped) && s.skipped.length)) ||
      new Set(s.queue).size !== s.queue.length ||
      !s.queue.every((id: string) => validIds.has(id)) ||
      !Number.isInteger(s.index) ||
      s.index < 0 ||
      s.index > s.queue.length ||
      !validDate(s.startedAt)
    )
      throw new Error('学习队列数据不完整');
    for (const list of [s.pool, s.skipped]) {
      if (
        list !== undefined &&
        (!Array.isArray(list) ||
          new Set(list).size !== list.length ||
          !list.every((id: string) => validIds.has(id)))
      )
        throw new Error('跳过题目或本轮范围不正确');
    }
    if (
      (s.skipped ?? []).some((id: string) => s.queue.includes(id)) ||
      (s.pool &&
        [...s.queue, ...(s.skipped ?? [])].some(
          (id: string) => !s.pool.includes(id),
        ))
    )
      throw new Error('跳过题目与学习队列冲突');
    const a = s.attempt;
    if (s.index < s.queue.length) {
      if (
        !a ||
        typeof a.id !== 'string' ||
        a.problemId !== s.queue[s.index] ||
        typeof a.code !== 'string' ||
        !validDate(a.startedAt) ||
        !['starter', 'input', 'draft', 'reference'].includes(a.kind) ||
        !Array.isArray(a.hints) ||
        !a.hints.every((h: string) => ['approach', 'answer'].includes(h)) ||
        typeof a.recorded !== 'boolean' ||
        !finite(a.tests) ||
        ![undefined, 'tests', 'structure'].includes(a.validation) ||
        (a.passedCode !== undefined && typeof a.passedCode !== 'string') ||
        (a.recorded && !ids.has(a.id)) ||
        (a.hints.length && !a.recorded)
      )
        throw new Error('默写草稿数据不完整');
    } else if (a !== null) throw new Error('学习队列状态不正确');
  }
  return data as MemoryStore;
}
