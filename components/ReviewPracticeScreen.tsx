import React from 'react';
import type { ReviewGrade } from '../utils/reviewPractice';
import { PomodoroMinutesStepper } from './PomodoroMinutesStepper';
import { POMODORO_MINUTES } from '../utils/measurement';
import { ReviewStyleSelector } from './ReviewStyleSelector';

/** 기본 복습(정리노트 문제 풀이) 화면. 상태는 SessionLogger가 갖고, 여기서는 받은 값을 보여주기만 한다. */

export interface ReviewRailItem {
  id: string;
  /** "3번 · 역방향" — 문제 내용은 힌트가 되므로 번호와 유형만 보여준다. */
  label: string;
  status: 'now' | 'waiting' | 'wrong' | 'done';
  wrongCount: number;
}

export const formatReviewInterval = (ms: number) => {
  const hours = ms / 3600000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}시간`;
  return `${Math.round(hours / 24)}일`;
};

interface Props {
  title: string;
  isRetry: boolean;
  subjectName: string;
  rangeLabel: string;
  elapsed: string;
  /** 뽀모도로 남은 시간. 0이 되어도 화면은 닫히지 않고 복습은 이어진다. */
  targetRemaining: string;
  /** 뽀모도로 시간이 다 되었을 때 true: 시간 글자가 주황으로 바뀌고 "뽀모도로 끝"이 보인다(알림만, 복습은 계속) */
  timeUp?: boolean;
  /** 뽀모도로 한 번의 길이(분). 머리 줄의 ▲▼ 버튼으로 5분씩 바꾸고 저장되어 다음 복습·학습에도 쓴다. 기본 25 */
  pomodoroMinutes?: number;
  /** 예상 시간이 뽀모도로 시간을 넘어 여러 회차로 나뉠 때: 지금 몇 번째 회차인지(남은 시간은 그 회차의 남은 시간) */
  pomodoroRound?: { round: number; rounds: number };
  /** 머리 줄 바로 아래에 놓는 알림 띠(뽀모도로가 끝났을 때) */
  notice?: React.ReactNode;
  /** 문제를 복습에서 뺀 직후의 안내 띠(되돌리기 버튼이 들어 있다) */
  removalNotice?: React.ReactNode;
  /** 지금 문제 카드 안에 놓는 도구(복습에서 빼기) */
  questionTools?: React.ReactNode;
  isRunning: boolean;
  canPause: boolean;
  onTogglePause: () => void;
  onClose: () => void;
  onCondenseFirst: () => void;
  level: number;
  round: number;
  roundSize: number;
  queueLength: number;
  hasQuestions: boolean;
  isComplete: boolean;
  /** 지금 문제를 그려 주는 내용(문제·조건·정답) */
  question: React.ReactNode;
  questionRange: string;
  /** 범위 옆에 보이는 글(2일: 그 부분 바로 뒤의 풀지 않은 곳). 보여 주기만 한다 */
  rangeNote?: string;
  hasCurrentQuestion: boolean;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (result: ReviewGrade) => void;
  /**
   * 17일: 오답 재시험(2회차부터). 있으면 평가 버튼 대신 오답 · 정답 두 개만 보이고, 카드처럼 앞뒤로 오가며 정답을 다시 가릴 수 있다.
   * 회차의 모든 문제에 표시하면 그 결과로 다음 회차(또는 끝)로 넘어간다.
   */
  /** 23일: 2회차 이후 재시험도 1회차처럼 난도 4개로 매긴다(카드처럼 앞뒤로 오가며 다시 가릴 수 있는 것은 그대로) */
  retest?: {
    position: number;
    total: number;
    graded: number;
    grade?: ReviewGrade;
    onPrev: () => void;
    onNext: () => void;
    onHide: () => void;
    onGrade: (grade: ReviewGrade) => void;
  };
  /**
   * 21일 플래시카드 단계: 테스트를 다 맞혔거나 "테스트 넘기고 플래시카드로"를 눌렀을 때.
   * 카드처럼 앞뒤로 오가며 정답을 다시 가릴 수 있고, 카드마다 정답 · 오답을 체크한다(첫 테스트 오답은 미리 오답으로 체크돼 있다).
   * 재시험과 달리 다 체크해도 저절로 넘어가지 않고, 아래 버튼으로 끝낸다.
   */
  flash?: {
    position: number;
    total: number;
    marked: number;
    mark?: 'wrong' | 'right';
    /* 플래시카드만 정답 · 오답 체크다(테스트는 난도 4개) */
    wrongMarked: number;
    /** 21일: 오답으로 건너뛰기 — 첫 오답 · 마지막 오답 */
    jumps: { key: string; label: string; active: boolean; onSelect: () => void }[];
    onPrev: () => void;
    onNext: () => void;
    onHide: () => void;
    onMark: (right: boolean) => void;
    onDone: () => void;
  };
  /** 테스트를 넘기고 플래시카드로 가는 버튼(테스트 중에만 보인다) */
  onSkipToFlash?: () => void;
  wrongIntervalLabel: string;
  correctIntervalLabel: string;
  /** 평가마다 다음 복습까지의 간격(FSRS-6). 없으면 wrong/correctIntervalLabel을 쓴다. */
  gradeIntervalLabels?: Record<ReviewGrade, string>;
  /** 걸린 시간으로 권하는 평가(첫 시도에만). 없으면 표시하지 않는다. */
  recommendedGrade?: ReviewGrade | null;
  /** 정답을 확인하기까지 걸린 시간 글 */
  responseLabel?: string;
  cardRef?: React.Ref<HTMLDivElement>;
  rail: ReviewRailItem[];
  firstTryCorrect: number;
  firstTryTotal: number;
  /** 복습이 끝난 뒤 보여 줄 정리노트 */
  completion: React.ReactNode;
  /** 마칠 때 고르는 난도(기본 복습). 문제가 없는 기본 복습에도 보인다 */
  feedback?: React.ReactNode;
  firstTryOk: number;
  firstTryBad: number;
  finishLabel: string;
  canFinish: boolean;
  onFinish: () => void;
  pauseLabel: string;
}

const GRADE_BUTTONS: { grade: ReviewGrade; title: string; className: string }[] = [
  { grade: 'again', title: '오답', className: 'border-rose-300 bg-rose-100 text-rose-900' },
  { grade: 'hard', title: '어렵게 맞음', className: 'border-amber-400 bg-amber-100 text-amber-950' },
  { grade: 'good', title: '맞음', className: 'border-green-400 bg-green-100 text-green-900' },
  { grade: 'easy', title: '쉽게 맞음', className: 'border-sky-400 bg-sky-100 text-sky-950' }
];

const GRADE_TITLES: Record<ReviewGrade, string> = Object.fromEntries(GRADE_BUTTONS.map(button => [button.grade, button.title])) as Record<ReviewGrade, string>;

const RAIL_CHIP: Record<ReviewRailItem['status'], string> = {
  now: 'bg-amber-700 text-white',
  waiting: 'bg-slate-200 text-slate-800',
  wrong: 'bg-rose-100 text-rose-900',
  done: 'bg-green-100 text-green-900'
};

/** 난도 4개(오답 · 어렵게 맞음 · 맞음 · 쉽게 맞음). 1회차와 2회차 이후 재시험이 같은 것을 쓴다 */
const GradeButtons: React.FC<{
  onGrade: (grade: ReviewGrade) => void;
  labels?: Partial<Record<ReviewGrade, string>>;
  wrongIntervalLabel: string;
  correctIntervalLabel: string;
  recommendedGrade?: ReviewGrade | null;
  chosen?: ReviewGrade;
  compact?: boolean;
}> = ({ onGrade, labels, wrongIntervalLabel, correctIntervalLabel, recommendedGrade, chosen, compact }) => (
  <div className={`grid grid-cols-2 gap-3 ${compact ? '' : 'md:grid-cols-4'}`}>
    {GRADE_BUTTONS.map(button => {
      const label = labels?.[button.grade] ?? (button.grade === 'again' ? wrongIntervalLabel : correctIntervalLabel);
      const recommended = recommendedGrade === button.grade;
      return (
        <button key={button.grade} type="button" onClick={() => onGrade(button.grade)}
          data-grade={button.grade} data-recommended={recommended ? 'true' : undefined} aria-pressed={chosen ? chosen === button.grade : undefined}
          className={`relative flex ${compact ? 'h-20' : 'h-24'} flex-col items-start justify-center gap-1 rounded-2xl border-2 px-4 py-3 text-left ${button.className} ${recommended ? 'ring-4 ring-indigo-500 ring-offset-2' : ''} ${chosen === button.grade ? 'ring-4 ring-slate-800' : ''}`}>
          {recommended && <span data-testid="review-recommended" className="absolute -top-3 right-3 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-black text-white">추천</span>}
          <span className={compact ? 'text-[19px] font-black' : 'text-[22px] font-black'}>{button.title}</span>
          <span className="text-sm font-bold">{button.grade === 'again' ? `다시 풀고, 다음 복습 ${label} 뒤` : `다음 복습 ${label} 뒤`}</span>
        </button>
      );
    })}
  </div>
);

/** 카드 조작 한 줄: 이전 · 다음과 가운데 자리 표시 */
const CardNav: React.FC<{ prefix: string; position: number; total: number; note: string; onPrev: () => void; onNext: () => void; tone: 'amber' | 'indigo' }> = ({ prefix, position, total, note, onPrev, onNext, tone }) => {
  const edge = tone === 'indigo' ? 'border-indigo-300 text-indigo-900 enabled:hover:bg-indigo-50' : 'border-amber-300 text-amber-900 enabled:hover:bg-amber-50';
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" data-testid={`${prefix}-prev`} onClick={onPrev} disabled={position <= 1}
        className={`h-12 rounded-xl border-2 bg-white px-4 text-base font-black disabled:opacity-40 ${edge}`}>◀ 이전</button>
      <span data-testid={`${prefix}-position`} className="text-center text-sm font-black text-slate-700">
        {position} / {total}
        <span className="block text-xs font-bold text-slate-500">{note}</span>
      </span>
      <button type="button" data-testid={`${prefix}-next`} onClick={onNext} disabled={position >= total}
        className={`h-12 rounded-xl border-2 bg-white px-4 text-base font-black disabled:opacity-40 ${edge}`}>다음 ▶</button>
    </div>
  );
};

/**
 * 오답 재시험 카드 조작(2회차부터): 이전 · 다음, 정답 확인 · 가리기, 그리고 1회차와 같은 난도 4개.
 * 난도를 매기면 아직 매기지 않은 다음 문제로 넘어가고, 회차의 문제를 모두 매기면 그 줄 순서대로 풀이에 반영된다.
 */
const RetestControls: React.FC<{
  retest: NonNullable<Props['retest']>; revealed: boolean; onReveal: () => void;
  labels?: Partial<Record<ReviewGrade, string>>; wrongIntervalLabel: string; correctIntervalLabel: string; recommendedGrade?: ReviewGrade | null; responseLabel?: string;
}> = ({ retest, revealed, onReveal, labels, wrongIntervalLabel, correctIntervalLabel, recommendedGrade, responseLabel }) => (
  <div data-testid="retest-controls" className="flex shrink-0 flex-col gap-3">
    <CardNav prefix="retest" position={retest.position} total={retest.total} onPrev={retest.onPrev} onNext={retest.onNext} tone="amber"
      note={`매김 ${retest.graded}/${retest.total}${retest.grade ? ` · 이 문제 ${GRADE_TITLES[retest.grade]}` : ''}`} />
    {!revealed ? (
      <button type="button" onClick={onReveal}
        className="h-[68px] rounded-2xl bg-amber-700 text-xl font-black text-white shadow-[0_4px_0_#78350F] hover:bg-amber-800">정답 확인</button>
    ) : (
      <>
        {responseLabel && <p data-testid="review-response-time" className="text-center text-sm font-bold text-slate-700">걸린 시간 {responseLabel}</p>}
        <GradeButtons onGrade={retest.onGrade} labels={labels} wrongIntervalLabel={wrongIntervalLabel} correctIntervalLabel={correctIntervalLabel}
          recommendedGrade={recommendedGrade} chosen={retest.grade} compact />
        <button type="button" data-testid="retest-hide" onClick={retest.onHide}
          className="h-11 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50">정답 다시 가리기</button>
      </>
    )}
  </div>
);

/**
 * 플래시카드 단계 조작: 테스트와 달리 정답 · 오답만 체크하고, 다 체크해도 저절로 넘어가지 않는다.
 * 테스트(난도 4개)와 한눈에 갈라 보이도록 남색으로 둔다.
 */
const FlashControls: React.FC<{ flash: NonNullable<Props['flash']>; revealed: boolean; onReveal: () => void }> = ({ flash, revealed, onReveal }) => (
  <div data-testid="flash-controls" className="flex shrink-0 flex-col gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="rounded-full bg-indigo-600 px-3 py-1 text-[13px] font-black text-white">플래시카드</span>
      {flash.jumps.length > 0 && (
        <div data-testid="flash-jumps" className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-slate-600">오답으로 가기</span>
          {flash.jumps.map(jump => (
            <button key={jump.key} type="button" data-flash-jump={jump.key} aria-pressed={jump.active} onClick={jump.onSelect}
              className={`h-10 rounded-xl border-2 px-3.5 text-[13px] font-black ${jump.active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50'}`}>
              {jump.label}
            </button>
          ))}
        </div>
      )}
    </div>
    <CardNav prefix="retest" position={flash.position} total={flash.total} onPrev={flash.onPrev} onNext={flash.onNext} tone="indigo"
      note={`체크 ${flash.marked}/${flash.total}${flash.mark ? ` · 이 문제 ${flash.mark === 'right' ? '정답' : '오답'}` : ''}`} />
    {!revealed ? (
      <button type="button" onClick={onReveal}
        className="h-[68px] rounded-2xl bg-indigo-700 text-xl font-black text-white shadow-[0_4px_0_#312E81] hover:bg-indigo-800">정답 확인</button>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" data-retest-mark="wrong" aria-pressed={flash.mark === 'wrong'} onClick={() => flash.onMark(false)}
            className={`h-20 rounded-2xl border-2 text-[22px] font-black ${flash.mark === 'wrong' ? 'border-rose-600 bg-rose-200 text-rose-950 ring-4 ring-rose-300' : 'border-rose-300 bg-rose-100 text-rose-900'}`}>오답</button>
          <button type="button" data-retest-mark="right" aria-pressed={flash.mark === 'right'} onClick={() => flash.onMark(true)}
            className={`h-20 rounded-2xl border-2 text-[22px] font-black ${flash.mark === 'right' ? 'border-green-600 bg-green-200 text-green-950 ring-4 ring-green-300' : 'border-green-400 bg-green-100 text-green-900'}`}>정답</button>
        </div>
        <button type="button" data-testid="retest-hide" onClick={flash.onHide}
          className="h-11 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50">정답 다시 가리기</button>
      </>
    )}
    <button type="button" data-testid="flash-done" onClick={flash.onDone}
      className="h-14 rounded-2xl bg-indigo-600 text-[17px] font-black text-white shadow-[0_4px_0_#3730A3] hover:bg-indigo-700">
      플래시카드 끝내기{flash.marked > 0 ? ` · 체크 ${flash.marked}/${flash.total}` : ''}
    </button>
  </div>
);

export const ReviewPracticeScreen: React.FC<Props> = props => {
  const rate = props.firstTryTotal > 0 ? Math.round(props.firstTryCorrect / props.firstTryTotal * 100) : 0;
  const rounds = Array.from({ length: Math.max(1, props.round) }, (_, index) => index + 1);
  return (
    <div role="dialog" aria-modal="true" aria-label="기본 복습" className="fixed inset-0 z-[9999] flex flex-col overflow-y-auto bg-amber-50">
      <header className="flex min-h-[76px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-amber-200 bg-white px-6 py-2 md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" aria-label="복습 닫기" onClick={props.onClose}
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-900">{props.title}{props.isRetry ? ' · 오답' : ''}</span>
              <h1 className="truncate text-[19px] font-black text-slate-900">{props.subjectName}</h1>
            </div>
            <span className="text-[13px] font-semibold text-slate-700">복습 범위 {props.rangeLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-sm font-bold text-slate-700">경과 시간</span>
            <span data-testid="review-elapsed" className="font-mono text-[34px] font-black leading-none tabular-nums text-slate-900">{props.elapsed}</span>
          </div>
          <div className="flex items-center gap-2">
            <div data-testid="review-pomodoro" data-time-up={props.timeUp ? 'true' : undefined} className="flex flex-col items-end gap-0.5">
              <span className={`text-sm font-bold ${props.timeUp ? 'text-amber-800' : 'text-slate-700'}`}>{props.timeUp ? '뽀모도로 끝' : props.pomodoroRound ? `뽀모도로 ${props.pomodoroRound.round}/${props.pomodoroRound.rounds}회` : '뽀모도로'}<span data-testid="review-pomodoro-minutes" className="ml-1.5 text-slate-500">· {props.pomodoroMinutes ?? POMODORO_MINUTES}분</span></span>
              <span data-testid="review-pomodoro-time" className={`font-mono text-[34px] font-black leading-none tabular-nums ${props.timeUp ? 'text-amber-700' : 'text-slate-900'}`}>{props.targetRemaining}</span>
            </div>
            <PomodoroMinutesStepper upOnly />
          </div>
          {props.canPause && (
            <button type="button" onClick={props.onTogglePause}
              className="flex h-[52px] items-center gap-2 rounded-xl border border-amber-300 bg-amber-100 px-[18px] text-[15px] font-bold text-amber-900">
              {props.pauseLabel}
            </button>
          )}
        </div>
      </header>
      {props.notice && <div className="shrink-0 px-6 pt-4 md:px-8">{props.notice}</div>}
      {props.removalNotice && <div className="shrink-0 px-6 pt-4 md:px-8">{props.removalNotice}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-5 px-6 pb-6 pt-5 md:px-8 lg:flex-row lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2">
            {props.hasQuestions && props.flash && (
              <span data-testid="flash-chip" className="rounded-full border-2 border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-black text-white">
                플래시카드 · {props.flash.total}장{props.flash.wrongMarked > 0 ? ` · 첫 테스트 오답 ${props.flash.wrongMarked}` : ''}
              </span>
            )}
            {props.hasQuestions && !props.isComplete && !props.flash && (
              <ol aria-label="라운드" className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
                {rounds.map(round => {
                  const active = round === props.round;
                  const label = round === 1 ? '전체 문제' : `오답 ${round - 1}회차`;
                  return (
                    <li key={round} className={`rounded-full border-2 px-4 py-2 text-sm font-black ${active ? 'border-amber-700 bg-amber-700 text-white' : 'border-amber-300 bg-white text-amber-900'}`}>
                      {round === 1 ? `${props.level}단계 · ` : ''}{label}{active ? ` · ${props.roundSize}문제` : ''}
                    </li>
                  );
                })}
                <li className="pl-1 text-sm font-bold text-slate-700">남은 문제 {props.queueLength}</li>
              </ol>
            )}
            {props.hasQuestions && <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
              <ReviewStyleSelector />
            </div>}
            <button type="button" onClick={props.onCondenseFirst}
              className="h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 hover:bg-amber-100">앞부분 축약</button>
            {props.onSkipToFlash && !props.flash && !props.isComplete && props.hasQuestions && (
              <button type="button" data-testid="skip-to-flash" onClick={props.onSkipToFlash}
                className="h-11 rounded-xl border-2 border-indigo-300 bg-white px-4 text-sm font-black text-indigo-800 hover:bg-indigo-50">테스트 넘기고 플래시카드로</button>
            )}
          </div>

          {props.hasCurrentQuestion && (!props.isComplete || props.flash) && (
            <section ref={props.cardRef} aria-label="문제" className="flex min-h-[26rem] flex-[1_0_auto] scroll-mt-6 flex-col gap-5 rounded-2xl border border-amber-200 bg-white px-6 py-6 md:px-8">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-md bg-amber-100 px-3 py-1 text-[13px] font-black text-amber-900">{props.questionRange}</span>
                {props.rangeNote && <span data-testid="review-range-note" className="rounded-md border border-amber-300 px-3 py-1 text-[13px] font-bold text-amber-900">{props.rangeNote}</span>}
                <span className="text-sm font-medium text-slate-700">{props.flash ? '플래시카드 · 정답을 떠올린 뒤 정답 · 오답을 체크하세요' : '정리노트 문제'}</span>
              </div>
              <div className="flex flex-1 items-center justify-center whitespace-pre-wrap text-center">{props.question}</div>
              {props.questionTools}
              {!props.revealed && (
                <div className="flex min-h-[3.5rem] items-center justify-center rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-base font-medium text-amber-900">
                  머릿속으로 먼저 떠올려 보세요
                </div>
              )}
              {props.flash ? (
                <FlashControls flash={props.flash} revealed={props.revealed} onReveal={props.onReveal} />
              ) : props.retest ? (
                <RetestControls retest={props.retest} revealed={props.revealed} onReveal={props.onReveal}
                  labels={props.gradeIntervalLabels} wrongIntervalLabel={props.wrongIntervalLabel} correctIntervalLabel={props.correctIntervalLabel}
                  recommendedGrade={props.recommendedGrade} responseLabel={props.responseLabel} />
              ) : !props.revealed ? (
                <button type="button" onClick={props.onReveal}
                  className="h-[76px] shrink-0 rounded-2xl bg-amber-700 text-xl font-black text-white shadow-[0_4px_0_#78350F] hover:bg-amber-800">정답 확인</button>
              ) : (
                <div className="flex shrink-0 flex-col gap-2">
                  {props.responseLabel && <p data-testid="review-response-time" className="text-center text-sm font-bold text-slate-700">걸린 시간 {props.responseLabel}</p>}
                  <GradeButtons onGrade={props.onGrade} labels={props.gradeIntervalLabels} wrongIntervalLabel={props.wrongIntervalLabel}
                    correctIntervalLabel={props.correctIntervalLabel} recommendedGrade={props.recommendedGrade} />
                </div>
              )}
            </section>
          )}

          {props.isComplete && props.hasQuestions && !props.flash && (
            <section aria-labelledby="gate-done-title" className="flex flex-col gap-5 rounded-2xl border border-amber-200 bg-white px-6 py-6 md:px-8">
              <div className="flex items-center gap-4">
                <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-800">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                </span>
                <div className="flex flex-col gap-1.5">
                  <h2 id="gate-done-title" className="text-2xl font-black text-slate-900">복습 문제 완료</h2>
                  <p data-testid="extra-review-note" className="text-sm font-bold text-slate-700">시간은 계속 재고 있어요. 노트와 페이지를 더 복습한 뒤 아래 버튼으로 마치세요.</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-black text-green-900">첫 시도 정답 {props.firstTryOk}</span>
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-black text-rose-900">오답 {props.firstTryBad}</span>
                  </div>
                </div>
              </div>
              {props.completion}
            </section>
          )}

          {props.isComplete && !props.flash && props.feedback}

          <button type="button" onClick={props.onFinish} disabled={!props.canFinish}
            className="h-[60px] shrink-0 rounded-2xl bg-indigo-600 px-8 text-[17px] font-black text-white shadow-[0_4px_0_#3730A3] enabled:hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-600 disabled:shadow-none">
            {props.finishLabel}
          </button>
        </div>

        {props.hasQuestions && (
          <aside aria-label="진행 상황" data-testid="progress-panel" className="order-last flex w-full shrink-0 flex-col gap-3.5 lg:order-first lg:w-[300px]">
            <section className="flex flex-col gap-2.5 rounded-2xl border border-amber-200 bg-white px-[18px] py-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-base font-black text-slate-900">이번 문제 묶음</h2>
                <span className="text-[13px] font-semibold text-slate-700">{props.subjectName} · {props.rail.length}문제</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {props.rail.map(item => (
                  <li key={item.id} className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border-2 px-3 py-1.5 text-slate-900 ${item.status === 'now' ? 'border-amber-700 bg-amber-100' : 'border-amber-100 bg-white'}`}>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.label}</span>
                    <span className={`shrink-0 rounded-md px-2.5 py-0.5 text-xs font-black ${RAIL_CHIP[item.status]}`}>
                      {item.status === 'now' ? '지금' : item.status === 'done' ? (item.wrongCount ? `맞음 · 오답 ${item.wrongCount}` : '맞음')
                        : item.status === 'wrong' ? `오답 ${item.wrongCount}회` : '대기'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-2.5 rounded-2xl border border-amber-200 bg-white px-[18px] py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-black text-slate-900">첫 시도 정답률</h2>
                <span className="font-mono text-[15px] font-bold text-slate-900">{props.firstTryTotal > 0 ? `${props.firstTryCorrect} / ${props.firstTryTotal} · ${rate}%` : '아직 없음'}</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-indigo-600" style={{ width: `${rate}%` }} />
              </div>
            </section>
          </aside>
        )}
      </main>
    </div>
  );
};
