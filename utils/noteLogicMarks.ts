import { matchingBracket, parseSetExpression } from './setExpression';
import type { SetExprNode } from './setExpression';
import { reviewQuotes } from './reviewQuote';
import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import type { ReviewMemoOldLine } from '../types';

/**
 * `[!]` 집합: 논리적으로 맞지 않는 값이 들어가는 집합.
 *  - `[!] 값`, `[도형.!] 값`(교집합), 토글 제목 `!` 아래의 값은 `!`에 걸린다. `[도형.%!]`처럼 여집합으로 쓰면 걸리지 않는다.
 *  - `!`에 걸린 칸이 든 줄(과 그 토글 아래)에서는 문제를 만들지 않는다: 교집합 관계가 되어 있는 동안만 나오지 않는다.
 *  - 노트의 그 줄이 고쳐지면 그 줄의 `!`가 빠지고(집합 밖으로), 문제는 다시 나온다.
 */
export const LOGIC_SET = '!';

const requiresLogicSet = (node: SetExprNode): boolean => {
  if (node.type === 'name') return node.name.trim() === LOGIC_SET;
  if (node.type === 'and') return node.items.some(requiresLogicSet);
  if (node.type === 'or') return node.items.every(requiresLogicSet);
  return false;
};

/** `[ ]` 안쪽 집합식이 `!`에 들어 있어야만 참이 되는가(`!`, `도형.!`) */
export const setRequiresLogicMark = (inner: string): boolean => {
  if (!inner.includes(LOGIC_SET)) return false;
  const node = parseSetExpression(inner);
  return Boolean(node) && requiresLogicSet(node!);
};

const quotedPositions = (text: string): ReadonlySet<number> => {
  const quoted = new Set<number>();
  if (!text.includes("'")) return quoted;
  const edges = [...reviewQuotes(text).edges].sort((a, b) => a - b);
  for (let index = 0; index + 1 < edges.length; index += 2) {
    for (let at = edges[index]; at <= edges[index + 1]; at += 1) quoted.add(at);
  }
  return quoted;
};

export interface LogicMarkSpan { start: number; end: number; inner: string }

/** 줄 글에서 `!`를 요구하는 `[ ]` 묶음들의 자리(따옴표 안과 겹친 안쪽 묶음은 뺀다) */
export const logicMarkSpans = (text: string): LogicMarkSpan[] => {
  if (!text.includes(LOGIC_SET) || !text.includes('[')) return [];
  const quoted = quotedPositions(text);
  const spans: LogicMarkSpan[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '[' || quoted.has(index)) continue;
    const end = matchingBracket(text, index);
    if (end < 0) continue;
    const inner = text.slice(index + 1, end);
    if (setRequiresLogicMark(inner)) spans.push({ start: index, end: end + 1, inner });
    index = end;
  }
  return spans;
};

export const hasLogicMark = (text: string): boolean => logicMarkSpans(text).length > 0;

/** 토글 제목이 `!` 집합이거나 `!`에 걸렸는가: 그 아래 값은 모두 `!`에 걸린다 */
export const isLogicToggleTitle = (title: string): boolean => {
  const bare = title.replace(/\{[^{}\n]*\}/g, '').replace(/[\s:;<,\-=]+$/, '').trim();
  return bare === LOGIC_SET || hasLogicMark(title);
};

const textOfNode = (node: SetExprNode): string => {
  if (node.type === 'name') return node.name;
  if (node.type === 'mark') return `[${node.inner}]`;
  if (node.type === 'not') return `%${node.of.type === 'name' || node.of.type === 'mark' ? textOfNode(node.of) : `(${textOfNode(node.of)})`}`;
  const glue = node.type === 'and' ? '.' : ',';
  return node.items.map(item => (item.type === 'and' || item.type === 'or') && item.type !== node.type ? `(${textOfNode(item)})` : textOfNode(item)).join(glue);
};

/** 집합식에서 `!`만 뺀다. 남는 것이 없으면 null */
const withoutLogicSet = (node: SetExprNode): SetExprNode | null => {
  if (node.type === 'name') return node.name.trim() === LOGIC_SET ? null : node;
  if (node.type === 'and') {
    const items = node.items.map(withoutLogicSet).filter((item): item is SetExprNode => item !== null);
    return items.length === 0 ? null : items.length === 1 ? items[0] : { type: 'and', items };
  }
  if (node.type === 'or') {
    const items = node.items.map(withoutLogicSet).filter((item): item is SetExprNode => item !== null);
    return items.length === 0 ? null : items.length === 1 ? items[0] : { type: 'or', items };
  }
  return node;
};

/** 글에서 `!`를 요구하는 `[ ]`에서 `!`를 뺀다(`[!] 값` → `값`, `[도형.!] 값` → `[도형] 값`) */
export const stripLogicMarks = (text: string): string => {
  const spans = logicMarkSpans(text);
  if (!spans.length) return text;
  let result = text;
  [...spans].reverse().forEach(span => {
    const node = parseSetExpression(span.inner);
    const rest = node ? withoutLogicSet(node) : null;
    if (rest) {
      result = `${result.slice(0, span.start)}[${textOfNode(rest)}]${result.slice(span.end)}`;
    } else {
      const after = result.slice(span.end).replace(/^[ \t]*\.?[ \t]*/, '');
      result = `${result.slice(0, span.start)}${after}`;
    }
  });
  return result;
};

/** 칸 하나(맨 앞 `[ ]`들과 값)에 `!`를 붙인다: 앞에 집합이 있으면 그 집합과 교집합(`[도형] 값` → `[도형.!] 값`), 없으면 `[!] 값`. */
export const markLogicCell = (cell: string): string => {
  const text = cell.trim();
  if (!text || hasLogicMark(text)) return cell;
  let lastStart = -1;
  let lastEnd = -1;
  let position = 0;
  for (let end = matchingBracket(text, 0); end > 0; end = matchingBracket(text, position)) {
    lastStart = position;
    lastEnd = end;
    position = end + 1;
    while (text[position] === ' ' || text[position] === '.') position += 1;
    if (text[position] !== '[') break;
  }
  if (lastStart < 0) return `[${LOGIC_SET}] ${text}`;
  const inner = text.slice(lastStart + 1, lastEnd).trim();
  const joined = /[,]/.test(inner) && !/^\(.*\)$/.test(inner) ? `(${inner}).${LOGIC_SET}` : `${inner}.${LOGIC_SET}`;
  return `${text.slice(0, lastStart)}[${joined}]${text.slice(lastEnd + 1)}`;
};

/** 노트 글의 한 줄 안에서 [start,end) 칸에 `!`를 붙인 줄 */
export const markLogicInLine = (line: string, start: number, end: number): string => {
  const cell = line.slice(start, end);
  const lead = cell.length - cell.trimStart().length;
  const marked = markLogicCell(cell);
  if (marked === cell) return line;
  return `${line.slice(0, start)}${' '.repeat(lead)}${marked.trimStart()}${line.slice(end)}`;
};

/** 노트 글에서 모든 줄(토글 제목 줄 포함)을 `visit`으로 바꾼다 */
export const mapMemoLines = (memo: string, visit: (line: string, index: number) => string): string => memo.split('\n').map(visit).join('\n');

/** 토글 줄 접두를 떼고 보이는 글만 (`:::toggle 제목` → `제목`) */
export const memoLineText = (line: string): string => (line.startsWith(REVIEW_MEMO_TOGGLE_START) ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : line);

interface Hunk { oldLines: string[]; newLines: string[]; newStart: number }

/** 줄 단위로 바뀐 덩어리들(최장 공통 부분열 기준). 노트는 짧아서 단순한 표로 계산한다. */
const changedHunks = (before: string[], after: string[]): Hunk[] => {
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      table[r][c] = before[r] === after[c] ? table[r + 1][c + 1] + 1 : Math.max(table[r + 1][c], table[r][c + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let r = 0;
  let c = 0;
  let current: Hunk | null = null;
  const close = () => { if (current && (current.oldLines.length || current.newLines.length)) hunks.push(current); current = null; };
  while (r < rows || c < cols) {
    if (r < rows && c < cols && before[r] === after[c]) { close(); r += 1; c += 1; continue; }
    if (!current) current = { oldLines: [], newLines: [], newStart: c };
    if (c < cols && (r >= rows || table[r][c + 1] >= table[r + 1][c])) { current.newLines.push(after[c]); c += 1; }
    else { current.oldLines.push(before[r]); r += 1; }
  }
  close();
  return hunks;
};

export interface MemoEditEffects {
  /** `!`에 걸렸던 줄이 고쳐졌으면 그 줄에서 `!`를 뺀 노트 글 */
  memo: string;
  /** 고치기 전의 줄들(바뀌거나 지워진 줄) */
  oldLines: Array<Omit<ReviewMemoOldLine, 'at'>>;
  /** `!`에서 풀려난 줄 수 */
  released: number;
}

const isStructureLine = (line: string) => line === REVIEW_MEMO_TOGGLE_END || !line.trim();

/**
 * 노트를 고쳤을 때의 효과: 바뀐 덩어리에서 `!`에 걸려 있던 줄이 고쳐졌다면(옛 줄에 `!`가 있고 새 줄도 `!`를 달고 있으면) 새 줄의 `!`를 뺀다.
 * 새로 `[!]` 줄만 더한 것(옛 줄에 `!`가 없는 덩어리)은 그대로 둔다. 바뀌거나 지워진 옛 줄은 "이전 값"으로 돌려준다.
 */
export const memoEditEffects = (before: string, after: string): MemoEditEffects => {
  if (before === after) return { memo: after, oldLines: [], released: 0 };
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const hunks = changedHunks(beforeLines, afterLines);
  const result = [...afterLines];
  const oldLines: MemoEditEffects['oldLines'] = [];
  let released = 0;
  hunks.forEach(hunk => {
    const flaggedBefore = hunk.oldLines.some(line => hasLogicMark(memoLineText(line)));
    hunk.oldLines.forEach((line, index) => {
      if (isStructureLine(line)) return;
      const next = hunk.newLines[index];
      oldLines.push({ text: line, ...(next !== undefined && !isStructureLine(next) ? { replacedBy: next } : {}) });
    });
    if (!flaggedBefore) return;
    hunk.newLines.forEach((line, index) => {
      if (!hasLogicMark(memoLineText(line))) return;
      const prefix = line.startsWith(REVIEW_MEMO_TOGGLE_START) ? REVIEW_MEMO_TOGGLE_START : '';
      const stripped = prefix + stripLogicMarks(memoLineText(line));
      if (stripped !== line) { result[hunk.newStart + index] = stripped; released += 1; }
    });
  });
  return { memo: result.join('\n'), oldLines, released };
};
