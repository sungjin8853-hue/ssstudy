import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSubjectNoteShorthand } from '../utils/useNoteShorthand';
import type { ReviewMemoDocument, StudyLog, Subject } from '../types';
import { NoteSetEditContext, NoteSetSourceContext, ReviewMemoEditor, SymbolTargetContext } from './ReviewMemoEditor';
import type { NoteSetRewriter } from './ReviewMemoEditor';
import type { SymbolTarget } from './ReviewMemoEditor';
import { NoteSymbolBar } from './NoteSymbolBar';
import { NoteTutorial } from './Tutorials';
import { parseNoteDiagram, parseCriterionRelation, parseCriterionLabels, parseLogicText } from '../utils/noteDiagram';
import type { LogicNode, DiagramLogicOperator as ReviewLogicalOperator } from '../utils/noteDiagram';
import { groupLogsByPageUnit, lastPageIndex, estimateMemoRows, NOTE_PAGE_ROWS, paginateNoteSections } from '../utils/noteUnits';
import type { NoteSheetPage, NoteSheetSection } from '../utils/noteUnits';
import { getGrowthUnitSize } from '../utils/pageGrowth';
import type { DiagramArrow, DiagramItem, DiagramOperator } from '../utils/noteDiagram';
import { createSessionMemoRecord, readSessionMemos } from '../utils/sessionMemo';
import { NotePracticeDialog } from './NotePractice';
import { generatedLinesOf } from '../utils/reviewQuestions';
import { NoteMergeHistory } from './NoteMergeHistory';
import { EditIntakeBar, ReviewRemovedList } from './ReviewRemovedList';
import { abilitiesFor, buildNoteSetIndex, evaluateSetExpression, headCellOf, toggleName } from '../utils/noteSets';
import type { NoteSetIndex } from '../utils/noteSets';
import type { NoteSetLine } from '../utils/noteDiagram';

/**
 * 정리노트: 과목별로 노트를 이어 붙여(최신 기록이 위) 한 쪽씩 넘겨 보고, 같은 내용을 관계도로 확인한다.
 * 노트는 기록마다 따로 저장되어 있으므로, 이어 붙인 화면에서 고친 글은 원래 그 기록에 저장된다.
 */

type NoteView = 'note' | 'map';

const ROW = 28;
const DEFAULT_ROWS = 14;

const dateLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}월 ${date.getDate()}일`;
};

/* ───────── 관계도 ───────── */

const ARROW_PATHS: Record<DiagramArrow, { d: string; color: string; label: string }> = {
  both: { d: 'M10 12h68M18 5l-8 7 8 7M70 5l8 7-8 7', color: '#4F46E5', label: '양방향' },
  forward: { d: 'M10 12h68M70 5l8 7-8 7', color: '#B45309', label: '앞으로만 (→)' },
  back: { d: 'M10 12h68M18 5l-8 7 8 7', color: '#B45309', label: '거꾸로만 (←)' }
};

const ArrowIcon: React.FC<{ kind: DiagramArrow; small?: boolean }> = ({ kind, small = false }) => (
  <svg width={small ? 40 : 88} height={small ? 14 : 24} viewBox="0 0 88 24" fill="none" stroke={ARROW_PATHS[kind].color}
    strokeWidth={small ? 3 : 2.5} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={ARROW_PATHS[kind].label}>
    <path d={ARROW_PATHS[kind].d} />
  </svg>
);

const columnsFor = (count: number) => Array.from({ length: count }, () => 'minmax(0,1fr)').join(' 88px ');

const NODE_TONES: Record<DiagramArrow, string> = {
  both: 'border-indigo-300 bg-indigo-50 text-indigo-950',
  forward: 'border-amber-300 bg-amber-50 text-amber-950',
  back: 'border-amber-300 bg-amber-50 text-amber-950'
};
const NODE_BASE = 'min-w-0 rounded-xl border-2 px-4 py-3 text-[17px] font-bold leading-snug [overflow-wrap:anywhere] [word-break:keep-all]';

/** 논리어마다 이름·기호·색이 달라서 한눈에 구별된다: 그리고(청록 ＋) / 또는(자주 ／) / 다음(하늘 →) */
const OPERATOR_STYLE: Record<ReviewLogicalOperator, { label: string; symbol: string; chip: string; line: string }> = {
  and: { label: '그리고', symbol: '＋', chip: 'bg-teal-100 text-teal-950 ring-teal-400', line: 'bg-teal-300' },
  or: { label: '또는', symbol: '／', chip: 'bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-400', line: 'bg-fuchsia-300' },
  sequence: { label: '다음', symbol: '→', chip: 'bg-sky-100 text-sky-950 ring-sky-400', line: 'bg-sky-300' },
  equal: { label: '같음', symbol: '＝', chip: 'bg-lime-100 text-lime-950 ring-lime-500', line: 'bg-lime-300' }
};

const OperatorChip: React.FC<{ operator: ReviewLogicalOperator; small?: boolean }> = ({ operator, small = false }) => (
  <span data-logic-operator={operator} aria-label={OPERATOR_STYLE[operator].label}
    className={`inline-flex shrink-0 items-center gap-1 rounded-full font-black ring-1 ${OPERATOR_STYLE[operator].chip} ${small ? 'px-2 py-0 text-xs' : 'px-3 py-0.5 text-sm'}`}>
    <span aria-hidden="true">{OPERATOR_STYLE[operator].symbol}</span>{OPERATOR_STYLE[operator].label}
  </span>
);

const Connector: React.FC<{ operator: DiagramOperator }> = ({ operator }) => (
  <div className="flex items-center gap-3" aria-hidden="true">
    <span className={`h-0.5 flex-1 ${OPERATOR_STYLE[operator].line}`} />
    <OperatorChip operator={operator} />
    <span className={`h-0.5 flex-1 ${OPERATOR_STYLE[operator].line}`} />
  </div>
);

/** 칸 안에 쓴 논리어(= , -)와 묶음을 이름 붙은 칩으로 풀어 보인다. 논리어가 없으면 글 그대로. */
const LogicView: React.FC<{ node: LogicNode; parent?: ReviewLogicalOperator }> = ({ node, parent }) => {
  if (node.kind === 'text') return <span>{node.text}</span>;
  if (node.kind === 'group') {
    return (
      <span data-logic-group="true" className="inline-flex flex-wrap items-center gap-1 rounded-lg border-2 border-dashed border-slate-400 bg-white/70 px-2 py-0.5">
        <span aria-hidden="true" className="font-black text-slate-500">(</span>
        <LogicView node={node.inner} />
        <span aria-hidden="true" className="font-black text-slate-500">)</span>
      </span>
    );
  }
  const body = (
    <span data-logic={node.operator} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {node.items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <OperatorChip operator={node.operator} small />}
          <LogicView node={item} parent={node.operator} />
        </React.Fragment>
      ))}
    </span>
  );
  return parent !== undefined && parent !== node.operator
    ? <span data-logic-nested="true" className="inline-flex rounded-lg border border-slate-300 bg-white/70 px-1.5 py-0.5">{body}</span>
    : body;
};

const LogicText: React.FC<{ text: string }> = ({ text }) => {
  const node = useMemo(() => parseLogicText(text), [text]);
  return node.kind === 'text' ? <>{text.includes("'") ? node.text : text}</> : <LogicView node={node} />;
};

const RelationRow: React.FC<{ fields: string[]; arrows: DiagramArrow[]; columns: number; atValues?: Record<number, string> }> = ({ fields, arrows, columns, atValues }) => (
  <div data-diagram-row="relation" className="grid items-center" style={{ gridTemplateColumns: columnsFor(Math.max(columns, fields.length)) }}>
    {fields.map((field, index) => (
      <React.Fragment key={index}>
        {index > 0 && <span className="flex justify-center"><ArrowIcon kind={arrows[index - 1]} /></span>}
        <div data-diagram-node="true" className={`${NODE_BASE} ${NODE_TONES[arrows[Math.min(index, arrows.length - 1)]]}`}>
          {atValues?.[index] !== undefined && (
            <span data-diagram-at="true" className="mb-1 mr-1 inline-flex w-fit items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-black text-teal-800 ring-1 ring-teal-200">@ = {atValues[index]}</span>
          )}
          {field ? <LogicText text={field} /> : ' '}
        </div>
      </React.Fragment>
    ))}
  </div>
);

/** `>A:` / `>A=` / `>A;` 아래에 줄들이 있을 때: 왼쪽 A 하나, 오른쪽에 아래 줄들이 "또는"/"그리고"로 이어진다. */
const FanRow: React.FC<{ left: string; arrow: DiagramArrow; right: string[]; operator: DiagramOperator; columns: number }> = ({ left, arrow, right, operator, columns }) => (
  <div data-diagram-row="fan" data-operator={operator} className="grid items-center" style={{ gridTemplateColumns: columnsFor(Math.max(columns, 2)) }}>
    <div data-diagram-node="true" className={`${NODE_BASE} ${NODE_TONES[arrow]}`}><LogicText text={left} /></div>
    <span className="flex justify-center"><ArrowIcon kind={arrow} /></span>
    <div className="flex min-w-0 flex-col gap-2">
      {right.map((text, index) => (
        <React.Fragment key={index}>
          {index > 0 && <Connector operator={operator} />}
          <div data-diagram-node="true" className={`${NODE_BASE} ${NODE_TONES[arrow]}`}><LogicText text={text} /></div>
        </React.Fragment>
      ))}
    </div>
  </div>
);

const GROUP_TAG: Record<'hierarchy' | 'containment', string> = { hierarchy: '상하관계', containment: '포함관계' };

/** 세션 노트의 분류 기준. 토글 제목에서 바꾸지 않은 곳 전체에 적용된다. 토글 안의 기준(보라)과 색으로 구별한다. */
const SessionCriterionContext = React.createContext<string | null>(null);

type CriterionTone = 'session' | 'scoped' | 'previous';
const CRITERION_PILL: Record<CriterionTone, string> = {
  session: 'rounded-lg bg-indigo-200 px-3 py-0.5 text-2xl font-black text-indigo-950',
  scoped: 'rounded-lg bg-violet-200 px-3 py-0.5 text-xl font-black text-violet-950',
  previous: 'rounded-md bg-slate-200 px-2 py-0.5 text-base font-black text-slate-500 line-through'
};

/** 분류 기준을 `[ ]` 없이 칸 이름 알약으로 보인다. 칸 사이는 : → ↔(양방향), ; → →(앞으로만), < → ←(거꾸로만). */
const CriterionFields: React.FC<{ criterion: string; tone: CriterionTone }> = ({ criterion, tone }) => {
  const { labels, arrows } = parseCriterionRelation(criterion);
  return (
    <span data-criterion-fields={tone} className="inline-flex flex-wrap items-center gap-1.5">
      {labels.map((label, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span aria-hidden="true" className="text-lg font-black text-slate-500">{arrows[index - 1] === 'back' ? '←' : arrows[index - 1] === 'forward' ? '→' : '↔'}</span>}
          <span className={CRITERION_PILL[tone]}>{label || ' '}</span>
        </React.Fragment>
      ))}
    </span>
  );
};

/** 분류 기준 칩. 지금 쓰이는(마지막) 기준은 크고 진하게, 앞서 쓰다 바뀐 기준(세션 기준 포함)은 흐리게 줄을 긋는다. */
const CriterionChip: React.FC<{ text: string; current?: boolean }> = ({ text, current = true }) => (
  <span data-diagram-criterion-chip={current ? 'current' : 'previous'}>
    <CriterionFields criterion={text} tone={current ? 'scoped' : 'previous'} />
  </span>
);

/**
 * 토글 제목에 쓴 분류 기준 `[ ]`. 세션 노트의 기준을 이 토글 안에서만 바꾼다(형제 토글에는 번지지 않는다).
 * 세션 기준 → 이 토글 기준 순서로 이어 보이고, 마지막이 지금 쓰이는 기준이다.
 */
const ScopedCriterion: React.FC<{ criteria?: string[]; labels?: string[] }> = ({ criteria, labels }) => {
  const own = criteria?.length ? criteria : labels?.length ? [labels.join(':')] : [];
  if (!own.length) return null;
  // 지금 쓰이는(마지막) 기준만 보인다. 앞서 쓰다 바뀐 기준이나 세션 기준에 줄을 그어 옆에 늘어놓지 않는다.
  const chips = [own[own.length - 1]];
  return (
    <div data-diagram-criteria="true" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="rounded-md bg-violet-700 px-2 py-0.5 text-xs font-black text-white">이 토글 안에서만</span>
      <span className="text-base font-black text-slate-900">분류 기준</span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {chips.map((text, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span aria-hidden="true" className="text-sm font-black text-slate-400">→</span>}
            <CriterionChip text={text} current />
          </React.Fragment>
        ))}
      </span>
    </div>
  );
};
const changesCriterion = (item: { criteria?: string[]; labels?: string[] }) => !!(item.criteria?.length || item.labels?.length);

/**
 * 포함관계 토글 제목 `>A:C`: 관계 줄이 아니라 열마다의 "집합" 머리글이다(칸마다 다른 분류 관점).
 * 아래 `B:D` 줄의 B는 A 집합에, D는 C 집합에 각각 구성요소로 들어간다. 예: `>수열:정의` 아래 `등차수열:차가 일정` → 등차수열은 수열에, 차가 일정은 정의에.
 */
const ContainmentHeader: React.FC<{ fields: string[]; arrows: DiagramArrow[]; labels?: string[]; tag?: string }> = ({ fields, arrows, labels, tag }) => (
  <div className="flex items-start gap-2.5">
  {tag && <span data-diagram-group-tag="true" className="mt-1 shrink-0 rounded-md bg-teal-100 px-2 py-0.5 text-xs font-black text-teal-900">{tag}</span>}
  <div data-diagram-row="containment-header" className="grid min-w-0 flex-1 items-start" style={{ gridTemplateColumns: columnsFor(fields.length) }}>
    {fields.map((field, index) => (
      <React.Fragment key={index}>
        {index > 0 && <span className="flex justify-center pt-6"><ArrowIcon kind={arrows[index - 1] ?? 'both'} small /></span>}
        <div data-diagram-heading="집합" data-diagram-viewpoint={labels?.[index] || undefined} className="flex min-w-0 flex-col items-stretch gap-1.5">
          <div className="flex min-w-0 flex-col gap-0.5 border-b-4 border-teal-400 px-1 pb-1.5">
            <span className="text-[19px] font-black leading-snug text-teal-950 [overflow-wrap:anywhere] [word-break:keep-all]">{field ? <LogicText text={field} /> : ' '}</span>
          </div>
        </div>
      </React.Fragment>
    ))}
  </div>
  </div>
);

/** 관계도에서 집합(`[ ]`)과 능력 집합을 읽을 색인과, 지금 그리는 줄이 속한 토글 경로 */
const NoteSetContext = React.createContext<{ index: NoteSetIndex | null; path: readonly string[] }>({ index: null, path: [] });

/** 능력 집합이 걸린 줄 아래에 붙는 작은 버튼. 누르면 분류 기준을 조그맣게 보여 준다. */
const AbilityBadge: React.FC<{ heads: string[]; inside?: string[] }> = ({ heads, inside = [] }) => {
  const { index, path } = React.useContext(NoteSetContext);
  const [open, setOpen] = useState<string | null>(null);
  const found = useMemo(() => {
    if (!index) return [];
    const byKey = new Map<string, { expression: string; criterion: string }>();
    heads.forEach(head => abilitiesFor(index, headCellOf(head), [...path, ...inside]).forEach(ability => byKey.set(`${ability.expression}|${ability.criterion}`, ability)));
    return [...byKey.entries()];
  }, [index, heads.join('\u0001'), path.join('\u0001'), inside.join('\u0001')]);
  if (!found.length) return null;
  return (
    <div data-ability-badges="true" className="flex flex-wrap items-center gap-2 pl-1">
      {found.map(([key, ability]) => (
        <span key={key} className="inline-flex flex-wrap items-center gap-2">
          <button type="button" data-ability-button="true" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-black text-indigo-900 hover:bg-indigo-100">
            능력 · {parseCriterionLabels(ability.criterion).join(' → ')}
          </button>
          {open === key && (
            <span data-ability-criterion="true" className="inline-flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-600">
              <span className="scale-90"><CriterionFields criterion={ability.criterion} tone="scoped" /></span>
              {ability.expression} 안의 데이터
            </span>
          )}
        </span>
      ))}
    </div>
  );
};

/** `[X]` 홀로(집합), `[집합식]:[기준]`(능력 정의), `[개념:정의]`(노트 전체 기준) 줄 */
const SetLineRow: React.FC<{ line: NoteSetLine }> = ({ line }) => {
  const { index } = React.useContext(NoteSetContext);
  const base = 'flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[15px] font-bold text-slate-800';
  if (line.kind === 'criterion') {
    return (
      <div data-diagram-row="note-criterion" className={`${base} border-indigo-200 bg-indigo-50`}>
        <span className="rounded-md bg-indigo-700 px-2 py-0.5 text-xs font-black text-white">노트 전체 기준</span>
        <CriterionFields criterion={line.criterion} tone="session" />
      </div>
    );
  }
  const shown = line.kind === 'define' ? `[${line.mark}]` : line.expression;
  const members = index ? evaluateSetExpression(index, shown) : (line.kind === 'define' ? line.members : []);
  const chips = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {members.length ? members.map(name => <span key={name} className="rounded-md bg-white px-2 py-0.5 text-sm font-black text-slate-900 ring-1 ring-slate-300">{name}</span>)
        : <span className="text-sm font-bold text-slate-500">비어 있어요</span>}
    </span>
  );
  if (line.kind === 'set' || line.kind === 'define') {
    return (
      <div data-diagram-row="set" className={`${base} border-teal-200 bg-teal-50`}>
        <span className="rounded-md bg-teal-700 px-2 py-0.5 text-xs font-black text-white">집합</span>
        <span className="font-mono text-base font-black text-teal-950">{shown}</span>
        <span aria-hidden="true" className="text-slate-500">=</span>
        {chips}
      </div>
    );
  }
  return (
    <div data-diagram-row="ability" className={`${base} border-violet-200 bg-violet-50`}>
      <span className="rounded-md bg-violet-700 px-2 py-0.5 text-xs font-black text-white">능력</span>
      <span className="font-mono text-base font-black text-violet-950">{line.expression}</span>
      <span aria-hidden="true" className="text-slate-500">→</span>
      <CriterionFields criterion={line.criterion} tone="scoped" />
      <span className="basis-full pl-1 text-sm font-bold text-slate-600">{chips}</span>
    </div>
  );
};

/** 토글 안에서 그리는 줄은 그 토글 제목을 경로(속성)에 더한다. */
const GroupPath: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const parent = React.useContext(NoteSetContext);
  const value = useMemo(() => ({ index: parent.index, path: [...parent.path, toggleName(title)] }), [parent, title]);
  return <NoteSetContext.Provider value={value}>{children}</NoteSetContext.Provider>;
};

const DiagramItems: React.FC<{ items: DiagramItem[]; columns: number; connector?: DiagramOperator }> = ({ items, columns, connector }) => (
  <div className="flex flex-col gap-3">
    {items.map((item, index) => (
      <React.Fragment key={index}>
        {index > 0 && connector && <Connector operator={connector} />}
        {item.kind === 'relation' && <><RelationRow fields={item.fields} arrows={item.arrows} columns={columns} atValues={item.atValues} /><AbilityBadge heads={[item.fields[0]]} /></>}
        {item.kind === 'setline' && <SetLineRow line={item.line} />}
        {item.kind === 'fan' && (changesCriterion(item) ? (
          <div data-diagram-scope="true" className="flex flex-col gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 p-3">
            <ScopedCriterion criteria={item.criteria} labels={item.labels} />
            <FanRow left={item.left} arrow={item.arrow} right={item.right} operator={item.operator} columns={columns} />
            <AbilityBadge heads={item.right} inside={[toggleName(item.left)]} />
          </div>
        ) : <><FanRow left={item.left} arrow={item.arrow} right={item.right} operator={item.operator} columns={columns} /><AbilityBadge heads={item.right} inside={[toggleName(item.left)]} /></>)}
        {item.kind === 'plain' && (
          <div data-diagram-row="plain" className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-[17px] font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere] [word-break:keep-all]"><LogicText text={item.text} /></div>
        )}
        {item.kind === 'plain' && <AbilityBadge heads={[item.text]} />}
        {item.kind === 'expanded' && (
          <div data-diagram-row="expanded" className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-amber-200 px-2 py-0.5 text-xs font-black text-amber-900">{item.source.includes('#') ? '틀' : '자리'} · 펼친 줄 {item.lines.length}</span>
              <span className="font-mono text-[15px] font-bold text-slate-800 [overflow-wrap:anywhere]">{item.source}</span>
            </div>
            <DiagramItems items={item.lines} columns={columns} />
          </div>
        )}
        {item.kind === 'group' && (
          <div data-diagram-row="group" data-group-kind={item.relation} data-diagram-scope={changesCriterion(item) ? 'true' : undefined}
            className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${item.relation === 'containment' ? 'border-dashed border-teal-400 bg-teal-50/50' : 'border-slate-300 bg-slate-50'}`}>
            {!item.header && <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-md bg-teal-100 px-2 py-0.5 text-xs font-black text-teal-900">{item.connector ? `${OPERATOR_STYLE[item.connector].label} 묶음` : GROUP_TAG[item.relation]}</span>
              {(item.title || !changesCriterion(item)) && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-base font-black text-slate-900 ring-1 ring-slate-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  {item.title || '묶음'}
                </span>
              )}
            </div>}
            {changesCriterion(item) && (
              <div className="-mx-4 border-y-2 border-indigo-200 bg-indigo-50 px-4 py-2.5">
                <ScopedCriterion criteria={item.criteria} labels={item.labels} />
              </div>
            )}
            {item.header && <ContainmentHeader fields={item.header.fields} arrows={item.header.arrows} labels={item.fieldLabels} tag={item.connector ? `${OPERATOR_STYLE[item.connector].label} 묶음` : GROUP_TAG[item.relation]} />}
            <GroupPath title={item.title}>
              <DiagramItems items={item.items} columns={item.header ? item.header.fields.length : 0} connector={item.connector} />
            </GroupPath>
          </div>
        )}
      </React.Fragment>
    ))}
  </div>
);

/** 세션 노트에 적어 둔 분류 기준. 노트 화면의 분류 기준과 같은 크기로 관계도 맨 앞에 두고, 아래 정리는 이 기준을 칸 위치에 맞추지 않고 내용대로 늘어놓는다. */
const SessionCriterionCard: React.FC<{ criterion: string }> = ({ criterion }) => (
  <aside data-diagram-criterion="session" aria-label="세션 노트 분류 기준"
    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border-2 border-indigo-200 bg-white px-4 py-3 text-lg font-black text-slate-900">
    <span className="rounded-md bg-indigo-700 px-2 py-0.5 text-xs font-black text-white">세션 노트</span>
    분류 기준
    <CriterionFields criterion={criterion} tone="session" />
    <span data-diagram-session-scope-note="true" className="basis-full text-sm font-bold text-slate-600">
      아래 관계도 전체에 적용됩니다. <span className="rounded-md bg-violet-100 px-1.5 text-violet-900">이 토글 안에서만</span> 표시가 붙은 곳은 그 토글의 기준으로 바뀝니다.
    </span>
  </aside>
);

const EmptyDiagram: React.FC = () => (
  <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center text-base font-bold text-slate-600">
    그릴 내용이 아직 없어요. 노트에 <span className="font-mono">:</span> 나 <span className="font-mono">;</span> 로 관계를 적어 보세요.
  </div>
);

export const NoteDiagram: React.FC<{ memo: string; criterion?: string | null }> = ({ memo, criterion }) => {
  const items = useMemo(() => parseNoteDiagram(memo, criterion, generatedLinesOf(memo)), [memo, criterion]);
  const hasSession = !!criterion && parseCriterionRelation(criterion).labels.some(Boolean);
  const setValue = useMemo(() => ({ index: buildNoteSetIndex([memo]), path: [] as readonly string[] }), [memo]);
  if (!items.length) return <EmptyDiagram />;
  return (
    <NoteSetContext.Provider value={setValue}>
    <SessionCriterionContext.Provider value={hasSession ? criterion! : null}>
      <section aria-label="관계도" className="flex flex-col gap-4 py-3">
        {hasSession && <SessionCriterionCard criterion={criterion!} />}
        <div data-diagram-session-scope={hasSession ? 'true' : undefined} className={hasSession ? 'border-l-4 border-indigo-300 pl-3' : undefined}>
          <DiagramItems items={items} columns={0} />
        </div>
      </section>
    </SessionCriterionContext.Provider>
    </NoteSetContext.Provider>
  );
};

const DiagramLegend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-bold text-slate-700">
    <span className="inline-flex items-center gap-2"><ArrowIcon kind="both" small />양방향</span>
    <span className="inline-flex items-center gap-2"><ArrowIcon kind="forward" small />앞으로만 (;)</span>
    <span className="inline-flex items-center gap-2"><ArrowIcon kind="back" small />거꾸로만 (&lt;)</span>
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-4 w-8 rounded border-2 border-dashed border-teal-400 bg-teal-50" />포함 · 상하 묶음
    </span>
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-4 w-1.5 rounded bg-indigo-300" />세션 노트 기준(전체 적용)
    </span>
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="rounded-md bg-violet-200 px-1.5 text-xs font-black text-violet-950">토글</span>이 토글 안에서만 바뀐 기준
    </span>
    <span className="inline-flex items-center gap-2">
      <OperatorChip operator="and" small /><OperatorChip operator="or" small /><OperatorChip operator="sequence" small />
    </span>
  </div>
);

/* ───────── 한 쪽씩 넘겨 보는 종이 ───────── */

/** 창 너비(px). 크게 보기에서 한 번에 펼칠 쪽 수를 정한다 */
const useWindowWidth = () => {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
};

/** 지금 화면 높이에 맞는 줄 수. 한 쪽 높이는 항상 격자 한 칸(28px)의 배수다. */
const useSheetRows = (reserved: number) => {
  const [rows, setRows] = useState(DEFAULT_ROWS);
  useEffect(() => {
    const update = () => setRows(Math.max(8, Math.min(30, Math.floor((window.innerHeight - reserved) / ROW))));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [reserved]);
  return rows;
};

/** 글이 차지하는 높이(contentHeight)가 쪽 높이(pageHeight)로 몇 쪽인지. 글이 아주 조금(2px 이하) 넘치는 것은 새 쪽으로 세지 않는다. */
export const countSheetPages = (contentHeight: number, pageHeight: number) => (
  Math.max(1, Math.ceil((contentHeight - 2) / Math.max(1, pageHeight)))
);

/** 지금 스크롤 위치(scrollTop)에서 보이는 쪽 번호(1부터). 쪽은 항상 쪽 높이의 배수 위치에서 시작한다. */
export const sheetPageAt = (scrollTop: number, pageHeight: number, total: number) => (
  Math.min(total, Math.max(1, Math.round(scrollTop / Math.max(1, pageHeight)) + 1))
);

const PAGER_BUTTON = 'flex h-12 min-w-[132px] items-center justify-center gap-1.5 rounded-xl border-2 px-4 text-[15px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** ◀ 이전 쪽 / n / 전체 쪽 / 다음 쪽 ▶ (노트 종이와 관계도가 함께 쓴다) */
const SheetPager: React.FC<{ page: number; total: number; onPage: (page: number) => void; from?: number }> = ({ page, total, onPage, from }) => (
  <div data-testid="note-pager" className="flex items-center justify-between gap-3">
    <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}
      className={`${PAGER_BUTTON} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>◀ 이전 쪽</button>
    <span className="font-mono text-base font-black tabular-nums text-slate-900" aria-live="polite">{from && from < page ? `${from}~${page}` : page} / {total} 쪽</span>
    <button type="button" onClick={() => onPage(page + 1)} disabled={page >= total}
      className={`${PAGER_BUTTON} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}>다음 쪽 ▶</button>
  </div>
);

export const PagedSheet: React.FC<{
  rows: number;
  grid?: boolean;
  label: string;
  /** 바뀌면 첫 쪽으로 돌아간다 (다른 과목·보기를 열 때) */
  resetKey?: string;
  children: React.ReactNode;
}> = ({ rows, grid = false, label, resetKey, children }) => {
  const scroller = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [pageState, setPageState] = useState({ page: 1, total: 1 });
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const height = element.clientHeight || 1;
    // 쪽 수는 "글이 차지하는 높이"로 센다. 종이(아래 minHeight)는 쪽 높이의 배수로 채워 두므로
    // 마지막 쪽까지 정확히 넘어가고, 화면에 보이는 "n / 전체"와 실제로 넘어갈 수 있는 쪽이 같다.
    const content = inner.current ? inner.current.offsetHeight : element.scrollHeight;
    const total = countSheetPages(content, height);
    const page = sheetPageAt(element.scrollTop, height, total);
    setPageState(previous => (previous.page === page && previous.total === total ? previous : { page, total }));
  }, []);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    measure();
  }, [resetKey, measure]);
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (scroller.current) observer.observe(scroller.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [measure, rows]);
  const goTo = (page: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = (Math.min(Math.max(1, page), pageState.total) - 1) * element.clientHeight;
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: 'smooth' });
    else element.scrollTop = top;
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div ref={scroller} role="region" aria-label={label} tabIndex={-1} onScroll={measure}
        className="overflow-y-auto overscroll-contain"
        style={{ height: rows * ROW, scrollSnapType: 'y proximity', ...(grid ? {
          backgroundColor: '#FFFFFF',
          backgroundImage: 'linear-gradient(#E1E6F7 1px, transparent 1px), linear-gradient(90deg, #E1E6F7 1px, transparent 1px)',
          backgroundSize: `${ROW}px ${ROW}px`,
          backgroundAttachment: 'local'
        } : { backgroundColor: '#FFFFFF' }) }}>
        <div className="relative" style={{ minHeight: pageState.total * rows * ROW }}>
          {Array.from({ length: pageState.total }, (_, index) => (
            <span key={index} aria-hidden="true" data-page-start={index + 1} className="pointer-events-none absolute left-0 w-px"
              style={{ top: index * rows * ROW, height: rows * ROW, scrollSnapAlign: 'start' }} />
          ))}
          <div ref={inner} className="px-3">{children}</div>
        </div>
      </div>
      <SheetPager page={pageState.page} total={pageState.total} onPage={goTo} />
    </div>
  );
};

/* ───────── 구역(단위·하루)을 쪽당 행 수에 맞춰 담은 쪽 ───────── */

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-10-18" → "10월 18일 (일)" */
const dayLabel = (day?: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  if (!match) return day ?? '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${Number(match[2])}월 ${Number(match[3])}일 (${WEEKDAY_NAMES[date.getDay()]})`;
};

/**
 * 구역 제목 한 행. 페이지 단위가 있으면 "3번째 단위"를 조금 큰 글씨로(옆에 p.21~30), 단위가 없으면 날짜를 조금 크고 간단하게.
 * 한 쪽보다 긴 구역이 다음 쪽으로 이어지면 "이어서"가 붙는다. 노트와 관계도가 같은 제목을 쓴다.
 */
const SectionHeading: React.FC<{ section: NoteSheetSection }> = ({ section }) => (
  <div data-note-heading={section.kind} className="flex h-7 items-center gap-2 whitespace-nowrap">
    {section.kind === 'unit' ? (
      <>
        <span data-note-unit-number={(section.index ?? 0) + 1} className="text-xl font-black text-indigo-900">{(section.index ?? 0) + 1}번째 단위</span>
        <span className="font-mono text-sm font-bold text-slate-500">p.{section.start}~{section.end}</span>
      </>
    ) : (
      <span data-note-day-heading={section.day} className="text-xl font-black text-indigo-900">{dayLabel(section.day)}</span>
    )}
    {section.continued && <span data-note-continued="true" className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900">이어서</span>}
  </div>
);

/** 한 쪽의 종이: 쪽당 행 수(rows)만큼의 높이. 기록 하나가 그보다 길면 이 안에서만 스크롤된다. */
const NotePaper: React.FC<{ rows: number; children: React.ReactNode }> = ({ rows, children }) => (
  <div role="region" aria-label="정리노트 종이" tabIndex={-1} className="overflow-y-auto overscroll-contain"
    style={{
      height: rows * ROW, backgroundColor: '#FFFFFF',
      backgroundImage: 'linear-gradient(#E1E6F7 1px, transparent 1px), linear-gradient(90deg, #E1E6F7 1px, transparent 1px)',
      backgroundSize: `${ROW}px ${ROW}px`, backgroundAttachment: 'local'
    }}>
    <div className="px-3">{children}</div>
  </div>
);

/**
 * 한 쪽의 관계도. 세션 분류 기준은 맨 위에 한 번, 그 아래에 이 쪽의 구역마다 제목과 관계도를 그린다.
 * 관계도가 화면보다 길면 그 쪽 안에서만 스크롤된다(분류 기준은 그대로 위에 남는다).
 */
export const NoteSheetDiagram: React.FC<{ page: NoteSheetPage; criterion?: string | null; rows: number; onFlip?: (delta: number) => void; setMemos?: readonly string[] }> = ({ page, criterion, rows, onFlip, setMemos }) => {
  const parsed = useMemo(
    () => page.sections.map(section => { const merged = mergeNoteTexts(section.entries.map(entry => entry.log)); return { section, items: parseNoteDiagram(merged, criterion, generatedLinesOf(merged)) }; }),
    [page, criterion]
  );
  const touch = useRef<{ x: number; y: number } | null>(null);
  const hasCriterion = !!criterion && parseCriterionRelation(criterion).labels.some(Boolean);
  const setKey = (setMemos ?? []).join('\u0000');
  const setValue = useMemo(() => ({ index: setMemos && setMemos.length ? buildNoteSetIndex(setMemos) : null, path: [] as readonly string[] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setKey]);
  if (!parsed.some(item => item.items.length) && !hasCriterion) return <EmptyDiagram />;
  return (
    <NoteSetContext.Provider value={setValue}>
    <SessionCriterionContext.Provider value={hasCriterion ? criterion! : null}>
    <div className="flex flex-col gap-3 overflow-hidden px-3 py-3" style={{ height: rows * ROW }}>
      {hasCriterion && <SessionCriterionCard criterion={criterion!} />}
      <div role="region" aria-label="관계도 종이" tabIndex={0}
        onKeyDown={event => {
          if (!onFlip) return;
          if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); onFlip(1); }
          else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); onFlip(-1); }
        }}
        onTouchStart={event => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }}
        onTouchEnd={event => {
          const start = touch.current; const point = event.changedTouches[0];
          touch.current = null;
          if (!start || !point || !onFlip) return;
          const dx = point.clientX - start.x; const dy = point.clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dy) < 50) onFlip(dx < 0 ? 1 : -1);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none">
        <div data-diagram-session-scope={hasCriterion ? 'true' : undefined} className={hasCriterion ? 'border-l-4 border-indigo-300 pl-3' : undefined}>
          {parsed.map(({ section, items }, index) => (
            <section key={`${section.key}:${index}`} aria-label="관계도" data-diagram-section={section.key} className={index > 0 ? 'mt-5' : ''}>
              <SectionHeading section={section} />
              <div className="mt-2">
                {items.length ? <DiagramItems items={items} columns={0} /> : <p className="text-sm font-bold text-slate-500">그릴 내용이 아직 없어요</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
    </SessionCriterionContext.Provider>
    </NoteSetContext.Provider>
  );
};

/* ───────── 탭 ───────── */

interface SubjectNotes { id: string; name: string; logs: StudyLog[]; latest: string }

/** 노트가 있는 기록을 과목별로 묶고, 과목 안에서는 최신 기록이 먼저 오게 한다. */
export const groupNotesBySubject = (logs: StudyLog[], subjects: Subject[], keepIds: ReadonlySet<string> = new Set()): SubjectNotes[] => {
  const bySubject = new Map<string, StudyLog[]>();
  logs.filter(log => (log.reviewMemo ?? '').trim().length > 0 || keepIds.has(log.id))
    .forEach(log => bySubject.set(log.subjectId, [...(bySubject.get(log.subjectId) || []), log]));
  const time = (log: StudyLog) => { const value = Date.parse(log.timestamp); return Number.isFinite(value) ? value : 0; };
  return Array.from(bySubject.entries()).map(([id, items]) => {
    const sorted = [...items].sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id));
    return {
      id,
      name: subjects.find(subject => subject.id === id)?.name || sorted.find(log => log.subjectNameSnapshot)?.subjectNameSnapshot || '삭제된 과목',
      logs: sorted,
      latest: sorted[0].timestamp
    };
  }).sort((a, b) => time(b.logs[0]) - time(a.logs[0]) || a.name.localeCompare(b.name, 'ko'));
};

/** 기록 사이를 한 줄 비우고 이어 붙인 글. 관계도를 그릴 때 쓴다. */
export const mergeNoteTexts = (logs: StudyLog[]) => logs.map(log => (log.reviewMemo ?? '').trim()).filter(Boolean).join('\n\n');

export const NoteTab: React.FC<{
  logs: StudyLog[];
  subjects: Subject[];
  onUpdateReviewMemo: (logId: string, memo: string, document?: ReviewMemoDocument) => void;
  /** 복습에서 뺀 문제를 되돌린다(주지 않으면 되돌리기 버튼이 없다) */
  onRestoreReviewQuestion?: (logId: string, questionKey: string) => void;
  /** 처음 열 때 보여줄 과목. 노트가 없는 과목이면 가장 최근 노트가 있는 과목으로 열린다. */
  initialSubjectId?: string;
  /** true면 initialSubjectId 과목만 보여준다(과목 고르는 칸이 없고, 노트가 없으면 빈 안내). 과목 안의 정리노트 버튼에서 쓴다. */
  lockSubject?: boolean;
  /** 노트 종이 높이를 계산할 때 화면 위·아래에서 이미 쓰이고 있는 높이(px)를 기본값보다 줄이거나 늘린다. */
  reservedOffset?: number;
  /** 크게 보기: 화면 너비만큼 여러 쪽을 나란히 보인다 */
  wide?: boolean;
  /** "복습에 넣지 않기": 고쳐서 복습에 들어간 문제를 뺀다(주지 않으면 버튼이 없다) */
  onSkipEditIntake?: (logIds: string[]) => void;
}> = ({ logs, subjects, onUpdateReviewMemo, onRestoreReviewQuestion, initialSubjectId = '', lockSubject = false, reservedOffset = 0, wide = false, onSkipEditIntake }) => {
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [view, setView] = useState<NoteView>('note');
  const [showTutorial, setShowTutorial] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  // 편집하다가 노트를 모두 지워도 그 칸이 사라지지 않게, 이 화면에서 고친 기록은 비어 있어도 둔다.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const symbolTarget = useRef<SymbolTarget['current']>(null) as SymbolTarget;

  const groups = useMemo(() => groupNotesBySubject(logs, subjects, touched), [logs, subjects, touched]);
  const current = lockSubject ? groups.find(group => group.id === initialSubjectId) : groups.find(group => group.id === subjectId) ?? groups[0];
  const lockedName = subjects.find(subject => subject.id === initialSubjectId)?.name ?? '';
  // 이 과목의 `=`·`-` 단축어 설정으로 노트를 읽는다(서랍을 닫으면 뒤 화면의 과목으로 돌아간다)
  useSubjectNoteShorthand(current?.id ?? (lockSubject ? initialSubjectId : null));
  const criterion = useMemo(() => {
    if (!current) return null;
    try { return createSessionMemoRecord(readSessionMemos()[current.id] ?? '').classificationCriterion; }
    catch { return null; }
  }, [current?.id]);
  // 구역(과목의 페이지 단위마다, 단위가 없으면 하루마다)을 쪽당 행 수에 맞춰 쪽에 담는다. 노트와 관계도가 같은 쪽을 본다.
  // 편집하는 동안 글이 늘어도 쪽이 바뀌지 않게, 기록의 행 수는 이 화면에서 처음 본 값을 계속 쓴다(보기를 바꾸면 다시 센다).
  const subjectMemos = useMemo(() => (current ? [...current.logs].reverse().map(log => log.reviewMemo ?? '').filter(Boolean) : []), [current]);
  // `[집합]()` 창에서 값을 고치면: 이 과목의 모든 노트 글에 같은 고침을 적용한다. 바뀐 노트가 있으면 되돌리는 함수를 돌려준다.
  const rewriteSubjectNotes = useMemo<NoteSetRewriter | null>(() => {
    if (!current) return null;
    return rewrite => {
      const changes = current.logs
        .map(log => ({ id: log.id, before: log.reviewMemo ?? '', after: rewrite(log.reviewMemo ?? '') }))
        .filter(change => change.after !== change.before);
      if (!changes.length) return null;
      setTouched(previous => new Set([...previous, ...changes.map(change => change.id)]));
      changes.forEach(change => onUpdateReviewMemo(change.id, change.after));
      return () => changes.forEach(change => onUpdateReviewMemo(change.id, change.before));
    };
  }, [current, onUpdateReviewMemo]);
  const currentSubject = current ? subjects.find(subject => subject.id === current.id) : undefined;
  const unitSize = currentSubject ? getGrowthUnitSize(currentSubject.growthPageUnit) : 0;
  const rowCache = useRef(new Map<string, number>());
  const [layoutTick, setLayoutTick] = useState(0);
  const repaginate = () => { rowCache.current.clear(); setLayoutTick(tick => tick + 1); };
  const rowsOf = useCallback((log: StudyLog) => {
    const known = rowCache.current.get(log.id);
    if (known !== undefined) return known;
    const rowsOfLog = estimateMemoRows(log.reviewMemo);
    rowCache.current.set(log.id, rowsOfLog);
    return rowsOfLog;
  }, []);
  const pages = useMemo(
    () => (current ? paginateNoteSections(groupLogsByPageUnit(current.logs, unitSize, currentSubject?.startPage ?? 1, current.id), NOTE_PAGE_ROWS, rowsOf) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, unitSize, currentSubject?.startPage, rowsOf, layoutTick]
  );
  const [pageKey, setPageKey] = useState<string | null>(null);
  const foundPage = pages.findIndex(item => item.key === pageKey);
  // 노트를 열거나 과목을 바꾸면 맨 뒤 쪽(가장 최근)에서 시작한다
  const pageHint = useRef(0);
  const pageIndex = foundPage >= 0 ? foundPage : pageKey === null ? lastPageIndex(pages) : Math.min(pageHint.current, lastPageIndex(pages));
  const page = pages[pageIndex];
  // 크게 보기(wide)면 화면 너비에 맞춰 여러 쪽을 한 번에 보인다(쪽 하나에 520px쯤, 최대 4쪽). 지금 쪽이 끝에 오도록 앞쪽부터 채운다.
  const spreadWidth = useWindowWidth();
  const spread = wide && view === 'note' ? Math.max(1, Math.min(4, Math.floor((spreadWidth - 80) / 520))) : 1;
  const spreadStart = Math.max(0, Math.min(pageIndex - spread + 1, pages.length - spread));
  const spreadPages = spread > 1
    ? pages.slice(spreadStart, spreadStart + spread).map((item, offset) => ({ page: item as typeof page | undefined, index: spreadStart + offset }))
    : [{ page, index: pageIndex }];
  const goPage = (target: number) => {
    const next = pages[Math.min(Math.max(0, target), pages.length - 1)];
    if (!next) return;
    // 쪽을 넘길 때 그동안 고친 글의 길이를 반영해 쪽을 다시 나눈다(글을 쓰는 동안에는 쪽이 흔들리지 않게 고정)
    pageHint.current = Math.min(Math.max(0, target), pages.length - 1);
    setPageKey(next.key);
    repaginate();
  };
  // 노트 종이는 쪽당 행 수 그대로(화면이 아주 낮으면 그만큼만), 관계도는 화면 높이에 맞추고 아래에 쪽 넘김 줄이 있다
  const rows = useSheetRows((view === 'note' ? 440 : 460) + reservedOffset + (view === 'note' && criterion ? 29 : 0));

  const segment = (target: NoteView, label: string, icon: React.ReactNode) => (
    <button type="button" aria-pressed={view === target} onClick={() => { if (view !== target) repaginate(); setView(target); }}
      className={`flex h-12 items-center gap-2 rounded-[9px] px-5 text-[15px] font-bold transition-colors ${view === target ? 'bg-white text-[#2B2480] shadow-[0_1px_3px_rgba(21,26,45,0.18)]' : 'text-slate-600 hover:text-slate-900'}`}>
      {icon}{label}
    </button>
  );

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <p className="text-lg font-black text-slate-900">{lockSubject && lockedName ? `${lockedName}에는 아직 정리노트가 없어요` : '아직 정리노트가 없어요'}</p>
        <p className="mt-2 text-base font-semibold text-slate-600">학습 실행에서 막힌 부분을 정리하면 여기에 모여요.</p>
      </div>
    );
  }

  return (
    <div className={`mx-auto flex flex-col gap-3.5 ${wide ? 'max-w-none' : 'max-w-5xl'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {lockSubject ? (
            <h3 className="min-w-0 truncate text-[17px] font-black text-slate-900">{current.name} · {current.logs.length}개</h3>
          ) : (
            <select aria-label="과목 선택" value={current.id} onChange={event => { setPageKey(null); repaginate(); setSubjectId(event.target.value); }}
              className="h-14 min-w-0 max-w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-[17px] font-black text-slate-900 outline-none focus:border-indigo-600">
              {groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.logs.length}개</option>)}
            </select>
          )}
          <span className="text-sm font-bold text-slate-600">최근 {dateLabel(current.latest)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3.5 py-1.5 text-sm font-black text-green-900">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            자동 저장됨
          </span>
          <button type="button" onClick={() => setShowPractice(true)} data-testid="note-practice-open"
            className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 text-[15px] font-black text-amber-900 hover:bg-amber-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></svg>
            문제 풀기
          </button>
          <div role="group" aria-label="보기 방식" className="flex gap-1 rounded-xl bg-[#E7EAF8] p-1">
            {segment('note', '노트', <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16z" /><path d="M13 7l4 4" /></svg>)}
            {segment('map', '관계도', <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="4" width="7" height="6" rx="1.5" /><rect x="3" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><path d="M10 7h4M10 17h4" /></svg>)}
          </div>
        </div>
      </div>

      {view === 'note' ? (
        <section aria-label="노트 편집기" className="flex flex-col gap-3">
          <EditIntakeBar logs={current.logs} onSkip={onSkipEditIntake} />
          <SymbolTargetContext.Provider value={symbolTarget}>
           <NoteSetSourceContext.Provider value={subjectMemos}>
            <NoteSetEditContext.Provider value={rewriteSubjectNotes}>
            <div className="overflow-hidden rounded-xl border border-rose-100 bg-white">
              <NoteSymbolBar onInsert={symbol => symbolTarget.current?.(symbol)} />
              {criterion && (
                <p data-note-criterion="true" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rose-100 bg-white px-4 py-3 text-lg font-black text-slate-900">
                  <span className="rounded-md bg-indigo-700 px-2 py-0.5 text-xs font-black text-white">세션 노트</span>
                  분류 기준
                  <CriterionFields criterion={criterion} tone="session" />
                </p>
              )}
              <div className="p-2.5 pb-0">
                {/* 크게 보기에서는 여러 쪽을 나란히 펼쳐 본다(왼쪽이 앞 쪽) */}
                <div className={spread > 1 ? 'grid gap-2.5' : ''} style={spread > 1 ? { gridTemplateColumns: `repeat(${spreadPages.length}, minmax(0, 1fr))` } : undefined}>
                {spreadPages.map(({ page: shownPage, index: shownIndex }) => (
                <div key={shownPage?.key ?? shownIndex} data-note-page={shownIndex + 1} className="min-w-0">
                {spread > 1 && <p className="mb-1 text-center font-mono text-xs font-black text-slate-500">{shownIndex + 1}쪽</p>}
                <NotePaper rows={Math.min(NOTE_PAGE_ROWS, rows)}>
                  {(shownPage?.sections ?? []).map((section, sectionIndex) => (
                    <section key={`${section.key}:${sectionIndex}`} data-note-section={section.key}>
                      {sectionIndex > 0 && <div aria-hidden="true" className="h-7" />}
                      <SectionHeading section={section} />
                      {section.entries.map(({ log, spanning }, index) => (
                        <React.Fragment key={log.id}>
                          {index > 0 && <div aria-hidden="true" className="h-7" />}
                          {spanning && (
                            <div className="flex h-7 items-center gap-2">
                              <span data-unit-spanning-log="true" className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900">앞 단위에서 이어짐 · p.{log.startPage}~{log.endPage}</span>
                            </div>
                          )}
                          <ReviewMemoEditor flat grid minHeight={ROW} colorColons theme="light"
                            value={log.reviewMemo ?? ''} document={log.reviewMemoDocument}
                            placeholder={sectionIndex === 0 && index === 0 ? '정리노트' : ''}
                            onChange={(memo, document) => {
                              setTouched(previous => (previous.has(log.id) ? previous : new Set(previous).add(log.id)));
                              onUpdateReviewMemo(log.id, memo, document);
                            }} />
                        </React.Fragment>
                      ))}
                    </section>
                  ))}
                </NotePaper>
                </div>
                ))}
                </div>
              </div>
              <div className="px-2.5 pb-2.5 pt-2.5">
                <SheetPager page={pageIndex + 1} from={spread > 1 ? spreadStart + 1 : undefined} total={Math.max(1, pages.length)} onPage={target => goPage(target - 1)} />
              </div>
            </div>
            </NoteSetEditContext.Provider>
           </NoteSetSourceContext.Provider>
          </SymbolTargetContext.Provider>
          <div>
            <button type="button" onClick={() => setShowTutorial(true)}
              className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-indigo-200 bg-white px-4 text-[15px] font-black text-indigo-800 hover:bg-indigo-50">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></svg>
              쓰는 법 보기
            </button>
          </div>
          <NoteMergeHistory logs={current.logs} onRestore={(logId, memo) => {
            setTouched(previous => (previous.has(logId) ? previous : new Set(previous).add(logId)));
            onUpdateReviewMemo(logId, memo);
          }} />
          <ReviewRemovedList logs={current.logs} onRestore={onRestoreReviewQuestion} />
        </section>
      ) : (
        <>
          <DiagramLegend />
          <div className="rounded-xl border border-slate-200 bg-white p-2.5">
            {page ? <NoteSheetDiagram page={page} criterion={criterion} rows={rows} onFlip={delta => goPage(pageIndex + delta)} setMemos={subjectMemos} /> : <EmptyDiagram />}
          </div>
          <SheetPager page={pageIndex + 1} total={Math.max(1, pages.length)} onPage={target => goPage(target - 1)} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-600">노트를 고치면 관계도도 같이 바뀌어요</span>
            <button type="button" onClick={() => setView('note')}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-[15px] font-black text-white shadow-[0_3px_0_#3730A3] hover:bg-indigo-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16z" /><path d="M13 7l4 4" /></svg>
              노트에서 고치기
            </button>
          </div>
        </>
      )}
      {showTutorial && <NoteTutorial onClose={() => setShowTutorial(false)} />}
      {showPractice && (
        <NotePracticeDialog subjectId={current.id} subjectName={current.name} criterion={criterion} onClose={() => setShowPractice(false)}
          units={groupLogsByPageUnit(current.logs, unitSize, currentSubject?.startPage ?? 1, current.id)}
          defaultUnitKey={page?.sections[0]?.key} />
      )}
    </div>
  );
};
