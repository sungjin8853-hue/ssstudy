import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 학습 실행 화면(태블릿)에서 쓰는 작은 표시 컴포넌트 모음. 계산은 하지 않고 받은 값만 보여준다. */

/** 상세 칸 맨 위 탭 하나: 한 복습 칸 안의 `전체` 또는 복습 범위 하나. 탭은 지표를 어느 것으로 볼지 고를 뿐이고 복습 시작은 그 칸의 복습 전체를 시작한다. */
export interface TaskMemberData {
  /** 탭의 고유 키 */
  key: string;
  detailKey: string;
  kind: 'review' | 'study';
  /** 탭 이름. 예: 전체 / p.1~10 / p.31~40 */
  label: string;
  state: 'pending' | 'done';
  /** true면 이 과목의 모든 복습을 합친 "전체" 탭(지표를 합쳐서 본다) */
  all?: boolean;
}

export interface TaskCardData {
  key: string;
  /** (쓰지 않음: 칸 하나에 모인 탭은 상세 칸이 SessionLogger의 memberChoices로 받는다) */
  members?: TaskMemberData[];
  /** 오른쪽 상세 칸이 가리키는 키 (과목 id 또는 복습 상세 키). 같은 과목은 한 줄로 합쳐 보여준다. */
  detailKey: string;
  kind: 'review' | 'study';
  /** 칩에 들어가는 이름: 학습 / 기본 복습 / 과목 복습 / 오답 복습 */
  kindLabel: string;
  title: string;
  meta: string;
  required: boolean;
  /** 예: "1시간 12분" 또는 "측정 필요" (할 일이 남아 있을 때만 쓴다) */
  timeLabel: string;
  /** pending: 아직 할 일이 남아 있음, done: 오늘 할 양을 모두 끝냄(회색 셀) */
  state: 'pending' | 'done';
  /** 오늘 할 양을 모두 끝낸 과목에만 들어온다. 셀에는 짧은 요약(pages·minutes)만 보이고 나머지는 상세 칸에서 본다. */
  done?: { summary: string; growth?: string | null; pages?: number; minutes?: number; short?: string };
}

/** 한 칸 안에서 지금 보는 것이 아닌 할 일 하나의 한 줄 정보 */
export interface LaterMemberData {
  key: string;
  kind: 'review' | 'study';
  /** 학습 / 기본 복습 / 과목 복습 / 오답 복습 */
  label: string;
  /** 예: "오늘 권장 p.5~7 · 3P · 23분", 끝낸 것이면 "✓ 4P · 14분" */
  text: string;
  state: 'pending' | 'done';
}

/** 복습 탭 하나(또는 전체 탭)의 지표 */
export interface ReviewScopeData {
  /** 예: p.1~10, 31~40 */
  range: string;
  pages: number;
  /** 예상 복습 시간(분). 모르면 0 */
  minutes: number;
  /** 이 지표에 든 복습 묶음 수(전체 탭이면 2 이상) */
  groups: number;
  pageLabel: string;
}

/** 기본 복습 칸에 보여줄 계획: 복습할 장수와 범위, 장당 시간(뽀모도로 계산용) */
export interface ReviewPlanContext {
  /** 복습 상세 키(basic-review:과목 id) */
  detailKey: string;
  /** 복습할 장수(복습 대기 기록들의 장수 합) */
  pages: number;
  /** 합친 범위. 예: "41~50" 또는 "1~10, 21~30". 범위를 모르면 빈 글자 */
  rangeLabel: string;
  /** 복습 장당 시간(분). 아직 모르면 0 */
  minutesPerPage: number;
  /** 예상 복습 시간(분) */
  estimatedMinutes: number;
}

export interface IdleSummaryContext {
  queueCount: number;
  /** 예상 시간을 알 수 있는 할 일의 합(분) */
  queueMinutes: number;
  /** 지금 선택된 할 일이 가리키는 상세 키 (과목 id 또는 복습 상세 키) */
  selectedDetailKey: string;
  /** 화살표로 오갈 수 있는 상세 키의 순서: 할 일(중요한 순) 다음에 오늘 끝낸 과목 */
  rowOrder: string[];
  /** rowOrder 중 할 일은 없고 오늘 끝낸 기록만 있는 줄의 키 */
  doneOnlyKeys: string[];
  selectedKind: 'study' | 'review' | null;
  selectedName: string;
  /** 학습 할 일일 때: 시작 페이지와 오늘 권장 장수 */
  startPage: number | null;
  recommendedPages: number | null;
  startButton: React.ReactNode;
  /** 지금 선택된 할 일이 기본 복습일 때의 복습 계획(복습할 장수 · 뽀모도로). 기본 복습이 아니면 null */
  reviewPlan?: ReviewPlanContext | null;
  /** 오늘 끝낸 기본 복습 칸에서 "추가 학습하기"로 다시 연 뒤 보여줄, 앞당겨 할 다음 복습의 계획(상세 키별) */
  extraReviewPlans?: Record<string, ReviewPlanContext>;
  /** 오늘 끝낸 과목에서 "추가 학습하기"로 다시 연 뒤 시작을 누르면 그 과목의 측정(복습이면 다음 복습)을 바로 시작한다 */
  onExtraStudy?: (detailKey: string) => void;
  /** 오늘 끝낸 복습 칸 중에 앞당겨 할 수 있는 다음 복습이 남아 있는 칸의 키. 여기 없는 복습 칸은 "추가 학습하기" 대신 눌러지지 않는 "오늘 복습 완료"가 온다. */
  extraReviewKeys?: string[];
  /** 지금 보는 칸(같은 과목 한 칸)에 있는 다른 할 일들: 칸 안 순서(기본 복습 → 과목)에서 뒤에 오는 것은 한 줄 정보만 둔다 */
  laterMembers?: LaterMemberData[];
  /** 지금 보는 복습 칸이 범위로 나뉜 복습을 합친 것이면, 상세 칸 맨 위에 놓이는 탭들(전체 · 범위마다) */
  memberChoices?: TaskMemberData[];
  /** 지금 보는 복습 탭의 지표(복습 범위 · 장수 · 예상 시간). "전체" 탭이면 이 과목의 모든 복습을 합친 값. 복습이 둘 이상일 때만 온다. */
  reviewScope?: ReviewScopeData | null;
  /** memberChoices 중 지금 보고 있는 것의 키 */
  currentMemberKey?: string;
  /** 고르는 줄에서 하나를 누르면: 그 할 일을 선택한다(시작 버튼이 그 할 일을 시작한다). */
  onPickMember?: (key: string) => void;
  /** 지금 보는 칸이 이미 끝난 과목이면 true. 화살표 이동은 칸 고유 키로 SessionLogger가 맡는다(같은 과목이 범위별로 여러 칸이어도 한 칸씩 간다). */
  currentRowDone?: boolean;
}

/** 화살표 한 번의 이동 대상. 목록 밖에 있으면(처음 상태) 오른쪽 화살표는 맨 위 줄로 간다. 끝을 넘으면 undefined. */
export const stepRowKey = (order: string[], current: string, delta: -1 | 1): string | undefined => {
  const target = order.indexOf(current) + delta;
  return target >= 0 ? order[target] : undefined;
};

export const formatMinutesLabel = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0분';
  if (minutes < 60) return `${Math.ceil(minutes)}분`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.ceil(minutes % 60);
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

const QuestionIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" />
  </svg>
);

/** 과목 셀 안의 "?" 버튼: 다른 정보보다 눈에 띄도록 색을 넣는다 */
export const TINTED_HELP_BUTTON = 'border-indigo-400 bg-indigo-100 text-indigo-900 hover:bg-indigo-200';

const POPOVER_TONES = {
  indigo: { border: 'border-indigo-600', open: 'border-indigo-600 bg-indigo-600 text-white', close: 'bg-indigo-100 text-indigo-900' },
  red: { border: 'border-red-700', open: 'border-red-700 bg-red-700 text-white', close: 'bg-[#FDE8E6] text-red-900' },
  amber: { border: 'border-amber-700', open: 'border-amber-700 bg-amber-700 text-white', close: 'bg-amber-100 text-amber-900' }
} as const;

/** "?" 버튼을 누르면 설명이 뜨는 말풍선. 설명 글을 화면에 늘어놓지 않기 위해 쓴다. */
export const HelpPopover: React.FC<{
  label: string;
  tone?: keyof typeof POPOVER_TONES;
  children: React.ReactNode;
  className?: string;
  /** 닫혀 있을 때 "?" 버튼의 색(테두리·바탕·글자). 안 주면 흰 바탕의 회색 버튼 */
  triggerClassName?: string;
}> = ({ label, tone = 'indigo', children, className = '', triggerClassName = 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50' }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);
  const colors = POPOVER_TONES[tone];
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <span ref={root} className={`${className.includes('absolute') ? '' : 'relative'} inline-flex ${className}`}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(prev => !prev)}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${open ? colors.open : triggerClassName}`}>
        <QuestionIcon />
      </button>
      {open && (
        <div role="dialog" aria-label={label}
          className={`absolute right-0 top-[3.25rem] z-30 flex w-80 max-w-[78vw] flex-col gap-2.5 rounded-2xl border-2 bg-white p-4 text-left shadow-xl ${colors.border}`}>
          <div className="flex flex-col gap-2 text-[15px] font-medium leading-relaxed text-slate-900">{children}</div>
          <button type="button" onClick={() => setOpen(false)}
            className={`h-10 self-end rounded-xl px-4 text-sm font-black ${colors.close}`}>알겠어요</button>
        </div>
      )}
    </span>
  );
};

/**
 * 한 과목에 학습·복습이 여럿일 때, 상세 칸 맨 위에 놓이는 탭: `전체 | 복습 p.1~10 | 복습 p.31~40 | 학습`.
 * 탭은 아래 지표를 어느 것으로 볼지 고를 뿐이고, 복습 시작은 어느 복습 탭에서든 이 과목의 복습 전체를 시작한다.
 */
export const MemberChooser: React.FC<{ members: TaskMemberData[]; currentKey: string; onPick: (key: string) => void }> = ({ members, currentKey, onPick }) => (
  <div data-testid="member-chooser" role="tablist" aria-label="이 과목에서 볼 것 고르기" className="flex flex-wrap items-end gap-1 border-b-2 border-slate-300">
    {members.map(member => {
      const current = member.key === currentKey;
      const review = member.kind === 'review';
      return (
        <button key={member.key} type="button" role="tab" data-member-key={member.key} data-member-state={member.state} data-member-all={member.all ? 'true' : undefined} aria-selected={current}
          onClick={() => onPick(member.key)}
          className={`-mb-[2px] flex min-h-[44px] items-center gap-1.5 rounded-t-xl border-2 border-b-0 px-3.5 text-[15px] font-black transition-colors ${current
            ? review ? 'border-amber-700 bg-white text-amber-900' : 'border-indigo-600 bg-white text-indigo-900'
            : member.state === 'done' ? 'border-transparent bg-slate-200 text-slate-600 hover:bg-slate-300' : 'border-transparent bg-slate-200/70 text-slate-700 hover:bg-slate-200'}`}>
          {member.label}{member.state === 'done' && <span aria-hidden="true">✓</span>}
        </button>
      );
    })}
  </div>
);

/** 한 과목 칸에서 뒷순서인 할 일의 한 줄 정보(자세한 지표는 그 차례가 되면 나온다) */
export const LaterMembersStrip: React.FC<{ members: LaterMemberData[] }> = ({ members }) => (
  <ul data-testid="later-members" aria-label="이어서 할 일" className="m-0 flex list-none flex-col gap-1 p-0">
    {members.map(member => (
      <li key={member.key} data-later-key={member.key} data-later-state={member.state}
        className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-[14px]">
        <span className="shrink-0 text-[12px] font-bold text-slate-500">{member.state === 'done' ? '끝냄' : '이어서'}</span>
        <span className={`shrink-0 font-black ${member.kind === 'review' ? 'text-amber-900' : 'text-indigo-900'}`}>{member.label}</span>
        <span className="min-w-0 font-semibold text-slate-700">{member.text}</span>
      </li>
    ))}
  </ul>
);

/** 복습 탭의 지표 한 줄: 복습 범위 · 장수 · 예상 시간 */
export const ReviewScopeStrip: React.FC<{ scope: ReviewScopeData; all: boolean }> = ({ scope, all }) => (
  <div data-testid="review-scope" data-scope-all={all ? 'true' : undefined} aria-label={all ? '전체 복습 지표' : '복습 지표'}
    className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-2.5">
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="text-[13px] font-bold text-amber-900">{all ? '전체 복습 범위' : '복습 범위'}</span>
      <span className="font-mono text-lg font-black text-slate-900">{scope.range || '-'}</span>
    </span>
    <span className="flex items-baseline gap-2">
      <span className="text-[13px] font-bold text-amber-900">복습할 페이지</span>
      <span className="font-mono text-lg font-black tabular-nums text-slate-900">{scope.pages}{scope.pageLabel}</span>
    </span>
    <span className="flex items-baseline gap-2">
      <span className="text-[13px] font-bold text-amber-900">예상</span>
      <span className="font-mono text-lg font-black tabular-nums text-slate-900">{scope.minutes > 0 ? formatMinutesLabel(scope.minutes) : '측정 필요'}</span>
    </span>
  </div>
);

/** 화살표 한 쌍과 지금 위치(예: 2 / 5). "할 일 N건" 셀이 있던 자리에 놓인다. */
export interface StepperData { position: number; total: number; done: boolean; onStep: (delta: -1 | 1) => void }

export const StepArrows: React.FC<StepperData> = ({ position, total, done, onStep }) => {
  const arrow = 'flex h-10 w-11 shrink-0 items-center justify-center rounded-full text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';
  const label = total <= 0 ? '' : done ? `완료한 과목 · ${position} / ${total}`
    : position === 1 ? `가장 중요한 할 일 · 1 / ${total}` : `중요한 순서 ${position} / ${total}`;
  return (
    <div data-testid="task-stepper" role="group" aria-label="할 일 넘기기" title={label}
      className="inline-flex h-11 shrink-0 items-center rounded-full border-2 border-slate-400 bg-white">
      <button type="button" aria-label="더 중요한 할 일로" disabled={position <= 1} onClick={() => onStep(-1)} className={arrow}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span aria-live="polite" aria-label={label} className="min-w-[3.25rem] whitespace-nowrap text-center text-lg font-black tabular-nums text-slate-900">
        {total > 0 ? `${position} / ${total}` : '-'}
      </span>
      <button type="button" aria-label="덜 중요한 할 일로" disabled={position >= total} onClick={() => onStep(1)} className={arrow}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
};

/**
 * 예상 소요 / 오늘 완료를 내용 크기만큼만 차지하는 작은 알약으로 한 줄에 늘어놓는다.
 * 맨 앞에는 "할 일 N건" 알약 대신 할 일을 넘기는 화살표(stepper)가 온다. action이 있으면 맨 끝에 붙는다.
 */
export const SummaryTiles: React.FC<{ minutes: number; completedLabel: string; stepper?: StepperData; action?: React.ReactNode }> = ({ minutes, completedLabel, stepper, action }) => (
  <section aria-label="오늘 요약" className="flex min-w-0 flex-wrap items-center gap-2">
    {stepper && <StepArrows {...stepper} />}
    {[
      { label: '예상 소요', value: minutes > 0 ? formatMinutesLabel(minutes) : '측정 필요', cls: 'border-slate-400 bg-white text-slate-900' },
      { label: '오늘 완료', value: completedLabel, cls: 'border-slate-400 bg-white text-slate-900' }
    ].map(tile => (
      <div key={tile.label} className={`flex h-10 min-w-0 items-center gap-2 rounded-full border-2 px-4 ${tile.cls}`}>
        <span className="shrink-0 text-[13px] font-bold text-slate-600">{tile.label}</span>
        <span className="truncate text-lg font-black tabular-nums">{tile.value}</span>
      </div>
    ))}
    {action}
  </section>
);

/**
 * 오늘 할 일이 많아져도 아래로 늘어나지 않게 하는 칸 배치.
 * 한 줄에 200px 셀이 다 들어가면 그대로(두 줄 셀)이고, 넘치면 셀을 한 줄짜리로 줄이고 줄 수를 늘려 높이를 거의 그대로 둔다.
 * 단계: 0=두 줄 셀 1줄 · 1=이름+시간 한 줄 셀 2줄 · 2,3=이름만 3줄. 폭을 모르면(첫 그림) 0단계 모양이다.
 */
export interface QueueDensity { level: 0 | 1 | 2 | 3; columns: number; rows: number; height: number }

const QUEUE_GAP = 6;
/** 0단계(auto-fill 두 줄 셀)는 칸 사이가 8px, 줄인 단계는 가로 6px */
const QUEUE_LEVELS = [
  { minWidth: 200, maxRows: 1, cellHeight: 64, columnGap: 8 },
  { minWidth: 150, maxRows: 2, cellHeight: 30, columnGap: QUEUE_GAP },
  { minWidth: 112, maxRows: 3, cellHeight: 22, columnGap: QUEUE_GAP },
  { minWidth: 84, maxRows: 3, cellHeight: 22, columnGap: QUEUE_GAP }
] as const;

export const queueDensity = (count: number, width: number): QueueDensity => {
  if (!(width > 0) || count <= 0) return { level: 0, columns: Math.max(1, count), rows: 1, height: 64 };
  const perRow = (level: typeof QUEUE_LEVELS[number]) => Math.max(1, Math.floor((width + level.columnGap) / (level.minWidth + level.columnGap)));
  for (let index = 0; index < QUEUE_LEVELS.length; index += 1) {
    const level = QUEUE_LEVELS[index];
    const rows = Math.ceil(count / perRow(level));
    if (rows <= level.maxRows) {
      const columns = Math.ceil(count / rows);
      return { level: index as QueueDensity['level'], columns, rows, height: rows * level.cellHeight + (rows - 1) * (index === 0 ? QUEUE_GAP : 4) };
    }
  }
  const last = QUEUE_LEVELS[QUEUE_LEVELS.length - 1];
  const rows = Math.ceil(count / perRow(last));
  return { level: 3, columns: Math.ceil(count / rows), rows, height: rows * last.cellHeight + (rows - 1) * 4 };
};

/** 목록 칸의 폭을 재서 queueDensity를 돌려준다(서버 그림·폭을 모를 때는 0단계). */
const useQueueDensity = (count: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = () => setWidth(Math.round(element.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  return { ref, density: queueDensity(count, width) };
};

/**
 * 오늘 할 일과 오늘 끝낸 과목을 작은 셀의 가로 줄로 보여주는 "과목 상태" 줄.
 * 고르는 목록이 아니다: 가장 중요한 할 일이 자동으로 선택되고, 지금 보고 있는 셀만 강조한다.
 * 다른 셀로 옮기는 일은 제목 줄의 화살표(StepArrows)로 한다.
 * 셀에는 이름과 한 줄 정보만 둔다. 상세한 값은 아래 상세 칸에 있다. 오늘 할 양을 모두 끝낸 과목은 회색 셀이 된다.
 * 지금 보고 있는 과목의 이름은 더 크고 진하게, 나머지는 작고 옅게 써서 어디를 보고 있는지 한눈에 보이게 한다.
 * 과목이 많아지면 아래로 늘어나지 않고 셀이 작아져 한 칸(거의 같은 높이) 안에 모두 보인다.
 */
export const TaskQueueCells: React.FC<{
  items: TaskCardData[];
  /** 지금 상세 칸이 보여주는 셀의 detailKey (currentRowKey가 없을 때만 쓴다) */
  currentKey: string;
  /** 지금 보고 있는 칸의 고유 키. 같은 과목 키를 가진 칸이 여럿이어도 하나만 강조된다. */
  currentRowKey?: string;
  /** 주면 칸을 눌러 그 할 일을 고를 수 있다(화살표 없이). */
  onSelect?: (item: TaskCardData) => void;
}> = ({ items, currentKey, currentRowKey, onSelect }) => {
  const { ref, density } = useQueueDensity(items.length);
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm font-bold text-slate-600">
        오늘 할 일이 없습니다.
      </div>
    );
  }
  const packed = density.level > 0;
  return (
    <div ref={ref} className="min-w-0">
      <ol aria-label="오늘 과목 상태" data-density={density.level}
        className={packed ? 'grid gap-x-1.5' : 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2'}
        style={packed ? { gridTemplateColumns: `repeat(${density.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${density.rows}, minmax(0, 1fr))`, height: density.height, rowGap: density.level === 1 ? QUEUE_GAP : 4 } : undefined}>
        {items.map(item => {
          const current = currentRowKey !== undefined ? item.key === currentRowKey : item.detailKey === currentKey;
          const review = item.kind === 'review';
          const done = item.state === 'done';
          const frame = current
            ? `border-slate-900 shadow-md ${done ? 'bg-slate-100 ring-2 ring-slate-400' : review ? 'bg-white ring-2 ring-amber-300' : 'bg-white ring-2 ring-indigo-300'}`
            : done
              ? 'border-slate-300 bg-slate-100'
              : 'border-slate-300 bg-white';
          const accent = done ? 'bg-slate-400' : review ? 'bg-amber-700' : 'bg-indigo-600';
          const nameClass = current
            ? `${packed ? (density.level === 1 ? 'text-[16px]' : 'text-[14px]') : 'text-[19px]'} font-black text-slate-950`
            : `${packed ? (density.level === 1 ? 'text-[14px]' : 'text-[13px]') : 'text-[15px]'} font-bold ${done ? 'text-slate-500' : 'text-slate-600'}`;
          const pick = onSelect ? {
            onClick: () => onSelect(item), tabIndex: 0, 'data-selectable': 'true',
            onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item); } }
          } : {};
          const selectable = onSelect ? ' cursor-pointer hover:bg-slate-50' : '';
          const tooltip = packed ? `${item.title} · ${done ? item.done?.short ?? '완료' : `${item.kindLabel} · ${item.timeLabel}`}` : item.title;
          if (packed) {
            return (
              <li key={item.key} data-task-key={item.key} data-task-state={item.state}
                aria-current={current ? 'true' : undefined} title={tooltip} {...pick}
                className={`flex min-h-0 min-w-0 items-center gap-1.5 rounded-lg border-2 ${density.level === 1 ? 'px-2.5' : 'px-1.5'} ${frame}${selectable} ${item.required && !done ? 'border-l-[5px] border-l-slate-900' : ''}`}>
                <span aria-hidden="true" className={`shrink-0 rounded-full ${accent} ${density.level === 1 ? 'h-2.5 w-2.5' : 'h-2 w-2'}`} />
                <span data-testid={current ? 'task-name-current' : 'task-name'} className={`min-w-0 flex-1 truncate leading-none ${nameClass}`}>{item.title}</span>
                {density.level === 1 && (done
                  ? <span data-testid="task-done-data" className="shrink-0 text-[13px] font-bold leading-none text-slate-600">✓</span>
                  : <span className="shrink-0 text-[13px] font-bold leading-none tabular-nums text-slate-800">{item.timeLabel}</span>)}
                {density.level > 1 && done && <span data-testid="task-done-data" className="shrink-0 text-[12px] font-bold leading-none text-slate-500">✓</span>}
              </li>
            );
          }
          return (
            <li key={item.key} data-task-key={item.key} data-task-state={item.state}
              aria-current={current ? 'true' : undefined} title={tooltip} {...pick}
              className={`flex min-h-[64px] min-w-0 flex-col justify-center gap-0.5 rounded-xl border-2 px-3 py-2 ${frame}${selectable}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className={`shrink-0 rounded-full ${accent} ${current ? 'h-3 w-3' : 'h-2.5 w-2.5'}`} />
                <span data-testid={current ? 'task-name-current' : 'task-name'} className={`min-w-0 flex-1 truncate leading-tight ${nameClass}`}>{item.title}</span>
                {item.required && !done && <span className="shrink-0 rounded border border-slate-900 px-1 text-[11px] font-black leading-4 text-slate-900">필수</span>}
              </span>
              {done ? (
                <span data-testid="task-done-data" className="truncate pl-4 text-[13px] font-bold leading-tight text-slate-600">
                  ✓ {item.done?.short ?? '완료'}{current ? ' · 보는 중' : ''}
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5 pl-4 text-[13px] font-semibold leading-tight text-slate-600">
                  <span className="truncate">{item.kindLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0 font-mono font-bold text-slate-800">{item.timeLabel}</span>
                  {current && <span className="ml-auto shrink-0 rounded bg-slate-900 px-1.5 text-[11px] font-black leading-4 text-white">지금</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/**
 * "오늘 할 일" 제목 줄(화살표 · 예상 소요 · 오늘 완료 · 계획 갱신 · 설명)과, 그 밑의 과목 셀 줄.
 */
export const TaskQueueList: React.FC<{
  items: TaskCardData[];
  currentKey: string;
  currentRowKey?: string;
  onRefresh: () => void;
  /** 주면 제목 줄에 "화살표 · 예상 소요 · 오늘 완료"가 같이 붙는다(빈 줄을 따로 쓰지 않는다) */
  stats?: { minutes: number; completedLabel: string };
  /** 할 일을 넘기는 화살표. "할 일 N건" 알약 자리(제목 줄 맨 앞)에 놓인다. */
  stepper?: StepperData;
  /** 주면 화살표 대신 셀을 눌러 과목을 고른다 */
  onSelect?: (item: TaskCardData) => void;
}> = ({ items, currentKey, currentRowKey, onRefresh, stats, stepper, onSelect }) => (
  <section aria-labelledby="today-task-label" className="flex min-w-0 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 id="today-task-label" className="text-lg font-black text-slate-900">오늘 할 일</h2>
      {stats && <div className="order-last w-full lg:order-none lg:w-auto"><SummaryTiles minutes={stats.minutes} completedLabel={stats.completedLabel} stepper={stepper} /></div>}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onRefresh}
          className="h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-bold text-slate-800 hover:bg-slate-50">
          계획 갱신
        </button>
        <HelpPopover label="할 일 순서 설명">
          <span>복습, 필수, 예상 시간이 짧은 순서로 가장 중요한 할 일을 자동으로 골라요.</span>
          {onSelect
            ? <span>다른 할 일은 셀을 눌러 봐요. 학습 · 기본 복습 · 복습과목은 따로 셀이고, 같은 과목의 기본 복습은 한 셀이에요. 범위가 여럿인 복습은 아래 탭으로 범위마다의 지표를 봐요. 오늘 할 양을 다 끝낸 과목은 회색 셀이 되고, 그 과목을 보면 한 기록이 나와요.</span>
            : <span>덜 중요한 할 일은 › 화살표로 넘겨 봐요. 오늘 할 양을 다 끝낸 과목은 회색 셀이 되고, 그 과목을 보면 한 기록이 나와요.</span>}
        </HelpPopover>
      </div>
    </div>
    <TaskQueueCells items={items} currentKey={currentKey} currentRowKey={currentRowKey} onSelect={onSelect} />
  </section>
);

/** 오늘 할 양을 끝낸 과목을 볼 때 시작 버튼 자리에 놓이는 눌러지지 않는 버튼. "추가 학습하기"를 누르면 학습 시작이 다시 켜진다. */
export const DoneStartButton: React.FC<{ label?: string }> = ({ label = '오늘 학습 완료' }) => (
  <button type="button" disabled aria-label={label} data-testid="start-disabled"
    className="flex h-[68px] w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-2xl bg-slate-200 text-xl font-black text-slate-600">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
    {label}
  </button>
);

/** 학습 시작 / 복습 시작 큰 버튼. */
export const StartButton: React.FC<{ kind: 'study' | 'review'; onClick: () => void }> = ({ kind, onClick }) => (
  <button type="button" onClick={onClick}
    className={`flex h-[68px] w-full items-center justify-center gap-2.5 rounded-2xl text-xl font-black text-white transition-transform active:translate-y-0.5 ${kind === 'review'
      ? 'bg-amber-700 shadow-[0_4px_0_#78350F] hover:bg-amber-800' : 'bg-indigo-600 shadow-[0_4px_0_#3730A3] hover:bg-indigo-700'}`}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
    {kind === 'review' ? '복습 시작' : '학습 시작'}
  </button>
);
