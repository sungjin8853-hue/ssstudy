import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { reviewGroups } from './reviewFieldOverride';
import { reviewQuotes } from './reviewQuote';
import { openTailOf } from './noteOpenTail';

/**
 * 줄 안의 `>`로 밑에 쓰기(3일 요청): 완전한 한 행 뒤에 `>`가 있으면, `>` 뒤의 행은 그 행 밑(토글 아래)에 쓴 것처럼 읽는다.
 *  - `[A] > [B] A:[N] C`는 `> [A]` 토글 밑에 `[B] A:[N] C`를 쓴 것과 같다.
 *  - 여러 번 쓰면 차례로 더 깊어진다: `X > Y > Z`는 X 밑에 Y, Y 밑에 Z.
 *  - 토글 제목에 쓰면(`> X > Y`) 그 토글 안의 줄들은 마지막 행(Y) 밑에 있다.
 *  - `>` 앞이 완전한 행일 때만이다: 앞이 비었거나 덜 끝났거나(`A :`, `A -` 처럼 연결어로 끝남) 뒤가 비면 `>`는 그냥 글자다.
 *    `[ ]` `( )` 안과 따옴표 안의 `>`, `>>` · `>=`도 글자다.
 *  - `//`로 칸을 나눈 줄에서 `>` 앞의 행은 바로 앞 `//` 뒤부터다: `a : b // X > c : d`는 `a : b`와 X 밑의 `c : d`다.
 *    `>` 뒤는 줄 끝까지 그 행 밑이다(`X > a : b // c : d`는 둘 다 X 밑). 토글 제목에 `//`가 있으면 `>`는 글자다.
 * 문제 만들기 · 관계도 · 집합 읽기가 이 글을 쓰고, 노트에 저장된 글은 바뀌지 않는다.
 */

/** 줄에서 밑에 쓰기로 읽는 `>`의 자리들과, 첫 `>` 앞의 마지막 `//`(그 앞은 따로 쓴 칸이다, 없으면 -1) */
const scanNest = (line: string): { cuts: number[]; lead: number } => {
  if (!line.includes('>')) return { cuts: [], lead: -1 };
  const groups = reviewGroups(line).skip;
  // 따옴표 `'…'` 안은 건너뛴다(여는 것과 닫는 것이 차례로 짝을 이룬다)
  const edges = [...reviewQuotes(line).edges].sort((a, b) => a - b);
  const quoteEnd = new Map<number, number>();
  for (let at = 0; at + 1 < edges.length; at += 2) quoteEnd.set(edges[at], edges[at + 1]);
  const cuts: number[] = [];
  let from = 0;
  let lead = -1;
  for (let index = 0; index < line.length; index += 1) {
    const closing = quoteEnd.get(index);
    if (closing !== undefined) { index = closing; continue; }
    const jump = groups.get(index);
    if (jump !== undefined) { index = jump; continue; }
    if (!cuts.length && line[index] === '/' && line[index + 1] === '/') { lead = index; from = index + 2; index += 1; continue; }
    if (line[index] !== '>') continue;
    if (line[index + 1] === '>' || line[index + 1] === '=' || line[index - 1] === '>') continue;
    const before = line.slice(from, index);
    const after = line.slice(index + 1).trim();
    // 앞이 연결어로 끝나면(`=>` `->` `A :`) 덜 끝난 행이다
    if (!before.trim() || openTailOf(before) || /[:;<,\-=]\s*$/.test(before) || !after || after.startsWith(':::')) continue;
    cuts.push(index);
    from = index + 1;
  }
  return { cuts, lead: cuts.length ? lead : -1 };
};

/** 줄(토글 제목이면 제목 글)에서 밑에 쓰기로 읽는 `>`의 자리들 */
export const nestCuts = (line: string): number[] => scanNest(line).cuts;

export interface NestRow { start: number; text: string }

/**
 * `>`로 나눈 행들(줄 안 시작 자리와 글). lead는 첫 `>` 앞의 `//` 앞에 따로 쓴 칸들(그 줄의 보통 칸), 없으면 null.
 * `>`가 없으면 null. 토글 제목(title)에 `//`가 있으면 `>`는 글자다.
 */
export const nestRowsOf = (body: string, title = false): { lead: NestRow | null; rows: NestRow[] } | null => {
  const { cuts, lead } = scanNest(body);
  if (!cuts.length || (title && lead >= 0)) return null;
  const piece = (start: number, end: number): NestRow => {
    const raw = body.slice(start, end);
    return { start: start + (raw.length - raw.trimStart().length), text: raw.trim() };
  };
  const first = lead >= 0 ? lead + 2 : 0;
  const bounds = [first - 1, ...cuts, body.length];
  return {
    lead: lead >= 0 ? piece(0, lead) : null,
    rows: bounds.slice(1).map((end, index) => piece(bounds[index] + 1, end))
  };
};

export const hasNestLines = (memo: string) => memo.includes('>') && memo.split('\n').some(line => nestCuts(line.startsWith(REVIEW_MEMO_TOGGLE_START) ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : line).length > 0);

/** 풀어 쓴 줄이 원래 어느 줄의 어디서 왔는가: 원래 줄 번호와, 그 줄(토글이면 제목 글) 안에서 이 행 글이 시작하는 자리. 끼워 넣은 토글 끝이면 null */
export interface NestOrigin { line: number; start: number; split: boolean }

export const expandNestLinesMapped = (lines: readonly string[]): { lines: string[]; origin: Array<NestOrigin | null> } => {
  const out: string[] = [];
  const origin: Array<NestOrigin | null> = [];
  /** 열린 토글마다 그 제목에서 더 연 토글 수(그 토글이 끝날 때 함께 닫는다) */
  const extra: number[] = [];
  lines.forEach((line, number) => {
    if (line === REVIEW_MEMO_TOGGLE_END) {
      const more = extra.pop() ?? 0;
      out.push(line); origin.push({ line: number, start: 0, split: false });
      for (let count = 0; count < more; count += 1) { out.push(REVIEW_MEMO_TOGGLE_END); origin.push(null); }
      return;
    }
    const toggle = line.startsWith(REVIEW_MEMO_TOGGLE_START);
    const body = toggle ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : line;
    const split = nestRowsOf(body, toggle);
    if (toggle) extra.push(split ? split.rows.length - 1 : 0);
    if (!split) { out.push(line); origin.push({ line: number, start: 0, split: false }); return; }
    if (split.lead && split.lead.text) { out.push(split.lead.text); origin.push({ line: number, start: split.lead.start, split: true }); }
    split.rows.forEach((row, index) => {
      const last = index === split.rows.length - 1;
      out.push(`${!last || toggle ? REVIEW_MEMO_TOGGLE_START : ''}${row.text}`);
      origin.push({ line: number, start: row.start, split: true });
    });
    if (!toggle) split.rows.slice(1).forEach(() => { out.push(REVIEW_MEMO_TOGGLE_END); origin.push(null); });
  });
  // 닫지 않은 토글에서 더 연 토글은 글 끝까지 열린 채로 둔다(닫지 않은 토글과 같다)
  return { lines: out, origin };
};

export const expandNestLines = (memo: string): string => (hasNestLines(memo) ? expandNestLinesMapped(memo.split('\n')).lines.join('\n') : memo);
