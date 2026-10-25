import React, { useState } from 'react';
import { ForecastItem, GroupSpeed, PlanUnit, UnitGrowthSummary, describeSpeedGrowth, describeStudyAmountGrowth, formatSignedHundredth, latestAmountGrowthOf, SpeedSeries } from '../utils/speedGrowth';
import { pagePositionLabel, pageWord } from '../utils/pageLabel';
import { formatSignedTenth } from '../utils/pageGrowth';
import { formatDuration } from '../utils/weekPlan';

/** 학습 설정(과목·폴더 관리)에 들어가는 속도 증가 · 시간 비율 · 완료 예측 부품. 계산은 하지 않고 받은 값만 그린다. */

/** 범주 색: 같은 순서로만 쓰고(항목이 바뀌어도 색이 바뀌지 않는다) 8개를 넘기지 않는다. 어두운 바탕(펼친 폴더 카드)에는 dark 값. */
export const SERIES_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};
export const seriesColor = (index: number, dark = false) => SERIES_COLORS[dark ? 'dark' : 'light'][index % SERIES_COLORS.light.length];

const niceStep = (range: number, count: number) => {
  const raw = range / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
};

/** min~max를 덮는 깨끗한 눈금 */
export const niceTicks = (min: number, max: number, count = 3) => {
  const span = max - min > 1e-9 ? max - min : 1;
  const step = niceStep(span, count);
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value < max + step - 1e-9; value += step) ticks.push(Math.round(value / step) * step);
  return ticks;
};

const tick = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export const formatGainTick = (value: number) => (value > 0 ? `+${tick(value)}` : value < 0 ? `−${tick(Math.abs(value))}` : '0');

/* ───────────────────────── 공통: 퍼센트 · 막대 글자색 · 진척도 막대 ───────────────────────── */

/** 값들의 비율을 정수 %로. 합이 100이 되도록 나머지가 큰 쪽부터 1씩 더하고, 0보다 큰 값은 작아도 1%로 보인다. 합이 0이면 모두 0. */
export const sharePercents = (values: number[]) => {
  const positive = values.map(value => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return positive.map(() => 0);
  const raw = positive.map(value => (value / total) * 100);
  const result = raw.map(value => Math.floor(value));
  let rest = 100 - result.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, fraction: value - result[index] })).sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => { if (rest > 0) { result[index] += 1; rest -= 1; } });
  positive.forEach((value, index) => {
    if (value > 0 && result[index] === 0) {
      result[index] = 1;
      result[result.indexOf(Math.max(...result))] -= 1;
    }
  });
  return result;
};

const channel = (value: number) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => {
  const raw = hex.replace('#', '');
  return 0.2126 * channel(parseInt(raw.slice(0, 2), 16)) + 0.7152 * channel(parseInt(raw.slice(2, 4), 16)) + 0.0722 * channel(parseInt(raw.slice(4, 6), 16));
};
/** 이 색 칸 위에 올릴 글자색: 흰색과 짙은 남색 중 대비가 더 큰 쪽 */
export const readableOn = (hex: string) => {
  const light = luminance(hex);
  return 1.05 / (light + 0.05) >= (light + 0.05) / (luminance('#0f172a') + 0.05) ? '#ffffff' : '#0f172a';
};

/** 진척도 막대: 막대 안에 %가 들어간다. 채워진 부분이 넉넉하면 그 끝 안쪽에 흰 글자, 좁으면 채움 바로 옆(트랙 안)에 짙은 글자. */
export const ProgressBar: React.FC<{ percent: number; dark?: boolean; label?: string }> = ({ percent, dark = false, label = '진척도' }) => {
  const value = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  const inside = value >= 14;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} data-testid="progress-bar"
      className={`relative h-6 w-full overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
      <div className="h-full rounded-full bg-indigo-600 transition-all duration-1000" style={{ width: `${value}%` }} />
      <span data-testid="progress-percent" className={`absolute top-0 flex h-full items-center text-[13px] font-black tabular-nums ${inside ? 'text-white' : dark ? 'text-indigo-100' : 'text-slate-700'}`}
        style={inside ? { right: `calc(${100 - value}% + 0.5rem)` } : { left: `calc(${value}% + 0.5rem)` }}>
        {value}%
      </span>
    </div>
  );
};

/* ───────────────────────── 요일별 필요 시간 비율 막대 ───────────────────────── */

export interface WeekdayNeed { weekday: number; label: string; minutes: number; pages?: number; isToday?: boolean }

/** "1h 19m" 꼴. 하루 평균 시간 칸(StatBox)과 같은 모양으로 맞춘다. */
export const formatHoursMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${hours}h ${total % 60}m` : `${total % 60}m`;
};

/**
 * 막대 위에 한 주 필요 시간 합계, 막대는 요일별 필요 시간의 비율(월~일 순서, 칸 너비가 비율이고 칸 안에는 요일과 그날 풀이 시간; %는 칸에 올리면 나온다). 쉬는 요일은 칸이 없고 막대 밑에 적는다.
 * 하루 평균 시간·페이지는 이 부품 밑에 따로 둔다.
 */
/** scheduledDays: 과목이 공부하기로 한 요일 수. 요일은 있는데 시간이 0이면 속도를 아직 재지 않은 것이라 "측정 필요"라고 적는다. */
export const WeekdayNeedBar: React.FC<{ days: WeekdayNeed[]; scheduledDays?: number }> = ({ days, scheduledDays }) => {
  const total = days.reduce((sum, day) => sum + Math.max(0, day.minutes), 0);
  const emptyLabel = scheduledDays && scheduledDays > 0 ? '측정 필요' : '학습 요일 없음';
  const percents = sharePercents(days.map(day => day.minutes));
  const active = days.map((day, index) => ({ day, percent: percents[index] })).filter(item => item.day.minutes > 0);
  const resting = days.filter(day => !(day.minutes > 0));
  return (
    <div data-testid="weekday-need" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="text-[13px] font-bold text-slate-500">한 주 필요 시간</p>
        <p data-testid="week-total" className={`font-black tabular-nums ${total > 0 ? 'text-2xl text-slate-900 xl:text-3xl' : 'text-base text-slate-400'}`}>
          {total > 0 ? formatHoursMinutes(total) : emptyLabel}
        </p>
      </div>
      {total > 0 ? (
        <div role="img" aria-label={`요일별 필요 시간 ${active.map(item => `${item.day.label} ${formatHoursMinutes(item.day.minutes)}(${item.percent}%)`).join(', ')}`}
          className="flex min-h-8 w-full gap-0.5 overflow-hidden rounded-lg">
          {active.map(({ day, percent }, index) => (
            <div key={day.weekday} data-testid="weekday-segment" data-weekday={day.weekday} title={`${day.label}요일 ${formatHoursMinutes(day.minutes)} · ${percent}%`}
              style={{ flexGrow: day.minutes, flexBasis: 0 }}
              className={`flex min-w-[3.5rem] flex-wrap content-center items-center justify-center gap-x-2 whitespace-nowrap px-1 py-0.5 leading-tight sm:min-w-[4.25rem] ${index % 2 === 0 ? 'bg-indigo-700 text-white' : 'bg-indigo-300 text-indigo-950'} ${day.isToday ? 'ring-2 ring-inset ring-amber-300' : ''}`}>
              {/* 요일이 시간보다 크고 굵다(굵기: 요일 bold > 시간 semibold). 칸이 넓으면 한 줄로, 좁으면 위아래로 쌓인다. */}
              <span className="text-[15px] font-bold sm:text-[17px]">{day.label}</span>
              <span data-testid="weekday-time" className="text-[14px] font-semibold tabular-nums sm:text-[16px]">{formatHoursMinutes(day.minutes)}</span>
            </div>
          ))}
        </div>
      ) : <div className="h-12 rounded-lg bg-slate-200" />}
      {total > 0 && resting.length > 0 && (
        <p data-testid="weekday-rest" className="px-1 text-[14px] font-semibold text-slate-600">쉬는 요일 {resting.map(day => day.label).join(' · ')}</p>
      )}
    </div>
  );
};

/* ───────────────────────── 학습 요일 · 요일별 페이지(과목의 페이지 단위) ───────────────────────── */

/** 페이지를 단위 덩어리로 말한다: 20 → "2단위", 24 → "2단위+4". 단위가 1 이하면 말하지 않는다. */
export const describePageUnits = (pages: number, step: number) => {
  if (!(step > 1)) return '';
  const whole = Math.floor(pages / step);
  const rest = pages - whole * step;
  return rest > 0 ? (whole > 0 ? `${whole}단위+${rest}` : `${rest}`) : `${whole}단위`;
};

/**
 * 한 주 필요 시간 바로 밑: 학습 요일을 켜고 끄고(요일 버튼), 요일마다 페이지를 + / − 로 고친다.
 * 페이지 값 바로 옆의 작은 위·아래 버튼(onStep)이 1쪽씩 고친다(페이지 단위씩 바꾸는 큰 버튼은 없다). 값 밑에 몇 단위인지 함께 나온다. 쉬는 요일은 "쉼".
 * 과목 카드에서 "수정"을 눌렀을 때만 나온다(평소에는 숨김).
 */
export const WeekdayPagesEditor: React.FC<{
  days: Array<{ id: number; label: string }>;
  selected: number[];
  pages: Record<number, number>;
  pageLabel: string;
  step: number;
  onToggle: (dayId: number) => void;
  onStep: (dayId: number, direction: 1 | -1) => void;
}> = ({ days, selected, pages, pageLabel, step, onToggle, onStep }) => {
  const total = selected.reduce((sum, id) => sum + Math.max(0, Math.round(pages[id] || 0)), 0);
  const stepButton = 'flex h-6 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-100 active:scale-95';
  const arrow = (up: boolean) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
  return (
    <div data-testid="weekday-pages" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="text-[13px] font-bold text-slate-500">{`학습 요일 · 요일별 ${pageLabel}`}</p>
        <p data-testid="weekday-pages-total" className="font-mono text-[13px] font-bold tabular-nums text-slate-500">합계 {total}{pageLabel}</p>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(day => {
          const on = selected.includes(day.id);
          const value = Math.max(0, Math.round(pages[day.id] || 0));
          return (
            <div key={day.id} data-testid="weekday-pages-cell" data-weekday={day.id} className="flex min-w-0 flex-col items-stretch gap-1">
              <button type="button" aria-pressed={on} aria-label={`${day.label}요일 학습 ${on ? '끄기' : '켜기'}`} onClick={() => onToggle(day.id)}
                className={`rounded-xl py-3 text-[15px] font-bold transition-all ${on ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{day.label}</button>
              {on ? (
                <>
                  <div className="flex items-center justify-center gap-1 py-1">
                    <div className="flex min-w-0 flex-col items-center py-0.5">
                      <p data-testid="weekday-pages-value" className="font-mono text-xl font-bold leading-tight tabular-nums text-amber-600">{value}<span className="ml-0.5 text-xs opacity-60">{pageLabel}</span></p>
                      <p data-testid="weekday-pages-units" className="h-4 text-[11px] font-semibold leading-4 text-slate-500">{describePageUnits(value, step)}</p>
                    </div>
                    <div role="group" aria-label={`${day.label}요일 1${pageLabel}씩`} className="flex shrink-0 flex-col gap-0.5">
                      <button type="button" data-testid="weekday-pages-up" aria-label={`${day.label}요일 1${pageLabel} 늘리기`} onClick={() => onStep(day.id, 1)} className={stepButton}>{arrow(true)}</button>
                      <button type="button" data-testid="weekday-pages-down" aria-label={`${day.label}요일 1${pageLabel} 줄이기`} onClick={() => onStep(day.id, -1)} className={stepButton}>{arrow(false)}</button>
                    </div>
                  </div>
                </>
              ) : <div className="flex flex-1 items-center justify-center py-3 text-sm font-semibold text-slate-400">쉼</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ───────────────────────── 하루 평균 시간 비율 막대 (폴더) ───────────────────────── */

export interface ShareItem { id: string; name: string; minutes: number; isFolder?: boolean }

export interface RatioSegment { id: string; name: string; value: number; color: string; tooltip?: string; /** 칸 안 %의 윗줄에 쓸 실제 값(예: "182P", "11h 47m") */ label?: string }

/**
 * 칸들이 서로 나눠 갖는 가로 비율 막대. 칸 안에 %가 들어가고(합 100), 값이 0인 칸은 없다.
 * 칸에 label(실제 값)이 있으면 윗줄에 값, 아랫줄에 %를 쓴다(막대가 두 줄 높이). 글자색은 칸 색에 맞춰 흰색/짙은 색 중 읽히는 쪽.
 */
export const RatioBar: React.FC<{ segments: RatioSegment[]; ariaLabel: string; dark?: boolean; testId?: string; large?: boolean }> = ({ segments, ariaLabel, dark = false, testId = 'ratio-bar', large = false }) => {
  const percents = sharePercents(segments.map(segment => segment.value));
  const twoLines = segments.some(segment => segment.label);
  return (
    <div role="img" aria-label={ariaLabel} data-testid={testId}
      className={`flex w-full gap-0.5 overflow-hidden ${large ? 'h-10 rounded-xl' : twoLines ? 'h-12 rounded-xl' : 'h-7 rounded-full'} ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
      {segments.map((segment, index) => segment.value > 0 && (
        <div key={segment.id} data-testid="ratio-segment" title={segment.tooltip || `${segment.name} ${percents[index]}%`}
          className={`flex flex-col items-center justify-center whitespace-nowrap font-black tabular-nums leading-tight ${large ? 'min-w-[3.5rem] text-[18px]' : `text-[12px] ${twoLines ? 'min-w-[2.75rem]' : 'min-w-[2rem]'}`}`}
          style={{ flexGrow: segment.value, flexBasis: 0, backgroundColor: segment.color, color: readableOn(segment.color) }}>
          {segment.label && <span data-testid="ratio-value">{segment.label}</span>}
          <span data-testid="ratio-percent" className={segment.label ? 'font-bold' : ''}>{percents[index]}%</span>
        </div>
      ))}
    </div>
  );
};

/** "평균"과 월~일 버튼. 누르면 그 요일의 비율을 보고, 이미 눌린 요일을 다시 누르면 평균으로 돌아온다. value가 null이면 하루 평균. */
export const WeekdayPicker: React.FC<{ value: number | null; onChange: (weekday: number | null) => void; days: Array<{ id: number; label: string }>; todayWeekday?: number; dark?: boolean }> = ({ value, onChange, days, todayWeekday, dark = false }) => {
  const idle = dark ? 'bg-white/10 text-indigo-100 hover:bg-white/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
  const picked = dark ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white';
  const button = (key: string, label: string, selected: boolean, onPress: () => void, wide = false, today = false, aria?: string) => (
    <button key={key} type="button" aria-pressed={selected} aria-label={aria}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onPress(); }} onMouseDown={event => event.stopPropagation()}
      className={`flex h-10 items-center justify-center rounded-lg text-[15px] font-bold transition-colors ${wide ? 'px-3' : 'w-10'} ${selected ? picked : idle} ${today && !selected ? (dark ? 'ring-2 ring-inset ring-amber-300/70' : 'ring-2 ring-inset ring-amber-300') : ''}`}>
      {label}
    </button>
  );
  return (
    <div data-testid="weekday-picker" role="group" aria-label="요일 고르기" className="flex flex-wrap items-center gap-1">
      {button('avg', '평균', value === null, () => onChange(null), true, false, '하루 평균 보기')}
      {days.map(day => button(String(day.id), day.label, value === day.id, () => onChange(value === day.id ? null : day.id), false, day.id === todayWeekday, `${day.label}요일 비율 보기`))}
    </div>
  );
};

/** 폴더 안의 과목·폴더가 하루 시간에서 차지하는 비율. 칸 안에 %가 들어가고, 이름은 막대 아래 범례에 둔다. 색은 항목 순서대로 고정. */
export const ShareBar: React.FC<{ items: ShareItem[]; dark?: boolean; emptyNote?: string; title?: string }> = ({ items, dark = false, emptyNote = '아직 비율이 없어요 · 공부할 요일이 없거나 속도를 재지 않은 과목뿐이에요', title = '하루 평균 시간 비율' }) => {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.minutes), 0);
  const percents = sharePercents(items.map(item => item.minutes));
  if (items.length === 0) {
    return (
      <p data-testid="share-bar-empty" className={`text-[13px] font-bold ${dark ? 'text-indigo-200' : 'text-slate-500'}`}>
        아직 들어간 과목이 없어요
      </p>
    );
  }
  return (
    <div data-testid="share-bar" className="flex flex-col gap-2">
      {total > 0 && (
        <RatioBar large dark={dark} ariaLabel={`${title} ${items.map((item, index) => `${item.name} ${percents[index]}%`).join(', ')}`}
          segments={items.map((item, index) => ({ id: item.id, name: item.name, value: item.minutes, color: seriesColor(index, dark), tooltip: `${item.name} ${percents[index]}% · ${formatDuration(item.minutes)}` }))} />
      )}
      {total <= 0 && (
        <>
          <div className={`h-10 w-full rounded-xl ${dark ? 'bg-white/10' : 'bg-slate-100'}`} />
          <p data-testid="share-bar-none" className={`text-[13px] font-bold ${dark ? 'text-indigo-200' : 'text-slate-500'}`}>{emptyNote}</p>
        </>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item, index) => (
          <li key={item.id} className={`flex items-center gap-1.5 text-[13px] font-bold ${dark ? 'text-indigo-100' : 'text-slate-700'}`}>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(index, dark) }} />
            <span className="max-w-[9rem] truncate">{item.isFolder ? '📂 ' : ''}{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ───────────────────────── 맨 위 요약: 하루 · 일주일 · 전체 ───────────────────────── */

/**
 * 요일별 학습 시간 막대(하루 단위에서만). 칸 너비가 그날 시간의 비율이고 칸 안에는 요일과 시간. 칸을 누르면 그 요일을 고른다(다시 누르면 평균).
 * 고른 요일은 테두리, 나머지는 흐리게. 쉬는 요일은 칸이 없다(요일 버튼으로는 고를 수 있다).
 */
export const WeekdayTimeBar: React.FC<{ days: WeekdayNeed[]; selected: number | null; onSelect: (weekday: number | null) => void; /** 공부 요일이 정해진 과목이 하나라도 있는가(있는데 시간이 0이면 측정 필요) */ hasSchedule?: boolean }> = ({ days, selected, onSelect, hasSchedule }) => {
  const active = days.filter(day => day.minutes > 0);
  if (active.length === 0) return <div data-testid="weekday-time-bar-empty" className="flex h-12 items-center justify-center rounded-lg bg-slate-100 text-[13px] font-bold text-slate-500">{hasSchedule ? '측정 필요 · 속도를 재면 요일별 시간이 나와요' : '학습 요일 없음'}</div>;
  return (
    <div data-testid="weekday-time-bar" role="group" aria-label="요일별 학습 시간" className="flex min-h-8 w-full gap-0.5 overflow-hidden rounded-lg">
      {active.map((day, index) => {
        const picked = selected === day.weekday;
        return (
          <button key={day.weekday} type="button" data-testid="weekday-time-segment" data-weekday={day.weekday} aria-pressed={picked}
            aria-label={`${day.label}요일 ${formatHoursMinutes(day.minutes)}`} title={`${day.label}요일 ${formatHoursMinutes(day.minutes)}`}
            onClick={() => onSelect(picked ? null : day.weekday)}
            style={{ flexGrow: day.minutes, flexBasis: 0 }}
            className={`flex min-w-[3.5rem] flex-wrap content-center items-center justify-center gap-x-2 whitespace-nowrap px-1 py-0.5 leading-tight transition-opacity sm:min-w-[4.25rem] ${index % 2 === 0 ? 'bg-indigo-700 text-white' : 'bg-indigo-300 text-indigo-950'} ${picked ? 'ring-2 ring-inset ring-slate-900' : day.isToday ? 'ring-2 ring-inset ring-amber-300' : ''} ${selected !== null && !picked ? 'opacity-50' : ''}`}>
            <span className="text-[15px] font-bold sm:text-[17px]">{day.label}</span>
            <span data-testid="weekday-time" className="text-[14px] font-semibold tabular-nums sm:text-[16px]">{formatHoursMinutes(day.minutes)}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * 속도 증가율 바로 옆에 붙는 공부량 값: 같은 변화를 "한 페이지에 쓴 시간(분)"으로 본 값이다(빨라지면 속도 +, 공부량 −).
 * 값이 없으면 아무것도 그리지 않는다(속도 쪽이 이미 "측정 필요"를 보여 준다). 색은 부모를 따르고 속도보다 작게 보여 준다.
 */
export const GrowthAmount: React.FC<{ value: number | null | undefined; label?: string; testId?: string; className?: string }> = ({ value, label = 'P', testId = 'growth-amount', className = '' }) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return (
    <span data-testid={testId} data-growth-kind="amount" title={`${pageWord(label)} 하나에 쓴 시간(분)의 변화`}
      className={`shrink-0 whitespace-nowrap font-mono text-[13px] font-bold tabular-nums opacity-80 ${className}`}>
      {`공부량 ${describeStudyAmountGrowth(value, label)}`}
    </span>
  );
};

/**
 * 고른 단위(하루 · 일주일 · 전체, 하루에서 요일을 골랐으면 그 요일)를 화면 글자로. 맨 위 요약과 아래 폴더 · 과목 카드가 같은 말을 쓴다.
 * scope는 "속도 증가율 · 하루 평균"처럼 값 이름 뒤에 붙이는 말이다.
 */
export const describePlanUnit = (unit: PlanUnit, weekdayLabel?: string) => {
  const day = unit === 'day' ? weekdayLabel : undefined;
  return {
    scope: day ? `${day}요일` : unit === 'day' ? '하루 평균' : unit === 'week' ? '일주일' : '전체',
    time: day ? `${day}요일 시간` : unit === 'day' ? '하루 평균 시간' : unit === 'week' ? '한 주 시간' : '전체 예상 시간',
    pages: day ? `${day}요일 페이지` : unit === 'day' ? '하루 평균 페이지' : unit === 'week' ? '한 주 페이지' : '전체 남은 페이지',
    share: day ? `${day}요일 시간 비율` : unit === 'day' ? '하루 평균 시간 비율' : unit === 'week' ? '일주일 시간 비율' : '전체 시간 비율',
    emptyShare: day ? `${day}요일에는 공부하는 과목이 없어요` : unit === 'all' ? '속도를 재면 전체 예상 시간이 나와요' : undefined as string | undefined
  };
};

const PLAN_UNITS: Array<{ id: PlanUnit; label: string }> = [{ id: 'day', label: '하루' }, { id: 'week', label: '일주일' }, { id: 'all', label: '전체' }];

export interface PlanUnitSummaryProps {
  /** 공부 요일이 정해진 과목이 하나라도 있는가 */
  hasSchedule?: boolean;
  unit: PlanUnit;
  onUnitChange: (unit: PlanUnit) => void;
  /** 하루 단위에서 고른 요일(0=일 … 6=토). null이면 하루 평균 */
  weekday: number | null;
  onWeekdayChange: (weekday: number | null) => void;
  growth: UnitGrowthSummary;
  /** 단위당 평균 공부량 증가(분/P): 평균 속도 증가율 옆에 보여 준다. 없으면 null */
  amount?: number | null;
  /** 단위의 시간(분): 하루 평균 · 한 주 · 전체 예상. 요일을 골랐으면 그 요일의 시간 */
  minutes: number;
  /** 요일별 학습 시간(월~일) — 하루 단위에서 막대로 그린다 */
  days: WeekdayNeed[];
  /** 맨 위 폴더 · 과목이 시간에서 차지하는 몫 */
  shareItems: ShareItem[];
}

/**
 * 학습 설정 맨 위 요약. 하루 / 일주일 / 전체를 버튼 하나로 고르면 그 단위의 평균 속도 증가율 · 표준편차 · 시간이 나오고,
 * 바로 밑에 맨 위 폴더 · 과목이 그 시간에서 차지하는 비율 막대가 있다. 하루 단위에서는 그 밑에 요일 버튼과 요일별 학습 시간 막대가 생기고,
 * 요일을 고르면 위의 값들과 비율 막대가 그 요일 기준으로 바뀐다.
 */
export const PlanUnitSummary: React.FC<PlanUnitSummaryProps> = ({ unit, onUnitChange, weekday, onWeekdayChange, growth, amount, minutes, days, shareItems, hasSchedule }) => {
  const dayLabel = unit === 'day' && weekday !== null ? days.find(day => day.weekday === weekday)?.label : undefined;
  const words = describePlanUnit(unit, dayLabel);
  const timeLabel = words.time;
  const shareLabel = words.share;
  const box = 'min-w-0 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200';
  return (
    <section data-testid="plan-summary" aria-label="학습 시간 요약" className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
      <div data-testid="plan-unit" role="group" aria-label="단위" className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
        {PLAN_UNITS.map(item => (
          <button key={item.id} type="button" aria-pressed={unit === item.id} onClick={() => onUnitChange(item.id)}
            className={`h-10 min-w-[4.5rem] rounded-lg px-4 text-[15px] font-bold transition-colors ${unit === item.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div data-testid="plan-stats" className="grid grid-cols-3 gap-2">
        <div className={box}>
          <p className="truncate text-[12px] font-bold text-slate-500">평균 속도 증가율</p>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p data-testid="plan-growth" className={`truncate font-mono text-[22px] font-black leading-tight tabular-nums ${growth.measured === 0 ? 'text-slate-400' : growth.mean < 0 ? 'text-amber-700' : 'text-indigo-700'}`}>
              {growth.measured > 0 ? describeSpeedGrowth(growth.mean) : '측정 필요'}
            </p>
            {growth.measured > 0 && <GrowthAmount value={amount} testId="plan-growth-amount" className="text-slate-600" />}
          </div>
        </div>
        <div className={box}>
          <p className="truncate text-[12px] font-bold text-slate-500">표준편차</p>
          <p data-testid="plan-spread" className={`truncate font-mono text-[22px] font-black leading-tight tabular-nums ${growth.measured === 0 ? 'text-slate-400' : 'text-slate-800'}`}>
            {growth.measured > 0 ? `±${growth.spread.toFixed(1)}P/h` : '-'}
          </p>
        </div>
        <div className={box}>
          <p className="truncate text-[12px] font-bold text-slate-500">{timeLabel}</p>
          <p data-testid="plan-time" className={`truncate font-mono text-[22px] font-black leading-tight tabular-nums ${minutes > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
            {minutes > 0 ? formatHoursMinutes(minutes) : '-'}
          </p>
        </div>
      </div>

      <div data-testid="plan-share" className="flex flex-col gap-2">
        <p className="text-[13px] font-bold text-slate-500">{shareLabel}</p>
        <ShareBar items={shareItems} title={shareLabel} emptyNote={words.emptyShare} />
      </div>

      {unit === 'day' && (
        <div data-testid="plan-weekdays" className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <WeekdayPicker value={weekday} onChange={onWeekdayChange} days={days.map(day => ({ id: day.weekday, label: day.label }))} todayWeekday={days.find(day => day.isToday)?.weekday} />
          <WeekdayTimeBar days={days} selected={weekday} onSelect={onWeekdayChange} hasSchedule={hasSchedule} />
        </div>
      )}
    </section>
  );
};

/* ───────────────────────── 속도 증가 그래프 (과목) ───────────────────────── */

const CHART_W = 420;
const CHART_H = 176;
const PAD = { left: 42, right: 16, top: 14, bottom: 30 };

/**
 * 속도 증가 그래프의 가로축. 모든 점의 페이지 위치를 알면 그 위치(p.31)가 가로고, 하나라도 모르면(기본복습 기록처럼 페이지 범위가 없는 기록)
 * 푼 장수의 합(12P)이 가로다. 위치는 데이터가 있는 범위만 보이고, 장수의 합은 0에서 시작한다.
 */
export interface SpeedAxis {
  values: number[];
  /** true면 페이지 위치, false면 푼 장수의 합 */
  position: boolean;
  lo: number;
  hi: number;
  ticks: number[];
}

export const speedAxisOf = (points: Array<{ page?: number | null; pagesDone?: number }>): SpeedAxis => {
  const positions = points.map(point => point.page);
  const position = positions.length > 0 && positions.every(value => typeof value === 'number' && Number.isFinite(value));
  const values = position ? positions as number[] : points.map(point => point.pagesDone ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!position) {
    const hi = (max || 1) * 1.04;
    return { values, position, lo: 0, hi, ticks: [0, hi / 2, hi].map(value => Math.round(value * 10) / 10) };
  }
  if (max - min < 1) return { values, position, lo: min - 0.5, hi: max + 0.5, ticks: [Math.round(min)] };
  const pad = (max - min) * 0.04;
  const ticks = [Math.round(min), Math.round((min + max) / 2), Math.round(max)].filter((value, index, all) => all.indexOf(value) === index);
  return { values, position, lo: min - pad, hi: max + pad, ticks };
};

/**
 * 선을 이어 그릴 한 구간들(점 번호). 페이지 위치가 앞으로만 가는 동안은 한 구간이고, 앞 페이지로 되돌아가면(같은 곳을 다시 풀 때)
 * 새 구간이 시작된다 — 되돌아가는 선이 그래프를 가로지르지 않게 구간마다 따로 긋는다. 푼 장수의 합은 늘 앞으로만 가서 한 구간이다.
 */
export const speedRunsOf = (values: number[], position: boolean): number[][] => {
  const runs: number[][] = [];
  values.forEach((value, index) => {
    if (index === 0 || (position && value < values[index - 1])) runs.push([index]);
    else runs[runs.length - 1].push(index);
  });
  return runs;
};

/** 눈금·말풍선에 쓰는 가로 값 글자: 위치는 p.31, 푼 장수의 합은 12P */
export const formatSpeedAxisValue = (value: number, position: boolean, label: string) => (
  position ? `${pagePositionLabel(label)}.${Math.round(value)}` : `${Math.round(value * 10) / 10}${label}`
);

/**
 * 페이지 위치에 따른 속도 증가. 가로는 25분이 끝난 페이지 위치(p.31), 세로는 첫 25분보다 늘어난 속도(P/h). 점마다 25분이고,
 * 점선은 추세선이다. 추세선은 첫 점에서 출발해 푼 장수 1P마다 페이지당 가속도만큼 오르는 선(평균 증가량 기울기)을 각 점의 위치에서 읽은 것이라, 처음과 마지막 점을 지난다.
 * 같은 페이지를 다시 풀어 위치가 앞으로 되돌아가면 선을 거기서 끊고 새 구간으로 이어 그린다.
 */
export const SpeedGainChart: React.FC<{ series: SpeedSeries; label?: string }> = ({ series, label = 'P' }) => {
  const points = series.points;
  const [picked, setPicked] = useState<number | null>(null);
  if (points.length < 2) {
    return (
      <div data-testid="speed-chart" className="flex h-[176px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 text-center text-[13px] font-bold text-slate-500">
        25분 공부가 두 번 이상 쌓이면 속도 증가 그래프가 그려져요
      </div>
    );
  }
  const axis = speedAxisOf(points);
  const xs = axis.values;
  const gains = points.map(point => point.gain);
  const yTicks = niceTicks(Math.min(0, ...gains), Math.max(0.1, ...gains));
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = (value: number) => PAD.left + ((value - axis.lo) / (axis.hi - axis.lo || 1)) * (CHART_W - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin || 1)) * (CHART_H - PAD.top - PAD.bottom);
  const slope = series.pageAcceleration ?? null;
  // 추세선: 첫 점에서 출발해 푼 장수 1P마다 페이지당 가속도만큼 오르는 선(평균 증가량 기울기)을 각 점의 위치에서 읽는다
  const trendAt = (index: number) => `${x(xs[index]).toFixed(1)},${y(gains[0] + (slope ?? 0) * ((points[index].pagesDone ?? 0) - (points[0].pagesDone ?? 0))).toFixed(1)}`;
  const runs = speedRunsOf(xs, axis.position);
  const active = picked !== null && points[picked] ? picked : points.length - 1;
  const pathOf = (run: number[]) => run.map((index, order) => `${order === 0 ? 'M' : 'L'}${x(xs[index]).toFixed(1)} ${y(points[index].gain).toFixed(1)}`).join(' ');
  return (
    <div data-testid="speed-chart" className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" className="mx-auto h-auto w-full max-w-[600px]"
        aria-label={`${axis.position ? '페이지 위치' : '푼 장수'}에 따른 속도 증가. 25분 ${points.length}번, 마지막 속도는 첫 25분보다 ${formatSignedTenth(gains[gains.length - 1])}${label}/h 빠릅니다.`}>
        {yTicks.map(value => (
          <g key={value}>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(value)} y2={y(value)} stroke={value === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" fontSize={11} fontWeight={700} fill="#64748b">{formatGainTick(value)}</text>
          </g>
        ))}
        {axis.ticks.map((value, index) => (
          <text key={index} x={x(value)} y={CHART_H - 10} textAnchor={axis.ticks.length === 1 ? 'middle' : index === 0 ? 'start' : index === axis.ticks.length - 1 ? 'end' : 'middle'} fontSize={11} fontWeight={700} fill="#64748b">{formatSpeedAxisValue(value, axis.position, label)}</text>
        ))}
        {runs.map((run, runIndex) => (
          <g key={runIndex}>
            {run.length > 1 && <path d={`${pathOf(run)} L${x(xs[run[run.length - 1]]).toFixed(1)} ${y(0).toFixed(1)} L${x(xs[run[0]]).toFixed(1)} ${y(0).toFixed(1)} Z`} fill="#4f46e5" opacity={0.1} />}
            {slope !== null && run.length > 1 && <polyline data-testid="speed-trend" points={run.map(trendAt).join(' ')} fill="none" stroke="#d97706" strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />}
            <path d={pathOf(run)} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {points.map((point, index) => (
          <g key={point.index}>
            <circle cx={x(xs[index])} cy={y(point.gain)} r={index === active ? 5.5 : 4} fill="#4f46e5" stroke="#ffffff" strokeWidth={2} />
            <circle cx={x(xs[index])} cy={y(point.gain)} r={12} fill="transparent" onMouseEnter={() => setPicked(index)} onClick={() => setPicked(index)}>
              <title>{`${formatSpeedAxisValue(xs[index], axis.position, label)}${axis.position ? '' : ' 푼 뒤'} · 속도 ${Math.round(point.speed * 10) / 10}${label}/h · 첫 25분보다 ${formatSignedTenth(point.gain)}${label}/h`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] font-bold text-slate-600">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-5 rounded bg-indigo-600" />속도 증가</li>
        {slope !== null && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed border-amber-600" />추세선</li>}
      </ul>
    </div>
  );
};

/* ───────────────────────── 폴더: 공부 시간에 따른 속도 증가 합계 ───────────────────────── */

export type ChartGroup = GroupSpeed & { colorIndex: number };

/**
 * 폴더 그래프: 폴더 전체의 합계 한 줄. 가로는 페이지 위치(과목 하나일 때) 또는 폴더가 푼 장수의 합(여러 과목이 섞일 때), 세로는 속도 증가 합계(P/h, 안에 든 과목마다 첫 25분보다 늘어난 값의 합).
 * 그래프 밑 목록은 폴더 바로 아래 폴더·과목의 최근 속도 증가율이다(이 값들을 더하면 위의 "속도 증가율 합계"가 된다).
 */
export const FolderSpeedChart: React.FC<{ total: GroupSpeed; items: ChartGroup[]; dark?: boolean; label?: string; title?: string; subjectLabel?: string }> = ({ total, items, dark = false, label = 'P', title = '속도 증가 합계', subjectLabel = '폴더 전체' }) => {
  const [picked, setPicked] = useState<number | null>(null);
  const ink = dark ? '#e0e7ff' : '#312e81';
  const grid = dark ? 'rgba(255,255,255,0.14)' : '#e2e8f0';
  const axis = dark ? 'rgba(255,255,255,0.4)' : '#94a3b8';
  const muted = dark ? '#a5b4fc' : '#64748b';
  const surface = dark ? '#1e1b4b' : '#ffffff';
  const points = total.points;
  const list = items.length > 0 && (
    <div className="flex flex-col gap-1">
      <ul data-testid="group-speed-list" className="grid gap-1 sm:grid-cols-2">
        {items.map(item => (
          <li key={item.id} data-testid="group-speed-row" className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-bold ${dark ? 'bg-white/5 text-indigo-100' : 'bg-white text-slate-700'}`}>
            <span className="min-w-0 flex-1 truncate">{item.isFolder ? '📂 ' : ''}{item.name}</span>
            <span className={`shrink-0 font-mono tabular-nums ${item.latestGrowth === null ? 'opacity-60' : ''}`}>{describeSpeedGrowth(item.latestGrowth, label)}</span>
            <GrowthAmount value={item.latestAmountGrowth} label={label} testId="group-speed-amount" />
          </li>
        ))}
      </ul>
    </div>
  );
  if (points.length < 2) {
    return (
      <div data-testid="folder-speed-chart" className="flex flex-col gap-2">
        <div className={`flex h-[120px] items-center justify-center rounded-xl border border-dashed px-4 text-center text-[13px] font-bold ${dark ? 'border-white/20 text-indigo-200' : 'border-slate-300 text-slate-500'}`}>
          25분 공부가 두 번 이상 쌓이면 그래프가 그려져요
        </div>
        {list}
      </div>
    );
  }
  const xAxis = speedAxisOf(points);
  const xs = xAxis.values;
  const gains = points.map(point => point.gain);
  const yTicks = niceTicks(Math.min(0, ...gains), Math.max(0.1, ...gains));
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = (value: number) => PAD.left + ((value - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * (CHART_W - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin || 1)) * (CHART_H - PAD.top - PAD.bottom);
  const active = picked !== null && points[picked] ? picked : points.length - 1;
  const runs = speedRunsOf(xs, xAxis.position);
  const pathOf = (run: number[]) => run.map((index, order) => `${order === 0 ? 'M' : 'L'}${x(xs[index]).toFixed(1)} ${y(points[index].gain).toFixed(1)}`).join(' ');
  return (
    <div data-testid="folder-speed-chart" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <p className={`text-[13px] font-black ${dark ? 'text-indigo-100' : 'text-slate-700'}`}>{title}</p>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" className="mx-auto h-auto w-full max-w-[600px]"
          aria-label={`${subjectLabel}의 ${xAxis.position ? '페이지 위치' : '푼 장수'}에 따른 속도 증가 합계. ${formatSpeedAxisValue(Math.min(...xs), xAxis.position, label)}에서 ${formatSpeedAxisValue(Math.max(...xs), xAxis.position, label)}까지, 마지막 합계 ${formatSignedTenth(gains[gains.length - 1])}${label}/h.`}>
          {yTicks.map(value => (
            <g key={value}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(value)} y2={y(value)} stroke={value === 0 ? axis : grid} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" fontSize={11} fontWeight={700} fill={muted}>{formatGainTick(value)}</text>
            </g>
          ))}
          {xAxis.ticks.map((value, index) => (
            <text key={index} x={x(value)} y={CHART_H - 10} textAnchor={xAxis.ticks.length === 1 ? 'middle' : index === 0 ? 'start' : index === xAxis.ticks.length - 1 ? 'end' : 'middle'} fontSize={11} fontWeight={700} fill={muted}>{formatSpeedAxisValue(value, xAxis.position, label)}</text>
          ))}
          {runs.map((run, runIndex) => (
            <g key={runIndex}>
              {run.length > 1 && <path d={`${pathOf(run)} L${x(xs[run[run.length - 1]]).toFixed(1)} ${y(0).toFixed(1)} L${x(xs[run[0]]).toFixed(1)} ${y(0).toFixed(1)} Z`} fill={ink} opacity={dark ? 0.14 : 0.08} />}
              <path data-testid="group-speed-line" d={pathOf(run)} fill="none" stroke={ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {points.map((point, index) => (
            <g key={index}>
              <circle cx={x(xs[index])} cy={y(point.gain)} r={index === active ? 5.5 : 4} fill={ink} stroke={surface} strokeWidth={2} />
              <circle cx={x(xs[index])} cy={y(point.gain)} r={11} fill="transparent" onMouseEnter={() => setPicked(index)} onClick={() => setPicked(index)}>
                <title>{`${formatSpeedAxisValue(xs[index], xAxis.position, label)}${xAxis.position ? '' : ' 푼 뒤'} · 합계 ${formatSignedTenth(point.gain)}${label}/h`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      {list}
    </div>
  );
};

/* ───────────────────────── 완료 예측 ───────────────────────── */

/** 재지 않은 과목만 무엇으로 예측했는지 적는다(속도를 잰 과목은 null). 전체 과목 목록에서 과목 이름 옆에 쓴다. */
export const describeForecastBasis = (basis: ForecastItem['basis']): string | null => ({
  measured: null,
  inherited: '측정 안 됨 · 현재 과목으로 예측',
  previous: '아직 25분이 안 돼 · 이전 과목 속도로 예측',
  initial: '측정 안 됨 · 처음 장당 시간으로 계산',
  none: '측정 안 됨 · 속도를 재면 예측해요'
} as Record<ForecastItem['basis'], string | null>)[basis];

/**
 * 현재 과목을 다 푸는 데 걸리는 시간과, 연결된 복습과목·후행과목을 푸는 데 걸리는 시간(가속도로 예측)을 모두 합친 두 숫자:
 * "남은 장수"와 "예상 시간". 과목별로 나눈 막대·범례는 없다(과목별 내용은 과목 카드 ▶ 전체 과목 목록에서 본다).
 */
export const ForecastList: React.FC<{ items: ForecastItem[]; totalMinutes: number; label?: string }> = ({ items, totalMinutes, label = 'P' }) => {
  if (items.length === 0) return null;
  const totalPages = items.reduce((sum, item) => sum + Math.max(0, item.remainingPages), 0);
  return (
    <div data-testid="forecast" className="flex flex-col gap-3">
      <div data-testid="forecast-totals" className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <p className="text-[12px] font-bold text-slate-500">남은 장수</p>
          <p data-testid="forecast-total-pages" className="font-mono text-[22px] font-black leading-tight tabular-nums text-slate-900">{`${Math.round(totalPages * 10) / 10}${label}`}</p>
        </div>
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <p className="text-[12px] font-bold text-slate-500">예상 시간</p>
          <p data-testid="forecast-total" className="font-mono text-[22px] font-black leading-tight tabular-nums text-slate-900">{formatDuration(totalMinutes)}</p>
        </div>
      </div>
    </div>
  );
};

/** 속도 증가율(최근 값)과 페이지당 가속도를 두 숫자로 */
export const SpeedFacts: React.FC<{ series: SpeedSeries; label?: string; /** 단위(하루 · 일주일 · 전체)로 본 속도 증가율. 주면 "최근" 값 대신 이 값을 보여 준다(undefined면 최근 값) */ growth?: number | null; /** 같은 단위로 본 공부량 증가(분/P). growth와 함께 준다(undefined면 최근 값) */ amount?: number | null; growthName?: string }> = ({ series, label = 'P', growth, amount, growthName }) => {
  const shown = growth === undefined ? series.latestGrowth : growth;
  const shownAmount = amount === undefined ? latestAmountGrowthOf(series) : amount;
  const pageAcceleration = series.pageAcceleration ?? null;
  return (
  <div data-testid="speed-facts" className="grid grid-cols-2 gap-2">
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="truncate text-[12px] font-bold text-slate-500">{growthName || '속도 증가율 · 최근'}</p>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p data-testid="speed-growth" className={`truncate font-mono text-[22px] font-black leading-tight tabular-nums ${shown === null ? 'text-slate-400' : shown < 0 ? 'text-amber-700' : 'text-indigo-700'}`}>
          {describeSpeedGrowth(shown, label)}
        </p>
        {shown !== null && <GrowthAmount value={shownAmount} label={label} testId="speed-growth-amount" className="text-slate-600" />}
      </div>
    </div>
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="text-[12px] font-bold text-slate-500">페이지당 가속도</p>
      <p data-testid="speed-acceleration" className={`font-mono text-[22px] font-black leading-tight tabular-nums ${pageAcceleration === null ? 'text-slate-400' : pageAcceleration < 0 ? 'text-amber-700' : 'text-indigo-700'}`}>
        {pageAcceleration === null ? '측정 필요' : <>{formatSignedHundredth(pageAcceleration)}<span className="ml-1 text-[13px] font-bold text-slate-500">{label}/h · 1{label}마다</span></>}
      </p>
    </div>
  </div>
  );
};

/* ───────────────────────── 항목 사이에 끼워 넣기 ───────────────────────── */

/**
 * 두 항목 사이(또는 맨 앞·맨 뒤)의 얇은 띠. 누르면 "새 학습 계획 추가"와 "새 분석 그룹 추가" 두 버튼이 나온다.
 * label은 스크린리더용 설명 전체(예: "시험과 자격증 사이에 추가"), alwaysOpen은 아무 항목도 없는 목록에서 버튼을 바로 보여 준다.
 */
export const InsertGap: React.FC<{ open: boolean; onToggle: () => void; onAddPlan: () => void; onAddFolder: () => void; label?: string; alwaysOpen?: boolean }> = ({ open, onToggle, onAddPlan, onAddFolder, label = '이 자리에 추가', alwaysOpen = false }) => {
  const isOpen = open || alwaysOpen;
  return (
    <div data-testid="insert-gap" data-open={isOpen ? 'true' : undefined} className="relative">
      {!alwaysOpen && (
        <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-label={label}
          className="group flex h-6 w-full items-center gap-2 px-1">
          <span aria-hidden="true" className={`h-px flex-1 border-t border-dashed ${isOpen ? 'border-indigo-400' : 'border-slate-300'}`} />
          <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border text-[13px] font-black leading-none transition-colors ${isOpen ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-400 group-hover:border-indigo-400 group-hover:text-indigo-600'}`}>{isOpen ? '×' : '＋'}</span>
          <span aria-hidden="true" className={`h-px flex-1 border-t border-dashed ${isOpen ? 'border-indigo-400' : 'border-slate-300'}`} />
        </button>
      )}
      {isOpen && (
        <div className="mb-1 mt-0.5 grid grid-cols-2 gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-2">
          <button type="button" data-testid="gap-add-plan" onClick={onAddPlan}
            className="h-12 rounded-xl border-2 border-indigo-600 bg-indigo-600 text-sm font-black text-white shadow-sm transition-colors hover:bg-indigo-700">
            ＋ 새 학습 계획 추가
          </button>
          <button type="button" data-testid="gap-add-folder" onClick={onAddFolder}
            className="h-12 rounded-xl border-2 border-slate-900 bg-slate-900 text-sm font-black text-white shadow-sm transition-colors hover:bg-slate-700">
            ＋ 새 분석 그룹 추가
          </button>
        </div>
      )}
    </div>
  );
};
