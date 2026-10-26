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
  hot100?: boolean;
  codeTopRank?: number;
  category?: string;
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
  result?: { status: 'accepted' | 'wrong' | 'error'; text: string };
};
export type Session = {
  queue: string[];
  pool?: string[];
  skipped?: string[];
  index: number;
  startedAt: string;
  attempt: Attempt | null;
  attempts?: Record<string, Attempt>;
  completed?: string[];
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
export function completedSessionIds(session: Session | null) {
  return session
    ? (session.completed ?? session.queue.slice(0, session.index))
    : [];
}
export function sessionAttempts(session: Session) {
  return {
    ...session.attempts,
    ...(session.attempt
      ? { [session.attempt.problemId]: session.attempt }
      : {}),
  };
}
function saveAttempt(store: MemoryStore, attempt: Attempt): MemoryStore {
  const session = store.session!;
  return {
    ...store,
    session: {
      ...session,
      completed: completedSessionIds(session),
      attempts: { ...sessionAttempts(session), [attempt.problemId]: attempt },
      attempt,
    },
  };
}
export function switchSessionProblem(
  store: MemoryStore,
  problems: MemoryProblem[],
  problemId: string,
  now: Date,
): MemoryStore {
  const session = store.session;
  if (!session || !session.queue.includes(problemId)) return store;
  const problem = problems.find((p) => p.id === problemId);
  if (!problem || session.attempt?.problemId === problemId) return store;
  const saved = sessionAttempts(session);
  return saveAttempt(store, saved[problemId] ?? freshAttempt(problem, now));
}
function advanceSession(
  store: MemoryStore,
  problems: MemoryProblem[],
  afterId: string,
  now: Date,
): MemoryStore {
  const session = store.session!;
  const completed = completedSessionIds(session);
  const attempts = sessionAttempts(session);
  const pos = session.queue.indexOf(afterId);
  const ordered = [
    ...session.queue.slice(pos + 1),
    ...session.queue.slice(0, pos + 1),
  ];
  const nextId = ordered.find((id) => !completed.includes(id));
  const problem = problems.find((p) => p.id === nextId);
  const next = {
    ...store,
    session: {
      ...session,
      completed,
      attempts,
      index: completed.length,
      attempt: null,
    },
  };
  return problem
    ? saveAttempt(next, attempts[problem.id] ?? freshAttempt(problem, now))
    : next;
}
export function startSession(
  store: MemoryStore,
  problems: MemoryProblem[],
  reviews: number,
  fresh: number,
  now: Date,
): MemoryStore {
  if (
    store.session?.queue.some(
      (id) => !completedSessionIds(store.session).includes(id),
    )
  )
    return store;
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
      attempts: {},
      completed: [],
    },
  };
}
export function editAttempt(
  store: MemoryStore,
  code: string,
  kind: Attempt['kind'] = 'draft',
): MemoryStore {
  if (!store.session?.attempt) return store;
  return saveAttempt(store, {
    ...store.session.attempt,
    code,
    kind,
    passedCode: undefined,
    tests: 0,
    validation: undefined,
    result: undefined,
  });
}

export function sessionPool(store: MemoryStore, problems: MemoryProblem[]) {
  const session = store.session;
  if (!session) return [];
  // Old saved rounds only identify their scope through queued question tracks.
  const tracks = new Set(
    problems
      .filter(
        (p) => session.queue.includes(p.id) || session.skipped?.includes(p.id),
      )
      .map((p) => p.track),
  );
  return problems.filter((p) =>
    session.pool ? session.pool.includes(p.id) : tracks.has(p.track),
  );
}

export type SessionProblemStatus = 'new' | 'skipped' | 'queued' | 'learned';

export function sessionProblemStatus(
  store: MemoryStore,
  problemId: string,
): SessionProblemStatus {
  if (store.session?.queue.includes(problemId)) return 'queued';
  // A pending skip survives a new round through its saved draft, even if empty.
  if (
    store.session?.skipped?.includes(problemId) ||
    Object.hasOwn(store.skippedDrafts ?? {}, problemId)
  )
    return 'skipped';
  return store.cards[problemId] ? 'learned' : 'new';
}

export function availableSessionProblems(
  store: MemoryStore,
  problems: MemoryProblem[],
) {
  const session = store.session;
  if (!session) return [];
  // Manual selection uses the complete catalog, including for saved old rounds.
  return problems.filter((p) => {
    const status = sessionProblemStatus(store, p.id);
    return status === 'new' || status === 'skipped';
  });
}

export function addSessionProblems(
  store: MemoryStore,
  problems: MemoryProblem[],
  ids: string[],
  now: Date,
): MemoryStore {
  const session = store.session;
  if (!session) return store;
  const eligible = new Set(
    availableSessionProblems(store, problems).map((p) => p.id),
  );
  const added = [...new Set(ids)].filter((id) => eligible.has(id));
  if (!added.length) return store;
  return {
    ...store,
    session: {
      ...session,
      completed: completedSessionIds(session),
      attempts: sessionAttempts(session),
      queue: [...session.queue, ...added],
      // Keep the saved round scope valid when manually adding outside questions.
      pool: [
        ...new Set([
          ...sessionPool(store, problems).map((p) => p.id),
          ...added,
        ]),
      ],
      // Explicitly adding a skipped question cancels only its skip marker.
      skipped: (session.skipped ?? []).filter((id) => !added.includes(id)),
      attempt:
        session.attempt ??
        freshAttempt(
          problems.find((p) => p.id === added[0])!,
          now,
        ),
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
  if (
    !session ||
    !attempt ||
    completedSessionIds(session).includes(attempt.problemId)
  )
    return store;
  const skipped = [...(session.skipped ?? []), attempt.problemId];
  const queue = session.queue.filter((id) => id !== attempt.problemId);
  const pool = sessionPool(store, problems);
  const attempts = sessionAttempts(session);
  delete attempts[attempt.problemId];
  const next: MemoryStore = {
    ...store,
    skippedDrafts: {
      ...store.skippedDrafts,
      [attempt.problemId]: attempt.code,
    },
    session: {
      ...session,
      completed: completedSessionIds(session),
      attempts,
      queue,
      pool: pool.map((p) => p.id),
      skipped,
      attempt: null,
    },
  };
  // Continue after the removed position, wrapping to earlier unfinished work.
  const precedingId =
    session.queue[session.queue.indexOf(attempt.problemId) - 1] ?? '';
  return advanceSession(next, problems, precedingId, now);
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
  return saveAttempt(store, {
    ...attempt,
    passedCode: code,
    tests,
    validation,
  });
}
export function saveAttemptResult(
  store: MemoryStore,
  attemptId: string,
  code: string,
  result: NonNullable<Attempt['result']>,
): MemoryStore {
  const attempt = store.session?.attempt;
  if (!attempt || attempt.id !== attemptId || attempt.code !== code)
    return store;
  return saveAttempt(store, { ...attempt, result });
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
  if (
    !a ||
    a.recorded ||
    completedSessionIds(store.session).includes(a.problemId)
  )
    return store;
  if (grade !== Rating.Again && (a.hints.length || !isAttemptPassed(a)))
    return store;
  const { card, log } = scheduler.next(
    store.cards[a.problemId] ?? createEmptyCard(now),
    now,
    grade,
  );
  return saveAttempt(
    {
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
    },
    { ...a, recorded: true },
  );
}
export function revealHint(
  store: MemoryStore,
  kind: 'approach' | 'answer',
  now: Date,
): MemoryStore {
  const a = store.session?.attempt;
  if (!a || a.hints.includes(kind)) return store;
  const hinted = saveAttempt(store, { ...a, hints: [...a.hints, kind] });
  return record(hinted, Rating.Again, now);
}
export function finishAttempt(
  store: MemoryStore,
  grade: Grade,
  problems: MemoryProblem[],
  now: Date,
): MemoryStore {
  const current = store.session?.attempt;
  if (!current) return store;
  if (completedSessionIds(store.session).includes(current.problemId))
    return advanceSession(store, problems, current.problemId, now);
  const next = record(store, grade, now);
  const session = next.session;
  if (!session?.attempt?.recorded) return store;
  const completed = [
    ...new Set([...completedSessionIds(session), session.attempt.problemId]),
  ];
  const skippedDrafts = next.skippedDrafts
    ? { ...next.skippedDrafts }
    : undefined;
  if (skippedDrafts) delete skippedDrafts[session.attempt.problemId];
  return advanceSession(
    {
      ...next,
      ...(skippedDrafts ? { skippedDrafts } : {}),
      session: {
        ...session,
        completed,
        index: completed.length,
        attempts: sessionAttempts(session),
      },
    },
    problems,
    session.attempt.problemId,
    now,
  );
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
    const modern = s.completed !== undefined || s.attempts !== undefined;
    if (
      modern &&
      (!Array.isArray(s.completed) ||
        new Set(s.completed).size !== s.completed.length ||
        !s.completed.every(
          (id: string) => s.queue.includes(id) && data.cards[id],
        ) ||
        s.index !== s.completed.length ||
        !s.attempts ||
        typeof s.attempts !== 'object' ||
        Array.isArray(s.attempts))
    )
      throw new Error('本轮完成记录或草稿集合不正确');
    const completed = modern ? s.completed : s.queue.slice(0, s.index);
    const checkAttempt = (a: Attempt, problemId: string) => {
      if (
        !a ||
        typeof a.id !== 'string' ||
        a.problemId !== problemId ||
        !s.queue.includes(problemId) ||
        typeof a.code !== 'string' ||
        !validDate(a.startedAt) ||
        !['starter', 'input', 'draft', 'reference'].includes(a.kind) ||
        !Array.isArray(a.hints) ||
        !a.hints.every((h: string) => ['approach', 'answer'].includes(h)) ||
        typeof a.recorded !== 'boolean' ||
        !finite(a.tests) ||
        ![undefined, 'tests', 'structure'].includes(a.validation) ||
        (a.passedCode !== undefined && typeof a.passedCode !== 'string') ||
        (a.recorded &&
          !data.reviews.some(
            (r: Review) => r.id === a.id && r.problemId === problemId,
          )) ||
        (a.hints.length && !a.recorded && !completed.includes(problemId)) ||
        (a.result !== undefined &&
          (!a.result ||
            !['accepted', 'wrong', 'error'].includes(a.result.status) ||
            typeof a.result.text !== 'string'))
      )
        throw new Error('默写草稿数据不完整');
    };
    const a = s.attempt;
    if (modern) {
      const attemptIds = new Set();
      for (const [id, attempt] of Object.entries(s.attempts)) {
        checkAttempt(attempt as Attempt, id);
        if (attemptIds.has((attempt as Attempt).id))
          throw new Error('本轮草稿标识重复');
        attemptIds.add((attempt as Attempt).id);
      }
      if (a !== null) {
        checkAttempt(a, a?.problemId);
        if (
          s.attempts[a.problemId] &&
          JSON.stringify(s.attempts[a.problemId]) !== JSON.stringify(a)
        )
          throw new Error('当前草稿与本轮保存状态冲突');
        if (!s.attempts[a.problemId] && attemptIds.has(a.id))
          throw new Error('本轮草稿标识重复');
      } else if (s.index !== s.queue.length)
        throw new Error('本轮仍有未完成题目');
    } else if (s.index < s.queue.length) checkAttempt(a, s.queue[s.index]);
    else if (a !== null) throw new Error('学习队列状态不正确');
  }
  return data as MemoryStore;
}
