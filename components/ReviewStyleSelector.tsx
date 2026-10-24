import React, { useSyncExternalStore } from 'react';
import { getReviewStyle, setReviewStyle, subscribeReviewStyle } from '../utils/reviewStyle';
import type { ReviewStyle } from '../utils/reviewStyle';

/** 지금 고른 복습 문제 모양(줄글 · 플래시 카드). 바뀌면 화면이 다시 그려진다. */
export const useReviewStyle = (): ReviewStyle => useSyncExternalStore(subscribeReviewStyle, getReviewStyle, getReviewStyle);

const OPTIONS: { value: ReviewStyle; label: string }[] = [
  { value: 'prose', label: '줄글' },
  { value: 'flash', label: '플래시 카드' }
];

/** 줄글 / 플래시 카드 선택. 모든 복습 문제에 적용된다. */
export const ReviewStyleSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const value = useReviewStyle();
  return (
    <div role="group" aria-label="문제 모양 (모든 복습 문제에 적용)" data-testid="review-style" className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-sm font-bold text-slate-700">문제</span>
      {OPTIONS.map(option => (
        <button key={option.value} type="button" data-style={option.value} aria-pressed={value === option.value} onClick={() => setReviewStyle(option.value)}
          className={`h-10 rounded-xl border-2 px-3 text-sm font-black ${value === option.value
            ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-50'}`}>{option.label}</button>
      ))}
    </div>
  );
};
