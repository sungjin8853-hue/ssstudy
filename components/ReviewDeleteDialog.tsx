import React, { useEffect, useMemo, useState } from 'react';
import type { StudyLog } from '../types';
import { reviewDeleteUnits } from '../utils/reviewDelete';

const formatNumber = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

const formatAt = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * 9일 "이미 넣은 복습을 삭제": 오늘 할 일 복습 칸의 복습을 복습에 넣은 단위로 보여 주고, 고른 것을 복습 제외로 바꾼다.
 * 처음에는 모두 골라져 있다. 공부 기록과 정리노트 글은 남고, 복습 일정 · 문제 기록만 지운다(되돌릴 수 없다).
 */
export const ReviewDeleteDialog: React.FC<{
  logs: readonly StudyLog[];
  pagePos: string;
  title: string;
  onDelete: (logIds: string[]) => void;
  onClose: () => void;
}> = ({ logs, pagePos, title, onDelete, onClose }) => {
  const units = useMemo(() => reviewDeleteUnits(logs), [logs]);
  const [picked, setPicked] = useState<string[]>(() => units.map(unit => unit.key));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const toggle = (key: string) => setPicked(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]));
  const pickedIds = units.filter(unit => picked.includes(unit.key)).flatMap(unit => unit.logIds);
  return (
    <div data-testid="review-delete-dialog" role="dialog" aria-modal="true" aria-label="복습 삭제"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-lg rounded-3xl border border-rose-100 bg-white p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-lg font-black text-rose-700">복습 삭제 <span className="text-sm font-bold text-slate-500">{title}</span></h4>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-600">✕</button>
        </div>
        <p className="mt-1 text-[13px] font-bold leading-relaxed text-slate-600">
          고른 복습은 복습 제외로 바뀌어 다시 나오지 않아요. 공부 기록과 정리노트 글은 남고, 복습 일정과 문제 기록은 지워져요.
        </p>
        <ul data-testid="review-delete-units" className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {units.map(unit => {
            const on = picked.includes(unit.key);
            const range = unit.ranges.length
              ? `${pagePos}.${unit.ranges.map(item => (item.start === item.end ? formatNumber(item.start) : `${formatNumber(item.start)}~${formatNumber(item.end)}`)).join(', ')}`
              : '범위 없음';
            return (
              <li key={unit.key}>
                <button type="button" aria-pressed={on} data-review-delete-unit={unit.key} onClick={() => toggle(unit.key)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left ${on ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                  <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black ${on ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-300 text-transparent'}`}>✓</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-black text-slate-900">{range}</span>
                    <span className="text-xs font-bold text-slate-500">{formatAt(unit.at)} {unit.auto ? '자동으로 넣음' : '넣음'} · 기록 {unit.logIds.length}개</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border-2 border-slate-200 bg-white py-3 text-base font-black text-slate-600">취소</button>
          <button type="button" data-testid="review-delete-confirm" disabled={pickedIds.length === 0}
            onClick={() => { onDelete(pickedIds); onClose(); }}
            className="rounded-xl bg-rose-600 py-3 text-base font-black text-white disabled:opacity-40">고른 복습 삭제</button>
        </div>
      </section>
    </div>
  );
};
