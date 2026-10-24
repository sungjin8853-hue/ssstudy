import React from 'react';
import {
  MAX_POMODORO_MINUTES, MIN_POMODORO_MINUTES, POMODORO_STEP_MINUTES, readPomodoroMinutes, stepPomodoroMinutes, usePomodoroMinutes
} from '../utils/pomodoroSetting';

const Arrow: React.FC<{ up: boolean }> = ({ up }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </svg>
);

const BUTTON = 'flex h-7 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-35';

/**
 * 측정 화면의 뽀모도로 칸: "뽀모도로 30분" 글자와, 그 바로 옆에 놓인 ▲ 버튼 하나.
 * 측정 중에는 시간을 늘리기만 하고 줄일 수는 없다.
 */
export const PomodoroLength: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [minutes] = usePomodoroMinutes();
  return (
    <div data-testid="pomodoro-length" className={`flex shrink-0 items-center gap-2 rounded-2xl bg-slate-50 px-3 py-3 ${className}`}>
      <div className="flex flex-col">
        <p className="mb-2 text-sm font-black text-slate-500">뽀모도로</p>
        <p className="whitespace-nowrap font-mono text-3xl font-black tabular-nums text-indigo-700">
          <span data-testid="pomodoro-minutes">{minutes}</span><span className="ml-0.5 text-base font-bold">분</span>
        </p>
      </div>
      <PomodoroMinutesStepper upOnly />
    </div>
  );
};

/**
 * 뽀모도로 시간을 5분씩 바꾸는 위·아래 버튼(세로로 쌓음). 바꾼 값은 저장되어 다음 학습·복습에도 그대로 쓴다.
 * upOnly: 측정 중에는 ▲(늘리기)만 보인다.
 * 버튼이 아닌 곳(다른 버튼 안이 아닌 자리)에 놓아야 한다.
 */
export const PomodoroMinutesStepper: React.FC<{ className?: string; upOnly?: boolean }> = ({ className = '', upOnly = false }) => {
  const [minutes, setMinutes] = usePomodoroMinutes();
  return (
    <div role="group" aria-label={`뽀모도로 시간 ${minutes}분`} data-testid="pomodoro-stepper" className={`flex shrink-0 flex-col justify-center gap-1 ${className}`}>
      <button type="button" data-testid="pomodoro-up" aria-label={`뽀모도로 ${POMODORO_STEP_MINUTES}분 늘리기`} title={`뽀모도로 ${POMODORO_STEP_MINUTES}분 늘리기`}
        disabled={minutes >= MAX_POMODORO_MINUTES} onClick={() => setMinutes(stepPomodoroMinutes(readPomodoroMinutes(), 1))} className={BUTTON}>
        <Arrow up />
      </button>
      {!upOnly && <button type="button" data-testid="pomodoro-down" aria-label={`뽀모도로 ${POMODORO_STEP_MINUTES}분 줄이기`} title={`뽀모도로 ${POMODORO_STEP_MINUTES}분 줄이기`}
        disabled={minutes <= MIN_POMODORO_MINUTES} onClick={() => setMinutes(stepPomodoroMinutes(readPomodoroMinutes(), -1))} className={BUTTON}>
        <Arrow up={false} />
      </button>}
    </div>
  );
};
