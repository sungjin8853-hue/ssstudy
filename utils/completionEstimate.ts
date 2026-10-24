import { StudyLog, Subject } from '../types';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from './review';
import {
  calculateFreshWeekdayPagePlan,
  getDiffDays,
  getLocalDateKey,
  getSubjectRemainingPageCount,
  getSubjectStages,
  getWeekdayPagePlan,
  parseStudyDate
} from './schedule';

export type SubjectStage = ReturnType<typeof getSubjectStages>[number];

export interface ProjectedStudyEvent {
  date: Date;
  pages: number;
}

export interface StageScheduleEstimate {
  completionDates: Map<string, Date>;
  studyEvents: Map<string, ProjectedStudyEvent[]>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export const formatEstimatedDate = (date?: Date | null) => {
  if (!date || !Number.isFinite(date.getTime())) return '예측 어려움';
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const today = parseStudyDate(getLocalDateKey());
  const diffDays = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (diffDays <= 0) return '오늘';
  if (diffDays === 1) return '내일';
  const dateLabel = target.getFullYear() === today.getFullYear()
    ? `${target.getMonth() + 1}/${target.getDate()}`
    : `${String(target.getFullYear()).slice(2)}.${target.getMonth() + 1}.${target.getDate()}`;
  return `${dateLabel} · ${diffDays}일 후`;
};

export const estimateStageSchedule = (subject: Subject): StageScheduleEstimate => {
  const completionDates = new Map<string, Date>();
  const studyEvents = new Map<string, ProjectedStudyEvent[]>();
  const stages = getSubjectStages(subject);
  const totalRemainingPages = getSubjectRemainingPageCount(subject);
  if (totalRemainingPages <= 0) return { completionDates, studyEvents };

  const diffDays = getDiffDays(subject.targetDate);
  let weekdayPlan = getWeekdayPagePlan(subject, totalRemainingPages, diffDays);
  let weeklyCapacity = Object.values(weekdayPlan).reduce((sum, pages) => sum + pages, 0);

  if (weeklyCapacity <= 0) {
    weekdayPlan = calculateFreshWeekdayPagePlan(subject, totalRemainingPages, diffDays);
    weeklyCapacity = Object.values(weekdayPlan).reduce((sum, pages) => sum + pages, 0);
  }

  if (weeklyCapacity <= 0) return { completionDates, studyEvents };

  const remainingByStage = stages.map(stage => Math.max(0, stage.remainingPages));
  let activeStageIndex = remainingByStage.findIndex(pages => pages > 0);
  const cursor = parseStudyDate(getLocalDateKey());

  for (let dayOffset = 0; dayOffset < 3650 && activeStageIndex >= 0; dayOffset += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + dayOffset);
    let availablePages = Math.max(0, weekdayPlan[date.getDay()] || 0);

    while (availablePages > 0 && activeStageIndex >= 0) {
      const stage = stages[activeStageIndex];
      const pages = Math.min(availablePages, remainingByStage[activeStageIndex]);
      if (pages > 0) {
        const events = studyEvents.get(stage.id) || [];
        events.push({ date: new Date(date), pages });
        studyEvents.set(stage.id, events);
        remainingByStage[activeStageIndex] -= pages;
        availablePages -= pages;
      }

      if (remainingByStage[activeStageIndex] <= 0) {
        completionDates.set(stage.id, new Date(date));
        activeStageIndex = remainingByStage.findIndex((pages, index) => index > activeStageIndex && pages > 0);
      }
    }
  }

  return { completionDates, studyEvents };
};

/**
 * 복습과목이 언제 끝날지: 그 복습과목을 붙인 단계들의 공부 기록이 복습 차례가 될 때마다 그만큼 푼다고 보고 따라간다.
 * stage에 단계 하나를 주면 그 단계만, 여러 단계(같은 복습과목을 붙인 본 과목 · 후행과목)를 주면 모두의 기록과 예정 공부를 합친다 —
 * 같은 복습과목이 단계마다 다른 완료일로 보이지 않게(21:50 점검).
 */
export const estimateReviewSubjectCompletion = (
  parentSubject: Subject,
  stage: SubjectStage | SubjectStage[],
  reviewSubject: Subject,
  projectedStudyEvents: ProjectedStudyEvent[],
  logs: StudyLog[]
) => {
  const remainingPages = getSubjectRemainingPageCount(reviewSubject);
  if (remainingPages <= 0) return null;

  const now = Date.now();
  const latestSupportedDate = now + (10 * 365 * DAY_MS);
  const stages = Array.isArray(stage) ? stage : [stage];
  const events = logs
    .filter(log => {
      if (log.subjectId !== parentSubject.id || log.isCondensed || log.reviewEnabled === false) return false;
      const logStage = stages.find(item => item.id === (log.subjectStageId || parentSubject.id));
      if (!logStage) return false;
      const reviewSubjectIds = Array.isArray(log.reviewSubjectIdsSnapshot) && log.reviewSubjectIdsSnapshot.length > 0
        ? log.reviewSubjectIdsSnapshot
        : logStage.reviewSubjectIds;
      return reviewSubjectIds.includes(reviewSubject.id);
    })
    .flatMap(log => {
      const pages = Math.max(0, log.pagesRead);
      if (pages <= 0) return [];
      const scheduledAt = log.nextReviewDate
        ? new Date(log.nextReviewDate).getTime()
        : new Date(log.timestamp).getTime() + INITIAL_REVIEW_DELAY_MS;
      if (!Number.isFinite(scheduledAt)) return [];
      return [{ at: scheduledAt, pages, step: Math.max(0, log.reviewStep || 0) }];
    });

  projectedStudyEvents.forEach(event => {
    events.push({
      at: event.date.getTime() + INITIAL_REVIEW_DELAY_MS,
      pages: event.pages,
      step: 0
    });
  });

  if (events.length === 0) return null;

  let completedPages = 0;
  for (let count = 0; count < 5000 && events.length > 0; count += 1) {
    events.sort((a, b) => a.at - b.at);
    const event = events.shift();
    if (!event) break;
    const effectiveAt = Math.max(now, event.at);
    if (effectiveAt > latestSupportedDate) return null;

    completedPages += event.pages;
    if (completedPages >= remainingPages) return new Date(effectiveAt);

    const nextAt = event.at + getNextReviewIntervalMs(event.step);
    if (Number.isFinite(nextAt) && nextAt <= latestSupportedDate) {
      events.push({ ...event, at: nextAt, step: event.step + 1 });
    }
  }

  return null;
};

/** "~10/25"처럼 월/일만 단순하게 쓴 예상 완료일. 예측할 수 없으면 null. */
export const formatShortEndDate = (date?: Date | null) => (
  date && Number.isFinite(date.getTime()) ? `~${date.getMonth() + 1}/${date.getDate()}` : null
);

/**
 * 한 과목이 언제쯤 끝날지: 학습과목이면 지금 공부 중인 단계의 완료 예정일, 복습과목이면 붙어 있는 학습과목의 공부 일정을
 * 따라가며 복습이 모두 끝나는 날. 이미 끝났거나 예측할 수 없으면 null.
 */
export const estimateSubjectEndDate = (subjects: Subject[], logs: StudyLog[], subjectId: string): Date | null => {
  const owner = subjects.find(subject => getSubjectStages(subject).some(stage => stage.reviewSubjectIds.includes(subjectId)));
  if (owner) {
    const linked = getSubjectStages(owner).filter(item => item.reviewSubjectIds.includes(subjectId));
    const reviewSubject = subjects.find(subject => subject.id === subjectId);
    if (!linked.length || !reviewSubject) return null;
    const schedule = estimateStageSchedule(owner);
    return estimateReviewSubjectCompletion(owner, linked, reviewSubject, linked.flatMap(item => schedule.studyEvents.get(item.id) || []), logs);
  }
  const subject = subjects.find(item => item.id === subjectId);
  if (!subject) return null;
  const stage = getSubjectStages(subject).find(item => item.status === 'current');
  if (!stage) return null;
  return estimateStageSchedule(subject).completionDates.get(stage.id) || null;
};
