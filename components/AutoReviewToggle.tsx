import React from 'react';

/**
 * 23일 "자동복습 끄고 키는 거는 학습 설정에서 과목을 처음 만들때 설정가능하게, 혹은 학습설정에서 수정으로":
 * 켜면 "복습에 넣기"를 누르지 않아도 공부를 저장하면 모인 공부가 한 묶음으로 복습에 들어간다.
 * 모을 시간(autoReviewHours)은 그대로 자동 복습 설정 창에서 고친다.
 */
export const AutoReviewToggle: React.FC<{
  value: boolean; onChange: (value: boolean) => void;
  /** 23일: 복습 하나에 모을 공부 시간(자동 복습을 켰을 때만 보인다). 학습 실행에 있던 설정을 여기로 옮겼다 */
  hours?: number; onHoursChange?: (hours: number) => void;
  dark?: boolean; testId?: string;
}> = ({ value, onChange, hours, onHoursChange, dark = false, testId = 'auto-review-register' }) => (
  <div className="flex flex-col gap-2">
  <button type="button" role="switch" aria-checked={value} data-testid={testId}
    onClick={event => { event.preventDefault(); event.stopPropagation(); onChange(!value); }}
    onMouseDown={event => event.stopPropagation()}
    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${dark
      ? value ? 'border-indigo-500 bg-indigo-900/40' : 'border-slate-700 bg-slate-800'
      : value ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
    <span className="min-w-0">
      <span className={`block text-sm font-black ${dark ? 'text-white' : 'text-slate-800'}`}>자동 복습 넣기</span>
      <span className={`block text-[12px] font-bold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        {value ? '"복습에 넣기"를 누르지 않아도 모인 공부를 한 묶음으로 복습에 넣어요' : '"복습에 넣기"를 누를 때만 복습에 들어가요'}
      </span>
    </span>
    <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${value ? 'bg-indigo-500' : dark ? 'bg-slate-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
    </span>
  </button>
  {value && onHoursChange && (
    <label data-testid={`${testId}-hours`} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 ${dark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'}`}>
      <span className={`text-sm font-black ${dark ? 'text-white' : 'text-slate-800'}`}>복습 하나에 모을 공부 시간</span>
      <input type="number" inputMode="decimal" min={0} step={0.5} value={hours ?? 1}
        onChange={event => onHoursChange(Math.max(0, Number(event.target.value) || 0))}
        onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
        className={`h-10 w-20 rounded-xl border px-2 text-right text-base font-black outline-none ${dark ? 'border-slate-600 bg-slate-900 text-white' : 'border-slate-300 bg-slate-50 text-slate-900'}`} />
      <span className={`text-sm font-black ${dark ? 'text-slate-300' : 'text-slate-700'}`}>시간</span>
      <span className={`w-full text-[12px] font-bold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        {(hours ?? 1) <= 0 ? '0시간이면 공부를 저장할 때마다 넣어요.' : '이만큼 공부가 모이면 한 묶음으로 복습에 넣어요.'}
      </span>
    </label>
  )}
  </div>
);
