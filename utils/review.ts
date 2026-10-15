import { ReviewMeasurement, StudyLog, Subject } from '../types';
import { getActiveSubjectStage, getSubjectStages } from './schedule';

export const BASIC_REVIEW_DETAIL_PREFIX = 'basic-review:';
export const IS_FAST_REVIEW_TEST_MODE = false;
export const INITIAL_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const getNextReviewIntervalMs = (reviewStep: number) => {
  if (reviewStep <= 0) return DAY_MS;
  return DAY_MS * Math.pow(2, reviewStep);
};

export const createRepeatedSubjectReview = (log: StudyLog, parentSubjectId: string, reviewStep: number, nowMs = Date.now()): StudyLog => ({
  ...log,
  isRepeatReview: true,
  reviewRepeatStartPage: log.endPage,
  reviewParentSubjectId: parentSubjectId,
  reviewSubjectId: log.subjectId,
  reviewSubjectIdsSnapshot: [log.subjectId],
  reviewStep: reviewStep + 1,
  nextReviewDate: new Date(nowMs + getNextReviewIntervalMs(reviewStep)).toISOString(),
  reviewEnabled: true,
  isCondensed: false,
  isReviewed: false
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
