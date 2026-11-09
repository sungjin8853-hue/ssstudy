import React, { useEffect, useState } from 'react';
import { MAX_REST_MINUTES, MIN_REST_MINUTES, REST_STEP_MINUTES, startRest, useRestTimer, writeRestEndsAt } from '../utils/restTimer';

const formatLeft = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * 9일: 쉬는 시간 타이머. 뽀모도로 한 번이 끝날 때마다 정해 둔 길이(5분 단위)로 저절로 시작하고, 끝나면 3초 알람이 울린다
 * (알람과 저절로 시작은 SessionLogger가 맡고, 여기서는 보여 주고 길이 · 시작 · 멈춤만 고른다).
 * compact: 측정 화면의 작은 칸(돌아갈 때만 보인다).
 */
export const RestTimer: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { minutes, endsAt, setMinutes } = useRestTimer();
  const [now, setNow] = useState(() => Date.now());
  const active = endsAt !== null && endsAt > now;
  useEffect(() => {
    if (endsAt === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  if (compact) {
    if (!active) return null;
    return (
      <div data-testid="rest-timer-compact" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
        <span className="text-xs font-black">쉬는 시간</span>
        <span className="font-mono text-lg font-black tabular-nums">{formatLeft(endsAt! - now)}</span>
        <button type="button" onClick={() => writeRestEndsAt(null)} aria-label="쉬는 시간 멈추기"
          className="rounded-lg bg-white px-2 py-1 text-xs font-black text-emerald-700">멈춤</button>
      </div>
    );
  }
  return (
    <div data-testid="rest-timer" data-active={active ? 'true' : 'false'} role="group" aria-label="쉬는 시간"
      className={`flex h-11 items-center gap-1.5 rounded-xl border px-2.5 ${active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <span className={`text-xs font-black ${active ? 'text-emerald-800' : 'text-slate-500'}`}>쉬는 시간</span>
      {active ? (
        <span data-testid="rest-timer-left" className="font-mono text-lg font-black tabular-nums text-emerald-800">{formatLeft(endsAt! - now)}</span>
      ) : (
        <span className="flex items-center gap-0.5">
          <span data-testid="rest-timer-minutes" className="font-mono text-lg font-black tabular-nums text-slate-800">{minutes}</span>
          <span className="text-xs font-bold text-slate-500">분</span>
          <span className="ml-0.5 flex flex-col">
            <button type="button" aria-label="쉬는 시간 5분 늘리기" disabled={minutes >= MAX_REST_MINUTES} onClick={() => setMinutes(minutes + REST_STEP_MINUTES)}
              className="flex h-4 w-6 items-center justify-center text-[10px] font-black text-slate-600 disabled:opacity-30">▲</button>
            <button type="button" aria-label="쉬는 시간 5분 줄이기" disabled={minutes <= MIN_REST_MINUTES} onClick={() => setMinutes(minutes - REST_STEP_MINUTES)}
              className="flex h-4 w-6 items-center justify-center text-[10px] font-black text-slate-600 disabled:opacity-30">▼</button>
          </span>
        </span>
      )}
      <button type="button" data-testid="rest-timer-toggle" onClick={() => (active ? writeRestEndsAt(null) : startRest())}
        aria-label={active ? '쉬는 시간 멈추기' : '쉬는 시간 시작'}
        className={`ml-0.5 h-8 rounded-lg px-2 text-xs font-black ${active ? 'bg-white text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
        {active ? '멈춤' : '시작'}
      </button>
    </div>
  );
};
