import type { StudyLog } from '../types';
import { isReviewQuestionRemoved } from './reviewGate';

export type QuestionGrade = 'again' | 'hard' | 'good' | 'easy';
export const QUESTION_GRADES: readonly QuestionGrade[] = ['again', 'hard', 'good', 'easy'];
/** 기본 복습 문제에서 고르는 난도(문제 카드의 버튼과 같은 이름) */
export const QUESTION_GRADE_LABELS: Record<QuestionGrade, string> = { again: '오답', hard: '어렵게 맞음', good: '맞음', easy: '쉽게 맞음' };

export interface BasicReviewCountRow {
  /** 문제의 몇 번째 복습인가(1회 = 그 문제를 처음 복습한 때) */
  count: number;
  /** 이 횟수까지 복습한 문제 수 */
  questions: number;
  /** 오답이 아닌 비율(0~1) */
  correctRate: number;
  /** 고른 난도별 수 */
  grades: Record<QuestionGrade, number>;
  /** 가장 많이 고른 난도와 그 비율(같으면 더 어려운 쪽) */
  top: { grade: QuestionGrade; share: number };
}

/**
 * 7일 "문제들을 해당 문제의 복습 횟수로 나열한 뒤, 정답률값을 보여주고 해당 정답률에 따른 가장 비율이 높은 난도 피드백값을 횟수마다":
 * 과목의 기록들에서 문제마다 쌓인 복습 기록(history)을 그 문제의 n번째 복습끼리 모은다. 복습에서 뺀 문제는 세지 않는다.
 */
export const basicReviewCountRows = (logs: readonly StudyLog[], subjectId: string): BasicReviewCountRow[] => {
  const rows = new Map<number, Record<QuestionGrade, number>>();
  logs.filter(log => log.subjectId === subjectId && !log.reviewParentSubjectId).forEach(log => {
    Object.entries(log.reviewQuestionSchedules ?? {}).forEach(([key, schedule]) => {
      if (isReviewQuestionRemoved(log, key)) return;
      (schedule.history ?? []).forEach((entry, index) => {
        if (!QUESTION_GRADES.includes(entry.grade)) return;
        const counts = rows.get(index + 1) ?? { again: 0, hard: 0, good: 0, easy: 0 };
        counts[entry.grade] += 1;
        rows.set(index + 1, counts);
      });
    });
  });
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([count, grades]) => {
    const total = QUESTION_GRADES.reduce((sum, grade) => sum + grades[grade], 0);
    const best = QUESTION_GRADES.reduce((top, grade) => (grades[grade] > grades[top] ? grade : top), 'again' as QuestionGrade);
    return { count, questions: total, correctRate: total ? (total - grades.again) / total : 0, grades, top: { grade: best, share: total ? grades[best] / total : 0 } };
  });
};
