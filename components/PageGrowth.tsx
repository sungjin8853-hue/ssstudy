import React, { useState } from 'react';
import { calculatePageUnitGrowth, getGrowthComparison, GrowthComparison, nextGrowthComparison } from '../utils/pageGrowth';

const growthCellClass = 'min-w-0 w-full rounded-lg border-t border-slate-200 pt-3 text-left lg:min-w-[20rem] lg:w-auto lg:flex-1 lg:rounded-none lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0';

export const ReviewGrowthSettings: React.FC<{ value: 'review' | 'unit'; onChange: (value: 'review' | 'unit') => void }> = ({ value, onChange }) => (
  <div className="mt-3 border-t border-rose-200 pt-3">
    <p className="mb-2 text-xs font-bold text-slate-500">성장 표시</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="복습과목 성장 표시">
      {([{ value: 'review', label: '복습 증가율' }, { value: 'unit', label: '페이지 단위 성장' }] as const).map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={event => { event.stopPropagation(); onChange(option.value); }}
          className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${value === option.value
            ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300'}`}>
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

export const ReviewSpeedGrowthCell: React.FC<{ changes: { average: number | null; latest: number | null }; measuredToday: boolean }> = ({ changes, measuredToday }) => (
  <div data-testid="review-speed-growth" className={growthCellClass}>
    <div className="grid grid-cols-2 gap-x-4 lg:grid-cols-[auto_auto] lg:justify-start lg:gap-x-6">
      {[{ label: '평균 속도 증가율', percent: changes.average }, { label: '이번 복습 증가율', percent: changes.latest }].map(item => (
        <div key={item.label}>
          <p className="text-xs font-bold text-slate-500">{item.label}</p>
          <p className={`mt-1 font-black leading-9 tabular-nums ${measuredToday && item.percent !== null ? 'text-2xl lg:text-3xl' : 'text-base'} ${item.percent !== null && item.percent < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>
            {!measuredToday || item.percent === null ? '측정 필요' : `${item.percent >= 0 ? '+' : ''}${item.percent.toFixed(1)}%`}
          </p>
        </div>
      ))}
    </div>
    <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">이전 복습·상위과목 대비</p>
  </div>
);

export const EfficiencyGrowthCell: React.FC<{ growth: ReturnType<typeof calculatePageUnitGrowth>; measuredToday: boolean }> = ({ growth, measuredToday }) => {
  const [comparison, setComparison] = useState<GrowthComparison>(1);
  const result = getGrowthComparison(growth.units, comparison);
  const label = result.comparison === 'older' ? '4단위 전부터 평균 대비' : result.comparison === 1 ? '이전 단위 대비' : `${result.comparison}단위 전 대비`;
  const remaining = !growth.current || growth.current.complete ? growth.unitSize : Math.max(0, growth.unitSize - growth.current.pages);
  return <button type="button" aria-label="효율 성장 비교" onClick={() => setComparison(nextGrowthComparison(growth.units, result.comparison))}
    className={`${growthCellClass} group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}>
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-[auto_auto_minmax(0,1fr)]">
      {[
        { label: '전체 효율', percent: result.overallGrowth },
        { label: '타임어택 효율', percent: result.attackGrowth }
      ].map(item => <div key={item.label}>
        <p className="text-xs font-bold text-slate-500">{item.label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className={`font-black leading-9 tabular-nums ${measuredToday && item.percent !== null ? 'text-2xl lg:text-3xl' : 'text-base'} ${item.percent !== null && item.percent < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>
            {!measuredToday || item.percent === null ? '측정 필요' : `${item.percent >= 0 ? '+' : ''}${item.percent.toFixed(1)}%`}
          </span>
        </div>
      </div>)}
      <div data-testid="unit-pages-remaining" className="col-span-2 flex items-baseline gap-2 lg:col-span-1 lg:block lg:justify-self-end">
        <p className="text-xs font-bold text-slate-500">다음 단위까지</p>
        <p className="mt-1 text-3xl font-black leading-9 tabular-nums text-amber-700">{Number(remaining.toFixed(2))}P</p>
      </div>
    </div>
    <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] font-medium leading-4 text-slate-500">
      <span className="transition-colors group-hover:text-indigo-600">{growth.unitSize}P 단위 · {label}</span>
    </div>
  </button>;
};
