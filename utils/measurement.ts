import { Subject } from '../types';
import { calculateStudyPageAmount, getReviewStartPage } from './review';
import { getActiveSubjectStage } from './schedule';

export const POMODORO_MINUTES = 25;

export interface PomodoroPlan {
  subjectId: string;
  pages: number | null;
  minutes: number;
  remainingTaskPages?: number;
}

export const getRemainingPomodoroSessions = (remainingPages: number, sessionPages: number | null) => (
  sessionPages !== null && sessionPages > 0 ? Math.max(0, Math.ceil(Math.max(0, remainingPages) / sessionPages - 1e-9)) : null
);

export const getSessionTimes = (studySeconds: number, organizationSeconds: number) => ({
  timeAttackMinutes: Math.max(0, studySeconds) / 60,
  organizationMinutes: Math.max(0, organizationSeconds) / 60,
  timeSpentMinutes: (Math.max(0, studySeconds) + Math.max(0, organizationSeconds)) / 60
});

export const resizeSessionTimes = (minutes: number, previous: { timeSpentMinutes: number; timeAttackMinutes?: number }) => {
  if (previous.timeAttackMinutes === undefined) return {};
  const ratio = previous.timeSpentMinutes > 0
    ? Math.min(1, Math.max(0, previous.timeAttackMinutes / previous.timeSpentMinutes)) : 0;
  return { timeAttackMinutes: minutes * ratio, organizationMinutes: minutes - minutes * ratio };
};

export const getMeasurementRemainingPages = (subject: Subject) => {
  const start = getReviewStartPage(subject);
  const end = getActiveSubjectStage(subject)?.endPage || subject.totalPages;
  return start === null ? 0 : Math.max(0, end - start + 1);
};

export const getPomodoroPageTarget = (minutesPerPage: number, remainingPages: number) => {
  if (!Number.isFinite(minutesPerPage) || minutesPerPage <= 0) return null;
  if (!Number.isFinite(remainingPages) || remainingPages <= 0) return 0;
  return Math.min(Math.floor(remainingPages), Math.max(1, Math.floor(POMODORO_MINUTES / minutesPerPage)));
};

export const isPomodoroGoalExceeded = (pages: number, goal: number | null) => (
  goal !== null && goal > 0 && pages > goal
);

export const getPomodoroRemainingPages = (goal: number | null, solvedPages: number) => (
  goal === null ? null : Math.max(0, goal - Math.max(0, solvedPages))
);

export const getMeasurementGoalEndPage = (startPage: number, pages: number | null) => (
  pages !== null && pages > 0 ? startPage + pages - 1 : null
);

export const getAutoSolvedPageCount = (start: number, end: number) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Number((end - start + (Number.isInteger(start) && Number.isInteger(end) ? 1 : 0)).toFixed(2)));
};

export const createPageMeasurement = (start: number, end: number, pages: number, remainingPages: number) => {
  if (calculateStudyPageAmount(start, end, remainingPages, true) === null
    || !Number.isInteger(pages) || pages <= 0) return null;
  return { startPage: start, endPage: end, pagesRead: pages, pageCountIsExplicit: true as const };
};

export { getLogProgressPages } from './schedule';
