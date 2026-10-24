/**
 * `=`와 `-`는 분류기준 없는 논리어다(`,`처럼 한 칸 안에서 값을 잇는다): `A:B=C`는 `A`와 `B=C` 두 칸이고, `A:B-C`는 `A`와 `B-C` 두 칸이다.
 * 한 칸 안에서는 `=`가 `-`·`,`보다 중요도가 높아 먼저 낸다. 이 단축어를 끄면 `=`와 `-`는 논리어가 아니라 그냥 글자다(a=b, 3-2, 서울-부산).
 *
 * 켜고 끄는 것은 과목마다다(21:09 "노트(과목)마다"): `Subject.noteShorthand`. 정하지 않은 과목은 예전 기기 설정(`swp_note_shorthand`, 기본 켜짐)을 따른다.
 *  - 노트 글을 읽는 함수들은 `isNoteShorthandOn()`을 본다. 그 값은 ① `withNoteShorthand`로 감싼 동안은 감싼 값,
 *    ② 아니면 지금 화면이 보고 있는 과목(가장 나중에 연 화면 · `useSubjectNoteShorthand`)의 값이다.
 *  - 여러 과목의 기록을 한꺼번에 다루는 곳(복습 일정 · 복습 문제)은 기록마다 `withLogShorthand(log, …)`로 그 과목의 값으로 읽는다.
 */
export const NOTE_SHORTHAND_KEY = 'swp_note_shorthand';

const readStored = (): boolean => {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(NOTE_SHORTHAND_KEY) !== 'false'; } catch { return true; }
};

/** 과목이 따로 정하지 않았을 때의 값(예전 기기 설정) */
let fallback = readStored();
const bySubject = new Map<string, boolean>();
/** 지금 화면들이 보고 있는 과목(나중에 연 것이 위) */
const owners: Array<{ token: object; subjectId: string | null }> = [];
let ambient = fallback;
let override: boolean | null = null;
const listeners = new Set<() => void>();

export const isNoteShorthandOn = () => (override ?? ambient);

export const shorthandOfSubject = (subjectId?: string | null): boolean => (subjectId && bySubject.has(subjectId) ? bySubject.get(subjectId)! : fallback);

const recompute = (): boolean => {
  const next = shorthandOfSubject(owners.length ? owners[owners.length - 1].subjectId : null);
  if (next === ambient) return false;
  ambient = next;
  return true;
};
const notify = () => listeners.forEach(listener => listener());

/** 과목들의 설정을 읽어 둔다(앱이 과목 목록을 그릴 때마다 부른다). 화면 값이 바뀌었으면 true. */
export const syncSubjectShorthands = (subjects: ReadonlyArray<{ id: string; noteShorthand?: boolean }>): boolean => {
  bySubject.clear();
  subjects.forEach(subject => { if (typeof subject.noteShorthand === 'boolean') bySubject.set(subject.id, subject.noteShorthand); });
  return recompute();
};

/** 이 값으로 읽는 동안만(동기 함수) */
export const withNoteShorthand = <T,>(on: boolean, run: () => T): T => {
  const before = override;
  override = on;
  try { return run(); } finally { override = before; }
};
export const withSubjectShorthand = <T,>(subjectId: string | null | undefined, run: () => T): T => withNoteShorthand(shorthandOfSubject(subjectId), run);
/** 기록의 과목 값으로 읽는다 */
export const withLogShorthand = <T,>(log: { subjectId?: string } | null | undefined, run: () => T): T => withSubjectShorthand(log?.subjectId, run);

/** 화면이 이 과목을 본다고 알린다(같은 token이면 자리를 그대로 두고 과목만 바꾼다). 화면 값이 바뀌었으면 true. 알림은 부르는 쪽이 `notifyNoteShorthand`로. */
export const claimNoteShorthand = (token: object, subjectId: string | null | undefined): boolean => {
  const entry = owners.find(item => item.token === token);
  if (entry) entry.subjectId = subjectId || null;
  else owners.push({ token, subjectId: subjectId || null });
  return recompute();
};
export const releaseNoteShorthand = (token: object): boolean => {
  const at = owners.findIndex(item => item.token === token);
  if (at >= 0) owners.splice(at, 1);
  return recompute();
};
export const notifyNoteShorthand = notify;

/** 과목을 정하지 않은 화면(과목이 없거나 과목이 따로 정하지 않음)의 값을 바꾼다. 기기에 저장하지 않는다(시험에서 쓴다). */
export const setNoteShorthand = (next: boolean) => { fallback = next; if (recompute()) notify(); };

/** 켜짐 여부가 바뀔 때 알려 받는다(화면 훅이 쓴다). 돌려주는 함수를 부르면 구독이 끝난다. */
export const subscribeNoteShorthand = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** 칸을 나누는 관계 기호들. `=`는 칸을 나누지 않고 한 칸 안의 논리어다. */
export const relationMarks = () => ':;<';
export const isRelationMark = (character: string | undefined) => !!character && relationMarks().includes(character);
/** 정규식 글자 집합 꼴(`[:;<]`) */
export const relationClass = () => '[:;<]';
/** 글 끝에 붙은 관계 기호(토글 제목의 꼬리) */
export const trailingRelation = () => new RegExp(`${relationClass()}\\s*$`);
/** 합치기가 새로 쓰는 약한 연결 기호: 단축어가 꺼져 있으면 `=`를 쓸 수 없어 `:`를 쓴다. */
export const weakLink = () => (isNoteShorthandOn() ? '=' : ':');
