import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeNotePunctuation } from '../utils/notePunctuation';
import { ReviewMemoBlock, serializeReviewMemoBlocks } from '../utils/reviewMemo';
import type { ReviewMemoDocument } from '../types';
import { canMoveReviewMemoNode, getReviewMemoChildren, getReviewMemoSubdocument, moveReviewMemoNode, newReviewMemoNodeId, resolveReviewMemoDocument, reviewMemoDocumentToText, withReviewMemoLogicalOperators } from '../utils/reviewMemoDocument';
import { MemoColorTextarea } from './MemoColorTextarea';
import { getReviewMemoDoubleSpaceEdit } from '../utils/reviewMemoInput';
import { getReviewFieldOverrides } from '../utils/reviewFieldOverride';
import { getToggleChildOffset } from '../utils/reviewQuestions';
import { NoteSymbolBar } from './NoteSymbolBar';
import { bracketDetail, bracketSuggestions, buildNoteSetIndex, cellLocationSuggestions, headCellAtCaret, setContents, setMembersTrigger, toggleName } from '../utils/noteSets';
import type { SetMemberRow } from '../utils/noteSets';
import type { BracketSuggestion } from '../utils/noteSets';
import { caretPositionIn } from '../utils/caretPosition';
import { rewriteSetMember } from '../utils/noteSetEdit';
import { NoteEnclosingContext, displayCaretOf, ghostViewOf, readField, setGhostView, useNoteGhostLabels } from './noteGhostField';
import { GHOST_MARK, displayOffset, ghostEndingAt, insertGhosts, normalizeSelection, stripGhosts, storedOffset } from '../utils/noteGhost';

interface Props {
  value: string;
  onChange: (value: string, document: ReviewMemoDocument) => void;
  document?: ReviewMemoDocument;
  placeholder?: string;
  theme?: 'light' | 'dark';
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  nested?: boolean;
  onExit?: () => void;
  /** 안쪽(토글) 편집기에서 맨 앞 칸 앞으로 백스페이스를 눌렀을 때: 바깥 토글의 제목 끝으로 커서를 올려 보낸다 */
  onBack?: () => void;
  colorColons?: boolean;
  fieldOverrides?: ReadonlyMap<number, string>;
  /** 이 에디터의 줄이 시작하는 칸 번호(끝이 열린 토글 제목 안에서는 제목 칸 수만큼 뒤) */
  fieldBase?: number;
  /** 모눈종이 배경. 글줄(28px)과 격자 간격을 맞춘다. */
  grid?: boolean;
  /** 편집창 아래에 기호 입력 막대(: ; , = - ( ) / >)를 붙인다. 가장 바깥 편집기에서만 쓴다. */
  symbolBar?: boolean;
  /** 테두리·배경·안쪽 여백 없이 글줄만 그린다. 바깥 칸이 격자를 대신 그릴 때(여러 노트를 이어 붙일 때) 쓴다. */
  flat?: boolean;
}

/** 마지막으로 글을 쓰던 입력칸에 기호를 넣는 함수. 안쪽(토글) 편집기도 같은 곳에 등록한다. */
export type SymbolTarget = { current: ((symbol: string) => void) | null };
export const SymbolTargetContext = createContext<SymbolTarget | null>(null);

/**
 * `[ ]` 안에서 추천할 집합 이름을 찾는 데 쓰는 같은 과목의 노트 글들. 없으면 지금 편집하는 글만 본다.
 * 글이 바뀔 때마다 훑지 않도록, 추천이 필요할 때(`[` 안에 커서가 있을 때)만 읽는다.
 */
export const NoteSetSourceContext = createContext<readonly string[] | null>(null);

/**
 * `[집합]()` 창에서 고치거나 지운 값을, 같은 과목의 모든 노트 글에 같은 고침으로 적용해 저장하는 함수(화면이 준다).
 * 바뀐 노트가 있으면 되돌리는 함수를 돌려주고, 바뀐 것이 없으면 null. 제공하지 않는 화면에서는 창이 보기 전용이다.
 */
export type NoteSetRewriter = (rewrite: (memo: string) => string) => (() => void) | null;
export const NoteSetEditContext = createContext<NoteSetRewriter | null>(null);

/** 추천 목록은 코드 편집기처럼 세로로 쌓고, 한 번에 이만큼만 보이며 나머지는 목록 안에서 스크롤한다 */
const SUGGESTION_VISIBLE_ROWS = 5;
const SUGGESTION_ROW = 32;
const SUGGESTION_PADDING = 8;
const SUGGESTION_MAX_HEIGHT = SUGGESTION_VISIBLE_ROWS * SUGGESTION_ROW + SUGGESTION_PADDING;
/** 집합 요소 보기 창: 한 줄 높이와 가장 큰 높이(넘으면 안에서 스크롤) */
const MEMBERS_ROW = 34;
const MEMBERS_MAX_HEIGHT = 330;

interface SetSuggestion {
  blockId: string; part: 'text' | 'title'; items: BracketSuggestion[];
  /** `bracket`: `[ ]` 안에서 뜬 추천 · `cell`: 노트 셀을 쓰면 뜨는 위치 추천(탭하면 셀 앞에 `[위치]`가 붙는다) */
  kind: 'bracket' | 'cell';
  /** 고른 줄(탭을 누르면 이 줄이 들어간다) */
  active: number;
  /** 커서 바로 아래(화면 좌표): 종이가 잘라내지 않도록 문서 맨 위에 그린다 */
  x: number; y: number;
}

interface ToggleDrag {
  source: string | null;
  target: string | null;
  canDrop: (id: string) => boolean;
  start: (id: string) => void;
  hover: (id: string | null) => void;
  drop: (id: string) => void;
  finish: () => void;
}
const ToggleDragContext = createContext<ToggleDrag | null>(null);
const TOGGLE_DRAG_TYPE = 'application/x-studywise-toggle';
type Block = ReviewMemoBlock & { id: string; childDocument?: ReviewMemoDocument };
const makeBlock = (block: ReviewMemoBlock): Block => ({ ...block, id: newReviewMemoNodeId() });
const readBlocks = (value: string, stored?: ReviewMemoDocument): Block[] => {
  const document = resolveReviewMemoDocument(value, stored);
  const blocks: Block[] = getReviewMemoChildren(document).map(node => node.type === 'text'
    ? { id: node.id, type: 'text', text: node.text }
    : { id: node.id, type: 'toggle', title: node.text, text: reviewMemoDocumentToText(document, node.id), childDocument: getReviewMemoSubdocument(document, node.id) });
  return blocks.length ? blocks : [makeBlock({ type: 'text', text: '' })];
};
const blocksToDocument = (blocks: Block[]): ReviewMemoDocument => withReviewMemoLogicalOperators({
  version: 1,
  nodes: blocks.flatMap((block, order) => {
    const node = { id: block.id, parentId: null, type: block.type, text: block.type === 'toggle' ? block.title : block.text, order };
    if (block.type === 'text') return [node];
    const children = resolveReviewMemoDocument(block.text, block.childDocument);
    return [node, ...children.nodes.map(child => ({ ...child, parentId: child.parentId ?? block.id }))];
  })
});
const NOTE_GRID_CELL = 28;
const NOTE_GRID_STYLE: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  backgroundImage: 'linear-gradient(#E1E6F7 1px, transparent 1px), linear-gradient(90deg, #E1E6F7 1px, transparent 1px)',
  backgroundSize: `${NOTE_GRID_CELL}px ${NOTE_GRID_CELL}px`,
  backgroundAttachment: 'local'
};
/** `[집합]()` 창의 값 한 줄: 글을 고치거나 모두 지우고 Enter(또는 다른 곳을 누르면) 노트에 적용된다 */
const MemberInput: React.FC<{ name: string; dark: boolean; onCommit: (next: string) => void; onMove: (delta: number) => void; onEscape: () => void }> = ({ name, dark, onCommit, onMove, onEscape }) => {
  const [draft, setDraft] = useState(name);
  const changed = draft.trim() !== name.trim();
  return <input data-set-member-input="true" value={draft} spellCheck={false} aria-label={`${name} 고치기`}
    onChange={event => setDraft(normalizeNotePunctuation(event.target.value))}
    onBlur={() => { if (changed) onCommit(draft); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (changed) onCommit(draft); else onMove(1); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); onMove(event.key === 'ArrowDown' ? 1 : -1); }
    }}
    className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[15px] font-bold outline-none focus:ring-2 ${dark ? 'text-slate-100 focus:bg-slate-700 focus:ring-indigo-400' : 'text-slate-900 focus:bg-teal-50 focus:ring-teal-400'}`} />;
};

const GrowingTextarea = ({ value, inputRef, colorColons, dark, fieldOverrides, fieldBase = 0, minLine = 32, ghostText = false, onUnfold, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: (element: HTMLTextAreaElement | null) => void;
  colorColons: boolean;
  dark: boolean;
  fieldOverrides?: ReadonlyMap<number, string>;
  fieldBase?: number;
  minLine?: number;
  /** 줄 맨 앞에 위치 `[..B]`를 글자처럼 끼워 보인다(저장하지 않음). 노트 글 칸에서만 켠다. */
  ghostText?: boolean;
  /** 끼운 위치 바로 뒤에서 백스페이스를 눌렀을 때: 그 줄(0부터)에 펼친 전체 위치를 실제 글자로 넣는다 */
  onUnfold?: (line: number, full: string) => void;
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setSource = useContext(NoteSetSourceContext);
  const enclosing = useContext(NoteEnclosingContext);
  const text = String(value ?? '');
  const computed = useNoteGhostLabels(text, setSource, enclosing, ghostText);
  // 한글 조합 중에는 끼운 글을 바꾸지 않는다(조합 도중 입력칸 글을 바꾸면 조합이 끊긴다): 조합이 끝나면 그때 새로 계산한다
  const composing = useRef(false);
  const frozen = useRef(computed);
  if (!composing.current) frozen.current = computed;
  const labels = frozen.current;
  const expected = useMemo(() => new Map(labels.map(item => [item.line, item.label])), [labels]);
  const display = useMemo(() => insertGhosts(text, labels), [text, labels]);
  const [, refresh] = useState(0);
  // 입력칸 글이 바뀔 때(끼운 위치가 달라질 때 포함) 커서는 저장하는 글 기준 같은 자리에 둔다: 바뀌기 전 입력칸에서 읽어 둔다
  const carry = useRef<{ start: number; end: number } | null>(null);
  const element = ref.current;
  if (element && element.ownerDocument.activeElement === element && element.value !== display) {
    const view = ghostViewOf(element);
    carry.current = { start: storedOffset(element.value, element.selectionStart, view?.expected), end: storedOffset(element.value, element.selectionEnd, view?.expected) };
  }
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${Math.max(minLine, field.scrollHeight)}px`;
    setGhostView(field, { expected, labels });
  }, [display]);
  // 입력칸 글이 다시 쓰이면 브라우저가 커서를 맨 끝으로 보내므로 읽어 둔 자리로 되돌린다(조합 중에는 글을 다시 쓰지 않는다)
  useLayoutEffect(() => {
    const saved = carry.current;
    carry.current = null;
    const field = ref.current;
    if (!saved || !field || field.ownerDocument.activeElement !== field || field.value !== display) return;
    const start = displayOffset(display, saved.start, expected);
    const end = displayOffset(display, saved.end, expected);
    if (field.selectionStart !== start || field.selectionEnd !== end) field.setSelectionRange(start, end);
  });
  // 커서가 끼운 글을 반쯤 걸치지 않게 한다(끼운 글 안쪽은 글자 자리가 아니다)
  const settle = (field: HTMLTextAreaElement) => {
    if (composing.current) return;
    const view = ghostViewOf(field);
    if (!view) return;
    const fixed = normalizeSelection(field.value, field.selectionStart, field.selectionEnd, view.expected);
    if (fixed) field.setSelectionRange(fixed.start, fixed.end, field.selectionDirection ?? undefined);
  };
  const ghostKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!labels.length || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    const field = event.currentTarget;
    const view = ghostViewOf(field);
    if (!view) return false;
    const start = field.selectionStart;
    const collapsed = start === field.selectionEnd;
    const span = collapsed ? ghostEndingAt(field.value, start, view.expected) : null;
    if (!span) return false;
    // 끼운 위치 바로 뒤에서 백스페이스: 생략된 전체 위치가 글자로 다시 나온다. 그 뒤로는 다른 글처럼 지워진다.
    if (event.key === 'Backspace' && !event.shiftKey && !event.metaKey) {
      const item = labels.find(label => label.line === span.line);
      if (!item || !onUnfold) return false;
      event.preventDefault();
      onUnfold(span.line, item.full);
      return true;
    }
    // 끼운 위치 바로 뒤에서 왼쪽: 끼운 글 안으로 들어가지 않고 앞 줄 끝으로 간다
    if (event.key === 'ArrowLeft' && !event.metaKey) {
      event.preventDefault();
      if (span.start === 0) return true;
      if (event.shiftKey) field.setSelectionRange(span.start - 1, span.end, 'backward');
      else field.setSelectionRange(span.start - 1, span.start - 1);
      return true;
    }
    return false;
  };
  const ghostClipboard = (event: React.ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    const field = event.currentTarget;
    const view = ghostViewOf(field);
    if (!view) return;
    const picked = field.value.slice(field.selectionStart, field.selectionEnd);
    if (!picked.includes(GHOST_MARK)) return;
    // 복사·잘라내기에는 끼운 위치를 빼고 쓴 글만 담는다
    event.preventDefault();
    event.clipboardData.setData('text/plain', stripGhosts(picked));
    if (cut) field.ownerDocument.execCommand('delete');
  };
  return <MemoColorTextarea {...props} rows={1} value={display} colorColons={colorColons} dark={dark} fieldOverrides={fieldOverrides} fieldBase={fieldBase}
    ghosts={labels.length ? labels : undefined} storedValue={text}
    onSelect={event => { settle(event.currentTarget); props.onSelect?.(event); }}
    onMouseUp={event => { settle(event.currentTarget); props.onMouseUp?.(event); }}
    onFocus={event => { settle(event.currentTarget); props.onFocus?.(event); }}
    onClick={event => { settle(event.currentTarget); props.onClick?.(event); }}
    onKeyUp={event => { settle(event.currentTarget); props.onKeyUp?.(event); }}
    onKeyDown={event => { if (ghostKey(event)) return; props.onKeyDown?.(event); }}
    onCopy={event => { ghostClipboard(event, false); props.onCopy?.(event); }}
    onCut={event => { ghostClipboard(event, true); props.onCut?.(event); }}
    onCompositionStart={event => { composing.current = true; props.onCompositionStart?.(event); }}
    onCompositionEnd={event => {
      composing.current = false;
      props.onCompositionEnd?.(event);
      refresh(count => count + 1);
    }}
    ref={element => {
    ref.current = element;
    inputRef(element);
  }} />;
};

export const ReviewMemoEditor: React.FC<Props> = ({
  value, onChange, document, placeholder = '복습 노트', theme = 'light',
  minHeight = 88, maxHeight, className = '', nested = false, onExit, onBack, colorColons = false, fieldOverrides, fieldBase = 0, grid = false, symbolBar = false, flat = false
}) => {
  const parentDrag = useContext(ToggleDragContext);
  const parentSymbolTarget = useContext(SymbolTargetContext);
  const ownSymbolTarget = useRef<SymbolTarget['current']>(null) as SymbolTarget;
  const symbolTarget = parentSymbolTarget ?? (symbolBar ? ownSymbolTarget : null);
  const [blocks, setBlocks] = useState<Block[]>(() => readBlocks(value, document));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const documentRef = useRef<ReviewMemoDocument>(blocksToDocument(blocks));
  const emitted = useRef(value);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const childEditors = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<{ key: string; position?: number } | null>(null);
  const dark = theme === 'dark';
  const setSource = useContext(NoteSetSourceContext);
  const enclosingToggles = useContext(NoteEnclosingContext);
  const [suggestion, setSuggestion] = useState<SetSuggestion | null>(null);
  const suppressKeyUp = useRef(false);
  const suggestionList = useRef<HTMLDivElement | null>(null);
  const [membersView, setMembersView] = useState<{ blockId: string; title: string; inner: string; rows: SetMemberRow[]; x: number; y: number;
    /** 마지막 고침을 되돌리는 함수와, 그 고침 전의 노트 글들(되돌린 뒤 목록을 다시 만들 때 쓴다) */
    undo: (() => void) | null; before: readonly string[] | null } | null>(null);
  const rewriteNotes = useContext(NoteSetEditContext);
  const membersRef = useRef<HTMLDivElement | null>(null);
  const membersFocus = useRef<number | null>(null);

  // `[집합]()` 괄호 사이에서 Enter: 그 집합 안의 모든 요소를 읽기 전용 창으로 보여 준다(고치는 것은 `[ ]`로 쓴다). 열었으면 true.
  const openMembersView = (blockId: string, field: HTMLTextAreaElement) => {
    const read = readField(field);
    const caret = read.start;
    if (read.end !== caret) return false;
    const inner = setMembersTrigger(read.value, caret);
    if (!inner) return false;
    const index = buildNoteSetIndex(setSource && setSource.length ? setSource : [read.value]);
    const rows = setContents(index, inner);
    const box = field.getBoundingClientRect();
    const spot = caretPositionIn(field, displayCaretOf(field, caret));
    const height = Math.min(MEMBERS_MAX_HEIGHT, 56 + Math.max(1, rows.length) * MEMBERS_ROW);
    const below = box.top + spot.top + spot.height + 4;
    const y = below + height > window.innerHeight - 8 ? Math.max(8, box.top + spot.top - height - 4) : below;
    const x = Math.max(8, Math.min(box.left + spot.left - 8, window.innerWidth - 340));
    setSuggestion(null);
    setMembersView({ blockId, title: `[${inner}]`, inner, rows, x, y, undo: null, before: null });
    return true;
  };

  // 창에서 값을 고치거나 지웠을 때: 같은 위치(그 집합 안, 분류기준 포함)의 같은 값이 같은 과목의 모든 노트에서 같이 바뀐다
  const commitMember = (rowIndex: number, from: string, to: string) => {
    const view = membersView;
    if (!view || !rewriteNotes) return;
    const sources = setSource ?? [];
    const index = buildNoteSetIndex(sources);
    const rewrite = (memo: string) => rewriteSetMember(memo, index, view.inner, from, to);
    const after = sources.map(rewrite);
    if (after.every((memo, at) => memo === sources[at])) return;
    const undo = rewriteNotes(rewrite);
    membersFocus.current = rowIndex;
    setMembersView(current => (current ? { ...current, rows: setContents(buildNoteSetIndex(after), current.inner), undo, before: sources } : current));
  };
  const undoMemberEdit = () => {
    if (!membersView?.undo) return;
    const before = membersView.before ?? [];
    membersView.undo();
    setMembersView(current => (current ? { ...current, rows: setContents(buildNoteSetIndex(before), current.inner), undo: null, before: null } : current));
  };
  const closeMembers = () => {
    const view = membersView;
    setMembersView(null);
    if (view) fields.current.get(`${view.blockId}:text`)?.focus();
  };
  const moveMemberFocus = (rowIndex: number, delta: number) => {
    const inputs = membersRef.current?.querySelectorAll<HTMLInputElement>('input[data-set-member-input]');
    inputs?.[Math.max(0, Math.min(inputs.length - 1, rowIndex + delta))]?.focus();
  };
  // 고친 뒤 목록이 다시 그려지면 같은 줄(지웠으면 그 자리의 다음 줄)에 커서를 돌려 놓는다
  useLayoutEffect(() => {
    if (membersFocus.current === null || !membersView) return;
    const inputs = membersRef.current?.querySelectorAll<HTMLInputElement>('input[data-set-member-input]');
    const at = membersFocus.current;
    membersFocus.current = null;
    if (inputs?.length) inputs[Math.min(at, inputs.length - 1)].focus();
  }, [membersView]);
  // 창 밖을 누르면 닫는다(창 안의 입력칸으로 커서가 옮겨가도 닫히지 않게 글 칸이 포커스를 잃는 것만으로는 닫지 않는다)
  useEffect(() => {
    if (!membersView) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (membersRef.current?.contains(target) || fields.current.get(`${membersView.blockId}:text`)?.contains(target)) return;
      setMembersView(null);
    };
    window.document.addEventListener('mousedown', close, true);
    return () => window.document.removeEventListener('mousedown', close, true);
  }, [membersView?.blockId]);

  // `[ ]` 안에 커서가 있으면 토글 연결값(뒤따르는 단어 셀의 위치·상위 집합)과 교집합·상위 집합 표기를 추천한다. `:` 같은 논리어를 써도 뜬다.
  // `typing`이면 방금 글을 쓴 것이다. 노트 셀 위치 추천은 쓰는 중에만 새로 뜨고(커서만 옮길 때는 뜨지 않음), 떠 있으면 커서가 셀에 있는 동안 유지된다.
  const refreshSuggestion = (blockId: string, part: 'text' | 'title', field: HTMLTextAreaElement, typing = false) => {
    // 글 읽기·커서는 저장하는 글 기준이다(입력칸에 글자처럼 끼운 위치 `[..B]`는 뺀다)
    const read = readField(field);
    const caret = read.start;
    const detail = read.value.includes('[') ? bracketDetail(read.value, caret) : null;
    let kind: SetSuggestion['kind'] = 'bracket';
    let items: BracketSuggestion[] = [];
    if (detail) {
      const index = buildNoteSetIndex(setSource && setSource.length ? setSource : [read.value]);
      items = bracketSuggestions(index, detail).slice(0, 40);
    } else if (part === 'text' && read.end === caret && (typing || (suggestion?.blockId === blockId && suggestion.kind === 'cell'))) {
      const located = headCellAtCaret(read.value, caret);
      if (located) {
        kind = 'cell';
        items = cellLocationSuggestions(buildNoteSetIndex(setSource && setSource.length ? setSource : [read.value]), located, caret).slice(0, 40);
      }
    }
    if (!items.length) { setSuggestion(null); return; }
    const box = field.getBoundingClientRect();
    const spot = caretPositionIn(field, displayCaretOf(field, caret));
    const height = Math.min(items.length, SUGGESTION_VISIBLE_ROWS) * SUGGESTION_ROW + SUGGESTION_PADDING;
    const below = box.top + spot.top + spot.height + 4;
    // 화면 아래쪽이면 커서 줄 위에 띄운다
    const y = below + height > window.innerHeight - 8 ? Math.max(8, box.top + spot.top - height - 4) : below;
    const x = Math.max(8, Math.min(box.left + spot.left - 8, window.innerWidth - 320));
    // 같은 목록이면 고른 줄을 그대로 두고, 글을 더 쓰면 맨 위 줄부터 다시 고른다
    setSuggestion(current => ({ blockId, part, items, kind, x, y,
      active: current && current.blockId === blockId && current.items.length === items.length && current.items.every((item, position) => item.text === items[position].text) ? current.active : 0 }));
  };

  // Keep empty paragraphs and block identities stable during local edits.
  useLayoutEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const next = readBlocks(value, document);
    documentRef.current = blocksToDocument(next);
    setBlocks(next);
    setClosed(new Set());
  }, [value, document]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const { key, position } = pendingFocus.current;
    const field = fields.current.get(key) || childEditors.current.get(key)?.querySelector('textarea');
    if (!field) return;
    field.focus();
    const caret = displayCaretOf(field, position ?? readField(field).value.length);
    field.setSelectionRange(caret, caret);
    pendingFocus.current = null;
  }, [blocks, closed]);

  const commit = (next: Block[]) => {
    const normalized = next.length ? next : [makeBlock({ type: 'text', text: '' })];
    setBlocks(normalized);
    emitted.current = serializeReviewMemoBlocks(normalized);
    documentRef.current = blocksToDocument(normalized);
    onChange(emitted.current, documentRef.current);
  };
  const finishDrag = () => {
    dragSourceRef.current = null;
    setDragSource(null);
    setDragTarget(null);
  };
  const drag: ToggleDrag = parentDrag || {
    source: dragSource,
    target: dragTarget,
    canDrop: id => !!dragSourceRef.current && canMoveReviewMemoNode(documentRef.current, dragSourceRef.current, id),
    start: id => { dragSourceRef.current = id; setDragSource(id); setDragTarget(null); },
    hover: setDragTarget,
    drop: id => {
      const source = dragSourceRef.current;
      if (source) {
        const moved = moveReviewMemoNode(documentRef.current, source, id);
        if (moved !== documentRef.current) {
          setClosed(new Set());
          commit(readBlocks(reviewMemoDocumentToText(moved), moved));
        }
      }
      finishDrag();
    },
    finish: finishDrag
  };
  const update = (index: number, block: Block) => {
    const next = [...blocks];
    next[index] = block;
    commit(next);
  };
  const focus = (id: string, part: 'text' | 'title', position?: number) => {
    pendingFocus.current = { key: `${id}:${part}`, position };
  };
  const register = (id: string, part: 'text' | 'title') => (element: HTMLTextAreaElement | null) => {
    const key = `${id}:${part}`;
    if (element) fields.current.set(key, element);
    else fields.current.delete(key);
  };
  /**
   * 줄을 토글로 바꾼다. command는 줄 맨 앞에 쓴 `>`(그 뒤 글이 제목),
   * trailing이면 줄 끝에 쓴 `>`(그 앞의 줄 전체가 제목)이고, 바뀐 토글은 열린 채 안쪽으로 커서가 들어간다.
   */
  const convertLine = (index: number, caret: number, command = '', trailing = false) => {
    const block = blocks[index];
    if (block.type !== 'text') return;
    const start = caret === 0 ? 0 : block.text.lastIndexOf('\n', caret - 1) + 1;
    const nextBreak = block.text.indexOf('\n', caret);
    const end = nextBreak < 0 ? block.text.length : nextBreak;
    const line = block.text.slice(start, end);
    const title = trailing ? line.replace(/>\s*$/, '').trimEnd() : command ? line.slice(command.length) : line;
    const toggle = { ...makeBlock({ type: 'toggle', title, text: '' }),
      ...(start === 0 ? { id: block.id } : {}) };
    const replacements: Block[] = [];
    if (start > 0) replacements.push({ ...block, text: block.text.slice(0, start - 1) });
    replacements.push(toggle);
    if (end < block.text.length) replacements.push(makeBlock({ type: 'text', text: block.text.slice(end + 1) }));
    if (trailing) focus(toggle.id, 'text', 0);
    else focus(toggle.id, 'title', command ? 0 : undefined);
    commit([...blocks.slice(0, index), ...replacements, ...blocks.slice(index + 1)]);
  };
  const removeEmptyTextBlock = (index: number) => {
    if (blocks.length <= 1) return;
    const previous = blocks[index - 1];
    const following = blocks[index + 1];
    const target = previous || following;
    if (target) {
      const part = target.type === 'toggle' ? 'title' : 'text';
      const position = previous
        ? (target.type === 'toggle' ? target.title.length : target.text.length)
        : 0;
      focus(target.id, part, position);
    }
    commit(blocks.filter((_, blockIndex) => blockIndex !== index));
  };
  /** 입력칸의 맨 끝으로 커서를 옮긴다(이미 그려진 칸이라 바로 옮긴다) */
  const caretToEnd = (field: HTMLTextAreaElement | undefined | null) => {
    if (!field) return false;
    field.focus();
    const caret = displayCaretOf(field, readField(field).value.length);
    field.setSelectionRange(caret, caret);
    return true;
  };
  /** 그 블록의 눈에 보이는 맨 끝: 열린 토글이면 안쪽 마지막 칸(더 깊은 토글이 열려 있으면 그 안 마지막 칸), 아니면 제목 끝 */
  const caretToEndOf = (target: Block) => {
    const inside = target.type === 'toggle' && !closed.has(target.id)
      ? Array.from(childEditors.current.get(`${target.id}:text`)?.querySelectorAll('textarea') ?? []).pop()
      : undefined;
    return caretToEnd(inside ?? fields.current.get(`${target.id}:${target.type === 'toggle' ? 'title' : 'text'}`));
  };
  /**
   * 글 칸 맨 앞에서 백스페이스(글을 지우지는 않는다, 빈 칸이면 그 칸만 지운다). 처리했으면 true.
   *  - 앞에 블록이 있으면 그 끝으로 커서가 간다(열린 토글이면 그 안 마지막 칸).
   *  - 토글 안 맨 앞 칸이면 바깥 토글의 제목 끝으로 간다. 토글 안의 칸이 그 빈 칸 하나뿐이면 칸은 남겨 둔다.
   *  - 맨 바깥 첫 칸이면 할 일이 없다(빈 칸이 둘 이상이면 아래 칸으로 커서가 가며 지운다).
   */
  const stepBackFrom = (index: number) => {
    const block = blocks[index];
    if (block.type !== 'text') return false;
    const previous = blocks[index - 1];
    const reach = () => (previous ? caretToEndOf(previous) : onBack ? (onBack(), true) : false);
    if (block.text) return reach();
    if (blocks.length <= 1) return reach();
    if (!previous && !onBack) { removeEmptyTextBlock(index); return true; }
    reach();
    commit(blocks.filter((_, blockIndex) => blockIndex !== index));
    return true;
  };
  const exitToggle = (index: number) => {
    const next = [...blocks];
    next[index] = { ...next[index], text: next[index].text.replace(/\n$/, '') };
    let paragraph = next[index + 1];
    if (!paragraph || paragraph.type !== 'text') {
      paragraph = makeBlock({ type: 'text', text: '' });
      next.splice(index + 1, 0, paragraph);
    }
    focus(paragraph.id, 'text', 0);
    commit(next);
  };
  // 기호 막대에서 누른 기호를 지금 쓰고 있던 입력칸의 커서 자리에 넣는다. (`>`는 그 줄을 토글로 바꾼다)
  const applySymbol = (blockId: string, part: 'text' | 'title', symbol: string) => {
    const index = blocks.findIndex(block => block.id === blockId);
    const field = fields.current.get(`${blockId}:${part}`);
    if (index < 0 || !field || !field.isConnected) return;
    const block = blocks[index];
    const { start, end } = readField(field);
    if (symbol === '>') {
      if (block.type === 'text') { convertLine(index, start); return; }
      // 토글 제목에서 누르면 그 토글 안 맨 앞에 새 토글이 생긴다(접혀 있으면 펼친다). 커서는 새 토글 제목으로 간다.
      const inner = serializeReviewMemoBlocks([{ type: 'toggle', title: '', text: '' }]);
      setClosed(prev => { const next = new Set(prev); next.delete(block.id); return next; });
      update(index, { ...block, text: block.text ? `${inner}\n${block.text}` : inner, childDocument: undefined });
      window.setTimeout(() => caretToEnd(childEditors.current.get(`${block.id}:text`)?.querySelector('textarea')), 0);
      return;
    }
    const pair = symbol === '( )';
    const inserted = pair ? '()' : symbol;
    const current = block.type === 'toggle' ? block.title : block.text;
    const next = `${current.slice(0, start)}${inserted}${current.slice(end)}`;
    focus(block.id, part, start + (pair ? 1 : inserted.length));
    update(index, block.type === 'toggle' ? { ...block, title: next } : { ...block, text: next });
  };
  const acceptSuggestion = (item: BracketSuggestion) => {
    if (!suggestion) return;
    const index = blocks.findIndex(block => block.id === suggestion.blockId);
    if (index < 0) return;
    const block = blocks[index];
    const current = block.type === 'toggle' ? block.title : block.text;
    const lead = current.slice(0, item.from);
    const next = `${lead}${item.text}${current.slice(item.to)}`;
    focus(block.id, suggestion.part, lead.length + (item.caret ?? item.text.length));
    setSuggestion(null);
    update(index, block.type === 'toggle' ? { ...block, title: next } : { ...block, text: next });
  };
  // 목록이 떠 있을 때의 키: 탭 자동완성, ↑↓로 고르기, Esc로 닫기. 처리했으면 true.
  const suggestionKey = (event: React.KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    if (!suggestion || suggestion.blockId !== blockId || !suggestion.items.length) return false;
    const count = suggestion.items.length;
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      suppressKeyUp.current = true;
      acceptSuggestion(suggestion.items[Math.min(suggestion.active, count - 1)]);
      return true;
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
    // 노트 셀 위치 추천이 하나뿐이면 ↑↓는 그냥 커서 이동이다(글을 쓰다 줄을 옮길 때 가로채지 않는다)
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      && !(suggestion.kind === 'cell' && count < 2)) {
      event.preventDefault();
      suppressKeyUp.current = true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSuggestion(current => (current ? { ...current, active: (current.active + step + count) % count } : current));
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      suppressKeyUp.current = true;
      setSuggestion(null);
      return true;
    }
    return false;
  };
  const applySymbolRef = useRef(applySymbol);
  applySymbolRef.current = applySymbol;
  const registerSymbolTarget = (blockId: string, part: 'text' | 'title') => {
    if (symbolTarget) symbolTarget.current = symbol => applySymbolRef.current(blockId, part, symbol);
  };
  const textStyle = `block w-full resize-none overflow-hidden bg-transparent ${grid ? 'py-0' : 'py-0.5'} text-lg font-medium leading-7 outline-none ${dark ? 'text-rose-50 placeholder:text-rose-200/35' : 'text-slate-800 placeholder:text-slate-300'}`;
  const subtle = `rounded p-1 ${dark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`;
  const content = (
    <div className={nested || flat ? className : `${className} rounded-xl border ${grid ? 'overflow-hidden' : 'p-3'} ${dark ? 'border-rose-300/25 bg-black/20' : 'border-rose-100 bg-white'}`}>
      {symbolBar && !nested && <NoteSymbolBar onInsert={symbol => symbolTarget?.current?.(symbol)} />}
      <div role="group" aria-label={nested ? '토글 내용 편집' : '복습 노트 편집'} className={nested || flat ? '' : grid ? 'overflow-y-auto px-3' : 'overflow-y-auto'} style={nested ? undefined : flat ? { minHeight } : grid ? { minHeight, maxHeight, ...NOTE_GRID_STYLE } : { minHeight, maxHeight }}>
        {blocks.map((block, index) => {
          const isDropTarget = block.type === 'toggle' && drag.target === block.id;
          return (
          <div key={block.id} data-memo-node-id={block.id} className={`group relative rounded-lg ${isDropTarget ? dark ? 'bg-indigo-500/15 ring-2 ring-indigo-400' : 'bg-indigo-50 ring-2 ring-indigo-300' : ''}`}
            onDragOver={event => {
              if (!drag.source || block.type !== 'toggle') return;
              event.stopPropagation();
              if (!drag.canDrop(block.id)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              drag.hover(block.id);
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                if (isDropTarget) drag.hover(null);
              }
            }}
            onDrop={event => {
              if (!drag.source || block.type !== 'toggle') return;
              event.preventDefault();
              event.stopPropagation();
              drag.drop(block.id);
            }}>
            <div className="flex items-start">
              {block.type === 'toggle' && (
                <button type="button" aria-label={closed.has(block.id) ? '토글 펼치기' : '토글 접기'} aria-expanded={!closed.has(block.id)}
                  draggable
                  title="클릭하여 접기·펼치기, 드래그하여 다른 토글 안으로 이동"
                  onDragStart={event => {
                    event.stopPropagation();
                    event.dataTransfer.setData(TOGGLE_DRAG_TYPE, 'move');
                    event.dataTransfer.effectAllowed = 'move';
                    drag.start(block.id);
                  }}
                  onDragEnd={event => { event.stopPropagation(); drag.finish(); }}
                  onClick={() => setClosed(prev => {
                    const next = new Set(prev);
                    if (next.has(block.id)) next.delete(block.id); else next.add(block.id);
                    return next;
                  })}
                  className={`${grid ? '' : 'mt-0.5'} grid h-7 w-6 shrink-0 cursor-grab place-items-center active:cursor-grabbing ${subtle}`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${closed.has(block.id) ? '' : 'rotate-90'}`}>
                    <path d="M3 2L9 6L3 10Z" fill="currentColor" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <GrowingTextarea inputRef={register(block.id, block.type === 'toggle' ? 'title' : 'text')} minLine={grid ? NOTE_GRID_CELL : 32}
                  ghostText={block.type === 'text'}
                  onUnfold={block.type === 'text' ? (line, full) => {
                    // 생략된 위치 `[..B]`를 펼쳐 그 줄 맨 앞에 실제 글자로 넣는다: 그 뒤로는 다른 글처럼 고치고 지울 수 있다
                    const lines = block.text.split('\n');
                    const lead = /^\s*/.exec(lines[line] ?? '')![0].length;
                    lines[line] = `${lines[line].slice(0, lead)}${full} ${lines[line].slice(lead)}`;
                    focus(block.id, 'text', lines.slice(0, line).reduce((sum, item) => sum + item.length + 1, 0) + lead + full.length + 1);
                    update(index, { ...block, text: lines.join('\n') });
                  } : undefined}
                  colorColons={colorColons} dark={dark} fieldOverrides={fieldOverrides} fieldBase={fieldBase}
                  aria-label={block.type === 'toggle' ? '토글 제목' : nested ? '토글 내용' : '노트 내용'}
                  placeholder={block.type === 'toggle' ? '토글 제목' : blocks.length === 1 ? placeholder : ''}
                  value={block.type === 'toggle' ? block.title : block.text} className={textStyle}
                  onFocus={event => { registerSymbolTarget(block.id, block.type === 'toggle' ? 'title' : 'text'); refreshSuggestion(block.id, block.type === 'toggle' ? 'title' : 'text', event.currentTarget); }}
                  onBlur={event => { setSuggestion(current => (current?.blockId === block.id ? null : current)); setMembersView(current => (current?.blockId === block.id && !membersRef.current?.contains(event.relatedTarget as Node | null) ? null : current)); }}
                  onKeyUp={event => { if (suppressKeyUp.current) { suppressKeyUp.current = false; return; } if (!event.nativeEvent.isComposing) refreshSuggestion(block.id, block.type === 'toggle' ? 'title' : 'text', event.currentTarget); }}
                  onClick={event => { setMembersView(null); refreshSuggestion(block.id, block.type === 'toggle' ? 'title' : 'text', event.currentTarget); }}
                  onChange={event => { setMembersView(null); const written = normalizeNotePunctuation(readField(event.target).value); update(index, block.type === 'toggle' ? { ...block, title: written.replace(/\n/g, ' ') } : { ...block, text: written }); refreshSuggestion(block.id, block.type === 'toggle' ? 'title' : 'text', event.target, true); }}
                  onKeyDown={event => {
                    if (suggestionKey(event, block.id)) return;
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    const field = event.currentTarget;
                    if (membersView?.blockId === block.id && event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setMembersView(null);
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                      if (membersView?.blockId === block.id) { event.preventDefault(); setMembersView(null); return; }
                      if (openMembersView(block.id, field)) { event.preventDefault(); return; }
                    }
                    if (event.key === ' ' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
                      const read = readField(field);
                      const edit = getReviewMemoDoubleSpaceEdit(read.value, read.start, read.end);
                      if (edit) {
                        event.preventDefault();
                        focus(block.id, block.type === 'toggle' ? 'title' : 'text', edit.caret);
                        update(index, block.type === 'toggle' ? { ...block, title: edit.text } : { ...block, text: edit.text });
                        return;
                      }
                    }
                    if (block.type === 'text') {
                      const { start: caret, end: selectionEnd } = readField(field);
                      const start = caret === 0 ? 0 : block.text.lastIndexOf('\n', caret - 1) + 1;
                      const prefix = block.text.slice(start, caret);
                      if (event.key === 'Backspace' && !event.shiftKey && caret === 0 && selectionEnd === 0 && stepBackFrom(index)) {
                        event.preventDefault();
                      } else if ((event.key === ' ' && prefix === '>') || (event.key === 'Enter' && ['/toggle', '/토글'].includes(prefix))) {
                        event.preventDefault();
                        convertLine(index, caret, prefix);
                      } else if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey && selectionEnd === caret
                        && /[^\s>][^>]*>$/.test(prefix) && !/[-=<>]>$/.test(prefix) && (block.text[caret] === undefined || block.text[caret] === '\n')) {
                        // 줄 끝에서 `>`를 쓰고 띄어쓰면 그 줄이 제목인 토글이 되어 열리고, 커서가 토글 안으로 들어간다
                        event.preventDefault();
                        convertLine(index, caret, '', true);
                      } else if (onExit && index === blocks.length - 1 && event.key === 'Enter' && !event.shiftKey && caret === block.text.length && selectionEnd === caret && (!block.text || block.text.endsWith('\n'))) {
                        event.preventDefault();
                        onExit();
                      }
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (closed.has(block.id)) {
                        const toggle = makeBlock({ type: 'toggle', title: '', text: '' });
                        focus(toggle.id, 'title', 0);
                        setClosed(prev => new Set(prev).add(toggle.id));
                        commit([...blocks.slice(0, index + 1), toggle, ...blocks.slice(index + 1)]);
                      } else {
                        focus(block.id, 'text', 0);
                        setClosed(prev => { const next = new Set(prev); next.delete(block.id); return next; });
                      }
                    } else if (event.key === 'Backspace' && field.selectionStart === 0 && field.selectionEnd === 0) {
                      event.preventDefault();
                      focus(block.id, 'text', 0);
                      const children = block.text || block.childDocument?.nodes.length ? readBlocks(block.text, block.childDocument) : [];
                      commit([
                        ...blocks.slice(0, index),
                        { type: 'text', text: block.title, id: block.id },
                        ...children,
                        ...blocks.slice(index + 1)
                      ]);
                    }
                  }} />
              </div>
            </div>
            {suggestion?.blockId === block.id && typeof window !== 'undefined' && createPortal(
              <div ref={suggestionList} role="listbox" aria-label="집합 추천" data-set-suggestions="true"
                style={{ position: 'fixed', left: suggestion.x, top: suggestion.y, maxHeight: SUGGESTION_MAX_HEIGHT }}
                className={`z-[10040] w-max min-w-[12rem] max-w-[min(28rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-lg ${dark ? 'border-slate-600 bg-slate-800' : 'border-indigo-200 bg-white'}`}>
                {suggestion.items.map((item, position) => {
                  const active = position === suggestion.active;
                  return (
                    <button key={`${item.from}:${item.to}:${item.text}`} type="button" role="option" aria-selected={active} data-active={active ? 'true' : 'false'}
                      data-set-suggestion={item.text} data-suggestion-tag={item.tag}
                      ref={element => {
                        const list = suggestionList.current;
                        if (!active || !element || !list) return;
                        if (element.offsetTop < list.scrollTop) list.scrollTop = element.offsetTop - SUGGESTION_PADDING / 2;
                        else if (element.offsetTop + element.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = element.offsetTop + element.offsetHeight - list.clientHeight + SUGGESTION_PADDING / 2;
                      }}
                      onMouseDown={event => event.preventDefault()}
                      onMouseMove={() => setSuggestion(current => (current && current.active !== position ? { ...current, active: position } : current))}
                      onClick={() => acceptSuggestion(item)}
                      style={{ height: SUGGESTION_ROW }}
                      className={`flex w-full items-center justify-between gap-5 rounded-md px-2.5 text-left text-[15px] font-bold ${active ? (dark ? 'bg-indigo-500 text-white' : 'bg-indigo-600 text-white') : (dark ? 'text-slate-100' : 'text-indigo-950')}`}>
                      <span className="truncate font-mono">{item.label}</span>
                      <span className={`shrink-0 text-xs font-bold ${active ? 'text-indigo-100' : dark ? 'text-slate-400' : 'text-slate-500'}`}>{item.tag}</span>
                    </button>
                  );
                })}
              </div>, window.document.body
            )}
            {membersView?.blockId === block.id && typeof window !== 'undefined' && createPortal(
              <div ref={membersRef} role="dialog" aria-label="집합 요소 보기" aria-readonly={rewriteNotes ? undefined : 'true'} data-set-members="true" data-set-members-editable={rewriteNotes ? 'true' : undefined}
                onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
                onBlur={event => {
                  // 창 밖의 다른 입력으로 커서가 옮겨가면 닫는다(커서가 어디에도 없게 된 경우는 창 밖을 누를 때 닫는다)
                  const next = event.relatedTarget as Node | null;
                  if (next && !membersRef.current?.contains(next) && !fields.current.get(`${membersView.blockId}:text`)?.contains(next)) setMembersView(null);
                }}
                style={{ position: 'fixed', left: membersView.x, top: membersView.y, maxHeight: MEMBERS_MAX_HEIGHT }}
                className={`z-[10040] flex w-[min(21rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border-2 shadow-xl ${dark ? 'border-slate-500 bg-slate-800 text-slate-100' : 'border-teal-300 bg-white text-slate-900'}`}>
                <div className={`flex shrink-0 items-baseline justify-between gap-3 border-b px-3 py-2 ${dark ? 'border-slate-600' : 'border-teal-100 bg-teal-50'}`}>
                  <span data-set-members-title="true" className="truncate font-mono text-[15px] font-black">{membersView.title}</span>
                  <span className={`shrink-0 text-xs font-bold ${dark ? 'text-slate-300' : 'text-teal-800'}`}>요소 {membersView.rows.length}개</span>
                </div>
                <ul data-set-members-list="true" className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-1.5" style={{ maxHeight: MEMBERS_MAX_HEIGHT - 84 }}>
                  {membersView.rows.length === 0 && <li className={`px-2 py-2 text-sm font-bold ${dark ? 'text-slate-300' : 'text-slate-500'}`}>비어 있어요</li>}
                  {membersView.rows.map((row, rowIndex) => (
                    <li key={`${row.depth}:${row.name}`} data-set-member={row.name} style={{ minHeight: MEMBERS_ROW, paddingLeft: 8 + row.depth * 16 }}
                      className={`flex items-center gap-2 rounded-md pr-2 text-[15px] font-bold ${rewriteNotes && !row.isSet ? '' : 'select-none'}`}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.isSet ? 'bg-teal-600' : 'bg-slate-400'}`} />
                      {rewriteNotes && !row.isSet
                        ? <MemberInput name={row.name} dark={dark} onCommit={next => commitMember(rowIndex, row.name, next)} onMove={delta => moveMemberFocus(rowIndex, delta)} onEscape={closeMembers} />
                        : <span className="min-w-0 break-words">{row.name}</span>}
                      {row.isSet && <span className="shrink-0 rounded bg-teal-100 px-1.5 text-[11px] font-black text-teal-900">집합</span>}
                    </li>
                  ))}
                </ul>
                <div className={`flex shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5 text-[12px] font-bold ${dark ? 'border-slate-600 text-slate-300' : 'border-teal-100 text-slate-600'}`}>
                  <p className="m-0">{rewriteNotes ? '값을 고치거나 지우고 Enter · 같은 위치의 값은 다른 노트에서도 같이 바뀜 · Esc로 닫기' : '보기 전용 · 고치려면 [ ]로 쓰세요 · Esc로 닫기'}</p>
                  {membersView.undo && <button type="button" data-set-members-undo="true" onClick={undoMemberEdit}
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-black ${dark ? 'border-slate-400 text-slate-100 hover:bg-slate-700' : 'border-teal-400 text-teal-900 hover:bg-teal-50'}`}>되돌리기</button>}
                </div>
              </div>, window.document.body
            )}
            {block.type === 'toggle' && !closed.has(block.id) && (
              <div className="ml-6 pl-2" ref={element => {
                const key = `${block.id}:text`;
                if (element) childEditors.current.set(key, element);
                else childEditors.current.delete(key);
              }}>
                <NoteEnclosingContext.Provider value={[...enclosingToggles, toggleName(block.title)]}>
                  <ReviewMemoEditor nested grid={grid} theme={theme} value={block.text} placeholder="내용"
                    colorColons={colorColons}
                    fieldOverrides={getReviewFieldOverrides(block.title, fieldOverrides, fieldBase)}
                    fieldBase={getToggleChildOffset(block.title, fieldBase, fieldOverrides)}
                    document={block.childDocument}
                    onChange={(text, childDocument) => update(index, { ...block, text, childDocument })}
                    onExit={() => exitToggle(index)}
                    onBack={() => caretToEnd(fields.current.get(`${block.id}:title`))} />
                </NoteEnclosingContext.Provider>
              </div>
            )}
          </div>
        ); })}
      </div>
    </div>
  );
  if (nested) return content;
  const withDrag = <ToggleDragContext.Provider value={drag}>{content}</ToggleDragContext.Provider>;
  return symbolTarget ? <SymbolTargetContext.Provider value={symbolTarget}>{withDrag}</SymbolTargetContext.Provider> : withDrag;
};
