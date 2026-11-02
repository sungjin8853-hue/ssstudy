import type { StudyLog, Subject } from '../types';
import { getStageChapters, getSubjectStages } from './schedule';

/**
 * 복습하는 부분 바로 뒤의 풀지 않은 페이지(2일 요청). 보여 주기만 하고 다른 계산에는 쓰지 않는다.
 * 그 기록(또는 함께 복습에 넣은 범위)의 끝 페이지 다음부터, 같은 단계에서 그다음으로 공부를 시작한 페이지 바로 앞까지다.
 * 단원이 있으면 단원 안의 페이지만 센다(단원 사이 건너뛰는 페이지는 풀 곳이 아니다). 뒤에 공부한 곳이 아직 없으면 없다.
 */
export interface PageSpan { start: number; end: number }

export const unsolvedPagesAfter = (log: StudyLog, logs: readonly StudyLog[], subjects: readonly Subject[]): PageSpan[] => {
  const subjectId = log.reviewParentSubjectId ?? log.subjectId;
  const subject = subjects.find(item => item.id === subjectId);
  const range = log.reviewUnitRange
    ?? (Number.isFinite(log.startPage) && Number.isFinite(log.endPage) ? { start: Math.min(log.startPage!, log.endPage!), end: Math.max(log.startPage!, log.endPage!) } : null);
  if (!subject || !range) return [];
  const stageId = log.subjectStageId || subject.id;
  const next = logs
    .filter(item => item.subjectId === subject.id && !item.reviewParentSubjectId && !item.isRepeatReview && (item.subjectStageId || subject.id) === stageId)
    .map(item => (Number.isFinite(item.startPage) ? item.startPage! : NaN))
    .filter(page => Number.isFinite(page) && page > range.end)
    .reduce((min, page) => Math.min(min, page), Infinity);
  if (!Number.isFinite(next) || next <= range.end + 1) return [];
  const gap = { start: range.end + 1, end: next - 1 };
  const stage = getSubjectStages(subject).find(item => item.id === stageId) ?? null;
  const chapters = getStageChapters(subject, stage);
  if (!chapters.length) return [gap];
  return chapters
    .map(chapter => ({ start: Math.max(chapter.startPage, gap.start), end: Math.min(chapter.endPage, gap.end) }))
    .filter(span => span.start <= span.end);
};

export const formatPageSpans = (spans: readonly PageSpan[], pagePos = 'p') => spans
  .map(span => (span.start === span.end ? `${pagePos}.${span.start}` : `${pagePos}.${span.start}~${span.end}`)).join(', ');
