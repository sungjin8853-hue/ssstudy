import React, { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EfficiencyComparison, EfficiencyScope, formatSignedTenth, getEfficiencyView, GrowthChange, nextEfficiencyComparison, sameComparison, SPEED_REFERENCE_LABEL } from '../utils/pageGrowth';
import { EfficiencyBoxes } from './EfficiencyBoxes';
import { DEFAULT_PAGE_LABEL, pageWord } from '../utils/pageLabel';

export const ReviewGrowthSettings: React.FC<{ value: 'review' | 'unit'; onChange: (value: 'review' | 'unit') => void }> = ({ value, onChange }) => (
  <div className="mt-3 border-t border-amber-200 pt-3">
    <p className="mb-2 text-sm font-black text-slate-700">측정 방식</p>
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="복습과목 측정 방식">
      {([
        { value: 'review', label: '평균 속도 증가율', sub: '평균 · 이번 복습 두 값' },
        { value: 'unit', label: '타임어택 포함', sub: '이전 복습(단위) 대비 · 뽀모도로 성장' }
      ] as const).map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={event => { event.stopPropagation(); onChange(option.value); }}
          className={`flex min-h-[56px] flex-col items-start justify-center rounded-xl border-2 px-4 py-2 text-left transition-colors ${value === option.value
            ? 'border-amber-700 bg-amber-700 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-amber-400'}`}>
          <span className="text-[15px] font-black">{option.label}</span>
          <span className={`text-xs font-semibold ${value === option.value ? 'text-amber-50' : 'text-slate-600'}`}>{option.sub}</span>
        </button>
      ))}
    </div>
  </div>
);

export interface ReviewSpeedPoint { pagesPerReference: number; baselinePagesPerReference?: number | null }

/** 증가율 칸 밑의 속도 그래프에 쓰는 점: 회차 이름과 값(기준 시간에 푸는 장수), 최근 8회까지 */
export const buildSpeedGraphData = (series: ReviewSpeedPoint[], limit = 8) => {
  const offset = Math.max(0, series.length - limit);
  return series.slice(offset).map((point, index) => ({
    label: `${offset + index + 1}회`,
    speed: Number(point.pagesPerReference.toFixed(2))
  }));
};

/**
 * 세로축: 첫 값을 한가운데에 두고 위아래로 같은 폭을 준다. 0장부터 그리면 변화가 바닥에 붙어 작게 보이기 때문이다.
 * 폭은 첫 값에서 가장 멀리 간 값의 1.25배(0.5 단위로 올림, 최소 0.5)이고, 아래쪽은 0 밑으로 내려가지 않는다.
 */
export const getSpeedGraphScale = (values: number[]) => {
  const center = values.length > 0 ? values[0] : 0;
  const farthest = values.reduce((max, value) => Math.max(max, Math.abs(value - center)), 0);
  const half = Math.max(0.5, Math.ceil(farthest * 1.25 * 2) / 2);
  const lower = Math.max(0, Number((center - half).toFixed(2)));
  const upper = Number((center + half).toFixed(2));
  return { center, lower, upper, ticks: [lower, center, upper].map(value => Number(value.toFixed(1))) };
};

/**
 * 같은 시간(1시간)에 풀 수 있는 장수를 회차별로 그린다. 오를수록 빨라진 것이다.
 * 점선은 첫 회차의 속도이고 세로축의 가운데다.
 */
export const SpeedGraph: React.FC<{ series: ReviewSpeedPoint[]; height?: number; plain?: boolean; label?: string }> = ({ series, height = 120, plain = false, label = DEFAULT_PAGE_LABEL }) => {
  const data = buildSpeedGraphData(series);
  const latest = data[data.length - 1];
  const scale = getSpeedGraphScale(data.map(point => point.speed));
  return (
    <div data-testid="speed-graph" className={`flex min-w-0 flex-col gap-1.5 ${plain ? 'rounded-xl bg-white p-3' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-black text-slate-800">{SPEED_REFERENCE_LABEL}에 푸는 {pageWord(label)}</p>
        {latest && <p className="font-mono text-xl font-black tabular-nums text-slate-900">{latest.speed}<span className="ml-0.5 text-sm text-slate-600">{label}</span></p>}
      </div>
      {data.length === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">측정 기록 없음</div>
      ) : (
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#CBD5E1" />
              <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={[scale.lower, scale.upper]} ticks={scale.ticks} fontSize={12} tickLine={false} axisLine={false} tickFormatter={value => `${value}`} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(15,23,42,0.12)' }}
                formatter={(value: number) => [`${value}${label}`, `${SPEED_REFERENCE_LABEL}에 푸는 ${pageWord(label)}`]} />
              <ReferenceLine y={scale.center} stroke="#64748B" strokeDasharray="5 4" />
              <Line type="monotone" dataKey="speed" stroke="#4F46E5" strokeWidth={3}
                dot={{ r: 4, fill: '#4F46E5', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

/**
 * 속도(1시간에 푸는 장수의 차이)와 공부량(한 페이지에 쓴 시간의 차이)을 큰 숫자 두 줄로 보여준다. 둘 다 소수 첫째 자리까지, 퍼센트 없음.
 * 값이 없으면 "-". 속도가 늘었을 때만 초록, 그 밖에는 중립색이다(빨간색은 쓰지 않는다).
 */
const GrowthLines: React.FC<{ change: GrowthChange | null; label?: string }> = ({ change, label = DEFAULT_PAGE_LABEL }) => {
  if (!change) return <p className="mt-1 text-2xl font-black leading-tight text-slate-500">-</p>;
  const lines = [
    { kind: 'speed' as const, label: '속도', value: change.speedPages, unit: `${label}/h`, tone: change.speedPages > 0 ? 'text-green-700' : 'text-slate-800' },
    { kind: 'amount' as const, label: '공부량', value: change.studyMinutes, unit: `분/${label}`, tone: 'text-indigo-800' }
  ];
  return (
    <div className="mt-1 flex flex-col gap-1">
      {lines.map(line => (
        <p key={line.kind} data-growth-kind={line.kind} className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="w-12 shrink-0 text-sm font-black text-slate-600">{line.label}</span>
          <span className={`font-mono text-3xl font-black leading-tight tabular-nums lg:text-4xl ${line.tone}`}>{formatSignedTenth(line.value)}</span>
          <span className="text-sm font-black text-slate-500">{line.unit}</span>
        </p>
      ))}
    </div>
  );
};

/**
 * 복습과목의 "평균·이번 복습 증가율" 칸 + 아래에 속도 그래프. 이전 복습·상위과목과 견준 값이다.
 * 속도(1시간에 푸는 장수의 차이)와 공부량(한 페이지에 쓴 시간의 차이)을 늘 함께 소수 첫째 자리까지 보여준다.
 */
export const ReviewSpeedGrowthCell: React.FC<{
  changes: { average: GrowthChange | null; latest: GrowthChange | null };
  series?: ReviewSpeedPoint[];
  label?: string;
}> = ({ changes, series, label = DEFAULT_PAGE_LABEL }) => (
  <div data-testid="review-speed-growth" className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-col">
      <div className="grid grid-cols-2 gap-x-4">
        {[{ label: '평균 증가율', change: changes.average },
          { label: '이번 복습 증가율', change: changes.latest }].map(item => (
          <div key={item.label} data-testid="review-change">
            <p className="text-base font-black text-slate-700">{item.label}</p>
            <GrowthLines change={item.change} label={label} />
          </div>
        ))}
      </div>
    </div>
    {series && <SpeedGraph series={series} label={label} />}
  </div>
);

/**
 * 다음 단위까지 게이지: 이번 단위에서 이미 한 장수를 채운 막대. 단위가 20장 이하이면 한 장마다 눈금을 긋는다.
 * 단위를 막 채웠거나 아직 시작 전이면 비어 있다.
 */
export const UnitGauge: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const ticks = total > 1 && total <= 20 ? total : 0;
  return (
    <div data-testid="unit-gauge" role="progressbar" aria-label="다음 단위까지" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Number(done.toFixed(2))}
      className="relative h-4 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-indigo-600 transition-[width]" style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
      {ticks > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${ticks} - 2px), rgba(255,255,255,0.9) calc(100% / ${ticks} - 2px), rgba(255,255,255,0.9) calc(100% / ${ticks}))` }} />
      )}
    </div>
  );
};

/** 비교 버튼의 글자: "뽀모도로 1회 전 ›" · "이전 단위 ›" · "이이전 단위 ›" · "평균 ›". 견줄 수 없는 때는 이유를 적는다. */
const compareLabel = (view: ReturnType<typeof getEfficiencyView>) => {
  const { choice } = view;
  if (choice.kind === 'average') return view.average ? '평균' : '평균 없음';
  if (choice.kind === 'unit') return choice.n === 0 ? '비교할 단위 없음' : choice.n === 1 ? '이전 단위' : '이이전 단위';
  return choice.n === 0 ? '비교할 뽀모도로 없음' : `뽀모도로 ${choice.n}회 전`;
};

/**
 * "효율" 셀(전체·타임어택 효율 + 속도·공부량 변화)과 그 아래 "다음 단위까지" 게이지.
 *  - 효율 값은 과목의 가장 최근 25분(뽀모도로) 평균이다. 페이지 단위를 넘어도 새로 시작하지 않는다.
 *    새 단위가 막 시작돼 그 단위에 푼 기록이 아직 없으면 이전 단위의 평균을 가져와 보인다.
 *  - 제목 옆 버튼을 누르면 비교 기준이 뽀모도로 1회 전 → … → 5회 전 → 이전 단위 → 이이전 단위 → 평균으로 넘어가고, 한 번 더 누르면 1회 전으로 돌아간다.
 *  - 페이지 단위는 푼 장수로 센다. 단위가 없는 과목에는 "다음 단위까지" 줄과 단위 비교가 없다(평균과는 견줄 수 있다).
 */
export const UnitGrowthEfficiency: React.FC<{
  scope: EfficiencyScope; efficiency?: number; attackEfficiency?: number; label?: string;
  /** 오늘 할 양을 끝낸 과목(초록 톤) */
  done?: boolean;
  /** 단위가 끝나는 때: 학습과목은 "복습에 넣기", 복습과목은 복습을 마칠 때 */
  unitEnd?: 'register' | 'review';
}> = ({ scope, efficiency, attackEfficiency, label = DEFAULT_PAGE_LABEL, done = false, unitEnd = 'register' }) => {
  // 기본은 이전 단위와 견준다(이전 단위가 없으면 버튼이 "비교할 단위 없음"). 효율 숫자 옆에는 늘 뽀모도로 1회 전 대비가 따로 붙는다.
  // 고르기 전(null)에는 이전 단위, 마친 단위가 아직 없으면 뽀모도로 1회 전과 견준다
  const [picked, setComparison] = useState<EfficiencyComparison | null>(null);
  const unitView = getEfficiencyView(scope, { kind: 'unit', n: 1 });
  const comparison: EfficiencyComparison = picked ?? (unitView.maxUnits > 0 || unitView.inherited ? { kind: 'unit', n: 1 } : { kind: 'pomodoro', n: 1 });
  const view = picked ? getEfficiencyView(scope, comparison) : comparison.kind === 'unit' ? unitView : getEfficiencyView(scope, comparison);
  const pomodoro = getEfficiencyView(scope, { kind: 'pomodoro', n: 1 });
  const showPomodoro = !(view.choice.kind === 'pomodoro' && view.choice.n === 1) && pomodoro.choice.kind === 'pomodoro' && pomodoro.choice.n === 1;
  const progress = scope.progress;
  const canCompare = view.options.length > 1 || (view.options.length === 1 && !sameComparison(view.options[0], view.choice));
  const compare = (
    <button type="button" data-testid="unit-compare" aria-label="비교 기준 바꾸기"
      data-comparison={view.comparison} data-comparison-kind={view.choice.kind} disabled={!canCompare}
      onClick={() => setComparison(nextEfficiencyComparison(view))}
      className="flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-indigo-400 bg-indigo-100 px-3.5 text-sm font-black text-indigo-900 transition-colors hover:bg-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default disabled:border-indigo-300 disabled:bg-indigo-50 disabled:text-indigo-800 disabled:hover:bg-indigo-50">
      {compareLabel(view)}
      {canCompare && <span aria-hidden="true">›</span>}
    </button>
  );
  return (
    <div data-testid="unit-growth" className="flex flex-col !border-t-0">
      <EfficiencyBoxes efficiency={view.shown ? view.shown.averageTimePerPage : efficiency}
        attackEfficiency={view.shown ? view.shown.timeAttackAverageTimePerPage : attackEfficiency}
        overall={view.overall} attack={view.attack} headerAction={compare} label={label} done={done}
        pomodoroOverall={showPomodoro ? pomodoro.overall : null} pomodoroAttack={showPomodoro ? pomodoro.attack : null}
        compareTitle={`${compareLabel(view)} 대비`}
        footer={progress ? (
          <div className="flex flex-col gap-1">
            <div data-testid="unit-pages-done" className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="text-base font-black text-slate-800">이번 단위</span>
                <span className="rounded-md bg-slate-700 px-2 py-0.5 text-xs font-black text-white">{progress.index}번째</span>
              </span>
              <p className="whitespace-nowrap font-black leading-none tabular-nums text-slate-900"><span className="font-mono text-[30px]">{Number(progress.done.toFixed(2))}</span><span className="ml-1 text-base text-slate-500">{label}</span></p>
            </div>
            <p className="text-xs font-bold text-slate-600">{progress.index}번째 단위 · {unitEnd === 'review' ? '복습을 마치면 단위가 끝나요' : '복습에 넣으면 단위가 끝나요'}</p>
          </div>
        ) : undefined} />
    </div>
  );
};
