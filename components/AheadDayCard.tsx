import React from 'react';
import type { AheadDay, AheadFinishPlan } from '../utils/aheadDay';
import { formatDurationShort } from '../utils/weekPlan';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const formatPages = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ''));
export const formatAheadDate = (dateKey: string | null) => {
  if (!dateKey) return '알 수 없어요';
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}(${WEEKDAY_NAMES[new Date(year, month - 1, day).getDay()]})`;
};

/**
 * 9일: 오늘 몫을 미리 끝낸 과목(빨간 할 일)을 누르면 초록 완료 카드 자리에 뜨는 빨간 카드.
 * 완료 카드의 "추가 학습하기" 대신 "오늘 학습"이 있고, 누르면 오늘 학습할 때의 계산(AheadFinishPanel)과 학습 시작이 나온다.
 */
export const AheadSummary: React.FC<{ ahead: AheadDay; label: string; onStudyToday: () => void }> = ({ ahead, label, onStudyToday }) => (
  <div data-testid="ahead-summary" className="flex h-full flex-col divide-y divide-rose-200 [&>*]:py-3 [&>*:first-child]:pt-1">
    <div className="flex flex-col gap-1">
      <span className="text-base font-black text-rose-800">오늘 몫을 미리 끝냈어요</span>
      <span className="text-sm font-bold text-rose-700">지난 학습에서 더 한 양이 오늘 몫을 모두 채웠어요.</span>
    </div>
    <div className="flex">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-bold text-slate-600">오늘 몫</span>
        <span className="font-mono text-[34px] font-black leading-tight tabular-nums text-slate-900">{formatPages(ahead.dayTarget)}<span className="ml-1 text-lg font-semibold text-slate-500">{label}</span></span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col border-l border-rose-200 pl-3">
        <span className="text-sm font-bold text-slate-600">미리 한 양</span>
        <span className="font-mono text-[34px] font-black leading-tight tabular-nums text-slate-900">{formatPages(ahead.aheadPages)}<span className="ml-1 text-lg font-semibold text-slate-500">{label}</span></span>
      </div>
    </div>
    <div className="mt-auto !border-t-0 !pt-4">
      <button type="button" onClick={onStudyToday} data-testid="ahead-study-today"
        className="flex h-[68px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-rose-700 bg-rose-600 text-xl font-black text-white shadow-sm transition-colors hover:bg-rose-700">
        <span aria-hidden="true">▶</span>오늘 학습
      </button>
    </div>
  </div>
);

/** "오늘 학습"을 누른 뒤: 끝내는 데 걸리는 총 시간 · 지금 요일별 할당량으로 필요한 학습일 · 미리 끝낸 날을 쉬면 끝나는 날 */
export const AheadFinishPanel: React.FC<{ plan: AheadFinishPlan; label: string }> = ({ plan, label }) => (
  <section data-testid="ahead-finish-plan" aria-label="오늘 학습 계산" className="grid gap-2 rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 sm:grid-cols-3">
    <div className="flex flex-col">
      <span className="text-[13px] font-bold text-rose-800">끝내는 데 걸리는 총 시간</span>
      <span data-testid="ahead-total" className="font-mono text-2xl font-black tabular-nums text-slate-900">{plan.totalMinutes > 0 ? formatDurationShort(plan.totalMinutes) : '측정 필요'}</span>
      <span className="text-[12px] font-bold text-slate-500">남은 {formatPages(plan.remainingPages)}{label}</span>
    </div>
    <div className="flex flex-col">
      <span className="text-[13px] font-bold text-rose-800">지금 요일별 할당량으로 하면</span>
      <span data-testid="ahead-days" className="font-mono text-2xl font-black tabular-nums text-slate-900">학습일 {plan.studyDaysNeeded}일</span>
      <span className="text-[12px] font-bold text-slate-500">오늘부터 쉬지 않으면 {formatAheadDate(plan.plainFinishDate)}</span>
    </div>
    <div className="flex flex-col">
      <span className="text-[13px] font-bold text-rose-800">미리 끝낸 날은 쉬면 완료</span>
      <span data-testid="ahead-finish" className="font-mono text-2xl font-black tabular-nums text-rose-800">{formatAheadDate(plan.finishDate)}</span>
      <span className="text-[12px] font-bold text-slate-500">
        {plan.skippedDates.length ? `쉬는 날 ${plan.skippedDates.map(formatAheadDate).join(' · ')}` : '오늘 뒤로 미리 끝낸 날은 없어요'}
      </span>
    </div>
  </section>
);
