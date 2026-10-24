import type { StudyLog } from '../types';
import type { NoteUnitPage } from './noteUnits';
import { buildReviewQuestions } from './reviewQuestions';
import { withLogShorthand } from './noteShorthand';
import type { NoteQuestion } from './reviewQuestions';
import { REVIEW_GRADE_FSRS } from './reviewPractice';
import type { PracticeQuestion, ReviewGrade } from './reviewPractice';

/**
 * 정리노트에서 복습 주기와 상관없이 문제를 푸는 기능의 계산 부분.
 *  - 풀 범위는 "단위"(정리노트의 N번째 단위 · 단위가 없으면 하루) 범위이거나 "페이지"(책 페이지) 범위다.
 *  - 푼 기록은 따로 쌓아 둔다(나중에 새 복습 알고리즘에 쓰려고). 여기서 푼 결과로 복습 일정은 바꾸지 않는다.
 */

const hasNote = (log: StudyLog) => (log.reviewMemo ?? '').trim().length > 0;

const dayText = (day?: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : (day || '');
};

/** 범위를 고르는 칸에 보이는 이름: "3번째 단위 · p.21~30" 또는 "10월 12일" */
export const noteUnitLabel = (unit: NoteUnitPage) => (
  unit.kind === 'unit' ? `${(unit.index ?? 0) + 1}번째 단위 · p.${unit.start}~${unit.end}` : dayText(unit.day)
);

/** 처음 단위부터 마지막 단위까지(순서와 상관없이 두 끝을 받는다) 안에 있는 노트가 있는 기록. 한 기록은 한 번만 센다. */
export const logsInUnitRange = (units: NoteUnitPage[], fromKey: string, toKey: string): StudyLog[] => {
  const first = units.findIndex(unit => unit.key === fromKey);
  const second = units.findIndex(unit => unit.key === toKey);
  if (first < 0 || second < 0) return [];
  const seen = new Set<string>();
  return units.slice(Math.min(first, second), Math.max(first, second) + 1).flatMap(unit => unit.logs)
    .filter(log => hasNote(log) && !seen.has(log.id) && !!seen.add(log.id));
};

/** 책 페이지가 [from, to]와 겹치는 노트가 있는 기록. 페이지를 적지 않은 기록은 이 방식으로는 고를 수 없다. */
export const logsInPageRange = (logs: StudyLog[], from: number, to: number): StudyLog[] => {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  return logs.filter(log => {
    if (!hasNote(log)) return false;
    const start = Number.isFinite(log.startPage) ? log.startPage! : log.endPage;
    const end = Number.isFinite(log.endPage) ? log.endPage! : log.startPage;
    return Number.isFinite(start) && Number.isFinite(end) && end! >= low && start! <= high;
  });
};

/** 단위 목록에 들어 있는 기록들의 페이지 범위(없으면 null) */
export const pageBoundsOf = (logs: StudyLog[]): { start: number; end: number } | null => {
  const pages = logs.filter(hasNote).flatMap(log => [log.startPage, log.endPage]).filter((page): page is number => Number.isFinite(page));
  return pages.length ? { start: Math.min(...pages), end: Math.max(...pages) } : null;
};

export interface NotePracticeEntry { id: string; log: StudyLog; question: NoteQuestion }

/** 고른 기록들의 노트에서 문제를 만든다. 기록마다 따로 줄을 세우므로(logId) 각 노트가 쉬운 것부터 풀린다. */
export const buildNotePracticeCatalog = (logs: StudyLog[]) => {
  const entries: NotePracticeEntry[] = [];
  const catalog: PracticeQuestion[] = [];
  for (const log of logs) {
    // 기록마다 그 과목의 `=`·`-` 단축어 설정으로 읽는다
    for (const question of withLogShorthand(log, () => buildReviewQuestions(log.reviewMemo ?? '').questions)) {
      const id = `${log.id}:${question.key}`;
      entries.push({ id, log, question });
      catalog.push({ id, logId: log.id, level: question.level, priority: question.priority, difficulty: question.difficulty,
        importance: question.importance, recallUnits: question.recallUnits, providedUnits: question.providedUnits, blankStart: question.blankStart });
    }
  }
  return { catalog, entries };
};

/* ───────── 푼 기록 ───────── */

export const NOTE_PRACTICE_RECORDS_KEY = 'swp_note_practice_records_v1';
const MAX_RECORDS = 20000;

export interface NotePracticeRecord {
  id: string;
  /** 푼 시각(ISO) */
  at: string;
  subjectId: string;
  logId: string;
  questionKey: string;
  kind: NoteQuestion['kind'];
  level: number;
  priority: number;
  difficulty: number;
  /** 먼 거리 문제의 걸음 수(2 이상). 아니면 없음 */
  distance?: number;
  grade: ReviewGrade;
  /** FSRS 평가 값(1 Again · 2 Hard · 3 Good · 4 Easy) */
  rating: 1 | 2 | 3 | 4;
  /** 이 문제의 몇 번째 시도인가(같은 풀이 안에서) */
  attempt: number;
  /** 문제를 보여 준 뒤 채점할 때까지 걸린 시간(ms) */
  elapsedMs: number;
  /** 고른 범위 이름(예: "2번째 단위 ~ 3번째 단위", "p.21~30") */
  scope: string;
}

type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const readNotePracticeRecords = (storage: RecordStorage = localStorage): NotePracticeRecord[] => {
  try {
    const value = JSON.parse(storage.getItem(NOTE_PRACTICE_RECORDS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
};

export const appendNotePracticeRecord = (record: NotePracticeRecord, storage: RecordStorage = localStorage) => {
  try {
    const next = [...readNotePracticeRecords(storage), record];
    storage.setItem(NOTE_PRACTICE_RECORDS_KEY, JSON.stringify(next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next));
  } catch { /* 저장 공간이 없어도 풀이는 계속된다 */ }
};

export const makeNotePracticeRecord = (
  entry: NotePracticeEntry, subjectId: string, grade: ReviewGrade, attempt: number, elapsedMs: number, scope: string, at = new Date()
): NotePracticeRecord => ({
  id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  at: at.toISOString(), subjectId, logId: entry.log.id, questionKey: entry.question.key, kind: entry.question.kind,
  level: entry.question.level, priority: entry.question.priority, difficulty: entry.question.difficulty,
  ...(entry.question.distance ? { distance: entry.question.distance } : {}),
  grade, rating: REVIEW_GRADE_FSRS[grade], attempt, elapsedMs: Math.max(0, Math.round(elapsedMs)), scope
});
