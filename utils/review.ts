import { ReviewMeasurement, StudyLog, Subject } from '../types';
import { fsrsIntervalMs } from './fsrs';
import { getActiveSubjectStage, getSubjectStages } from './schedule';

export const BASIC_REVIEW_DETAIL_PREFIX = 'basic-review:';
export const IS_FAST_REVIEW_TEST_MODE = false;
export const INITIAL_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const getNextReviewIntervalMs = (reviewStep: number) => {
  if (reviewStep <= 0) return DAY_MS;
  return DAY_MS * Math.pow(2, reviewStep);
};

/** fsrs를 주면(난도 피드백) 다음 복습 날짜를 FSRS-6로 정하고 그 기억을 이어 간다. 없으면 예전처럼 두 배씩이다. */
export const createRepeatedSubjectReview = (
  log: StudyLog, parentSubjectId: string, reviewStep: number, nowMs = Date.now(), fsrs?: NonNullable<StudyLog['reviewFsrs']>
): StudyLog => ({
  ...log,
  isRepeatReview: true,
  reviewRepeatStartPage: log.endPage,
  reviewParentSubjectId: parentSubjectId,
  reviewSubjectId: log.subjectId,
  reviewSubjectIdsSnapshot: [log.subjectId],
  reviewStep: reviewStep + 1,
  reviewFsrs: fsrs,
  nextReviewDate: new Date(fsrs ? fsrs.lastReviewMs + fsrsIntervalMs(fsrs) : nowMs + getNextReviewIntervalMs(reviewStep)).toISOString(),
  reviewEnabled: true,
  isCondensed: false,
  isReviewed: false
});

/**
 * "합산 기록 수정"처럼 기록을 새로 만들어 저장할 때 그대로 이어 가야 하는 복습 상태:
 * 난도 피드백과 그 FSRS-6 기억, 문제별 복습 일정, 복습에서 뺀 문제와 이전 값, 풀린 단계.
 * 이어 가지 않으면 페이지·시간만 고쳐도 기억이 사라지고 뺀 문제가 다시 나온다.
 */
export const carriedReviewState = (log: StudyLog): Partial<StudyLog> => ({
  ...(log.reviewFsrs ? { reviewFsrs: log.reviewFsrs } : {}),
  ...(log.feedbackGrade ? { feedbackGrade: log.feedbackGrade } : {}),
  ...(log.reviewQuestionSchedules ? { reviewQuestionSchedules: log.reviewQuestionSchedules } : {}),
  ...(log.reviewQuestionFormat !== undefined ? { reviewQuestionFormat: log.reviewQuestionFormat } : {}),
  ...(log.reviewGateLevel !== undefined ? { reviewGateLevel: log.reviewGateLevel } : {}),
  ...(log.reviewRemoved ? { reviewRemoved: log.reviewRemoved } : {}),
  ...(log.reviewMemoOldLines ? { reviewMemoOldLines: log.reviewMemoOldLines } : {})
});

export const getRepeatedReviewRange = (log: StudyLog, subject: Subject) => {
  const initialStart = log.reviewRepeatStartPage ?? log.endPage ?? subject.startPage ?? 1;
  const stage = getSubjectStages(subject).find(item => item.id === log.subjectStageId)
    || getSubjectStages(subject).find(item => initialStart >= item.startPage && initialStart <= item.endPage);
  const pending = (log.reviewSubjectTimeRecords || []).filter(record => record.subjectId === subject.id
    && record.completed === false && record.reviewNumber === (log.reviewStep || 0) + 1 && record.lastEndPage !== undefined)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  const startPage = pending ? pending.lastEndPage! + 1 : initialStart;
  const endPage = stage?.endPage || subject.totalPages;
  return { startPage, endPage, stageId: stage?.id,
    initialRemainingPages: Math.max(0, endPage - initialStart + 1),
    remainingPages: Math.max(0, endPage - startPage + 1) };
};

export const completeRepeatedSubjectReview = (log: StudyLog): StudyLog => ({
  ...log, isReviewed: true, nextReviewDate: undefined, reviewSubjectId: undefined,
  reviewEnabled: false, isCondensed: true
});

export const getReviewDetailKey = (
  reviewType: 'basic' | 'subject',
  parentSubjectId: string,
  subjectId: string
) => reviewType === 'subject'
  ? subjectId
  : `${BASIC_REVIEW_DETAIL_PREFIX}${parentSubjectId}`;

export const recordSubjectReviewTime = (
  log: StudyLog, subjectId: string, minutes: number, completed: boolean, timestamp: string,
  measurement: ReviewMeasurement
): StudyLog => {
  if (log.pagesRead <= 0 || !Number.isFinite(minutes) || minutes < 0
    || !Number.isFinite(measurement.pagesRead) || measurement.pagesRead <= 0) return log;
  const records = log.reviewSubjectTimeRecords || [];
  const reviewNumber = (log.reviewStep || 0) + 1;
  const isPendingCurrentReview = (record: NonNullable<StudyLog['reviewSubjectTimeRecords']>[number]) => (
    record.subjectId === subjectId && record.completed === false && record.reviewNumber === reviewNumber && Boolean(record.measurementId)
  );
  const pendingMinutes = completed
    ? records.filter(isPendingCurrentReview)
      .reduce((sum, record) => sum + Math.max(0, record.minutes), 0)
    : 0;
  const pending = completed ? records.filter(isPendingCurrentReview) : [];
  const pages = measurement.pagesRead + pending.reduce((sum, record) => sum + Math.max(0, record.pages), 0);
  const baselineMinutes = measurement.pagesRead * measurement.baselineTimePerPage
    + pending.reduce((sum, record) => sum + record.pages * (record.baselineTimePerPage || 0), 0);
  const hasBaseline = measurement.baselineTimePerPage > 0
    && !pending.some(record => record.pages > 0 && !(record.baselineTimePerPage! > 0));
  const totalMinutes = minutes + pendingMinutes;
  const timeAttackMinutes = (measurement.timeAttackMinutes ?? minutes)
    + pending.reduce((sum, record) => sum + (record.timeAttackMinutes ?? record.minutes), 0);
  const baselineTimeAttackMinutes = measurement.pagesRead * (measurement.baselineTimeAttackPerPage ?? measurement.baselineTimePerPage)
    + pending.reduce((sum, record) => sum + record.pages * (record.baselineTimeAttackPerPage ?? record.baselineTimePerPage ?? 0), 0);
  if (!completed && minutes === 0) return log;
  return {
    ...log,
    reviewSubjectTimeRecords: [
      ...records.filter(record => !(completed && isPendingCurrentReview(record))),
      { subjectId, minutes: totalMinutes, pages, completed, reviewNumber, timestamp,
        timeAttackMinutes,
        organizationMinutes: Math.max(0, totalMinutes - timeAttackMinutes),
        baselineTimeAttackPerPage: pages > 0 ? baselineTimeAttackMinutes / pages : 0,
        measurementId: measurement.measurementId,
        includedMeasurementIds: Array.from(new Set([measurement.measurementId,
          ...pending.flatMap(record => record.includedMeasurementIds || [record.measurementId!])])),
        lastEndPage: measurement.lastEndPage,
        baselineTimePerPage: pages > 0 && hasBaseline ? baselineMinutes / pages : 0,
        timeChangePercent: baselineMinutes > 0 && hasBaseline && totalMinutes > 0
          ? (totalMinutes / baselineMinutes - 1) * 100 : undefined }
    ]
  };
};

export const recordReviewMeasurement = (
  logs: StudyLog[], logIds: string[], subjectId: string, minutes: number,
  completed: boolean, timestamp: string, measurement: ReviewMeasurement
) => {
  if (!Number.isFinite(minutes) || minutes < 0 || !Number.isFinite(measurement.pagesRead) || measurement.pagesRead <= 0) return logs;
  const ids = new Set(logIds);
  const totalPages = logs.filter(log => ids.has(log.id)).reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0);
  if (totalPages <= 0) return logs;
  return logs.map(log => {
    if (!ids.has(log.id)) return log;
    const share = Math.max(0, log.pagesRead) / totalPages;
    return recordSubjectReviewTime(log, subjectId, minutes * share, completed, timestamp,
      { ...measurement, pagesRead: measurement.pagesRead * share,
        timeAttackMinutes: (measurement.timeAttackMinutes ?? minutes) * share });
  });
};

export const calculateStudyPageAmount = (start: number, end: number, remainingPages: number, wholePages = false) => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(remainingPages)
    || start < 1 || (wholePages && (!Number.isInteger(start) || !Number.isInteger(end)))) return null;
  const amount = Number((end - start + (Number.isInteger(start) && Number.isInteger(end) ? 1 : 0)).toFixed(2));
  return amount > 0 && amount <= remainingPages ? amount : null;
};

export const getReviewStartPage = (subject: Subject) => {
  const stage = getActiveSubjectStage(subject);
  const legacy = subject.reviewStartPage;
  if (legacy && legacy >= (stage?.startPage || subject.startPage || 1)
    && legacy <= (stage?.endPage || subject.totalPages)) return legacy;
  return stage?.currentPage ?? null;
};

export const applySessionEndPage = (subject: Subject, log: StudyLog): Subject => {
  if (!Number.isInteger(log.endPage)) return subject;
  const stageId = log.subjectStageId || getActiveSubjectStage(subject)?.id || subject.id;
  const stage = getSubjectStages(subject).find(item => item.id === stageId);
  if (!stage || log.endPage! < stage.startPage || log.endPage! > stage.endPage) return subject;
  return {
    ...subject,
    reviewStartPage: undefined,
    completedPages: stageId === subject.id ? log.endPage! : subject.completedPages,
    followUpSubjects: subject.followUpSubjects?.map(item => item.id === stageId ? { ...item, completedPage: log.endPage! } : item)
  };
};

export const applyReviewPageCursor = (subject: Subject, log: StudyLog): Subject => (
  log.reviewParentSubjectId ? applySessionEndPage(subject, log) : subject
);

/**
 * 공부 세션의 복습 등록(페이지 단위가 있는 과목도, 없는 과목도 똑같다).
 *  - 공부 세션을 저장할 때 그 세션만의 복습을 바로 등록하지 않고 "복습 대기"(unitReviewPending)로 둔다. 노트도 그대로 남는다.
 *  - 복습은 사용자가 학습을 끝내고 "복습에 넣기"를 눌러 난도를 골라야 등록된다(registerPendingReviews): 그때까지 쌓인 대기 기록들이
 *    한꺼번에 복습에 들어가고(고른 난도가 정한 때가 첫 복습) 새 노트도 함께 복습으로 간다. 누르지 않으면 대기 기록과 노트는 계속 유지된다.
 *    단위의 끝 페이지에 닿아도 자동으로 등록하지 않는다.
 *  - 사용자가 그 세션의 복습을 뺐거나(복습 제외), 복습 세션·반복 복습이거나, 페이지 범위가 정수가 아니면 미루지 않고 기존 그대로다.
 * existingLogs는 incoming을 뺀 현재 기록, 돌려주는 logs는 대기가 풀린 existingLogs, incoming은 저장할 기록이다.
 */
export interface UnitReviewResult {
  incoming: StudyLog;
  logs: StudyLog[];
  /** 이번 저장으로 복습이 등록된 단위들(지금은 자동 등록이 없어 늘 비어 있다) */
  units: Array<{ start: number; end: number; logIds: string[] }>;
}

/** 대기 기록을 복습으로 등록한 기록: 복습 포함, 고른 난도(reviewFsrs)가 정한 때가 첫 복습(난도가 없으면 2시간 뒤) */
const registerPendingLog = (log: StudyLog, nowMs: number, range?: { start: number; end: number }): StudyLog => ({
  ...log, unitReviewPending: undefined, reviewUnitRange: range ?? log.reviewUnitRange,
  isCondensed: false, reviewEnabled: true, isReviewed: false, reviewStep: 0,
  nextReviewDate: new Date(log.reviewFsrs ? log.reviewFsrs.lastReviewMs + fsrsIntervalMs(log.reviewFsrs) : nowMs + INITIAL_REVIEW_DELAY_MS).toISOString()
});

export const applyUnitReviewRegistration = (
  subject: Subject | undefined, existingLogs: StudyLog[], incoming: StudyLog, nowMs = Date.now()
): UnitReviewResult => {
  const unchanged: UnitReviewResult = { incoming, logs: existingLogs, units: [] };
  if (!subject || incoming.isRepeatReview || incoming.reviewParentSubjectId) return unchanged;
  const start = incoming.startPage;
  const end = incoming.endPage;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end! < start!) return unchanged;
  const wantsReview = incoming.reviewEnabled !== false && !incoming.isCondensed;
  const deferred: StudyLog = wantsReview
    ? { ...incoming, nextReviewDate: undefined, isCondensed: true, reviewEnabled: false, unitReviewPending: true }
    : incoming;
  return { incoming: deferred, logs: existingLogs, units: [] };
};

/** 이 과목에서 "복습에 넣기"를 기다리는 기록들 */
export const getPendingReviewLogs = (logs: StudyLog[], subjectId: string): StudyLog[] => (
  logs.filter(log => log.unitReviewPending && log.subjectId === subjectId)
);

export interface PendingReviewRegistration {
  logs: StudyLog[];
  /** 복습에 들어간 기록 id들 */
  logIds: string[];
  /** 들어간 기록들이 푼 쪽 범위(페이지를 적은 기록이 있을 때) */
  range?: { start: number; end: number };
}

/**
 * 사용자가 "복습에 넣기"를 눌렀을 때: 이 과목에서 쌓인 대기 기록을 모두 복습으로 등록한다(그 기록들의 노트가 새 복습 문제가 된다).
 * 대기 기록이 없으면 아무것도 바꾸지 않는다. 다른 과목의 기록은 건드리지 않는다.
 */
export const registerPendingReviews = (subjectId: string, logs: StudyLog[], nowMs = Date.now()): PendingReviewRegistration => {
  const pending = getPendingReviewLogs(logs, subjectId);
  if (!pending.length) return { logs, logIds: [] };
  const starts = pending.map(log => log.startPage ?? log.endPage).filter((page): page is number => Number.isFinite(page));
  const ends = pending.map(log => log.endPage ?? log.startPage).filter((page): page is number => Number.isFinite(page));
  const range = starts.length && ends.length ? { start: Math.min(...starts), end: Math.max(...ends) } : undefined;
  const ids = new Set(pending.map(log => log.id));
  return {
    logs: logs.map(log => (ids.has(log.id) ? registerPendingLog(log, nowMs, range) : log)),
    logIds: pending.map(log => log.id),
    range
  };
};
