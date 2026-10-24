import React from 'react';
import { HelpPopover, TINTED_HELP_BUTTON } from './TodayTasks';
import { describeSpeed, describeStudyAmount, GrowthChange, SPEED_REFERENCE_LABEL } from '../utils/pageGrowth';
import { DEFAULT_PAGE_LABEL, pageWord } from '../utils/pageLabel';

const Arrow: React.FC<{ direction: 'up' | 'down' }> = ({ direction }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={direction === 'up' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} />
  </svg>
);

/**
 * 이전과 견준 변화를 알약으로 보여준다. 속도와 공부량을 늘 함께 보여주고(기본 복습은 속도만), 퍼센트는 쓰지 않는다.
 *  - 속도 = 1시간 동안 푸는 장수의 차이 (예: 속도 +2.0P/h = 같은 시간에 2장 더)
 *  - 공부량 = 한 페이지에 쓴 시간(분)의 차이 (예: 공부량 +1.0분/P = 한 장에 1분 더 오래)
 * 둘 다 소수 첫째 자리까지다. 빨간색은 쓰지 않는다 — 느려진 것도 "더 오래 공부했다"는 뜻이라 나쁜 소식이 아니다.
 * 변화가 없으면(견줄 기준이 없을 때) 아무것도 그리지 않는다.
 */
export const GrowthChips: React.FC<{ change: GrowthChange | null | undefined; speedOnly?: boolean; label?: string }> = ({ change, speedOnly = false, label = DEFAULT_PAGE_LABEL }) => {
  if (!change) return null;
  const chip = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-[15px] font-black tabular-nums';
  const direction = (value: number) => (value > 0 ? 'up' as const : value < 0 ? 'down' as const : null);
  const speedDirection = direction(change.speedPages);
  const amountDirection = direction(change.studyMinutes);
  return (
    <div data-testid="growth-chips" className="flex flex-col items-end gap-1">
      <span data-growth-kind="speed" title={`${SPEED_REFERENCE_LABEL} 동안 푸는 ${pageWord(label)} 수의 차이`}
        className={`${chip} ${change.speedPages > 0 ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-800'}`}>
        {speedDirection && <Arrow direction={speedDirection} />}
        {describeSpeed(change, label)}
      </span>
      {!speedOnly && (
        <span data-growth-kind="amount" title={`${pageWord(label)} 하나에 쓴 시간(분)의 차이`}
          className={`${chip} bg-indigo-100 text-indigo-900`}>
          {amountDirection && <Arrow direction={amountDirection} />}
          {describeStudyAmount(change, label)}
        </span>
      )}
    </div>
  );
};

/**
 * "효율" 셀: 전체 효율(성장 척도, 크게) + 타임어택 효율(작게)과 각각의 속도·공부량 변화.
 * 제목 옆에 비교 기준(뽀모도로 N회 전)을 바꾸는 버튼(headerAction)이 들어간다. 값은 가장 최근 25분의 평균이다.
 */
export const EfficiencyBoxes: React.FC<{
  efficiency?: number;
  attackEfficiency?: number;
  overall?: GrowthChange | null;
  attack?: GrowthChange | null;
  headerAction?: React.ReactNode;
  /** 과목이 "페이지"를 부르는 글자(기본 P) */
  label?: string;
  /** 오늘 할 양을 끝낸 과목: 셀 전체가 초록 톤이라 이 칸도 같은 톤으로 맞춘다 */
  done?: boolean;
}> = ({ efficiency, attackEfficiency, overall, attack, headerAction, label = DEFAULT_PAGE_LABEL, done = false }) => {
  const has = (value?: number) => Boolean(value && value > 0);
  return (
    <section aria-label="효율" data-testid="efficiency-cell"
      className={`flex min-w-0 flex-col gap-2.5 rounded-xl border-2 px-4 pb-3 pt-2 ${done ? 'border-green-600 bg-[#d0f9de]' : 'border-slate-400 bg-slate-100'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h4 className="text-lg font-black text-slate-900">효율</h4>
          {headerAction}
        </div>
        <HelpPopover label="효율 설명" triggerClassName={TINTED_HELP_BUTTON}>
          <span><b>효율</b>은 가장 최근 공부 25분(뽀모도로)의 평균이에요. 짧은 시간의 값은 믿기 어려워서 25분을 한 덩어리로 봐요.</span>
          <span><b>전체 효율</b>은 풀이와 정리 시간을 모두 합해서 푼 장수로 나눠요. 막힌 문제를 넘긴 만큼 정리에서 드러나서 성장을 재는 기준이 돼요.</span>
          <span><b>타임어택 효율</b>은 타임어택에서 한 장당 걸린 시간이에요. 막힌 문제는 바로 넘기니까 성장은 전체 효율로 봐요.</span>
          <span><b>속도</b>는 1시간 동안 푸는 장수가 얼마나 늘었는지, <b>공부량</b>은 한 페이지에 쓴 시간이 몇 분 늘었는지예요. 제목 옆 버튼을 누르면 뽀모도로 1회 전, 2회 전 … 5회 전, 이전 단위, 이이전 단위, 평균과 차례로 견줘요.</span>
          <span><b>페이지 단위</b>는 푼 장수로 세요. 단위 크기만큼 풀 때마다 한 단위가 차고, 마친 단위의 평균과 견줄 수 있어요. 효율은 단위를 넘어도 새로 시작하지 않고 계속 이어져요. 평균은 이 과목 전체의 장당 시간이에요.</span>
        </HelpPopover>
      </div>
      <div data-testid="current-overall-efficiency" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="text-base font-black text-slate-800">전체 효율</span>
            <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-black text-white">성장 척도</span>
          </span>
          <p className="whitespace-nowrap font-black leading-tight tabular-nums text-indigo-900">
            {has(efficiency) ? <><span className="font-mono text-[44px] md:text-[48px]">{efficiency!.toFixed(1)}</span><span className="ml-1 text-lg text-slate-500">분/{label}</span></> : <span className="text-xl text-slate-600">측정 필요</span>}
          </p>
        </div>
        <GrowthChips change={overall} label={label} />
      </div>
      <div data-testid="current-attack-efficiency" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-300 pt-2.5">
        <div className="flex items-baseline gap-3 whitespace-nowrap">
          <span className="text-base font-black text-slate-800">타임어택 효율</span>
          <span className="font-black leading-tight tabular-nums text-slate-900">
            {has(attackEfficiency) ? <><span className="font-mono text-[30px]">{attackEfficiency!.toFixed(1)}</span><span className="ml-1 text-base text-slate-500">분/{label}</span></> : <span className="text-base text-slate-600">측정 필요</span>}
          </span>
        </div>
        <GrowthChips change={attack} label={label} />
      </div>
    </section>
  );
};
