import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { reviewGroups } from './reviewFieldOverride';
import { reviewQuotes } from './reviewQuote';

/**
 * 토글 제목의 형식 `#`(29일, 4일 넓힘): 제목에 홀로 쓴 `#`은 아래 줄 값이 들어갈 자리다.
 *  - `#`이 여럿이면(`> A:#:V:#`) 아래 줄을 연결어(`:` `;` `<`)로 나눈 칸을 차례로 넣는다: `B:C` → `A:B:V:C`, `U:G` → `A:U:V:G`.
 *  - 칸이 모자라면 앞 자리부터 채우고 나머지 자리는 뺀다(그 앞 연결어까지): `B` → `A:B:V`.
 *  - 칸이 남으면 마지막 자리에 나머지를 그대로 넣는다(`#` 하나면 전처럼 줄 전체가 그 자리에 들어간다).
 *  - 형식 토글 밑의 형식 토글은 겹쳐 쓴다(`> A:#:V:#` 밑 `> B:#` = `> A:B:V:#`).
 * 제목 자신은 문제도 자리도 아니다. 단어에 붙은 `#`(C#)과 `#-#` 같은 틀 줄의 `#`는 자리가 아니다.
 */

const EDGE = /[\s:;<>()[\]]/;
const RELATION = ':;<';

/** 제목에서 형식 자리(`#`)들의 위치. 홀로 쓴 `#`이 하나도 없거나, 붙은 `#`이 섞였거나, 첫 자리 앞에 글이 없으면 [] */
export const frameSlotsOf = (title: string): number[] => {
  const quoted = reviewQuotes(title).edges;
  const sorted = [...quoted].sort((a, b) => a - b);
  const inQuote = (at: number) => sorted.some((open, index) => index % 2 === 0 && at > open && at < (sorted[index + 1] ?? -1));
  const hashes = [...title.matchAll(/#/g)].map(match => match.index!).filter(at => !inQuote(at));
  if (!hashes.length) return [];
  const alone = (at: number) => (title[at - 1] === undefined || EDGE.test(title[at - 1])) && (title[at + 1] === undefined || EDGE.test(title[at + 1]));
  if (!hashes.every(alone)) return [];
  return title.slice(0, hashes[0]).trim() ? hashes : [];
};

export const isFrameTitle = (title: string) => frameSlotsOf(title).length > 0;

export interface FramePart { start: number; end: number; text: string }

/** 줄을 맨 바깥 연결어(`:` `;` `<`)로 나눈 칸들(괄호 · 따옴표 · `{이름}` 안은 나누지 않는다)과 칸 사이 연결어 글 */
export const splitFrameParts = (line: string): { parts: FramePart[]; separators: string[] } => {
  const skip = reviewGroups(line).skip;
  const quoted = reviewQuotes(line).marks;
  const cuts: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (quoted.has(index)) continue;
    const jump = skip.get(index);
    if (jump !== undefined) { index = jump; continue; }
    if (line[index] === '{') { const close = line.indexOf('}', index); if (close > index) { index = close; continue; } }
    if (RELATION.includes(line[index])) cuts.push(index);
  }
  // 붙여 쓴 연결어(`::`)는 하나의 칸 경계다
  const runs: Array<{ start: number; end: number }> = [];
  cuts.forEach(cut => { const last = runs.at(-1); if (last && last.end === cut) last.end = cut + 1; else runs.push({ start: cut, end: cut + 1 }); });
  const parts: FramePart[] = [];
  const separators: string[] = [];
  let from = 0;
  runs.forEach(run => {
    parts.push({ start: from, end: run.start, text: line.slice(from, run.start).trim() });
    separators.push(line.slice(run.start, run.end));
    from = run.end;
  });
  parts.push({ start: from, end: line.length, text: line.slice(from).trim() });
  return { parts, separators };
};

/** 형식에 줄을 넣은 글. 형식이 아니면 null */
export const fillFrame = (frame: string, line: string): string | null => {
  const slots = frameSlotsOf(frame);
  if (!slots.length) return null;
  const { parts } = splitFrameParts(line);
  const filled = parts.filter(part => part.text);
  if (!filled.length) return null;
  let text = '';
  let from = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const at = slots[index];
    if (index >= filled.length) {
      // 칸이 모자라면 남은 자리는 뺀다: 자리 앞의 연결어와 빈칸까지
      text += frame.slice(from, at);
      return text.replace(/\s*[:;<]+\s*$/, '').trimEnd();
    }
    const last = index === slots.length - 1;
    const value = last && filled.length > slots.length ? line.slice(filled[index].start).trim() : filled[index].text;
    text += frame.slice(from, at) + value;
    from = at + 1;
  }
  return text + frame.slice(from);
};

/** 형식의 자리마다 칸 번호(0부터, 형식 맨 앞 칸이 0). 자리가 맨 바깥 칸 하나가 아니면 null */
export const frameSlotColumns = (frame: string): number[] | null => {
  const slots = frameSlotsOf(frame);
  if (!slots.length) return null;
  const { parts, separators } = splitFrameParts(frame);
  const columns: number[] = [];
  let column = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) column += separators[index - 1].length;
    if (parts[index].text === '#') columns.push(column);
    else if (parts[index].text.includes('#') && slots.some(at => at >= parts[index].start && at < parts[index].end)) return null;
  }
  return columns.length === slots.length ? columns : null;
};

/**
 * 형식 토글 밑의(형식이 아닌) 하위 토글 아래 줄: 그 줄의 칸들은 하위 토글 제목의 칸들이 들어간 자리(`#`)에 차례로 놓인다(4일 요청:
 * `> A:#:V:#` 밑 `> B:C` 밑 `X:Y`는 X가 B 자리, Y가 C 자리). 자리 사이에 형식 칸이 있으면 같은 연결어를 겹쳐 써(`X::Y`) 그만큼 건너뛴다.
 * 형식의 고정 칸 자리에 놓으려면 그 칸 이름을 `[ ]`로 꼭 쓴다(4일: 연결): `[A] X:D:[V] Y:B`는 X가 A 자리, D가 B 자리, Y가 V 자리, B가 C 자리.
 * `[ ]`가 없는 칸은 앞 칸 다음의 `#` 자리로 간다(남은 `#` 자리가 없으면 바로 다음 칸).
 * 첫 칸의 칸 번호와 그렇게 고친 줄을 돌려준다. 자리를 셀 수 없으면 null
 */
export const placeUnderFrame = (frame: string, line: string): { column: number; text: string } | null => {
  const columns = frameSlotColumns(frame);
  if (!columns) return null;
  const frameSplit = splitFrameParts(frame);
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  /** 형식 고정 칸 이름 → 칸 번호 */
  const named = new Map<string, number>();
  let column = 0;
  frameSplit.parts.forEach((part, index) => {
    if (index > 0) column += frameSplit.separators[index - 1].length;
    if (part.text !== '#') named.set(norm(part.text), column);
  });
  const { parts, separators } = splitFrameParts(line);
  const markOf = (text: string) => { const match = /^\[([^\[\]]+)\]/.exec(text.trim()); return match ? named.get(norm(match[1])) : undefined; };
  const placed: number[] = [];
  parts.forEach((part, index) => {
    const marked = markOf(part.text);
    if (marked !== undefined) { placed.push(marked); return; }
    const previous = index > 0 ? placed[index - 1] : -1;
    const slot = columns.find(at => at > previous);
    placed.push(slot ?? previous + 1);
  });
  if (placed.some((at, index) => index > 0 && at <= placed[index - 1])) return null;
  let text = parts[0].text;
  for (let index = 1; index < parts.length; index += 1) {
    const mark = separators[index - 1][separators[index - 1].length - 1];
    text += `${mark.repeat(placed[index] - placed[index - 1])}${parts[index].text}`;
  }
  return { column: placed[0], text };
};

/**
 * 합친 줄(형식에 넣은 글을 고친 것)을 다시 아래 줄 글로 돌린다(4일: 연결 · 첨가). 형식의 고정 칸이 그대로여야 하고, 자리마다의 칸이 아래 줄 칸이 된다.
 * 칸 사이 연결어는 원래 아래 줄의 것을 쓰고, 새로 생긴 칸은 합친 줄의 연결어를 쓴다. 돌릴 수 없으면 null
 */
export const unfillFrame = (frame: string, merged: string, original: string): string | null => {
  const columns = frameSlotColumns(frame);
  if (!columns) return null;
  const frameSplit = splitFrameParts(frame);
  const mergedSplit = splitFrameParts(merged);
  if (frameSplit.separators.some(separator => separator.length > 1) || mergedSplit.separators.some(separator => separator.length > 1)) return null;
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  // 합친 줄은 원래 펼친 줄의 칸을 모두 가져야 한다(칸이 줄면 줄 구조가 바뀐 합치기다)
  const before = fillFrame(frame, original);
  if (!before || mergedSplit.parts.length < splitFrameParts(before).parts.length) return null;
  const fixed = frameSplit.parts.map(part => part.text);
  const lastSlot = fixed.lastIndexOf('#');
  // 마지막 자리 뒤에 고정 칸이 있으면 합친 줄의 길이가 형식과 같아야 한다
  if (lastSlot < fixed.length - 1 && mergedSplit.parts.length !== fixed.length) return null;
  const values: string[] = [];
  for (let index = 0; index < fixed.length; index += 1) {
    const part = mergedSplit.parts[index];
    if (!part) break;
    if (fixed[index] === '#') {
      if (index === lastSlot && mergedSplit.parts.length > fixed.length) {
        values.push(merged.slice(part.start).trim());
        break;
      }
      values.push(part.text);
    } else if (norm(part.text) !== norm(fixed[index])) return null;
  }
  if (!values.length) return null;
  const originalSplit = splitFrameParts(original);
  return values.reduce((text, value, index) => (index === 0 ? value : `${text}${originalSplit.separators[index - 1] ?? ':'}${value}`), '');
};

/**
 * 노트 글에서 형식 토글을 펼친다(집합 · 관계도 읽기용): 형식 토글은 없어지고 아래 줄이 형식에 넣은 줄이 된다.
 * 형식 토글 밑의 형식 토글은 겹친 형식으로, 형식이 아닌 하위 토글은 제목을 형식에 넣은 토글로 남기고 그 아래 줄은 그대로 둔다.
 */
export const expandFrameLines = (memo: string): string => {
  if (!memo.includes('#') || !memo.includes(REVIEW_MEMO_TOGGLE_START)) return memo;
  const out: string[] = [];
  /** 열린 토글마다: 그 토글이 형식이면 (겹친) 형식 글, 아니면 null. 형식 토글 줄은 쓰지 않았는지 */
  const stack: Array<{ frame: string | null; dropped: boolean }> = [];
  memo.split('\n').forEach(line => {
    const parent = stack.at(-1);
    const frame = parent?.frame ?? null;
    if (line === REVIEW_MEMO_TOGGLE_END) {
      const closing = stack.pop();
      if (!closing?.dropped) out.push(line);
      return;
    }
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
      const title = line.slice(REVIEW_MEMO_TOGGLE_START.length);
      if (isFrameTitle(title)) {
        stack.push({ frame: frame ? fillFrame(frame, title) ?? title : title, dropped: true });
        return;
      }
      const filled = frame && title.trim() ? fillFrame(frame, title) : null;
      out.push(filled ? `${REVIEW_MEMO_TOGGLE_START}${filled}` : line);
      stack.push({ frame: null, dropped: false });
      return;
    }
    if (frame && line.trim()) { out.push(fillFrame(frame, line) ?? line); return; }
    out.push(line);
  });
  return out.join('\n');
};
