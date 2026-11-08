import React, { useMemo } from 'react';
import type { StudyLog } from '../types';
import { formatReviewInterval } from './ReviewPracticeScreen';
import { fsrsIntervalMs, fsrsReview } from '../utils/fsrs';
import { autoReviewGradeOf } from '../utils/autoReview';
import { formatSpeed, pastSessions, previousUnitSpeed, speedPerHour, SUBJECT_GRADE_LABELS, SUBJECT_GRADE_RATING, SUBJECT_GRADES, summarizeSpeedFeedback } from '../utils/subjectFeedback';
import type { SubjectGrade } from '../utils/subjectFeedback';

/**
 * 8일: 자동 복습이 켜진 과목에서 학습을 저장하면(같은 3시간 묶음에 공부가 더해져도) 넣은 묶음의 난도를 묻는다.
 * 추천 난도가 표시되고, 고른 난도가 그 묶음의 실제 종합 난도가 된다(같은 묶음이면 마지막에 고른 것). 닫으면 지금 난도(고른 것, 없으면 추천) 그대로다.
 */
export const AutoReviewFeedbackDialog: React.FC<{
  logs: readonly StudyLog[];
  members: readonly StudyLog[];
  groupAt: string;
  pageLabel: string;
  onChoose: (grade: SubjectGrade) => void;
  onClose: () => void;
}> = ({ logs, members, groupAt, pageLabel, onChoose, onClose }) => {
  const info = useMemo(() => {
    const ids = new Set(members.map(log => log.id));
    const subjectId = members[0]?.subjectId ?? '';
    const pages = members.reduce((sum, log) => sum + (Number.isFinite(log.pagesRead) ? log.pagesRead : 0), 0);
    const minutes = members.reduce((sum, log) => sum + (Number.isFinite(log.timeSpentMinutes) ? log.timeSpentMinutes : 0), 0);
    const summary = summarizeSpeedFeedback(pastSessions(logs.filter(log => !ids.has(log.id)), subjectId, 'study'));
    const atMs = Date.parse(groupAt);
    const intervals = Object.fromEntries(SUBJECT_GRADES.map(grade => [grade, fsrsIntervalMs(fsrsReview(null, SUBJECT_GRADE_RATING[grade], atMs))])) as Record<SubjectGrade, number>;
    const starts = members.map(log => log.startPage ?? log.endPage).filter((page): page is number => Number.isFinite(page));
    const ends = members.map(log => log.endPage ?? log.startPage).filter((page): page is number => Number.isFinite(page));
    return {
      speed: speedPerHour(pages, minutes), summary, previous: previousUnitSpeed(logs, subjectId, members),
      recommended: autoReviewGradeOf(logs, members.map(log => ({ ...log, autoReviewChosenGrade: undefined }))),
      current: members.map(log => log.autoReviewChosenGrade).find(Boolean) ?? null,
      intervals, range: starts.length && ends.length ? `${Math.min(...starts)}~${Math.max(...ends)}` : '', count: members.length
    };
  }, [logs, members, groupAt]);
  return (
    <div role="dialog" aria-modal="true" aria-label="자동 복습 난도 피드백" data-testid="auto-review-feedback"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-xl rounded-3xl border border-indigo-100 bg-white p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-lg font-black text-indigo-800">난도 피드백</h4>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-600">✕</button>
        </div>
        <p className="mt-1 text-[13px] font-bold text-slate-600">
          자동으로 복습에 넣었어요 · {pageLabel}.{info.range}{info.count > 1 ? ` · 3시간 안에 넣은 공부 ${info.count}개가 한 묶음` : ''} · 고른 난도가 이 묶음의 난도예요
        </p>
        <p className="mt-2 text-sm font-black text-slate-700">이번 속도 <span className="text-2xl text-indigo-700">{formatSpeed(info.speed, pageLabel)}</span></p>
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-[13px] font-bold text-slate-700">
          {info.previous !== null && <li className="text-indigo-800">바로 앞 단위 속도 {formatSpeed(info.previous, pageLabel)} · 추천은 이 단위와 견줘요</li>}
          <li>평균 속도 {formatSpeed(info.summary.averageSpeed, pageLabel)}{info.summary.averageSpeed === null ? ' · 지난 기록이 없어요' : ''}</li>
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SUBJECT_GRADES.map(grade => (
            <button key={grade} type="button" data-feedback-grade={grade} data-recommended={info.recommended === grade ? 'true' : undefined}
              aria-pressed={info.current === grade} onClick={() => onChoose(grade)}
              className={`relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left active:scale-[0.98] ${info.current === grade ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
              {info.recommended === grade && <span className="absolute -top-2.5 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">추천</span>}
              <span className="text-base font-black text-slate-900">{SUBJECT_GRADE_LABELS[grade]}</span>
              <span className="text-xs font-bold text-slate-600">다음 복습 {formatReviewInterval(info.intervals[grade])} 뒤</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] font-bold text-slate-500">닫으면 {info.current ? `지금 고른 ${SUBJECT_GRADE_LABELS[info.current]}` : `추천 ${SUBJECT_GRADE_LABELS[info.recommended]}`}으로 둬요.</p>
      </section>
    </div>
  );
};
