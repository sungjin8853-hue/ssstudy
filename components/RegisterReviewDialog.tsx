import React, { useEffect } from 'react';
import { formatSpeed, SUBJECT_GRADE_LABELS, SUBJECT_GRADES } from '../utils/subjectFeedback';
import type { PendingFeedback, SubjectGrade } from '../utils/subjectFeedback';
import { formatReviewInterval } from './ReviewPracticeScreen';

/**
 * "복습에 넣기"를 누르면 뜨는 난도 선택. 공부를 저장할 때는 난도를 묻지 않고, 복습에 넣을 때 한 번 고른다.
 * 난도(다시 · 어려움 · 보통 · 쉬움)를 누르면 바로 그 과목의 복습 대기 기록 모두가 그 난도로 복습에 들어가고 창이 닫힌다(학습 실행 화면으로 돌아간다).
 * 이번 속도는 대기 기록들이 푼 장수 ÷ 걸린 시간, 평균 속도와 등급별 기록은 같은 과목의 지난 공부 기록이다.
 */
export const RegisterReviewDialog: React.FC<{
  info: PendingFeedback;
  pageLabel: string;
  onChoose: (grade: SubjectGrade) => void;
  onClose: () => void;
}> = ({ info, pageLabel, onChoose, onClose }) => {
  const { speed, summary, recommended, intervals } = info;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div data-testid="register-review-dialog" role="dialog" aria-modal="true" aria-label="복습에 넣기 난도 선택"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="난도 피드백" data-difficulty-feedback="true" className="w-full max-w-xl rounded-3xl border border-indigo-100 bg-white p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-lg font-black text-indigo-800">난도 피드백</h4>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-600">✕</button>
        </div>
        <p data-feedback-current="true" className="mt-1 text-sm font-black text-slate-700">이번 속도 <span className="text-2xl text-indigo-700">{formatSpeed(speed, pageLabel)}</span></p>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px] font-bold text-slate-700">
          <li data-feedback-average="true">평균 속도 {formatSpeed(summary.averageSpeed, pageLabel)}{summary.averageSpeed === null ? ' · 지난 기록이 없어요' : ''}</li>
          {summary.byGrade.map(item => <li key={item.grade} data-feedback-history={item.grade} className="text-slate-600">
            {SUBJECT_GRADE_LABELS[item.grade]} · 평균 속도 {formatSpeed(item.averageSpeed, pageLabel)} · {item.count}회
          </li>)}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SUBJECT_GRADES.map(grade => (
            <button key={grade} type="button" data-feedback-grade={grade} data-recommended={recommended === grade ? 'true' : undefined}
              onClick={() => onChoose(grade)}
              className="relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-left active:scale-[0.98]">
              {recommended === grade && <span className="absolute -top-2.5 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">추천</span>}
              <span className="flex flex-wrap items-baseline gap-x-1 text-base font-black text-slate-900">
                {SUBJECT_GRADE_LABELS[grade]}
                {grade === 'easy' && <span data-feedback-target="true" className="whitespace-nowrap text-[13px] font-bold text-slate-600">(목표하는 속도 {formatSpeed(summary.targetSpeed, pageLabel)})</span>}
              </span>
              <span className="text-xs font-bold text-slate-600">다음 복습 {formatReviewInterval(intervals[grade])} 뒤</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
