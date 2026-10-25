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

/** 오르면 초록, 내리면 빨강. 공부량(분/P)은 속도의 반대라서 색은 속도를 따른다 */
const toneOf = (speed: number) => (speed > 0 ? 'text-green-700' : speed < 0 ? 'text-rose-700' : 'text-slate-700');
const pillOf = (speed: number) => (speed > 0 ? 'bg-green-100 ring-green-300' : speed < 0 ? 'bg-rose-100 ring-rose-300' : 'bg-white ring-slate-300');

/**
 * 효율 값 바로 아래 붙는 변화: 제목 옆 버튼으로 고른 기준(이전 단위 등)과 견준 속도 · 공부량 한 줄,
 * 그 아래 작은 줄에 그 성장이 25분 전보다 얼마나 늘었는지(속도). 기준 이름은 버튼에 이미 있어서 다시 적지 않는다.
 */
const ChangeLine: React.FC<{ change: GrowthChange; label: string; recent?: GrowthChange | null }> = ({ change, label, recent }) => {
  const arrow = (value: number) => (value > 0 ? <Arrow direction="up" /> : value < 0 ? <Arrow direction="down" /> : null);
  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5">
      <div data-testid="growth-chips" className={`flex flex-col items-end rounded-lg px-2.5 py-1 ring-1 ${pillOf(change.speedPages)} ${toneOf(change.speedPages)}`}>
        <span data-growth-kind="speed" title={`${SPEED_REFERENCE_LABEL} 동안 푸는 ${pageWord(label)} 수의 차이`}
          className="flex items-center gap-0.5 whitespace-nowrap text-[15px] font-black tabular-nums">{arrow(change.speedPages)}{describeSpeed(change, label)}</span>
        <span data-growth-kind="amount" title={`${pageWord(label)} 하나에 쓴 시간(분)의 차이`}
          className="flex items-center gap-0.5 whitespace-nowrap text-[15px] font-black tabular-nums">{arrow(change.studyMinutes)}{describeStudyAmount(change, label)}</span>
      </div>
      {recent && (
        <p data-testid="growth-recent" className="whitespace-nowrap text-xs font-bold text-slate-600">
          25분 전보다 <span className={`font-black tabular-nums ${toneOf(recent.speedPages)}`}>{describeSpeed(recent, label).replace(/^속도 /, '')}</span>
        </p>
      )}
    </div>
  );
};

/** 효율 한 줄: 왼쪽에 이름, 오른쪽에 값과 그 바로 아래 변화 */
const EfficiencyRow: React.FC<{
  testId: string; title: string; badge?: string; value: number | null; compare?: GrowthChange | null;
  recent?: GrowthChange | null; label: string; big?: boolean; emptyNote?: string;
}> = ({ testId, title, badge, value, compare, recent, label, big = false, emptyNote }) => (
  <div data-testid={testId} className={`flex min-w-0 flex-col gap-1 ${big ? '' : 'border-t border-slate-300 pt-2.5'}`}>
    <div className="flex items-start justify-between gap-x-3">
      <span className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1">
        <span className="text-base font-black text-slate-800">{title}</span>
        {badge && <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-black text-white">{badge}</span>}
      </span>
      <div className="flex min-w-0 flex-col items-end gap-1">
        <p className={`whitespace-nowrap font-black leading-none tabular-nums ${big ? 'text-indigo-900' : 'text-slate-900'}`}>
          {value !== null
            ? <><span className={`font-mono ${big ? 'text-[44px] md:text-[48px]' : 'text-[30px]'}`}>{value.toFixed(1)}</span><span className="ml-1 text-base text-slate-500">분/{label}</span></>
            : <span className="text-base text-slate-600">측정 필요</span>}
        </p>
        {compare && <ChangeLine change={compare} label={label} recent={recent} />}
      </div>
    </div>
    {!compare && big && emptyNote && value !== null && <p data-testid="growth-empty" className="text-xs font-bold text-slate-600">{emptyNote}</p>}
  </div>
);

/**
 * "효율" 셀: 전체 효율(성장 척도, 크게) + 타임어택 효율(작게)과 각각의 속도·공부량 변화.
 * 제목 옆에 비교 기준(이전 단위 · 이이전 단위 · 평균)을 바꾸는 버튼(headerAction)이 들어간다. 값은 가장 최근 25분의 평균이다.
 */
export const EfficiencyBoxes: React.FC<{
  efficiency?: number;
  attackEfficiency?: number;
  overall?: GrowthChange | null;
  headerAction?: React.ReactNode;
  /** 과목이 "페이지"를 부르는 글자(기본 P) */
  label?: string;
  /** 오늘 할 양을 끝낸 과목: 셀 전체가 초록 톤이라 이 칸도 같은 톤으로 맞춘다 */
  done?: boolean;
  /** 그 성장이 25분 전보다 얼마나 늘었는지(지금 25분 − 직전 25분). 기준과 견줄 수 있을 때만 */
  recentOverall?: GrowthChange | null;
  /** 견줄 단위가 아직 없을 때 비교 칸 자리에 보이는 말 */
  emptyNote?: string;
  /** 칸 맨 아래 줄(이번 단위). 위 두 줄과 같은 모양으로 들어간다 */
  footer?: React.ReactNode;
}> = ({ efficiency, attackEfficiency, overall, headerAction, label = DEFAULT_PAGE_LABEL, done = false, recentOverall, footer, emptyNote }) => {
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
          <span><b>효율</b>은 가장 최근 공부 25분의 평균이에요. 짧은 시간의 값은 믿기 어려워서 25분을 한 덩어리로 봐요.</span>
          <span><b>전체 효율</b>은 풀이와 정리 시간을 모두 합해서 푼 장수로 나눠요. 막힌 문제를 넘긴 만큼 정리에서 드러나서 성장을 재는 기준이 돼요.</span>
          <span><b>타임어택 효율</b>은 타임어택에서 한 장당 걸린 시간이에요. 막힌 문제는 바로 넘기니까 성장은 전체 효율로 봐요.</span>
          <span>전체 효율 아래에 <b>속도</b>(1시간 동안 푸는 장수가 얼마나 늘었는지)와 <b>공부량</b>(한 페이지에 쓴 시간이 몇 분 늘었는지)이 붙어요. 제목 옆 버튼에 적힌 기준(<b>이전 단위</b>, 이이전 단위, 평균)과 견준 값이고, 오르면 초록, 내리면 빨강이에요. 그 아래 작은 줄은 그 성장이 25분 전보다 얼마나 늘었는지예요. 타임어택 효율은 값만 보여줘요.</span>
          <span><b>단위</b>는 "복습에 넣기"를 누른 때로 나눠요. 이전에 복습에 넣은 때부터 이번에 넣을 때까지가 한 단위이고, 처음 단위는 처음 시작부터 첫 복습에 넣기까지예요. 복습과목은 복습 한 번이 한 단위예요. 효율은 단위를 넘어도 새로 시작하지 않고 계속 이어져요. 평균은 이 과목 전체의 장당 시간이에요.</span>
        </HelpPopover>
      </div>
      <EfficiencyRow testId="current-overall-efficiency" title="전체 효율" badge="성장 척도" value={has(efficiency) ? efficiency! : null}
        compare={overall} recent={recentOverall} label={label} emptyNote={emptyNote} big />
      <EfficiencyRow testId="current-attack-efficiency" title="타임어택 효율" value={has(attackEfficiency) ? attackEfficiency! : null}
        label={label} />
      {footer && <div className="border-t border-slate-300 pt-2.5">{footer}</div>}
    </section>
  );
};
