import React, { useEffect, useMemo, useState } from 'react';
import type { StudyLog, Subject } from '../types';
import { buildStudyRecord, canAddReviewSubjects, canAddToReview, RecordReviewState, StudyRecordRow } from '../utils/studyRecord';
import { getSubjectStageReviewSubjectIds } from '../utils/schedule';
import { getPageLabel, pagePositionLabel } from '../utils/pageLabel';
import { formatDurationShort } from '../utils/weekPlan';
import { parseStudyDate } from '../utils/schedule';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const formatDate = (dateKey: string) => {
  const date = parseStudyDate(dateKey);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}(${WEEKDAY[date.getDay()]})`;
};
const formatClock = (ms: number) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const formatMonthDay = (ms: number) => {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY[date.getDay()]})`;
};
const num = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ''));

/** 복습이 오늘 할 일로 나오는 때를 말로 */
const whenText = (nextAt: number, days: number, nowMs: number) => {
  if (nextAt <= nowMs) return '오늘 할 일에 나와 있어요';
  if (days <= 0) return `오늘 ${formatClock(nextAt)}부터 오늘 할 일에 나와요`;
  return `${days}일 뒤(${formatMonthDay(nextAt)}) 오늘 할 일에 나와요`;
};

const stateView = (state: RecordReviewState, nowMs: number, reviewNames: string, basicOff = false): { tone: string; text: string } => {
  switch (state.kind) {
    case 'scheduled':
      return { tone: state.nextAt <= nowMs ? 'text-rose-700' : 'text-indigo-700', text: `${state.stage === 'subject' ? `복습과목${reviewNames ? `(${reviewNames})` : ''}` : '기본 복습'} · ${whenText(state.nextAt, state.days, nowMs)}` };
    case 'basicSkipped':
      return { tone: 'text-amber-700', text: `기본 복습은 빠져 있어요${state.nextAt !== null && state.days !== null ? ` · 복습과목 ${whenText(state.nextAt, state.days, nowMs)}` : ''}` };
    case 'pending':
      return { tone: 'text-amber-700', text: `복습에 아직 안 들어갔어요(복습 넣기를 기다려요${basicOff ? ' · 기본 복습은 빼 둠' : ''})` };
    case 'waiting':
      return { tone: 'text-amber-700', text: '복습에 아직 안 들어갔어요(자동 복습으로 모으는 중)' };
    case 'excluded':
      return { tone: 'text-slate-500', text: '복습 제외로 저장했어요' };
    default:
      return { tone: 'text-emerald-700', text: '복습을 모두 마쳤어요' };
  }
};

/**
 * 12일 "각 과목마다 학습 기록 보기": 날짜와 그날 한 페이지 · 단위, 기록마다 복습이 며칠 뒤 오늘 할 일로 나오는지.
 * 복습이 들어가 있지 않은 기록은 그 위에 "복습하기"가 있고, 누르면 바로 복습에 넣는다.
 */
export const StudyRecordDialog: React.FC<{
  subject: Subject;
  subjects: Subject[];
  logs: StudyLog[];
  onAddToReview: (logIds: string[], mode: 'basic' | 'subjects') => void;
  onClose: () => void;
}> = ({ subject, subjects, logs, onAddToReview, onClose }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const days = useMemo(() => buildStudyRecord(subject, logs, nowMs), [subject, logs, nowMs]);
  const label = getPageLabel(subject);
  const pos = pagePositionLabel(label);
  const stageCount = new Set(days.flatMap(day => day.rows.map(row => row.log.subjectStageId || subject.id))).size;
  /** 그 기록의 복습과목(저장할 때 이어져 있던 것, 없으면 지금 그 단계의 것) 중 남아 있는 과목 이름 */
  const reviewSubjectNamesOf = (row: StudyRecordRow) => {
    const ids = row.log.reviewSubjectIdsSnapshot?.length ? row.log.reviewSubjectIdsSnapshot : getSubjectStageReviewSubjectIds(subject, row.log.subjectStageId || subject.id);
    return ids.map(id => subjects.find(item => item.id === id)?.name).filter((name): name is string => Boolean(name));
  };
  const reviewNamesOf = (row: StudyRecordRow) => reviewSubjectNamesOf(row).join(', ');
  const notInReview = days.flatMap(day => day.rows).filter(row => canAddToReview(row.state) || canAddReviewSubjects(row.state, reviewSubjectNamesOf(row).length > 0));

  return (
    <div data-testid="study-record-dialog" role="dialog" aria-modal="true" aria-label={`${subject.name} 학습 기록`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-3"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-slate-900">{subject.name} · 학습 기록</h3>
            <p className="text-[13px] font-bold text-slate-500">
              {days.length ? `공부한 날 ${days.length}일` : '아직 공부한 기록이 없어요'}
              {notInReview.length > 0 && <span className="text-amber-700"> · 복습에 안 들어간 기록 {notInReview.length}개</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-600">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {days.map(day => (
              <li key={day.date} data-record-date={day.date}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                  <span className="text-base font-black text-slate-800">{formatDate(day.date)}</span>
                  <span className="text-[13px] font-bold text-slate-500">{num(day.pages)}{label}{day.minutes > 0 ? ` · ${formatDurationShort(day.minutes)}` : ''}</span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {day.rows.map(row => {
                    const view = stateView(row.state, nowMs, reviewNamesOf(row), Boolean(row.log.basicReviewSkipped));
                    const addable = canAddToReview(row.state);
                    const addableSubjects = canAddReviewSubjects(row.state, reviewSubjectNamesOf(row).length > 0);
                    return (
                      <li key={row.log.id} data-record-log={row.log.id} data-review-state={row.state.kind}
                        className={`overflow-hidden rounded-2xl border ${addable || addableSubjects ? 'border-amber-300' : 'border-slate-200'} bg-white`}>
                        {(addable || addableSubjects) && (
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-3 py-1.5">
                            <span className="text-[12px] font-bold text-amber-800">{row.state.kind === 'basicSkipped' ? '기본 복습이 안 들어가 있어요' : addableSubjects ? '기본 복습 · 복습과목이 안 들어가 있어요' : '복습이 안 들어가 있어요'}</span>
                            <span className="flex shrink-0 gap-1.5">
                              {addableSubjects && (
                                <button type="button" data-testid="record-add-review-subjects" onClick={() => onAddToReview([row.log.id], 'subjects')}
                                  className="h-9 rounded-xl border-2 border-amber-600 bg-white px-3 text-sm font-black text-amber-800 hover:bg-amber-100">복습과목 추가</button>
                              )}
                              {addable && (
                                <button type="button" data-testid="record-add-review" onClick={() => onAddToReview([row.log.id], 'basic')}
                                  className="h-9 rounded-xl bg-amber-600 px-4 text-sm font-black text-white hover:bg-amber-700">복습하기</button>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5 px-3 py-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-[15px] font-black text-slate-900">
                              {row.start !== undefined && row.end !== undefined ? row.start === row.end ? `${pos}.${num(row.start)}` : `${pos}.${num(row.start)}~${num(row.end)}` : pos}
                              <span className="ml-1.5 text-[13px] font-bold text-slate-500">{num(row.pages)}{label}{row.log.timeSpentMinutes > 0 ? ` · ${formatDurationShort(row.log.timeSpentMinutes)}` : ''}</span>
                            </span>
                            <span data-record-unit={row.unit} className="text-[13px] font-black text-slate-600">
                              {stageCount > 1 && row.log.subjectStageNameSnapshot ? `${row.log.subjectStageNameSnapshot} · ` : ''}단위 {row.unit}{row.currentUnit ? ' (지금 채우는 중)' : ''}
                            </span>
                          </div>
                          <span data-record-when className={`text-[13px] font-bold ${view.tone}`}>{view.text}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
};
