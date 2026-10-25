import { legacyFingerprints } from './legacy-answer-fingerprints';
export type EditorDraft = {
  kind: 'starter' | 'input' | 'reference' | 'draft';
  code?: string;
};
export type EditorDrafts = Record<string, EditorDraft>;
type EditorProblem = {
  id: string;
  lc: number | null;
  referenceCode: string;
  starterCode: string;
  inputStarterCode?: string;
};
// Preserve current drafts under their established keys.
export const draftKey = (id: string) => `simple:${id}`;
export const getReference = (p: EditorProblem) => p.referenceCode;
export const getStarter = (p: EditorProblem) => p.starterCode;
export const getInputStarter = (p: EditorProblem) =>
  p.inputStarterCode ?? p.starterCode;
export function getEditorCode(p: EditorProblem, draft?: EditorDraft) {
  if (draft?.kind === 'draft') return draft.code ?? '';
  if (draft?.kind === 'input') return getInputStarter(p);
  return draft?.kind === 'reference' ? getReference(p) : getStarter(p);
}
function fingerprint(code: string) {
  let hash = 2166136261;
  for (let i = 0; i < code.length; i++)
    hash = Math.imul(hash ^ code.charCodeAt(i), 16777619) >>> 0;
  return String(hash);
}
export function migrateDrafts(
  problems: EditorProblem[],
  legacy: Record<string, string>,
  current: EditorDrafts,
): EditorDrafts {
  const migrated = { ...current };
  for (const p of problems) {
    const key = draftKey(p.id);
    if (migrated[key]) continue;
    const previous = current[`original:${p.id}`];
    const code =
      previous?.kind === 'draft'
        ? previous.code
        : (legacy[p.id] ?? (p.lc === null ? undefined : legacy[String(p.lc)]));
    if (typeof code === 'string') {
      const known = legacyFingerprints[p.id]?.[fingerprint(code)];
      migrated[key] =
        code === p.referenceCode
          ? { kind: 'reference' }
          : code === p.starterCode
            ? { kind: 'starter' }
            : code === p.inputStarterCode
              ? { kind: 'input' }
              : known
                ? { kind: known }
                : { kind: 'draft', code };
    } else if (previous)
      migrated[key] = {
        kind: previous.kind === 'draft' ? 'starter' : previous.kind,
      };
  }
  return migrated;
}
