import type { StudyLog } from '../types';
import { fsrsIntervalMs, fsrsReview } from './fsrs';
import { registerPendingLog } from './review';
import { pastSessions, recommendSubjectGrade, speedPerHour, SUBJECT_GRADE_RATING } from './subjectFeedback';
import type { SubjectGrade } from './subjectFeedback';

/**
 * 자동 복습 넣기(3일 요청): 과목에서 켜 두면 "복습에 넣기"를 누르지 않아도 공부를 저장하면 바로 복습에 들어간다.
 *  - 앞 공부가 끝나고 3시간 안에 다음 공부를 시작했으면 같은 때 공부한 것으로 본다: 맨 앞 공부 때로 합쳐 한 묶음으로 복습에 넣는다.
 *    (같은 과목 · 같은 단계, 앞 공부도 자동으로 넣은 것이고 아직 복습하지 않았을 때만. 사이에 복습을 했으면 새 묶음이다)
 *  - 묶음의 난도는 묶음 전체 속도(푼 장수 합 ÷ 걸린 시간 합)를 그 과목 지난 공부의 총합 평균 속도와 비교한 추천 난도다(비교할 기록이 없으면 보통).
 *  - 복습 때(기억 FSRS-6)는 맨 앞 공부 때에 그 난도로 평가한 것이다. 묶음의 기록은 모두 같은 때 · 같은 범위(장 범위를 합친 것)로 복습에 들어간다.
 */
export const AUTO_REVIEW_GAP_MS = 3 * 60 * 60 * 1000;

const isStudyLog = (log: StudyLog) => !log.isRepeatReview && !log.reviewParentSubjectId;
const stageOf = (log: StudyLog) => log.subjectStageId || log.subjectId;
const endMs = (log: StudyLog) => Date.parse(log.timestamp);
const startMs = (log: StudyLog) => endMs(log) - Math.max(0, Number(log.timeSpentMinutes) || 0) * 60000;

/** 이 기록이 붙을 자동 복습 묶음(맨 앞 공부 때 = 묶음 열쇠). 붙을 곳이 없으면 null */
export const autoReviewGroupFor = (logs: readonly StudyLog[], incoming: StudyLog): string | null => {
  const before = logs
    .filter(log => log.id !== incoming.id && log.subjectId === incoming.subjectId && isStudyLog(log) && stageOf(log) === stageOf(incoming)
      && endMs(log) <= endMs(incoming))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const previous = before[before.length - 1];
  if (!previous || !previous.autoReviewRegistered || !previous.reviewRegisteredAt) return null;
  if (startMs(incoming) - endMs(previous) > AUTO_REVIEW_GAP_MS) return null;
  const group = logs.filter(log => log.autoReviewRegistered && log.subjectId === incoming.subjectId && log.reviewRegisteredAt === previous.reviewRegisteredAt);
  // 이미 복습한 묶음에는 붙이지 않는다
  if (group.some(log => log.isReviewed || (log.reviewStep ?? 0) > 0)) return null;
  return previous.reviewRegisteredAt;
};

const totals = (list: readonly StudyLog[]) => list.reduce((sum, log) => ({
  pages: sum.pages + (Number.isFinite(log.pagesRead) ? log.pagesRead : 0),
  minutes: sum.minutes + (Number.isFinite(log.timeSpentMinutes) ? log.timeSpentMinutes : 0)
}), { pages: 0, minutes: 0 });

/**
 * 묶음 기록들의 난도: 묶음 전체 속도를 그 과목 지난 공부의 평균 속도와 비교한 추천(없으면 보통).
 * 평균은 타임어택 한 번씩의 속도가 아니라 지난 공부 전체의 총합 평균(푼 장수 합 ÷ 걸린 시간 합)이다(4일: 자동 복습은 단위가 없다).
 */
export const autoReviewGradeOf = (logs: readonly StudyLog[], group: readonly StudyLog[]): SubjectGrade => {
  const ids = new Set(group.map(log => log.id));
  const subjectId = group[0]?.subjectId ?? '';
  const own = totals(group);
  const past = totals(pastSessions(logs.filter(log => !ids.has(log.id)), subjectId, 'study'));
  return recommendSubjectGrade(speedPerHour(own.pages, own.minutes), speedPerHour(past.pages, past.minutes)) ?? 'good';
};

/**
 * 대기 중인 기록 하나(logId)를 자동으로 복습에 넣는다. 3시간 안에 이어 한 공부면 앞 묶음에 합쳐 묶음 전체를 다시 매긴다.
 * 대기 중이 아니면 그대로 돌려준다.
 */
export const registerAutoReview = (logs: StudyLog[], logId: string): StudyLog[] => {
  const incoming = logs.find(log => log.id === logId);
  if (!incoming || !incoming.unitReviewPending) return logs;
  const groupAt = autoReviewGroupFor(logs, incoming);
  const members = groupAt
    ? [...logs.filter(log => log.autoReviewRegistered && log.subjectId === incoming.subjectId && log.reviewRegisteredAt === groupAt), incoming]
    : [incoming];
  const firstMs = groupAt ? Date.parse(groupAt) : endMs(incoming);
  const grade = autoReviewGradeOf(logs, members);
  const card = fsrsReview(null, SUBJECT_GRADE_RATING[grade], firstMs);
  const starts = members.map(log => log.startPage ?? log.endPage).filter((page): page is number => Number.isFinite(page));
  const ends = members.map(log => log.endPage ?? log.startPage).filter((page): page is number => Number.isFinite(page));
  const range = starts.length && ends.length ? { start: Math.min(...starts), end: Math.max(...ends) } : undefined;
  const ids = new Set(members.map(log => log.id));
  const due = new Date(card.lastReviewMs + fsrsIntervalMs(card)).toISOString();
  return logs.map(log => {
    if (!ids.has(log.id)) return log;
    const graded: StudyLog = { ...log, feedbackGrade: grade, reviewFsrs: card, autoReviewQueued: undefined, autoReviewRegistered: true };
    if (log.id === incoming.id) return registerPendingLog(graded, firstMs, range);
    return { ...graded, reviewUnitRange: range ?? graded.reviewUnitRange, nextReviewDate: due };
  });
};
