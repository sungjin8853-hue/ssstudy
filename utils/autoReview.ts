import type { StudyLog, Subject } from '../types';
import { getLogProgressPages, getLogStudyDate } from './schedule';
import { fsrsReview } from './fsrs';
import { registerPendingLog } from './review';
import { pastSessions, previousUnitSpeed, recommendSubjectGrade, speedPerHour, SUBJECT_GRADE_RATING } from './subjectFeedback';
import type { SubjectGrade } from './subjectFeedback';

/**
 * 자동 복습 넣기(3일 요청, 4일 바꿈, 8일 다시 바꿈): 과목에서 켜 두면 "복습에 넣기"를 누르지 않아도 공부를 저장하면 바로 복습에 들어간다.
 *  - 8일 "일정 시간이 채워지면 복습하는 게 아니라 바로바로 복습으로 들어가게 하고 3시간 단위로 복습을 넣은 시간을 나누어 거의 동일 시각에 한 복습은
 *    동일한 때에 한 것으로": 저장할 때마다 넣는다. 아직 복습하지 않은 자동 묶음(같은 과목 · 같은 단계)의 넣은 때로부터 3시간 안에 넣는 공부는
 *    그 묶음에 들어가 같은 때(묶음의 처음 넣은 때)에 넣은 것으로 본다. 3시간이 지나면 새 묶음이다.
 *  - 앞 공부가 끝나고 1시간 안에 이어 한 공부는 한 기록으로 합쳐 저장한다(4일, 아직 복습하지 않은 앞 기록에만).
 *  - 묶음의 난도는 묶음 전체 속도(푼 장수 합 ÷ 걸린 시간 합)를 바로 앞에 공부한 단위(앞 묶음)의 속도와 견준 추천 난도다(앞 단위가 없으면 지난 공부 전체 평균, 그것도 없으면 보통).
 *    묶음에 공부가 더해질 때마다 묶음 전체를 다시 매기고, 기억(FSRS)은 묶음의 넣은 때에 평가한 것이다.
 */
export const DEFAULT_AUTO_REVIEW_HOURS = 1;
export const AUTO_REVIEW_SAME_TIME_MS = 60 * 60 * 1000;
/** 8일: 넣은 때가 이만큼 안이면 같은 때에 넣은 것으로 본다(3시간 단위) */
export const AUTO_REVIEW_GROUP_MS = 3 * 60 * 60 * 1000;

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
/** 자동으로 넣었고 아직 한 번도 복습하지 않은 기록(묶음에 더하거나 합칠 수 있다) */
export const isFreshAutoRegistered = (log: StudyLog) => Boolean(log.autoReviewRegistered && log.reviewRegisteredAt && !log.unitReviewPending
  && !log.isReviewed && !(log.reviewStep ?? 0) && !(log.basicReviewTimeRecords?.length) && !log.reviewQuestionSchedules);

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
  if (!previous || !(isAutoWaiting(previous) || isFreshAutoRegistered(previous)) || previous.manualEntry || incoming.manualEntry) return { logs, id: logId };
  // 공부한 날이 다르면(자정을 넘김) 합치지 않는다: 합치면 뒤 공부가 앞 날짜로 세어져 그날 계획에서 빠진다
  if (getLogStudyDate(previous) !== getLogStudyDate(incoming)) return { logs, id: logId };
  if (startMs(incoming) - endMs(previous) > AUTO_REVIEW_SAME_TIME_MS) return { logs, id: logId };
  if (!Number.isInteger(previous.endPage) || !Number.isInteger(incoming.startPage) || incoming.startPage! <= previous.endPage!) return { logs, id: logId };
  // 범위는 바로 이어지거나(다음 페이지) 둘 다 단원 기록(진척 장수를 따로 가짐)일 때만 합친다: 사이를 건너뛴 기록을 합치면 나중에 고칠 때 건너뛴 쪽까지 진척으로 세어진다
  const chapterLogs = previous.progressPages !== undefined && incoming.progressPages !== undefined;
  if (incoming.startPage !== previous.endPage! + 1 && !chapterLogs) return { logs, id: logId };
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
 * 막 저장한 기록 하나(logId)를 자동 복습에 바로 넣는다(8일): 1시간 안에 이어 한 공부면 앞 기록에 합치고, 아직 복습하지 않은 같은 단계의 자동 묶음을
 * 넣은 때로부터 3시간 안이면 그 묶음에 더해 묶음의 넣은 때로 넣는다(묶음 전체 난도를 다시 매긴다). 아니면 새 묶음이다.
 * hours · force는 예전 "모을 시간"용이라 쓰지 않는다(부르는 쪽 호환). 대기 중이 아니면 그대로 돌려준다.
 */
export const registerAutoReview = (
  logs: StudyLog[], logId: string, _hours = DEFAULT_AUTO_REVIEW_HOURS, _force = false,
  /** 넣기 직전에 할 일(노트 합치기: 복습에 넣을 때 이전 쪽 노트에 합친다) */
  beforeRegister: (logs: StudyLog[], ids: string[]) => StudyLog[] = current => current
): StudyLog[] => {
  const incoming0 = logs.find(log => log.id === logId);
  if (!incoming0 || !incoming0.unitReviewPending) return logs;
  const atMs = endMs(incoming0);
  // 예전 판에서 모으던 기록이 남아 있으면 먼저 넣는다(그 마지막 공부 때에)
  let next = flushFilledAutoGroups(logs, incoming0.subjectId, 0, beforeRegister, logId);
  const simplified = simplifyAutoLog(next, logId);
  next = simplified.logs;
  const incoming = next.find(log => log.id === simplified.id)!;
  if (incoming.unitReviewPending) next = beforeRegister(next, [incoming.id]);
  const current = next.find(log => log.id === incoming.id) ?? incoming;
  // 같은 때(3시간 단위)의 아직 복습하지 않은 자동 묶음
  const groups = [...new Set(next.filter(log => log.id !== current.id && log.subjectId === current.subjectId && stageOf(log) === stageOf(current) && isFreshAutoRegistered(log))
    .map(log => log.reviewRegisteredAt!))]
    .filter(at => { const ms = Date.parse(at); return Number.isFinite(ms) && ms <= atMs && atMs - ms <= AUTO_REVIEW_GROUP_MS; })
    .sort();
  const groupAt = groups[groups.length - 1];
  const groupMs = groupAt ? Date.parse(groupAt) : (current.unitReviewPending ? atMs : Date.parse(current.reviewRegisteredAt ?? '') || atMs);
  const memberIds = [...new Set([...(groupAt ? next.filter(log => log.subjectId === current.subjectId && log.autoReviewRegistered && log.reviewRegisteredAt === groupAt).map(log => log.id) : []), current.id])];
  return registerAutoGroup(next, memberIds, groupMs);
};

/**
 * 모은 시간이 이미 정한 시간 이상인 묶음을 넣는다(설정에서 시간을 줄였을 때 다음 저장을 기다리지 않게). 단계마다 따로, 넣는 때는 그 묶음 마지막 공부 때.
 * 넣을 것이 없으면 그대로 돌려준다.
 */
export const flushFilledAutoGroups = (
  logs: StudyLog[], subjectId: string, hours: number,
  beforeRegister: (logs: StudyLog[], ids: string[]) => StudyLog[] = current => current,
  exceptId?: string
): StudyLog[] => {
  const waiting = logs.filter(log => log.id !== exceptId && log.subjectId === subjectId && log.unitReviewPending && log.autoReviewWaiting);
  const stages = [...new Set(waiting.map(stageOf))];
  return stages.reduce((current, stage) => {
    const group = waiting.filter(log => stageOf(log) === stage);
    const minutes = group.reduce((sum, log) => sum + (Number(log.timeSpentMinutes) || 0), 0);
    if (minutes < hours * 60 - 1e-9) return current;
    const ids = group.map(log => log.id);
    return registerAutoGroup(beforeRegister(current, ids), ids, Math.max(...group.map(endMs)));
  }, logs);
};
