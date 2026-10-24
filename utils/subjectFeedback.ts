import type { StudyLog } from '../types';
import { fsrsIntervalMs, fsrsReview, FSRS_DEFAULT_RETENTION } from './fsrs';
import type { FsrsCard, FsrsRating } from './fsrs';
import { getNextReviewIntervalMs } from './review';

/**
 * 과목 난도 피드백(학습과목·복습과목): 과목 한 번을 끝낸 뒤 다시 · 어려움 · 보통 · 쉬움을 고르면 FSRS-6로 그 기록의 다음 복습이 정해진다.
 *  - 속도는 1시간에 푼 장수(P/h) = 푼 장수 ÷ 걸린 시간(풀이+정리).
 *  - 같은 과목의 지난 기록으로 "평균 속도"를 구하고, 이번 속도가 평균보다 충분히 빠르면 쉬움, 느리면 어려움을 권한다(다시는 권하지 않는다).
 *  - 쉬움 옆에는 쉬움이 되는 속도(목표 속도 = 평균 × EASY_SPEED_RATIO)를 보여 준다.
 */
export type SubjectGrade = 'again' | 'hard' | 'good' | 'easy';
export const SUBJECT_GRADES: readonly SubjectGrade[] = ['again', 'hard', 'good', 'easy'];
export const SUBJECT_GRADE_RATING: Record<SubjectGrade, FsrsRating> = { again: 1, hard: 2, good: 3, easy: 4 };
export const SUBJECT_GRADE_LABELS: Record<SubjectGrade, string> = { again: '다시', hard: '어려움', good: '보통', easy: '쉬움' };

/** 평균보다 이만큼 이상 빠르면 쉬움 / 이만큼 아래로 느리면 어려움 */
export const EASY_SPEED_RATIO = 1.15;
export const HARD_SPEED_RATIO = 0.85;
/** 평균을 낼 때 보는 최근 기록 수 */
const RECENT_SESSIONS = 10;

export type FeedbackKind = 'study' | 'review';

/** 1시간에 푼 장수. 장수나 시간이 없으면 null */
export const speedPerHour = (pages: number, minutes: number): number | null => (
  Number.isFinite(pages) && Number.isFinite(minutes) && pages > 0 && minutes > 0 ? pages / (minutes / 60) : null
);

const logSpeed = (log: StudyLog) => speedPerHour(log.pagesRead, log.timeSpentMinutes);

/** 같은 과목에서 지난 기록들(공부는 복습 측정이 아닌 기록, 복습은 복습과목으로 잰 기록). 시간순 */
export const pastSessions = (logs: readonly StudyLog[], subjectId: string, kind: FeedbackKind): StudyLog[] => logs
  .filter(log => log.subjectId === subjectId && Boolean(log.reviewParentSubjectId) === (kind === 'review') && logSpeed(log) !== null)
  .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface SpeedFeedbackSummary {
  /** 지난 기록의 평균 속도(P/h): 최근 기록의 가운데 값. 기록이 없으면 null */
  averageSpeed: number | null;
  /** 쉬움이 되는 속도 */
  targetSpeed: number | null;
  /** 피드백을 고른 적이 있는 등급마다: 그때의 평균 속도와 횟수 */
  byGrade: { grade: SubjectGrade; averageSpeed: number; count: number }[];
}

export const summarizeSpeedFeedback = (sessions: readonly StudyLog[]): SpeedFeedbackSummary => {
  const speeds = sessions.slice(-RECENT_SESSIONS).map(logSpeed).filter((value): value is number => value !== null);
  const averageSpeed = speeds.length ? median(speeds) : null;
  const byGrade = SUBJECT_GRADES.flatMap(grade => {
    const own = sessions.filter(log => log.feedbackGrade === grade).map(logSpeed).filter((value): value is number => value !== null);
    return own.length ? [{ grade, averageSpeed: own.reduce((sum, value) => sum + value, 0) / own.length, count: own.length }] : [];
  });
  return { averageSpeed, targetSpeed: averageSpeed === null ? null : averageSpeed * EASY_SPEED_RATIO, byGrade };
};

/** 이번 속도로 권하는 평가. 기록이 없거나 속도를 모르면 null, 다시는 권하지 않는다. */
export const recommendSubjectGrade = (speed: number | null, averageSpeed: number | null): SubjectGrade | null => {
  if (speed === null || averageSpeed === null || averageSpeed <= 0) return null;
  const ratio = speed / averageSpeed;
  if (ratio >= EASY_SPEED_RATIO) return 'easy';
  if (ratio >= HARD_SPEED_RATIO) return 'good';
  return 'hard';
};

/**
 * 이 기록의 과목 단위 기억(FSRS-6). 아직 평가가 없는 예전 기록은 지금 복습 단계(reviewStep)의 간격을 안정도로 삼아 이어 간다.
 * 복습을 한 번도 안 한 기록(단계 0)이면 null이라 첫 평가가 첫 기억이 된다.
 */
export const subjectCardOf = (log: StudyLog): FsrsCard | null => {
  if (log.reviewFsrs) return log.reviewFsrs;
  const step = log.reviewStep ?? 0;
  const due = log.nextReviewDate ? Date.parse(log.nextReviewDate) : NaN;
  if (step <= 0 || !Number.isFinite(due)) return null;
  const intervalMs = getNextReviewIntervalMs(step - 1);
  return { stability: Math.max(0.5, intervalMs / 86400000), difficulty: 5, reps: step, lapses: 0, lastReviewMs: due - intervalMs };
};

/** 과목 평가를 반영한 새 기억 */
export const gradeSubjectCard = (log: StudyLog, grade: SubjectGrade, nowMs: number): FsrsCard => (
  fsrsReview(subjectCardOf(log), SUBJECT_GRADE_RATING[grade], nowMs)
);

/** 과목 단위 기억이 정한 다음 복습 시각(ms). 기억이 없으면 NaN */
export const subjectDueMs = (log: Pick<StudyLog, 'reviewFsrs'>): number => (
  log.reviewFsrs ? log.reviewFsrs.lastReviewMs + fsrsIntervalMs(log.reviewFsrs, FSRS_DEFAULT_RETENTION) : NaN
);

/** 지금 이 기록을 평가한다면 평가마다 다음 복습까지의 간격(ms) — 버튼에 보여 준다 */
export const previewSubjectIntervals = (log: StudyLog | null, nowMs: number): Record<SubjectGrade, number> => {
  const card = log ? subjectCardOf(log) : null;
  return Object.fromEntries(SUBJECT_GRADES.map(grade => [grade, fsrsIntervalMs(fsrsReview(card, SUBJECT_GRADE_RATING[grade], nowMs))])) as Record<SubjectGrade, number>;
};

/** P/h 한 자리 소수 */
export const formatSpeed = (speed: number | null, label = 'P') => (speed === null ? '-' : `${speed.toFixed(1)}${label}/h`);

/**
 * "복습에 넣기"를 눌렀을 때 고르는 난도의 바탕: 그 과목의 복습 대기 기록들을 한 묶음으로 본다.
 *  - 이번 속도 = 대기 기록들이 푼 장수의 합 ÷ 걸린 시간의 합, 평균 속도 · 등급별 기록 = 대기 기록을 뺀 같은 과목의 지난 공부 기록
 *  - 간격 미리보기는 아직 복습한 적 없는 기록의 첫 기억 기준이다(대기 기록은 모두 같다).
 */
export interface PendingFeedback {
  pending: StudyLog[];
  pages: number;
  minutes: number;
  speed: number | null;
  summary: SpeedFeedbackSummary;
  recommended: SubjectGrade | null;
  intervals: Record<SubjectGrade, number>;
}

export const pendingFeedbackOf = (logs: readonly StudyLog[], subjectId: string, nowMs: number): PendingFeedback => {
  const pending = logs.filter(log => log.unitReviewPending && log.subjectId === subjectId);
  const ids = new Set(pending.map(log => log.id));
  const pages = pending.reduce((sum, log) => sum + (Number.isFinite(log.pagesRead) ? log.pagesRead : 0), 0);
  const minutes = pending.reduce((sum, log) => sum + (Number.isFinite(log.timeSpentMinutes) ? log.timeSpentMinutes : 0), 0);
  const speed = speedPerHour(pages, minutes);
  const summary = summarizeSpeedFeedback(pastSessions(logs.filter(log => !ids.has(log.id)), subjectId, 'study'));
  return { pending, pages, minutes, speed, summary, recommended: recommendSubjectGrade(speed, summary.averageSpeed), intervals: previewSubjectIntervals(pending[0] ?? null, nowMs) };
};

/** 고른 난도를 그 과목의 복습 대기 기록 모두에 매긴다: 평가(feedbackGrade)와 그 평가가 정한 기억(reviewFsrs). 등록은 registerPendingReviews가 한다. */
export const gradePendingReviews = (logs: StudyLog[], subjectId: string, grade: SubjectGrade, nowMs: number): StudyLog[] => logs.map(log => (
  log.unitReviewPending && log.subjectId === subjectId ? { ...log, feedbackGrade: grade, reviewFsrs: gradeSubjectCard(log, grade, nowMs) } : log
));
