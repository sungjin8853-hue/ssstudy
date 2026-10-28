import React from 'react';
import type { ReviewGrade } from '../utils/reviewPractice';
import { PomodoroMinutesStepper } from './PomodoroMinutesStepper';
import { POMODORO_MINUTES } from '../utils/measurement';
import { PracticeLevelSelector } from './PracticeLevelSelector';
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
  /** 사용자가 고른 난도(이 단계까지 출제). 문제를 풀어도 저절로 오르지 않는다 */
  maxLevel: number;
  onChangeLevel: (level: number) => void;
  round: number;
  roundSize: number;
  queueLength: number;
  hasQuestions: boolean;
  isComplete: boolean;
  /** 지금 문제를 그려 주는 내용(문제·조건·정답) */
  question: React.ReactNode;
  questionRange: string;
  hasCurrentQuestion: boolean;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (result: ReviewGrade) => void;
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

const RAIL_CHIP: Record<ReviewRailItem['status'], string> = {
  now: 'bg-amber-700 text-white',
  waiting: 'bg-slate-200 text-slate-800',
  wrong: 'bg-rose-100 text-rose-900',
  done: 'bg-green-100 text-green-900'
};

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
            {props.hasQuestions && !props.isComplete && (
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
              <PracticeLevelSelector value={props.maxLevel} onChange={props.onChangeLevel} />
            </div>}
            <button type="button" onClick={props.onCondenseFirst}
              className="h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 hover:bg-amber-100">앞부분 축약</button>
          </div>

          {props.hasCurrentQuestion && !props.isComplete && (
            <section ref={props.cardRef} aria-label="문제" className="flex min-h-[26rem] flex-[1_0_auto] scroll-mt-6 flex-col gap-5 rounded-2xl border border-amber-200 bg-white px-6 py-6 md:px-8">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-md bg-amber-100 px-3 py-1 text-[13px] font-black text-amber-900">{props.questionRange}</span>
                <span className="text-sm font-medium text-slate-700">정리노트 문제</span>
              </div>
              <div className="flex flex-1 items-center justify-center whitespace-pre-wrap text-center">{props.question}</div>
              {props.questionTools}
              {!props.revealed && (
                <div className="flex min-h-[3.5rem] items-center justify-center rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-base font-medium text-amber-900">
                  머릿속으로 먼저 떠올려 보세요
                </div>
              )}
              {!props.revealed ? (
                <button type="button" onClick={props.onReveal}
                  className="h-[76px] shrink-0 rounded-2xl bg-amber-700 text-xl font-black text-white shadow-[0_4px_0_#78350F] hover:bg-amber-800">정답 확인</button>
              ) : (
                <div className="flex shrink-0 flex-col gap-2">
                  {props.responseLabel && <p data-testid="review-response-time" className="text-center text-sm font-bold text-slate-700">걸린 시간 {props.responseLabel}</p>}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {GRADE_BUTTONS.map(button => {
                      const label = props.gradeIntervalLabels?.[button.grade]
                        ?? (button.grade === 'again' ? props.wrongIntervalLabel : props.correctIntervalLabel);
                      const recommended = props.recommendedGrade === button.grade;
                      return (
                        <button key={button.grade} type="button" onClick={() => props.onGrade(button.grade)}
                          data-grade={button.grade} data-recommended={recommended ? 'true' : undefined}
                          className={`relative flex h-24 flex-col items-start justify-center gap-1 rounded-2xl border-2 px-4 py-3 text-left ${button.className} ${recommended ? 'ring-4 ring-indigo-500 ring-offset-2' : ''}`}>
                          {recommended && <span data-testid="review-recommended" className="absolute -top-3 right-3 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-black text-white">추천</span>}
                          <span className="text-[22px] font-black">{button.title}</span>
                          <span className="text-sm font-bold">{button.grade === 'again' ? `다시 풀고, 다음 복습 ${label} 뒤` : `다음 복습 ${label} 뒤`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {props.isComplete && props.hasQuestions && (
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

          {props.isComplete && props.feedback}

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
