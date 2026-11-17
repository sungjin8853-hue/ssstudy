import React from 'react';
import { formatSpeed, SUBJECT_GRADE_LABELS, SUBJECT_GRADES } from '../utils/subjectFeedback';
import type { SubjectGrade } from '../utils/subjectFeedback';
import type { ReviewIntakeFeedback, ReviewIntakeInfo } from '../utils/reviewIntake';
import { formatReviewInterval } from './ReviewPracticeScreen';

/**
 * 17일: 학습량 입력에서 고르는 "복습에 넣기"와 난도 피드백(전에는 오늘 할 일의 "복습에 넣기" 창).
 *  - 자동 복습을 끈 과목: 켜면 기다리는 기록(이번 공부 포함)이 고른 난도로 복습에 들어간다. 이번 공부로 단원을 끝냈으면 처음부터 켜 둔다.
 *  - 자동 복습을 켠 과목: 이번 저장으로 모은 시간이 차면 그 묶음의 난도를 고른다. 아직이면 모은 시간만 보인다.
 */
export const ReviewIntakeSection: React.FC<{
  info: ReviewIntakeInfo;
  pageLabel: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  grade: SubjectGrade | null;
  onGrade: (grade: SubjectGrade) => void;
}> = ({ info, pageLabel, on, onToggle, grade, onGrade }) => {
  const grades = (feedback: ReviewIntakeFeedback) => {
    const selected = grade ?? feedback.recommended;
    return (
      <>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px] font-bold text-slate-700">
          <li data-intake-speed="true">이번 속도 {formatSpeed(feedback.speed, pageLabel)} · 기록 {feedback.count}개 · {Math.round(feedback.minutes)}분</li>
          {feedback.previousSpeed !== null && <li className="text-indigo-800">바로 앞 단위 속도 {formatSpeed(feedback.previousSpeed, pageLabel)} · 추천은 이 단위와 견줘요</li>}
          <li>평균 속도 {formatSpeed(feedback.summary.averageSpeed, pageLabel)}{feedback.summary.averageSpeed === null ? ' · 지난 기록이 없어요' : ''}</li>
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SUBJECT_GRADES.map(item => (
            <button key={item} type="button" data-intake-grade={item} aria-pressed={selected === item} data-recommended={feedback.recommended === item ? 'true' : undefined}
              onClick={() => onGrade(item)}
              className={`relative flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left ${selected === item ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500' : 'border-slate-200 bg-slate-50'}`}>
              {feedback.recommended === item && <span className="absolute -top-2.5 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">추천</span>}
              <span className="text-base font-black text-slate-900">{SUBJECT_GRADE_LABELS[item]}</span>
              <span className="text-xs font-bold text-slate-600">{feedback.intervals[item] <= 0 ? '바로 복습' : `다음 복습 ${formatReviewInterval(feedback.intervals[item])} 뒤`}</span>
            </button>
          ))}
        </div>
      </>
    );
  };
  if (info.kind === 'auto') {
    return (
      <section aria-label="자동 복습" data-testid="review-intake" data-intake-kind="auto" className="mb-4 w-full rounded-2xl border border-indigo-100 bg-white p-4">
        <h4 className="text-base font-black text-indigo-800">자동 복습{info.willRegister ? ' · 난도 피드백' : ''}</h4>
        <p data-testid="review-intake-note" className="mt-1 text-[13px] font-bold text-slate-600">
          {info.willRegister
            ? `이번 저장으로 모은 공부 ${Math.round(info.minutes)}분이 한 묶음으로 복습에 들어가요. 난도를 골라 주세요.`
            : `모은 공부 ${Math.round(info.minutes)}분(이번 포함) · ${info.hours <= 0 ? '저장할 때마다' : `${info.hours}시간이 차면`} 복습에 들어가요.`}
        </p>
        {info.willRegister && info.feedback && grades(info.feedback)}
      </section>
    );
  }
  return (
    <section aria-label="복습에 넣기" data-testid="review-intake" data-intake-kind="manual" className="mb-4 w-full rounded-2xl border border-indigo-100 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" role="switch" aria-checked={on} checked={on} onChange={event => onToggle(event.target.checked)} data-testid="review-intake-switch"
          className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-black text-indigo-800">복습에 넣기</span>
          <span className="text-[12px] font-bold leading-relaxed text-slate-500">
            {on ? `기다리는 기록 ${info.feedback.count}개(이번 포함)를 고른 난도로 지금 복습에 넣어요. 여기서 단위가 끝나요.`
              : '켜면 이번 공부까지 지금 복습에 넣어요. 끄면 복습을 기다리는 기록으로 남아요.'}
          </span>
          {info.finishedChapters.length > 0 && <span data-testid="review-intake-chapter" className="text-[12px] font-black text-indigo-700">{info.finishedChapters.join(', ')}을(를) 끝냈어요. 복습에 넣는 걸 추천해요.</span>}
        </span>
      </label>
      {on && grades(info.feedback)}
    </section>
  );
};
