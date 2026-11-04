import type { StudyLog, Subject } from '../types';
import { getLogProgressPages, getLogStudyDate } from './schedule';
import { fsrsReview } from './fsrs';
import { registerPendingLog } from './review';
import { pastSessions, previousUnitSpeed, recommendSubjectGrade, speedPerHour, SUBJECT_GRADE_RATING } from './subjectFeedback';
import type { SubjectGrade } from './subjectFeedback';

/**
 * 자동 복습 넣기(3일 요청, 4일 바꿈): 과목에서 켜 두면 "복습에 넣기"를 누르지 않아도 공부를 저장하면 복습에 들어간다.
 *  - 공부 시간이 정한 시간(autoReviewHours, 기본 1시간)만큼 모이면 모인 공부를 한 묶음으로 복습에 넣는다(4일: "학습 시간 자체가 몇 시간 채워져야 하나의 복습").
 *    같은 과목 · 같은 단계끼리 모은다. 단계가 바뀌면 앞 단계에 모인 공부는 그때 넣고, 과목을 다 끝내면 모인 만큼 넣는다.
 *  - 앞 공부가 끝나고 1시간 안에 이어 한 공부는 같은 때 한 것으로 보고 한 기록으로 합쳐 저장한다(4일: 저장하는 양을 줄인다).
 *    아직 복습에 넣지 않고 모으는 중인 기록끼리만 합친다(3시간 안 공부를 묶음에 합치던 것은 없앴다).
 *  - 묶음의 난도는 묶음 전체 속도(푼 장수 합 ÷ 걸린 시간 합)를 바로 앞에 공부한 단위(앞 묶음)의 속도와 견준 추천 난도다(앞 단위가 없으면 지난 공부 전체 평균, 그것도 없으면 보통).
 *  - 묶음은 모두 다 찬 때(마지막 공부를 저장한 때)에 그 난도로 복습에 들어간다(복습에 넣기를 그때 누른 것과 같다).
 */
export const DEFAULT_AUTO_REVIEW_HOURS = 1;
export const AUTO_REVIEW_SAME_TIME_MS = 60 * 60 * 1000;

/** 복습 하나에 모을 공부 시간(시간). 0이면 저장할 때마다 넣는다 */
export const autoReviewHoursOf = (subject: Pick<Subject, 'autoReviewHours'> | undefined) => {
  const hours = Number(subject?.autoReviewHours);
  return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_AUTO_REVIEW_HOURS;
};

const isStudyLog = (log: StudyLog) => !log.isRepeatReview && !log.reviewParentSubjectId;
const stageOf = (log: StudyLog) => log.subjectStageId || log.subjectId;
const endMs = (log: StudyLog) => Date.parse(log.timestamp);
const startMs = (log: StudyLog) => endMs(log) - Math.max(0, Number(log.timeSpentMinutes) || 0) * 60000;
const sumOf = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (Number(a) || 0) + (Number(b) || 0));

/** 자동 복습으로 모으는 중인(아직 넣지 않은) 기록 */
export const isAutoWaiting = (log: StudyLog) => Boolean(log.unitReviewPending && (log.autoReviewWaiting || log.autoReviewQueued));

/** 앞 기록(earlier)에 바로 이어 한 기록(later)을 한 기록으로 합친다: 장수 · 시간은 더하고 범위는 앞 시작 ~ 뒤 끝, 노트는 차례로 잇는다 */
export const mergeStudyLogs = (earlier: StudyLog, later: StudyLog): StudyLog => {
  const contiguous = Number.isInteger(earlier.endPage) && later.startPage === earlier.endPage! + 1;
  const plainRange = contiguous && earlier.progressPages === undefined && later.progressPages === undefined
    && Boolean(earlier.pageCountIsExplicit) === Boolean(later.pageCountIsExplicit);
  const memos = [earlier.reviewMemo, later.reviewMemo].filter(memo => (memo ?? '').trim().length > 0) as string[];
  const concat = <T,>(a?: T[], b?: T[]) => (a?.length || b?.length ? [...(a ?? []), ...(b ?? [])] : undefined);
  return {
    ...earlier,
    pagesRead: (Number(earlier.pagesRead) || 0) + (Number(later.pagesRead) || 0),
    // 진척(장수)은 두 기록의 합 그대로다. 범위가 그대로 이어지지 않으면(단원 사이 건너뜀 등) 합을 따로 적어 둔다
    ...(plainRange ? {} : { progressPages: getLogProgressPages(earlier) + getLogProgressPages(later) }),
    endPage: later.endPage ?? earlier.endPage,
    timeSpentMinutes: (Number(earlier.timeSpentMinutes) || 0) + (Number(later.timeSpentMinutes) || 0),
    timeAttackMinutes: sumOf(earlier.timeAttackMinutes, later.timeAttackMinutes),
    organizationMinutes: sumOf(earlier.organizationMinutes, later.organizationMinutes),
    pomodoroSession: earlier.pomodoroSession || later.pomodoroSession,
    timestamp: later.timestamp,
    reviewMemo: memos.length ? memos.join('\n') : undefined,
    reviewMemoDocument: memos.length > 1 ? undefined : (earlier.reviewMemoDocument ?? later.reviewMemoDocument),
    basicReviewTimeRecords: concat(earlier.basicReviewTimeRecords, later.basicReviewTimeRecords),
    reviewSubjectTimeRecords: concat(earlier.reviewSubjectTimeRecords, later.reviewSubjectTimeRecords),
    autoReviewCut: earlier.autoReviewCut || later.autoReviewCut || undefined
  };
};

/**
 * 모으는 중인 앞 기록이 끝나고 1시간 안에 시작한 기록이면 앞 기록에 합친다. 합친 뒤의 기록 id를 돌려준다(합치지 않으면 그대로).
 * 같은 과목 · 같은 단계 · 같은 공부한 날 · 앞으로 이어지는 범위일 때만, 사진이 둘 다 있거나 직접 넣은 기록이면 합치지 않는다.
 */
export const simplifyAutoLog = (logs: StudyLog[], logId: string): { logs: StudyLog[]; id: string } => {
  const incoming = logs.find(log => log.id === logId);
  if (!incoming || !isStudyLog(incoming)) return { logs, id: logId };
  const before = logs
    .filter(log => log.id !== incoming.id && log.subjectId === incoming.subjectId && isStudyLog(log) && stageOf(log) === stageOf(incoming) && endMs(log) <= endMs(incoming))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const previous = before[before.length - 1];
  if (!previous || !isAutoWaiting(previous) || previous.manualEntry || incoming.manualEntry) return { logs, id: logId };
  // 공부한 날이 다르면(자정을 넘김) 합치지 않는다: 합치면 뒤 공부가 앞 날짜로 세어져 그날 계획에서 빠진다
  if (getLogStudyDate(previous) !== getLogStudyDate(incoming)) return { logs, id: logId };
  if (startMs(incoming) - endMs(previous) > AUTO_REVIEW_SAME_TIME_MS) return { logs, id: logId };
  if (!Number.isInteger(previous.endPage) || !Number.isInteger(incoming.startPage) || incoming.startPage! <= previous.endPage!) return { logs, id: logId };
  if (previous.photoBase64 && incoming.photoBase64) return { logs, id: logId };
  const merged = mergeStudyLogs(previous, { ...incoming, photoBase64: undefined });
  const withPhoto = { ...merged, photoBase64: previous.photoBase64 ?? incoming.photoBase64 };
  return { logs: logs.filter(log => log.id !== incoming.id).map(log => (log.id === previous.id ? withPhoto : log)), id: previous.id };
};

const totals = (list: readonly StudyLog[]) => list.reduce((sum, log) => ({
  pages: sum.pages + (Number.isFinite(log.pagesRead) ? log.pagesRead : 0),
  minutes: sum.minutes + (Number.isFinite(log.timeSpentMinutes) ? log.timeSpentMinutes : 0)
}), { pages: 0, minutes: 0 });

/**
 * 묶음 기록들의 난도: 묶음 전체 속도를 그 과목 지난 공부의 평균 속도와 비교한 추천(없으면 보통).
 * 견주는 기준은 복습할 부분 바로 앞에 공부한 단위(앞 묶음)의 속도이고, 앞 단위가 없으면 지난 공부 전체의 총합 평균이다(4일).
 */
export const autoReviewGradeOf = (logs: readonly StudyLog[], group: readonly StudyLog[]): SubjectGrade => {
  const ids = new Set(group.map(log => log.id));
  const subjectId = group[0]?.subjectId ?? '';
  const own = totals(group);
  // 4일: 복습할 부분 바로 앞에 공부한 단위(앞 묶음)와 견준다. 앞 단위가 없으면 지난 공부 전체 평균과 견준다
  const previous = previousUnitSpeed(logs, subjectId, group);
  const past = totals(pastSessions(logs.filter(log => !ids.has(log.id)), subjectId, 'study'));
  return recommendSubjectGrade(speedPerHour(own.pages, own.minutes), previous ?? speedPerHour(past.pages, past.minutes)) ?? 'good';
};

/** 모은 기록들(members)을 한 묶음으로 at 때에 복습에 넣는다: 난도는 autoReviewGradeOf, 범위는 기록 범위를 합친 것 */
export const registerAutoGroup = (logs: StudyLog[], memberIds: readonly string[], atMs: number): StudyLog[] => {
  const ids = new Set(memberIds);
  const members = logs.filter(log => ids.has(log.id));
  if (!members.length) return logs;
  const grade = autoReviewGradeOf(logs, members);
  const card = fsrsReview(null, SUBJECT_GRADE_RATING[grade], atMs);
  const starts = members.map(log => log.startPage ?? log.endPage).filter((page): page is number => Number.isFinite(page));
  const ends = members.map(log => log.endPage ?? log.startPage).filter((page): page is number => Number.isFinite(page));
  const range = starts.length && ends.length ? { start: Math.min(...starts), end: Math.max(...ends) } : undefined;
  return logs.map(log => (ids.has(log.id)
    ? registerPendingLog({ ...log, feedbackGrade: grade, reviewFsrs: card, autoReviewQueued: undefined, autoReviewWaiting: undefined, autoReviewCut: undefined, autoReviewRegistered: true }, atMs, range)
    : log));
};

/**
 * 막 저장한 기록 하나(logId)를 자동 복습에 넣는다: 1시간 안에 이어 한 공부면 앞 기록에 합치고, 같은 단계에 모은 공부 시간이
 * hours만큼 차면(또는 force: 바로 복습 넣기 · 과목을 다 끝냄) 모은 기록을 한 묶음으로 넣는다. 아니면 모으는 중으로 둔다.
 * 다른 단계에 모으던 기록은 단계가 바뀐 것이니 먼저 넣는다. 대기 중이 아니면 그대로 돌려준다.
 */
export const registerAutoReview = (
  logs: StudyLog[], logId: string, hours = DEFAULT_AUTO_REVIEW_HOURS, force = false,
  /** 묶음을 넣기 직전에 할 일(노트 합치기: 복습에 넣을 때 이전 쪽 노트에 합친다) */
  beforeRegister: (logs: StudyLog[], ids: string[]) => StudyLog[] = current => current
): StudyLog[] => {
  const incoming0 = logs.find(log => log.id === logId);
  if (!incoming0 || !incoming0.unitReviewPending) return logs;
  const atMs = endMs(incoming0);
  const register = (current: StudyLog[], ids: string[]) => registerAutoGroup(beforeRegister(current, ids), ids, atMs);
  const cut = force || Boolean(incoming0.autoReviewCut);
  const simplified = simplifyAutoLog(logs, logId);
  let next = simplified.logs;
  const incoming = next.find(log => log.id === simplified.id)!;
  const waiting = next.filter(log => log.id !== incoming.id && log.subjectId === incoming.subjectId && log.unitReviewPending && log.autoReviewWaiting);
  const otherStage = waiting.filter(log => stageOf(log) !== stageOf(incoming));
  if (otherStage.length) next = register(next, otherStage.map(log => log.id));
  const group = [...waiting.filter(log => stageOf(log) === stageOf(incoming)), incoming];
  const minutes = group.reduce((sum, log) => sum + (Number(log.timeSpentMinutes) || 0), 0);
  if (cut || minutes >= hours * 60 - 1e-9) return register(next, group.map(log => log.id));
  return next.map(log => (log.id === incoming.id ? { ...log, autoReviewQueued: undefined, autoReviewCut: undefined, autoReviewWaiting: true } : log));
};

/**
 * 모은 시간이 이미 정한 시간 이상인 묶음을 넣는다(설정에서 시간을 줄였을 때 다음 저장을 기다리지 않게). 단계마다 따로, 넣는 때는 그 묶음 마지막 공부 때.
 * 넣을 것이 없으면 그대로 돌려준다.
 */
export const flushFilledAutoGroups = (
  logs: StudyLog[], subjectId: string, hours: number,
  beforeRegister: (logs: StudyLog[], ids: string[]) => StudyLog[] = current => current
): StudyLog[] => {
  const waiting = logs.filter(log => log.subjectId === subjectId && log.unitReviewPending && log.autoReviewWaiting);
  const stages = [...new Set(waiting.map(stageOf))];
  return stages.reduce((current, stage) => {
    const group = waiting.filter(log => stageOf(log) === stage);
    const minutes = group.reduce((sum, log) => sum + (Number(log.timeSpentMinutes) || 0), 0);
    if (minutes < hours * 60 - 1e-9) return current;
    const ids = group.map(log => log.id);
    return registerAutoGroup(beforeRegister(current, ids), ids, Math.max(...group.map(endMs)));
  }, logs);
};
