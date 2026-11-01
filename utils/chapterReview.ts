import type { StudyLog, Subject } from '../types';
import { fsrsIntervalMs, fsrsReview, FSRS_DEFAULT_RETENTION } from './fsrs';
import type { FsrsCard } from './fsrs';
import { getStageChapters, getSubjectStages } from './schedule';
import { pastSessions, recommendSubjectGrade, speedPerHour, SUBJECT_GRADE_RATING, SUBJECT_GRADES, summarizeSpeedFeedback } from './subjectFeedback';
import type { SpeedFeedbackSummary, SubjectGrade } from './subjectFeedback';

/**
 * 단원별 "복습에 넣기"(1일 요청).
 *  - 아직 한 번도 복습에 넣지 않은(대기) 기록을 단원으로 묶는다. 기록은 시작 페이지가 든 단원에 속한다. 단원이 없는 단계는 한 묶음이다.
 *  - 단원 하나를 끝내면(그 단원 끝 페이지까지 풀면) 복습에 넣기를 추천한다.
 *  - 복습 주기는 그 기록들을 공부한 때마다 복습한 것으로 보고 FSRS-6로 차례로 계산한다. 공부 한 번의 난도는 그때의 속도로 정하고
 *    (그 전 기록들의 평균 속도와 비교: 쉬움 · 보통 · 어려움), 마지막 평가는 그 기록들 난도의 평균이다(추천 · 기본값).
 */
export interface PendingChapterGroup {
  key: string;
  stageId: string;
  /** 단원 번호(1부터). 단원이 없는 단계면 null */
  number: number | null;
  startPage: number | null;
  endPage: number | null;
  /** 보이는 이름: "단원 2 · p.11~20" (후행과목이면 앞에 그 이름) */
  label: string;
  logs: StudyLog[];
  /** 그 단원 끝 페이지까지 풀었는가 */
  finished: boolean;
}

const byTime = (a: StudyLog, b: StudyLog) => a.timestamp.localeCompare(b.timestamp);

export const pendingChapterGroups = (subject: Subject, logs: readonly StudyLog[], pagePos = 'p'): PendingChapterGroup[] => {
  const pending = logs.filter(log => log.unitReviewPending && log.subjectId === subject.id).sort(byTime);
  if (!pending.length) return [];
  const stages = getSubjectStages(subject);
  const groups = new Map<string, PendingChapterGroup & { order: number }>();
  pending.forEach(log => {
    const stageId = log.subjectStageId || subject.id;
    const stageIndex = Math.max(0, stages.findIndex(stage => stage.id === stageId));
    const stage = stages[stageIndex] ?? null;
    const chapters = getStageChapters(subject, stage);
    const page = Number.isFinite(log.startPage) ? log.startPage! : log.endPage;
    const index = Number.isFinite(page) ? chapters.findIndex(chapter => page! >= chapter.startPage && page! <= chapter.endPage) : -1;
    const key = `${stageId}:${index >= 0 ? index : 'all'}`;
    const existing = groups.get(key);
    if (existing) { existing.logs.push(log); return; }
    const chapter = index >= 0 ? chapters[index] : null;
    const prefix = stage?.isFollowUp ? `${stage.name} · ` : '';
    const finished = chapter ? logs.some(item => item.subjectId === subject.id && !item.reviewParentSubjectId
      && (item.subjectStageId || subject.id) === stageId && Number(item.endPage) >= chapter.endPage) : false;
    groups.set(key, {
      key, stageId, number: chapter ? index + 1 : null, startPage: chapter?.startPage ?? null, endPage: chapter?.endPage ?? null,
      label: chapter ? `${prefix}단원 ${index + 1} · ${pagePos}.${chapter.startPage}~${chapter.endPage}` : `${prefix || ''}${chapters.length ? '단원 밖' : '전체'}`,
      logs: [log], finished, order: stageIndex * 10000 + (index >= 0 ? index : 9999)
    });
  });
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ order: _order, ...group }) => group);
};

/** 공부 한 번의 난도: 그 기록의 속도를 그 전 기록들(같은 과목 공부)의 평균 속도와 비교한다. 비교할 기록이 없으면 보통 */
export const sessionGradeOf = (logs: readonly StudyLog[], subjectId: string, log: StudyLog): SubjectGrade => {
  const before = logs.filter(item => item.id !== log.id && item.timestamp < log.timestamp);
  const average = summarizeSpeedFeedback(pastSessions(before, subjectId, 'study')).averageSpeed;
  return recommendSubjectGrade(speedPerHour(log.pagesRead, log.timeSpentMinutes), average) ?? 'good';
};

/** 난도들의 평균(다시 1 · 어려움 2 · 보통 3 · 쉬움 4의 평균을 반올림). 없으면 보통 */
export const averageGradeOf = (grades: readonly SubjectGrade[]): SubjectGrade => {
  if (!grades.length) return 'good';
  const mean = grades.reduce((sum, grade) => sum + SUBJECT_GRADE_RATING[grade], 0) / grades.length;
  return SUBJECT_GRADES[Math.min(3, Math.max(0, Math.round(mean) - 1))];
};

/**
 * 고른 기록들을 공부한 때마다 복습한 것으로 보고 계산한 기억(FSRS-6): 앞의 기록들은 그때의 난도로, 마지막 기록은 finalGrade로 평가한다.
 * 다음 복습은 마지막 공부 때 + 간격이다(이미 지났으면 바로 복습할 때다).
 */
export const simulateStudyCard = (logs: readonly StudyLog[], subjectId: string, selected: readonly StudyLog[], finalGrade: SubjectGrade): FsrsCard | null => {
  const ordered = [...selected].sort(byTime);
  let card: FsrsCard | null = null;
  ordered.forEach((log, index) => {
    const at = Date.parse(log.timestamp);
    if (!Number.isFinite(at)) return;
    const grade = index === ordered.length - 1 ? finalGrade : sessionGradeOf(logs, subjectId, log);
    card = fsrsReview(card, SUBJECT_GRADE_RATING[grade], at);
  });
  return card;
};

export const simulatedDueMs = (card: FsrsCard | null) => (card ? card.lastReviewMs + fsrsIntervalMs(card, FSRS_DEFAULT_RETENTION) : NaN);

export interface ChapterFeedback {
  pages: number;
  minutes: number;
  speed: number | null;
  summary: SpeedFeedbackSummary;
  /** 고른 기록마다 공부했을 때의 난도(시간순) */
  sessionGrades: SubjectGrade[];
  /** 그 난도들의 평균: 마지막 평가의 추천 */
  recommended: SubjectGrade | null;
  /** 난도마다 지금부터 다음 복습까지(ms, 이미 지났으면 0) */
  intervals: Record<SubjectGrade, number>;
}

export const chapterFeedbackOf = (logs: readonly StudyLog[], subjectId: string, selected: readonly StudyLog[], nowMs: number): ChapterFeedback => {
  const ids = new Set(selected.map(log => log.id));
  const pages = selected.reduce((sum, log) => sum + (Number.isFinite(log.pagesRead) ? log.pagesRead : 0), 0);
  const minutes = selected.reduce((sum, log) => sum + (Number.isFinite(log.timeSpentMinutes) ? log.timeSpentMinutes : 0), 0);
  const summary = summarizeSpeedFeedback(pastSessions(logs.filter(log => !ids.has(log.id)), subjectId, 'study'));
  const sessionGrades = [...selected].sort(byTime).map(log => sessionGradeOf(logs, subjectId, log));
  const intervals = Object.fromEntries(SUBJECT_GRADES.map(grade => {
    const due = simulatedDueMs(simulateStudyCard(logs, subjectId, selected, grade));
    return [grade, Number.isFinite(due) ? Math.max(0, due - nowMs) : 0];
  })) as Record<SubjectGrade, number>;
  return { pages, minutes, speed: speedPerHour(pages, minutes), summary, sessionGrades, recommended: selected.length ? averageGradeOf(sessionGrades) : null, intervals };
};

/** 고른 기록들에 마지막 평가(grade)와 계산한 기억을 매긴다. 등록은 registerPendingReviews(…, ids)가 한다 */
export const gradeSelectedPending = (logs: StudyLog[], subjectId: string, logIds: readonly string[], grade: SubjectGrade): StudyLog[] => {
  const ids = new Set(logIds);
  const selected = logs.filter(log => ids.has(log.id) && log.unitReviewPending && log.subjectId === subjectId);
  const card = simulateStudyCard(logs, subjectId, selected, grade);
  return logs.map(log => (ids.has(log.id) && log.unitReviewPending && log.subjectId === subjectId
    ? { ...log, feedbackGrade: grade, ...(card ? { reviewFsrs: card } : {}) } : log));
};
