import React from 'react';

/**
 * 뽀모도로 시간이 끝났다는 작은 알림 띠. 학습을 멈추거나 화면을 닫지 않고, 쉬어가도 되고 이어서 해도 된다고만 알려 준다.
 * 닫기(×)를 누르면 사라진다. 타이머는 이 띠와 상관없이 계속 흐른다.
 */
export const PomodoroNotice: React.FC<{ message: string; onDismiss: () => void; className?: string }> = ({ message, onDismiss, className = '' }) => (
  <div role="status" aria-live="polite" data-testid="pomodoro-notice"
    className={`flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-100 py-1.5 pl-4 pr-1.5 text-[15px] font-black text-amber-900 ${className}`}>
    <svg className="shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>
    <span className="min-w-0 flex-1">{message}</span>
    <button type="button" onClick={onDismiss} aria-label="뽀모도로 알림 닫기"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-amber-900 hover:bg-amber-200">×</button>
  </div>
);
