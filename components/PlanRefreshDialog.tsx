import React, { useEffect, useState } from 'react';
import { formatDurationShort, PlanRefreshSummary } from '../utils/weekPlan';

const show = (minutes: number) => (minutes > 0 ? formatDurationShort(minutes) : '쉼');

/**
 * 9일 "계획 갱신시 월~일 각각 몇 시간씩 공부하는 것으로 바뀌는지와 함께 갱신 후 하루 평균 필요 공부 시간을 보여 줌":
 * 계획 갱신을 누르면 뜬다. 모든 과목을 합친 요일별 공부(직접 공부, 복습 제외) 필요 시간의 전 → 후와 하루 평균. 시간은 10분 단위로 올린다.
 * 과목마다 나눈 값은 아래에서 펼쳐 본다.
 */
export const PlanRefreshDialog: React.FC<{ summary: PlanRefreshSummary; onClose: () => void }> = ({ summary, onClose }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const diff = summary.afterDailyAverage - summary.beforeDailyAverage;
  return (
    <div data-testid="plan-refresh-dialog" role="dialog" aria-modal="true" aria-label="계획 갱신 결과"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-indigo-100 bg-white p-5 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-lg font-black text-indigo-800">계획을 갱신했어요</h4>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-600">✕</button>
        </div>
        <div data-testid="plan-refresh-average" className="mt-3 rounded-2xl bg-indigo-50 px-4 py-3">
          <p className="text-[13px] font-bold text-indigo-700">갱신 후 하루 평균 필요 공부 시간</p>
          <p className="mt-0.5 font-mono text-3xl font-black tabular-nums text-indigo-900">{formatDurationShort(summary.afterDailyAverage)}</p>
          <p className="mt-1 text-[12px] font-bold text-indigo-700">
            한 주 {formatDurationShort(summary.afterWeek)} ÷ 7일 · 공부하는 날만 평균 {formatDurationShort(summary.afterStudyDayAverage)}
            {diff !== 0 && <> · 전보다 하루 {diff > 0 ? '+' : '-'}{formatDurationShort(Math.abs(diff))}</>}
          </p>
        </div>
        <table data-testid="plan-refresh-days" className="mt-3 w-full table-fixed border-collapse text-center">
          <thead>
            <tr>{summary.days.map(day => <th key={day.weekday} className="pb-1 text-sm font-black text-slate-700">{day.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr>{summary.days.map(day => <td key={day.weekday} data-plan-before={day.weekday} className="font-mono text-[12px] font-bold tabular-nums text-slate-400 line-through decoration-slate-300">{day.before !== day.after ? show(day.before) : ''}</td>)}</tr>
            <tr>{summary.days.map(day => (
              <td key={day.weekday} data-plan-after={day.weekday}
                className={`font-mono text-[14px] font-black tabular-nums ${day.after > day.before ? 'text-rose-700' : day.after < day.before ? 'text-emerald-700' : 'text-slate-800'}`}>{show(day.after)}</td>
            ))}</tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] font-bold text-slate-500">요일마다 직접 공부하는 시간(복습 제외)이에요. 위 줄은 갱신 전, 바뀌지 않은 요일은 비워 뒀어요. 시간은 10분 단위로 올렸어요.</p>
        {summary.subjects.length > 0 && (
          <div className="mt-3">
            <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
              className="text-sm font-black text-indigo-700">{open ? '과목별 접기' : '과목별 보기'}</button>
            {open && (
              <ul data-testid="plan-refresh-subjects" className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {summary.subjects.map(subject => (
                  <li key={subject.id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="text-sm font-black text-slate-800">{subject.name}</p>
                    <div className="mt-1 grid grid-cols-7 gap-1 text-center font-mono text-[11px] font-bold tabular-nums">
                      {subject.days.map((day, index) => (
                        <span key={day.weekday} className={day.after !== day.before ? 'text-indigo-700' : 'text-slate-500'}>
                          <span className="block font-sans text-slate-400">{summary.days[index].label}</span>
                          {day.after !== day.before ? `${show(day.before)}→${show(day.after)}` : show(day.after)}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-base font-black text-white">확인</button>
      </section>
    </div>
  );
};
