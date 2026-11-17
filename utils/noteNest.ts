import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { reviewGroups } from './reviewFieldOverride';
import { reviewQuotes } from './reviewQuote';

/**
 * 줄 안의 `>`로 밑에 쓰기(3일 요청): 완전한 한 행 뒤에 `>`가 있으면, `>` 뒤의 행은 그 행 밑(토글 아래)에 쓴 것처럼 읽는다.
 *  - `[A] > [B] A:[N] C`는 `> [A]` 토글 밑에 `[B] A:[N] C`를 쓴 것과 같다.
 *  - 여러 번 쓰면 차례로 더 깊어진다: `X > Y > Z`는 X 밑에 Y, Y 밑에 Z.
 *  - 토글 제목에 쓰면(`> X > Y`) 그 토글 안의 줄들은 마지막 행(Y) 밑에 있다.
 *  - 앞이 덜 끝난 행(`자동차 : > 바퀴 : 4개`)이면 줄 끝이 열린 줄(`자동차 :` 밑 줄 `바퀴 : 4개`)과 같다(3일). 뒤 행은 앞 행의 칸 수만큼 뒤 칸에서 이어진다.
 *  - 앞이 비었거나 뒤가 비면, 또 연결어에 붙여 쓴 `=>` `->` `:>`는 `>`가 그냥 글자다.
 *    `[ ]` `( )` 안과 따옴표 안의 `>`, `>>` · `>=`도 글자다.
 *  - `//`로 칸을 나눈 줄에서 `>` 앞의 행은 바로 앞 `//` 뒤부터다: `a : b // X > c : d`는 `a : b`와 X 밑의 `c : d`다.
 *    17일 "// 뒤와 완전히 분리": `>` 뒤 행은 다음 `//`까지다. `X > a : b // c : d`는 X 밑의 `a : b`와 따로 쓴 `c : d`다
 *    (`//` 뒤는 새 줄처럼 다시 읽는다: `X > a // Y > b`는 X 밑의 a, Y 밑의 b). 토글 제목에 `//`가 있으면 `>`는 글자다.
 * 문제 만들기 · 관계도 · 집합 읽기가 이 글을 쓰고, 노트에 저장된 글은 바뀌지 않는다.
 */

/**
 * 17일 "`//`면 모든 곳에서 엔터 친 것처럼": 줄 안의 `//`(괄호 · 따옴표 밖)를 줄바꿈으로 풀어 쓴 줄들.
 * 보통 줄은 조각마다 한 줄, 토글 제목의 `//` 뒤 조각은 그 토글 안 첫 줄들이 된다(제목에서 엔터를 친 것과 같다).
 * 빈 조각은 버린다. origin.start는 원래 줄(토글이면 제목 글) 안에서 조각 글이 시작하는 자리다.
 */
const slashCuts = (line: string): number[] => {
  if (!line.includes('//')) return [];
  const groups = reviewGroups(line).skip;
  const edges = [...reviewQuotes(line).edges].sort((a, b) => a - b);
  const quoteEnd = new Map<number, number>();
  for (let at = 0; at + 1 < edges.length; at += 2) quoteEnd.set(edges[at], edges[at + 1]);
  const cuts: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const closing = quoteEnd.get(index);
    if (closing !== undefined) { index = closing; continue; }
    const jump = groups.get(index);
    if (jump !== undefined) { index = jump; continue; }
    if (line[index] === '/' && line[index + 1] === '/') { cuts.push(index); while (line[index + 1] === '/') index += 1; }
  }
  return cuts;
};

const slashPieces = (body: string): NestRow[] => {
  const cuts = slashCuts(body);
  if (!cuts.length) return [];
  const pieces: NestRow[] = [];
  let from = 0;
  [...cuts, body.length].forEach(cut => {
    const raw = body.slice(from, cut);
    if (raw.trim()) pieces.push({ start: from + (raw.length - raw.trimStart().length), text: raw.trim() });
    from = cut;
    while (body[from] === '/') from += 1;
  });
  return pieces;
};

export const expandSlashLinesMapped = (lines: readonly string[]): { lines: string[]; origin: NestOrigin[] } => {
  const out: string[] = [];
  const origin: NestOrigin[] = [];
  lines.forEach((line, number) => {
    const toggle = line.startsWith(REVIEW_MEMO_TOGGLE_START);
    const body = toggle ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : line;
    const pieces = line === REVIEW_MEMO_TOGGLE_END ? [] : slashPieces(body);
    if (!pieces.length) { out.push(line); origin.push({ line: number, start: 0, split: false }); return; }
    // 토글 제목이 `//`로 시작하면(제목 글 없음) 제목은 비고 조각들이 안으로 들어간다
    const titleEmpty = toggle && !body.slice(0, slashCuts(body)[0]).trim();
    if (titleEmpty) { out.push(REVIEW_MEMO_TOGGLE_START); origin.push({ line: number, start: 0, split: true }); }
    pieces.forEach((piece, index) => {
      out.push(`${toggle && index === 0 && !titleEmpty ? REVIEW_MEMO_TOGGLE_START : ''}${piece.text}`);
      origin.push({ line: number, start: piece.start, split: true });
    });
  });
  return { lines: out, origin };
};

export const expandSlashLines = (memo: string): string => (memo.includes('//') ? expandSlashLinesMapped(memo.split('\n')).lines.join('\n') : memo);

/** 줄에서 밑에 쓰기로 읽는 `>`의 자리들과, 첫 `>` 앞의 마지막 `//`(그 앞은 따로 쓴 칸이다, 없으면 -1), 첫 `>` 뒤 첫 `//`(그 뒤는 따로 쓴 칸이다, 없으면 -1) */
const scanNest = (line: string): { cuts: number[]; lead: number; tail: number } => {
  if (!line.includes('>')) return { cuts: [], lead: -1, tail: -1 };
  const groups = reviewGroups(line).skip;
  // 따옴표 `'…'` 안은 건너뛴다(여는 것과 닫는 것이 차례로 짝을 이룬다)
  const edges = [...reviewQuotes(line).edges].sort((a, b) => a - b);
  const quoteEnd = new Map<number, number>();
  for (let at = 0; at + 1 < edges.length; at += 2) quoteEnd.set(edges[at], edges[at + 1]);
  const cuts: number[] = [];
  let from = 0;
  let lead = -1;
  let tail = -1;
  for (let index = 0; index < line.length; index += 1) {
    const closing = quoteEnd.get(index);
    if (closing !== undefined) { index = closing; continue; }
    const jump = groups.get(index);
    if (jump !== undefined) { index = jump; continue; }
    if (line[index] === '/' && line[index + 1] === '/') {
      if (cuts.length) { tail = index; break; }
      lead = index; from = index + 2; index += 1; continue;
    }
    if (line[index] !== '>') continue;
    if (line[index + 1] === '>' || line[index + 1] === '=' || line[index - 1] === '>') continue;
    const before = line.slice(from, index);
    const after = line.slice(index + 1).trim();
    // 연결어에 붙여 쓴 `>`(`=>` `->` `:>`)는 화살표 글자다. 띄어 쓴 `A : > B`는 덜 끝난 행 밑에 쓴 것이다(3일: 줄 끝이 열린 줄과 같다)
    if (!before.trim() || /[:;<,\-=]$/.test(before) || !after || after.startsWith(':::')) continue;
    cuts.push(index);
    from = index + 1;
  }
  return { cuts, lead: cuts.length ? lead : -1, tail: cuts.length ? tail : -1 };
};

/** 줄(토글 제목이면 제목 글)에서 밑에 쓰기로 읽는 `>`의 자리들 */
export const nestCuts = (line: string): number[] => {
  const { cuts, tail } = scanNest(line);
  // 17일: `//` 뒤(tail)는 새 줄처럼 다시 읽으니 그 안의 `>`도 밑에 쓰기다
  return tail >= 0 ? [...cuts, ...nestCuts(line.slice(tail + 2)).map(at => at + tail + 2)] : cuts;
};

export interface NestRow { start: number; text: string }

/**
 * `>`로 나눈 행들(줄 안 시작 자리와 글). lead는 첫 `>` 앞의 `//` 앞에 따로 쓴 칸들(그 줄의 보통 칸), 없으면 null.
 * tail은 마지막 행 뒤 `//` 뒤의 글(17일: 따로 쓴 칸, 새 줄처럼 다시 읽는다), 없으면 null.
 * `>`가 없으면 null. 토글 제목(title)에 `//`가 있으면 `>`는 글자다.
 */
export const nestRowsOf = (body: string, title = false): { lead: NestRow | null; rows: NestRow[]; tail: NestRow | null; tailFrom: number } | null => {
  const { cuts, lead, tail } = scanNest(body);
  if (!cuts.length || (title && (lead >= 0 || tail >= 0))) return null;
  const piece = (start: number, end: number): NestRow => {
    const raw = body.slice(start, end);
    return { start: start + (raw.length - raw.trimStart().length), text: raw.trim() };
  };
  const first = lead >= 0 ? lead + 2 : 0;
  const bounds = [first - 1, ...cuts, tail >= 0 ? tail : body.length];
  return {
    lead: lead >= 0 ? piece(0, lead) : null,
    rows: bounds.slice(1).map((end, index) => piece(bounds[index] + 1, end)),
    tail: tail >= 0 ? piece(tail + 2, body.length) : null,
    /** tail 글이 시작하는 자리(`//` 바로 뒤), 없으면 -1 */
    tailFrom: tail >= 0 ? tail + 2 : -1
  };
};

export const hasNestLines = (memo: string) => memo.includes('//') || (memo.includes('>') && memo.split('\n').some(line => nestCuts(line.startsWith(REVIEW_MEMO_TOGGLE_START) ? line.slice(REVIEW_MEMO_TOGGLE_START.length) : line).length > 0));

/** 풀어 쓴 줄이 원래 어느 줄의 어디서 왔는가: 원래 줄 번호와, 그 줄(토글이면 제목 글) 안에서 이 행 글이 시작하는 자리. 끼워 넣은 토글 끝이면 null */
export interface NestOrigin { line: number; start: number; split: boolean }

/** `//`를 줄바꿈으로 푼 뒤(17일) `>`로 밑에 쓴 행을 토글로 푼다. origin은 원래 줄 기준이다 */
export const expandNestLinesMapped = (lines: readonly string[]): { lines: string[]; origin: Array<NestOrigin | null> } => {
  const slashed = expandSlashLinesMapped(lines);
  const nested = expandNestOnlyMapped(slashed.lines);
  return {
    lines: nested.lines,
    origin: nested.origin.map(origin => {
      if (!origin) return null;
      const from = slashed.origin[origin.line];
      return { line: from.line, start: from.start + origin.start, split: from.split || origin.split };
    })
  };
};

const expandNestOnlyMapped = (lines: readonly string[]): { lines: string[]; origin: Array<NestOrigin | null> } => {
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
    if (toggle) {
      const split = nestRowsOf(line.slice(REVIEW_MEMO_TOGGLE_START.length), true);
      extra.push(split ? split.rows.length - 1 : 0);
      if (!split) { out.push(line); origin.push({ line: number, start: 0, split: false }); return; }
      split.rows.forEach(row => { out.push(`${REVIEW_MEMO_TOGGLE_START}${row.text}`); origin.push({ line: number, start: row.start, split: true }); });
      return;
    }
    // 보통 줄: 마지막 행 뒤 `//` 뒤(tail)는 행들의 토글을 닫은 뒤 새 줄처럼 다시 읽는다(17일)
    const emit = (body: string, base: number, whole: boolean) => {
      const split = nestRowsOf(body, false);
      if (!split) {
        if (whole) { out.push(line); origin.push({ line: number, start: 0, split: false }); }
        else if (body.trim()) { out.push(body.trim()); origin.push({ line: number, start: base + (body.length - body.trimStart().length), split: true }); }
        return;
      }
      if (split.lead && split.lead.text) { out.push(split.lead.text); origin.push({ line: number, start: base + split.lead.start, split: true }); }
      split.rows.forEach((row, index) => {
        const last = index === split.rows.length - 1;
        out.push(`${!last ? REVIEW_MEMO_TOGGLE_START : ''}${row.text}`);
        origin.push({ line: number, start: base + row.start, split: true });
      });
      split.rows.slice(1).forEach(() => { out.push(REVIEW_MEMO_TOGGLE_END); origin.push(null); });
      if (split.tailFrom >= 0) emit(body.slice(split.tailFrom), base + split.tailFrom, false);
    };
    emit(line, 0, true);
  });
  // 닫지 않은 토글에서 더 연 토글은 글 끝까지 열린 채로 둔다(닫지 않은 토글과 같다)
  return { lines: out, origin };
};

export const expandNestLines = (memo: string): string => (hasNestLines(memo) ? expandNestLinesMapped(memo.split('\n')).lines.join('\n') : memo);
