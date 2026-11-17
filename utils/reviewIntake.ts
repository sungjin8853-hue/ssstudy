import type { StudyLog, Subject } from '../types';
import { autoReviewGradeOf, autoReviewHoursOf } from './autoReview';
import { chapterFeedbackOf, pendingChapterGroups } from './chapterReview';
import { fsrsIntervalMs, fsrsReview } from './fsrs';
import { pastSessions, previousUnitSpeed, speedPerHour, SUBJECT_GRADE_RATING, SUBJECT_GRADES, summarizeSpeedFeedback } from './subjectFeedback';
import type { SpeedFeedbackSummary, SubjectGrade } from './subjectFeedback';

/**
 * 17일 "복습 자동 여부만 할 일에서 설정하고 복습 피드백 및 복습 넣기는 학습량 입력에서":
 * 학습량 입력(측정을 마치고 저장하는 창 · 학습 기록 추가 창)에서 이번 공부를 저장하면서 복습에 넣고 난도를 고른다.
 *  - 자동 복습을 끈 과목: "복습에 넣기"를 켜면 이 과목에서 기다리는 기록(이번 공부 포함)이 고른 난도로 한 단위가 되어 복습에 들어간다
 *    (전의 "복습에 넣기" 창과 같다: 단원이 있으면 단원마다 공부한 때마다 복습한 것으로 계산).
 *  - 자동 복습을 켠 과목: 이번 저장으로 모은 공부 시간이 차면(또는 과목을 다 끝내면) 그 묶음이 들어가므로 그때 묶음의 난도를 고른다.
 *    아직 차지 않으면 모은 시간만 보여 준다.
 */
export type ReviewIntake = { kind: 'register'; grade: SubjectGrade } | { kind: 'auto'; grade: SubjectGrade };

export interface ReviewIntakeFeedback {
  speed: number | null;
  previousSpeed: number | null;
  summary: SpeedFeedbackSummary;
  recommended: SubjectGrade;
  intervals: Record<SubjectGrade, number>;
  /** 넣을 기록 수(이번 공부 포함) */
  count: number;
  minutes: number;
}

export type ReviewIntakeInfo =
  | { kind: 'manual'; feedback: ReviewIntakeFeedback; finishedChapters: string[] }
  | { kind: 'auto'; willRegister: boolean; minutes: number; hours: number; feedback: ReviewIntakeFeedback | null };

const stageOf = (log: StudyLog) => log.subjectStageId || log.subjectId;
const sum = (logs: readonly StudyLog[], pick: (log: StudyLog) => number) => logs.reduce((total, log) => total + (Number.isFinite(pick(log)) ? pick(log) : 0), 0);

/**
 * 저장하기 전의 이번 공부(draft: 복습을 기다리는 기록으로 만든 것)로 보는 복습 넣기 정보.
 * finished: 이번 공부로 과목을 다 끝내는가(자동 복습이면 시간이 덜 차도 넣는다).
 */
export const reviewIntakeInfo = (subject: Subject, logs: readonly StudyLog[], draft: StudyLog, finished: boolean, nowMs: number): ReviewIntakeInfo => {
  const all = [...logs.filter(log => log.id !== draft.id), draft];
  if (subject.autoReviewRegister) {
    const waiting = logs.filter(log => log.id !== draft.id && log.subjectId === subject.id && log.unitReviewPending && log.autoReviewWaiting && stageOf(log) === stageOf(draft));
    const members = [...waiting, draft];
    const minutes = sum(members, log => log.timeSpentMinutes);
    const hours = autoReviewHoursOf(subject);
    const willRegister = finished || minutes >= hours * 60 - 1e-9;
    if (!willRegister) return { kind: 'auto', willRegister, minutes, hours, feedback: null };
    const ids = new Set(members.map(log => log.id));
    const atMs = Date.parse(draft.timestamp) || nowMs;
    return {
      kind: 'auto', willRegister, minutes, hours,
      feedback: {
        speed: speedPerHour(sum(members, log => log.pagesRead), minutes),
        previousSpeed: previousUnitSpeed(all, subject.id, members),
        summary: summarizeSpeedFeedback(pastSessions(all.filter(log => !ids.has(log.id)), subject.id, 'study')),
        recommended: autoReviewGradeOf(all, members.map(log => ({ ...log, autoReviewChosenGrade: undefined }))),
        intervals: Object.fromEntries(SUBJECT_GRADES.map(grade => [grade, fsrsIntervalMs(fsrsReview(null, SUBJECT_GRADE_RATING[grade], atMs))])) as Record<SubjectGrade, number>,
        count: members.length, minutes
      }
    };
  }
  const groups = pendingChapterGroups(subject, all);
  const selected = groups.flatMap(group => group.logs);
  const feedback = chapterFeedbackOf(all, subject.id, selected, nowMs);
  // 이번 공부로 끝낸 단원(그 단원 끝 페이지까지 풀었다): 복습에 넣기를 권한다
  const finishedChapters = groups.filter(group => group.finished && group.number !== null && group.logs.some(log => log.id === draft.id)).map(group => group.label);
  return {
    kind: 'manual', finishedChapters,
    feedback: { speed: feedback.speed, previousSpeed: feedback.previousSpeed, summary: feedback.summary, recommended: feedback.recommended ?? 'good',
      intervals: feedback.intervals, count: selected.length, minutes: feedback.minutes }
  };
};

/** 자동 복습 묶음에 고른 난도를 적는다: 이번 기록과 같은 과목 · 단계에서 모으는 중인 기록 모두(앞 기록에 합쳐져도 남게) */
export const markAutoIntakeGrade = (logs: StudyLog[], incoming: StudyLog, grade: SubjectGrade): StudyLog[] => logs.map(log => (
  log.id === incoming.id || (log.subjectId === incoming.subjectId && log.unitReviewPending && log.autoReviewWaiting && stageOf(log) === stageOf(incoming))
    ? { ...log, autoReviewChosenGrade: grade } : log
));
