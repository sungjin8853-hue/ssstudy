import React from 'react';
import { MAX_REVIEW_LEVEL } from '../utils/reviewPractice';

/** 문제 난도를 사용자가 직접 고른다(고른 단계까지 출제). 문제를 풀어도 저절로 바뀌지 않는다. */
export const PracticeLevelSelector: React.FC<{ value: number; onChange: (level: number) => void; className?: string }> = ({ value, onChange, className = '' }) => (
  <div role="group" aria-label="난도 (이 단계까지 출제)" data-testid="practice-level" className={`flex items-center gap-1.5 ${className}`}>
    <span className="text-sm font-bold text-slate-700">난도</span>
    {Array.from({ length: MAX_REVIEW_LEVEL }, (_, index) => index + 1).map(level => (
      <button key={level} type="button" data-level={level} aria-pressed={value === level} onClick={() => onChange(level)}
        className={`h-10 min-w-[3.25rem] rounded-xl border-2 px-3 text-sm font-black ${value === level
          ? 'border-amber-700 bg-amber-700 text-white' : 'border-amber-300 bg-white text-amber-900 hover:bg-amber-100'}`}>{level}단계</button>
    ))}
  </div>
);
