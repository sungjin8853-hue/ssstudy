import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyLog } from '../types';
import type { NoteUnitPage } from '../utils/noteUnits';
import { getReviewPracticeLevel, gradeReviewPractice, setReviewPracticeLevel, startReviewPractice } from '../utils/reviewPractice';
import { PracticeLevelSelector } from './PracticeLevelSelector';
import { ReviewStyleSelector } from './ReviewStyleSelector';
import type { ReviewGrade } from '../utils/reviewPractice';
import {
  appendNotePracticeRecord, buildNotePracticeCatalog, logsInPageRange, logsInUnitRange, makeNotePracticeRecord, noteUnitLabel, pageBoundsOf
} from '../utils/notePractice';
import { ReviewQuestionContent } from './ReviewQuestionContent';

/**
 * 정리노트 옆 "문제 풀기": 복습 주기와 상관없이, 고른 범위(단위 또는 페이지)의 노트로 만든 문제를 푼다.
 * 풀이 방식은 복습과 같다(쉬운 것부터 → 맞히면 어려운 것, 틀리면 다시). 푼 결과는 기록으로만 쌓이고 복습 일정은 바뀌지 않는다.
 */

const GRADES: Array<{ grade: ReviewGrade; label: string; tone: string }> = [
  { grade: 'again', label: '오답', tone: 'border-rose-300 bg-rose-100 text-rose-900' },
  { grade: 'hard', label: '어렵게 맞음', tone: 'border-amber-400 bg-amber-100 text-amber-950' },
  { grade: 'good', label: '맞음', tone: 'border-green-400 bg-green-100 text-green-900' },
  { grade: 'easy', label: '쉽게 맞음', tone: 'border-sky-400 bg-sky-100 text-sky-950' }
];

/** 정리노트 서랍(옆으로 밀려 나오는 칸) 안에 그리면 서랍 크기에 갇히므로, 화면 전체를 쓰도록 문서 맨 위에 그린다. */
const Overlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body)
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);

const PracticeRun: React.FC<{
  subjectId: string;
  subjectName: string;
  logs: StudyLog[];
  scope: string;
  criterion: string | null;
  /** 같은 과목의 모든 노트 글(다른 쪽에서 정의한 능력 집합을 문제에 보여 주려고) */
  setMemos: readonly string[];
  onBack: () => void;
  onClose: () => void;
}> = ({ subjectId, subjectName, logs, scope, criterion, setMemos, onBack, onClose }) => {
  const { catalog, entries } = useMemo(() => buildNotePracticeCatalog(logs), [logs]);
  const entryById = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  // 범위를 직접 골랐으므로 처음에는 모든 단계를 열어 두고, 난도는 위의 선택으로 직접 바꾼다.
  const open = useMemo(() => Object.fromEntries(logs.map(log => [log.id, 3])), [logs]);
  const [practice, setPractice] = useState(() => startReviewPractice(catalog, open));
  const [revealed, setRevealed] = useState(false);
  const shownAt = useRef(Date.now());
  const current = practice.queue[0] ? entryById.get(practice.queue[0]) : undefined;
  const finished = catalog.length > 0 && practice.queue.length === 0;
  const okCount = Object.values(practice.firstCorrect).filter(Boolean).length;
  const badCount = Object.values(practice.firstCorrect).filter(value => !value).length;

  const grade = (result: ReviewGrade) => {
    if (!current) return;
    appendNotePracticeRecord(makeNotePracticeRecord(current, subjectId, result, (practice.attempts[current.id] || 0) + 1,
      Date.now() - shownAt.current, scope));
    setPractice(previous => gradeReviewPractice(previous, catalog, result));
    setRevealed(false);
    shownAt.current = Date.now();
  };
  const restart = () => { setPractice(startReviewPractice(catalog, open)); setRevealed(false); shownAt.current = Date.now(); };

  return (
    <Overlay><div role="dialog" aria-modal="true" aria-label="정리노트 문제 풀기" data-testid="note-practice"
      className="fixed inset-0 z-[10020] flex flex-col overflow-y-auto bg-amber-50">
      <header className="flex min-h-[76px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-white px-6 py-2 md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" aria-label="문제 풀기 닫기" onClick={onClose}
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"><CloseIcon /></button>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-900">문제 풀기</span>
              <h1 className="truncate text-[19px] font-black text-slate-900">{subjectName}</h1>
            </div>
            <span className="truncate text-[13px] font-semibold text-slate-700">{scope}</span>
          </div>
        </div>
        {catalog.length > 0 && <ReviewStyleSelector />}
        {catalog.length > 0 && <PracticeLevelSelector value={getReviewPracticeLevel(practice)} onChange={level => { setPractice(previous => setReviewPracticeLevel(previous, catalog, level)); setRevealed(false); }} />}
        {catalog.length > 0 && !finished && (
          <span data-testid="note-practice-remaining" className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-900">
            {practice.round === 1 ? '전체 문제' : `오답 ${practice.round - 1}회차`} · 남은 문제 {practice.queue.length}
          </span>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pb-8 pt-6 md:px-8">
        {catalog.length === 0 && (
          <section className="flex flex-col items-center gap-4 rounded-2xl border border-amber-200 bg-white px-6 py-12 text-center">
            <p className="text-lg font-black text-slate-900">이 범위에는 풀 수 있는 문제가 없어요</p>
            <button type="button" onClick={onBack} className="h-12 rounded-xl border-2 border-amber-300 bg-white px-5 text-[15px] font-black text-amber-900">범위 다시 고르기</button>
          </section>
        )}
        {current && !finished && (
          <section aria-label="문제" className="flex min-h-[26rem] flex-1 flex-col gap-5 rounded-2xl border border-amber-200 bg-white px-6 py-6 md:px-8">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-md bg-amber-100 px-3 py-1 text-[13px] font-black text-amber-900">{practice.level}단계</span>
              <span className="text-sm font-medium text-slate-700">정리노트 문제</span>
            </div>
            <div className="flex flex-1 items-center justify-center whitespace-pre-wrap text-center">
              <ReviewQuestionContent question={current.question} criterion={criterion} revealed={revealed} memo={current.log.reviewMemo ?? ''} setMemos={setMemos} />
            </div>
            {!revealed ? (
              <button type="button" onClick={() => setRevealed(true)}
                className="h-[76px] shrink-0 rounded-2xl bg-amber-700 text-xl font-black text-white shadow-[0_4px_0_#78350F] hover:bg-amber-800">정답 확인</button>
            ) : (
              <>
                <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
                  {GRADES.map(item => (
                    <button key={item.grade} type="button" data-grade={item.grade} onClick={() => grade(item.grade)}
                      className={`flex h-20 items-center justify-center rounded-2xl border-2 px-4 text-[21px] font-black ${item.tone}`}>{item.label}</button>
                  ))}
                </div>
                <p className="text-center text-sm font-semibold text-slate-600">풀이 과정이나 답이 하나라도 틀리면 오답이에요 · 기록만 저장되고 복습 일정은 그대로예요</p>
              </>
            )}
          </section>
        )}
        {finished && (
          <section aria-label="풀이 끝" className="flex flex-col gap-5 rounded-2xl border border-amber-200 bg-white px-6 py-8 md:px-8">
            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-800">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
              </span>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-2xl font-black text-slate-900">문제 풀기 끝</h2>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-black text-green-900">첫 시도 정답 {okCount}</span>
                  <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-black text-rose-900">오답 {badCount}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={restart} className="h-12 rounded-xl border-2 border-amber-300 bg-white px-5 text-[15px] font-black text-amber-900 hover:bg-amber-50">처음부터 다시</button>
              <button type="button" onClick={onBack} className="h-12 rounded-xl border-2 border-amber-300 bg-white px-5 text-[15px] font-black text-amber-900 hover:bg-amber-50">범위 다시 고르기</button>
              <button type="button" onClick={onClose} className="h-12 rounded-xl bg-indigo-600 px-6 text-[15px] font-black text-white shadow-[0_3px_0_#3730A3] hover:bg-indigo-700">닫기</button>
            </div>
          </section>
        )}
      </main>
    </div></Overlay>
  );
};

type RangeMode = 'unit' | 'page';

export const NotePracticeDialog: React.FC<{
  subjectId: string;
  subjectName: string;
  /** 정리노트의 단위(또는 하루) 쪽 목록. 오래된 것이 먼저 */
  units: NoteUnitPage[];
  /** 처음에 고르는 단위: 지금 보고 있는 쪽의 단위 */
  defaultUnitKey?: string;
  criterion: string | null;
  onClose: () => void;
}> = ({ subjectId, subjectName, units, defaultUnitKey, criterion, onClose }) => {
  const initialKey = units.some(unit => unit.key === defaultUnitKey) ? defaultUnitKey! : units[units.length - 1]?.key ?? '';
  const [mode, setMode] = useState<RangeMode>('unit');
  const [fromKey, setFromKey] = useState(initialKey);
  const [toKey, setToKey] = useState(initialKey);
  const allLogs = useMemo(() => units.flatMap(unit => unit.logs), [units]);
  const allMemos = useMemo(() => allLogs.map(log => log.reviewMemo ?? '').filter(Boolean), [allLogs]);
  const initialBounds = pageBoundsOf(units.find(unit => unit.key === initialKey)?.logs ?? []);
  const [pageFrom, setPageFrom] = useState(initialBounds ? String(initialBounds.start) : '');
  const [pageTo, setPageTo] = useState(initialBounds ? String(initialBounds.end) : '');
  const [session, setSession] = useState<{ logs: StudyLog[]; scope: string } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // 뒤의 정리노트 서랍도 Esc로 닫히므로, 먼저(캡처 단계에서) 받아서 이 창만 닫는다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const hasPages = pageBoundsOf(allLogs) !== null;
  const selection = useMemo(() => {
    if (mode === 'unit') {
      const first = units.find(unit => unit.key === fromKey);
      const second = units.find(unit => unit.key === toKey);
      const logs = logsInUnitRange(units, fromKey, toKey);
      const ordered = [first, second].filter((unit): unit is NoteUnitPage => !!unit)
        .sort((a, b) => units.indexOf(a) - units.indexOf(b));
      const scope = ordered.length === 2 && ordered[0] !== ordered[1] ? `${noteUnitLabel(ordered[0])} ~ ${noteUnitLabel(ordered[1])}`
        : ordered[0] ? noteUnitLabel(ordered[0]) : '';
      return { logs, scope };
    }
    const from = Number(pageFrom);
    const to = Number(pageTo);
    const valid = pageFrom.trim() !== '' && pageTo.trim() !== '';
    return { logs: valid ? logsInPageRange(allLogs, from, to) : [], scope: valid ? `p.${Math.min(from, to)}~${Math.max(from, to)}` : '' };
  }, [mode, units, fromKey, toKey, pageFrom, pageTo, allLogs]);
  const questionCount = useMemo(() => buildNotePracticeCatalog(selection.logs).catalog.length, [selection.logs]);

  if (session) {
    return <PracticeRun subjectId={subjectId} subjectName={subjectName} logs={session.logs} scope={session.scope} criterion={criterion} setMemos={allMemos}
      onBack={() => setSession(null)} onClose={onClose} />;
  }
  const select = 'h-12 min-w-0 flex-1 rounded-xl border-2 border-slate-300 bg-white px-3 text-[15px] font-bold text-slate-900 outline-none focus:border-indigo-600';
  const number = 'h-12 w-28 rounded-xl border-2 border-slate-300 bg-white px-3 text-center font-mono text-[17px] font-bold text-slate-900 outline-none focus:border-indigo-600';
  const segment = (target: RangeMode, label: string) => (
    <button type="button" aria-pressed={mode === target} onClick={() => setMode(target)}
      className={`h-11 rounded-[9px] px-5 text-[15px] font-bold ${mode === target ? 'bg-white text-[#2B2480] shadow-[0_1px_3px_rgba(21,26,45,0.18)]' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>
  );
  return (
    <Overlay><div role="dialog" aria-modal="true" aria-label="문제 풀 범위" data-testid="note-practice-setup"
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-900">문제 풀기 · 범위</h2>
          <button type="button" aria-label="범위 닫기" onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-slate-900 hover:bg-slate-50"><CloseIcon /></button>
        </div>
        <div role="group" aria-label="범위 방식" className="flex gap-1 self-start rounded-xl bg-[#E7EAF8] p-1">
          {segment('unit', '단위로')}
          {hasPages && segment('page', '페이지로')}
        </div>
        {mode === 'unit' ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="시작 단위" value={fromKey} onChange={event => setFromKey(event.target.value)} className={select}>
              {units.map(unit => <option key={unit.key} value={unit.key}>{noteUnitLabel(unit)}</option>)}
            </select>
            <span className="font-black text-slate-500">~</span>
            <select aria-label="끝 단위" value={toKey} onChange={event => setToKey(event.target.value)} className={select}>
              {units.map(unit => <option key={unit.key} value={unit.key}>{noteUnitLabel(unit)}</option>)}
            </select>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-black text-slate-600">p.</span>
            <input aria-label="시작 페이지" inputMode="numeric" value={pageFrom} onChange={event => setPageFrom(event.target.value.replace(/[^0-9]/g, ''))} className={number} />
            <span className="font-black text-slate-500">~</span>
            <input aria-label="끝 페이지" inputMode="numeric" value={pageTo} onChange={event => setPageTo(event.target.value.replace(/[^0-9]/g, ''))} className={number} />
          </div>
        )}
        <p data-testid="note-practice-count" className="text-sm font-bold text-slate-700">
          노트 {selection.logs.length}개 · 문제 {questionCount}개
        </p>
        <button type="button" disabled={questionCount === 0} onClick={() => setSession({ logs: selection.logs, scope: selection.scope })}
          className="h-[60px] rounded-2xl bg-amber-700 text-lg font-black text-white shadow-[0_4px_0_#78350F] enabled:hover:bg-amber-800 disabled:bg-slate-200 disabled:text-slate-600 disabled:shadow-none">
          {questionCount === 0 ? '이 범위에는 문제가 없어요' : '풀기 시작'}
        </button>
      </div>
    </div></Overlay>
  );
};
