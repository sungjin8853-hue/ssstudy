import { Subject, SubjectChapter } from '../types';
import { calculateStudyPageAmount, getReviewStartPage } from './review';
import { getActiveSubjectStage, getStageChapters } from './schedule';
import { pagesBetween } from './subjectChapters';

/** 뽀모도로 기본 길이(분). 사용자가 바꾼 길이는 utils/pomodoroSetting.ts에 저장되고, 아래 함수들은 minutes로 그 값을 받는다. */
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
  const stage = getActiveSubjectStage(subject);
  const end = stage?.endPage || subject.totalPages;
  const chapters = getStageChapters(subject, stage);
  // 단원이 있으면 단원 안 페이지만 센다
  if (chapters.length > 0) return start === null ? 0 : pagesBetween(chapters, start, end);
  return start === null ? 0 : Math.max(0, end - start + 1);
};

export const getPomodoroPageTarget = (minutesPerPage: number, remainingPages: number, pomodoroMinutes = POMODORO_MINUTES) => {
  if (!Number.isFinite(minutesPerPage) || minutesPerPage <= 0) return null;
  if (!Number.isFinite(remainingPages) || remainingPages <= 0) return 0;
  return Math.min(Math.floor(remainingPages), Math.max(1, Math.floor(pomodoroMinutes / minutesPerPage)));
};

export const POMODORO_SECONDS = POMODORO_MINUTES * 60;

/**
 * 예상 시간(초)을 뽀모도로(기본 25분) 단위로 나눈 횟수. 예상 시간이 뽀모도로 시간 이하면 1회(예상 시간만큼)이고,
 * 넘으면 뽀모도로 시간씩 나누고 남는 시간이 마지막 회차가 되도록 올림한다. 예상 시간을 모르면(0 이하) 0.
 */
export const getPomodoroRounds = (estimatedSeconds: number, pomodoroMinutes = POMODORO_MINUTES) => (
  Number.isFinite(estimatedSeconds) && estimatedSeconds > 0
    ? Math.max(1, Math.ceil(estimatedSeconds / (pomodoroMinutes * 60) - 1e-9)) : 0
);

/**
 * 예상 시간(초)과 경과 시간(초)으로 지금 몇 번째 뽀모도로인지, 그 회차가 끝나기까지 몇 초 남았는지 구한다.
 * 회차는 뽀모도로 시간(기본 25분)씩이고 마지막 회차는 남는 시간만큼이다(예: 예상 33분 20초 → 25:00 + 08:20). 예상 시간이 모두 지나면 finished이고 남은 시간은 0이다.
 * completedRounds는 이미 끝난 회차 수(알림을 낼 기준)이다.
 */
export const getPomodoroProgress = (estimatedSeconds: number, elapsedSeconds: number, pomodoroMinutes = POMODORO_MINUTES) => {
  const roundSeconds = pomodoroMinutes * 60;
  const rounds = getPomodoroRounds(estimatedSeconds, pomodoroMinutes);
  if (rounds === 0) return null;
  const elapsed = Math.max(0, elapsedSeconds);
  const finished = elapsed >= estimatedSeconds;
  const round = finished ? rounds : Math.min(rounds, Math.floor(elapsed / roundSeconds) + 1);
  const roundEnd = finished ? estimatedSeconds : Math.min(round * roundSeconds, estimatedSeconds);
  return { rounds, round, remainingSeconds: Math.max(0, roundEnd - elapsed), finished, completedRounds: finished ? rounds : round - 1 };
};

/**
 * 기본 복습의 뽀모도로. 복습할 장수와 장당 시간(분)으로 "한 번(25분)에 복습할 장수"와 "필요 횟수"를 구한다.
 * 한 번에 복습할 장수는 복습할 장수를 넘지 않는다. 필요 횟수는 예상 시간(장수 × 장당 시간)을 뽀모도로 시간으로 나눈 횟수다.
 * 장당 시간을 모르면(0 이하) 둘 다 null이다.
 */
export const getReviewPomodoro = (reviewPages: number, minutesPerPage: number, pomodoroMinutes = POMODORO_MINUTES) => {
  const pages = getPomodoroPageTarget(minutesPerPage, reviewPages, pomodoroMinutes);
  const sessions = pages !== null && pages > 0 ? getPomodoroRounds(reviewPages * minutesPerPage * 60, pomodoroMinutes) : null;
  return { pages, sessions };
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

export const createPageMeasurement = (start: number, end: number, pages: number, remainingPages: number, chapters: readonly SubjectChapter[] = []) => {
  if (chapters.length > 0) {
    // 단원이 있으면 끝 페이지는 단원 안 페이지여야 하고, 진척도에는 단원 사이를 건너뛴 만큼 뺀 장수가 들어간다
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(pages) || pages <= 0 || start < 1 || end < start) return null;
    if (!chapters.some(item => end >= item.startPage && end <= item.endPage)) return null;
    const progressPages = pagesBetween(chapters, start, end);
    if (progressPages <= 0 || progressPages > remainingPages) return null;
    return { startPage: start, endPage: end, pagesRead: pages, pageCountIsExplicit: true as const, progressPages };
  }
  if (calculateStudyPageAmount(start, end, remainingPages, true) === null
    || !Number.isInteger(pages) || pages <= 0) return null;
  return { startPage: start, endPage: end, pagesRead: pages, pageCountIsExplicit: true as const };
};

export { getLogProgressPages } from './schedule';
