import React from 'react';

/**
 * 12일 "처음 과목을 만들 때, 혹은 기존 과목을 수정할 때 기본 복습을 늘 노트 작성 여부 상관없이 자동으로 켜지게 할지 선택":
 * 켜면 학습량 입력 창의 복습 선택이 노트가 비어 있어도 "복습 포함"으로 골라져 있다(직접 제외를 누를 수는 있다).
 */
export const AlwaysBasicReviewToggle: React.FC<{ value: boolean; onChange: (value: boolean) => void; dark?: boolean; testId?: string }> = ({ value, onChange, dark = false, testId = 'always-basic-review' }) => (
  <button type="button" role="switch" aria-checked={value} data-testid={testId}
    onClick={event => { event.preventDefault(); event.stopPropagation(); onChange(!value); }}
    onMouseDown={event => event.stopPropagation()}
    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${dark
      ? value ? 'border-emerald-500 bg-emerald-900/40' : 'border-slate-700 bg-slate-800'
      : value ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
    <span className="min-w-0">
      <span className={`block text-sm font-black ${dark ? 'text-white' : 'text-slate-800'}`}>기본 복습 늘 넣기</span>
      <span className={`block text-[12px] font-bold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        {value ? '노트를 안 써도 학습량 입력 창에서 "복습 포함"으로 골라 둬요' : '노트에 글이 있을 때만 "복습 포함"으로 골라 둬요'}
      </span>
    </span>
    <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${value ? 'bg-emerald-500' : dark ? 'bg-slate-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
    </span>
  </button>
);
