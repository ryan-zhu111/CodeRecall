import { emptyMemory, MEMORY_KEY } from './memory';

export const SOLVED_KEY = 'acm-quick-drill:solved';
export const DRAFTS_KEY = 'acm-quick-drill:drafts';
export const VERSIONED_DRAFTS_KEY = 'acm-quick-drill:drafts-by-version';
export const LEARNING_RESET_KEY = 'acm-quick-drill:learning-reset';

type LearningStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function learningGeneration(storage: LearningStorage) {
  return storage.getItem(LEARNING_RESET_KEY) ?? '';
}

export function isCurrentLearning(
  storage: LearningStorage,
  generation: string,
) {
  return learningGeneration(storage) === generation;
}

// Keep display preferences and unrelated data. Snapshot first so a failed
// storage write can be rolled back without reporting a successful reset.
export function resetLearningProgress(storage: LearningStorage) {
  const keys = [
    MEMORY_KEY,
    SOLVED_KEY,
    DRAFTS_KEY,
    VERSIONED_DRAFTS_KEY,
    LEARNING_RESET_KEY,
  ];
  const previous = keys.map((key) => [key, storage.getItem(key)] as const);
  const revision = crypto.randomUUID();
  try {
    storage.setItem(MEMORY_KEY, JSON.stringify({ ...emptyMemory(), revision }));
    storage.removeItem(SOLVED_KEY);
    storage.removeItem(DRAFTS_KEY);
    storage.removeItem(VERSIONED_DRAFTS_KEY);
    // Written last: other open tabs reload only after all learning data is reset.
    storage.setItem(LEARNING_RESET_KEY, revision);
  } catch {
    let restored = true;
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        restored = false;
      }
    }
    throw new Error(
      restored
        ? '重置失败，原记录已保留。请检查浏览器存储权限后重试。'
        : '重置未完整完成。请先导出当前记录，检查浏览器存储权限后重试。',
    );
  }
}
