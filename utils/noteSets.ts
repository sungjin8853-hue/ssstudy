import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { isReviewSlash } from './reviewSlash';
import { canonicalMark, looksLikeCriterion, readNoteSetLine, splitTitleCriteria, topLevelCuts } from './noteDiagram';
export { readNoteSetLine } from './noteDiagram';
export type { NoteSetLine } from './noteDiagram';
import type { NoteSetLine } from './noteDiagram';
import { matchingBracket, parseSetExpression } from './setExpression';
import type { SetExprNode } from './setExpression';
import { isNoteShorthandOn, relationMarks, trailingRelation } from './noteShorthand';
import { expandOpenLines } from './noteOpenTail';
import { reviewQuotes } from './reviewQuote';

/**
 * 집합과 능력 집합.
 *  - 모든 단어 셀은 집합이 "될 수 있는" 데이터다. 토글 제목이 집합이고, 셀 아래에 부분집합이 하나라도 생기면 그 셀도 집합이다(자기 자신은 가질 수 없다).
 *  - `[ ]`는 집합 위치·집합식이다. 안에서만 `.`(교집합) `,`(합집합) `%`(여집합: 같은 상위 집합 안의 나머지)를 쓴다.
 *    `[X]`만 홀로 쓰면 집합 그 자체라서 X 안의 모든 부분집합과 셀이다(부분집합의 부분집합까지).
 *  - `[집합식]:[기준]`은 능력 정의다: 그 집합 안의 데이터는 기준(예: 개념:정의)으로 유도한다.
 */
export interface AbilityDefinition {
  expression: string;
  criterion: string;
  /** 정의가 적힌 토글 경로(최상위면 빈 배열): 그 안에서만 적용된다 */
  scope: string[];
  /** 집합식의 결과(셀 이름, 띄어쓰기를 뺀 꼴) */
  members: string[];
}

export interface NoteSetIndex {
  /** 이름(띄어쓰기를 뺀 꼴) → 쓴 그대로의 이름 */
  display: ReadonlyMap<string, string>;
  /** 이름 → 바로 위 집합들 */
  parents: ReadonlyMap<string, readonly string[]>;
  /** 집합 이름 → 바로 아래 항목들(쓴 순서) */
  children: ReadonlyMap<string, readonly string[]>;
  /** 토글 제목이거나 아래에 항목이 있는 이름 */
  sets: ReadonlySet<string>;
  /** `[A:C] 단어`처럼 단어 셀 왼쪽에 쓴 위치 표시(또는 `[A:C]:(D,급수)` 정의): 표시 글(띄어쓰기를 뺀 꼴) → 그 위치에 있는 셀들 */
  marks: ReadonlyMap<string, MarkSet>;
  /** `marks` 중 셀 왼쪽에 직접 쓴 위치 표시만(능력적 정의가 집합으로 더해진 것은 빼고) */
  placements: ReadonlyMap<string, MarkSet>;
  abilities: readonly AbilityDefinition[];
  /** 연결어(`:` `;` `<`)가 한 번이라도 쓰인 셀(줄 맨 앞 셀과 연결어 뒤에 이어 쓴 값): `[?]`에는 이런 셀이 들지 않는다 */
  connected: ReadonlySet<string>;
}

export interface MarkSet {
  /** 쓴 그대로의 표시 글(`[ ]` 안쪽) */
  display: string;
  /** 그 위치에 있는 단어 셀 이름들(띄어쓰기를 뺀 꼴, 쓴 순서) */
  cells: readonly string[];
}

export const normSetName = (text: string) => text.replace(/\s+/g, '');

/**
 * `[?]`는 "연결어 없이 그냥 집합 안에 있는 셀"들의 집합이다: 어떤 집합 안(토글 아래 · `[A] 셀`)에 있으면서 `:` `;` `<` 어디에도 쓰이지 않은 셀.
 * `=`와 `-`는 연결어가 아니다. 집합 이름(아래 항목이 있는 것)은 셀이 아니라서 들지 않고, 어느 집합에도 없는 셀도 들지 않는다.
 */
export const UNCONNECTED_NAME = '?';
const isUnconnectedName = (text: string) => normSetName(text) === UNCONNECTED_NAME;

/** 위치 표시(`[ ]` 안쪽 글)를 가리키는 열쇠. `[a:b:c]`는 `[[a]:[b]:[c]]`를 줄인 것이라 둘은 같은 위치다. */
export const markKeyOf = (inner: string) => normSetName(canonicalMark(inner));

const isBracketGroup = (part: string) => { const end = matchingBracket(part, 0); return end > 0 && end === part.length - 1; };

/**
 * 글이 위치 사슬뿐이면 그 표준형(`a:b:c`), 아니면 null: `[a:b:c]` · `[a]:[b]:[c]` · `[[a]:[b]:[c]]`.
 * 토글 제목이 이것이면 그 아래 줄들은 그 위치에 있다(`[a:b:c] 셀`을 쓴 것과 같다).
 */
export const positionChainOf = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed[0] !== '[') return null;
  const cuts = topLevelCuts(trimmed, ':;<');
  // `[[a]:[b]:[c]]`: 바깥 `[ ]` 하나가 사슬 전체를 감싼 꼴
  if (!cuts.length && isBracketGroup(trimmed) && trimmed[1] === '[') return positionChainOf(trimmed.slice(1, -1));
  const bounds = [-1, ...cuts, trimmed.length];
  if (!bounds.slice(1).every((end, index) => isBracketGroup(trimmed.slice(bounds[index] + 1, end).trim()))) return null;
  const canonical = canonicalMark(trimmed);
  return topLevelCuts(canonical, ':;<').length > 0 ? canonical : null;
};

export const toggleName = (title: string) => {
  const cleaned = (text: string) => text.replace(/\{[^{}\n]*\}/g, '').replace(trailingRelation(), '').trim();
  // 제목이 위치 사슬뿐(`[a:b:c]`)이면 그 위치가 이름이다: 그 아래 줄은 그 위치의 집합 요소다
  return positionChainOf(cleaned(title)) ?? cleaned(splitTitleCriteria(title).head);
};

/** 줄을 `//`로 나눈 칸들 */
const segmentsOf = (line: string): string[] => {
  const cuts = topLevelCuts(line, '/').filter(cut => isReviewSlash(line, cut));
  const bounds = [-1, ...cuts, line.length];
  return bounds.slice(1).map((end, index) => line.slice(bounds[index] + 1, end).trim()).filter(Boolean);
};

/**
 * 칸의 맨 앞 셀(관계 기호 앞)과 그 셀에 붙은 `[ ]` 위치 표시들.
 * 위치 표시는 셀 왼쪽(`[A:C] 급수`)에 쓴다. 집합 기호(`.` `,` `%`)는 `[ ]` 안에서만 쓰므로(14:48 · 21:09)
 * `[A:C].급수`의 점은 셀 글자(`.급수`)이고, `급수.[A:C]`처럼 셀 뒤에 붙인 `[ ]`는 위치 표시가 아니다. 교집합은 `[급수.[A:C]] 급수`로 쓴다.
 */
export const splitHeadMarks = (segment: string): { cell: string; marks: string[] } => {
  const cuts = topLevelCuts(segment, relationMarks());
  let rest = (cuts.length ? segment.slice(0, cuts[0]) : segment).trim();
  const marks: string[] = [];
  // 셀 왼쪽의 `[ ]`들. 안쪽에 `[ ]`가 겹쳐도(`[급수.[A:C]] 급수`) 짝이 맞는 것 하나씩 뗀다.
  for (let end = matchingBracket(rest, 0); end > 0; end = matchingBracket(rest, 0)) {
    marks.push(rest.slice(1, end).trim());
    rest = rest.slice(end + 1).replace(/^\s*/, '');
  }
  rest = rest.trim();
  // `[집합]()`처럼 빈 괄호만 이은 것은 셀이 아니다(요소 보기 창을 여는 자리)
  if (/^\(\s*\)$/.test(rest)) rest = '';
  return { cell: rest, marks: marks.filter(Boolean) };
};

/**
 * 칸 왼쪽에 쓴 `[A:B;C]`가 분류기준으로 읽히는 글이면 그 안쪽 글(오른쪽에 쓴 값의 `:` `;`에 칸 이름 A, B, C가 적용된다), 아니면 undefined.
 * 칸이 둘 이상이고 `[ ]` `( )` `.` `,` `%`가 없는 글만 기준이다(`[도형.%삼각형]` 같은 집합식은 아니다). 가장 가까운(오른쪽) 것을 쓴다.
 */
export const leadingCriterionOf = (segment: string): string | undefined =>
  splitHeadMarks(segment).marks.filter(mark => looksLikeCriterion(mark) && !/[\[\]().,%]/.test(mark)).at(-1);

/** 칸의 맨 앞 셀(관계 기호 앞) 이름. 붙은 `[ ]` 위치 표시는 뺀다. */
export const headCellOf = (segment: string): string => splitHeadMarks(segment).cell;

/**
 * `#`는 모든 텍스트를 대신하는 자리다. `[A] #'-'#: #+#`처럼 줄 앞 `[ ]` 뒤 첫 칸에 `#`가 있고 칸이 둘 이상이면 틀이다:
 * A 안의 셀 중 첫 칸 꼴(`#'-'#`)에 맞는 모든 셀에 대해, 그 셀의 `#` 자리 값들을 나머지 칸의 `#`에 차례로 넣은 줄이 생긴다(`A:'B-C':'B+C'`).
 * 틀 안의 따옴표 `'…'`는 안의 글을 그대로(논리어도 `#`도 글자로) 쓴다: `#'-'#`의 `-`는 글자 `-`, `'#'`은 글자 `#`.
 */
export interface NoteTemplate {
  /** 줄 앞 `[ ]`들(집합 이름 · 집합식 · 위치) */
  marks: string[];
  /** 맞춰 볼 첫 칸 글(`#'-'#`) */
  pattern: string;
  /** 첫 칸 다음 칸들의 글(`#+#`) */
  results: string[];
  /** 칸 사이 관계 기호들: `separators[0]`은 첫 칸과 `results[0]` 사이 */
  separators: string[];
}
/** 틀 안의 `{A}` 자리에 들어갈 수 있는 글들을 알려 주는 함수(집합식 → 원소 글들). 없으면 `{ }`는 그냥 글자다. */
export type TemplateSlotOptions = (expression: string) => string[];
type TemplateToken =
  /** `#`: 아무 글. `exclude`가 있으면(`{#%집합}`) 그 집합의 원소를 하나도 품지 않은 아무 글 */
  | { any: true; exclude?: string[]; same?: undefined; slot?: undefined }
  /** `{A}`: 집합 A의 원소 하나 */
  | { slot: string[]; any?: false; same?: undefined }
  /** 결과 칸의 `{@}` `{@2}`: 첫 칸에서 맞은 자리 값(`{A}` · `{#%S}`)을 다시 쓴다. 번호가 없으면 차례로, 있으면 그 번째(1부터) */
  | { same: number | null; any?: false; slot?: undefined }
  | { any?: false; slot?: undefined; same?: undefined; text: string };
/** `{@}` `{@2}` → 번째(없으면 null). 자리 되부르기가 아니면 undefined */
const sameSlotOf = (expression: string): number | null | undefined => {
  const found = /^@\s*(\d*)$/.exec(expression);
  return found ? (found[1] ? Number(found[1]) : null) : undefined;
};
/** `{#%S}` → S. `#`에 제외 집합을 붙인 자리가 아니면 undefined */
const excludeSetOf = (expression: string): string | undefined => {
  const found = /^#\s*%\s*(.+)$/.exec(expression);
  return found ? found[1].trim() : undefined;
};
const unquote = (text: string) => text.replace(/^'([\s\S]*)'$/, '$1');
/**
 * 틀 칸 글을 `#`(아무 글 · 빈 글도 된다), `{A}`(집합 A의 원소 하나), 글자 덩어리로 가른다. 따옴표 안은 글자다(`#`도 `{ }`도 글자). 짝 없는 `'`는 그냥 글자.
 * `{A}`는 `optionsOf(A)`가 원소를 돌려줄 때만 자리다(집합이 아닌 `{원인}`은 그냥 글자).
 */
const templateTokens = (text: string, optionsOf?: TemplateSlotOptions): TemplateToken[] => {
  const tokens: TemplateToken[] = [];
  let literal = '';
  const flush = () => { if (literal) { tokens.push({ text: literal }); literal = ''; } };
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === "'") {
      const close = text.indexOf("'", at + 1);
      // 따옴표는 논리어(`- , =`)를 글자로 만들 뿐, 텍스트어 `#`는 따옴표 안에서도 자리다(`'#′'` → `x^2′`)
      if (close > at + 1) {
        text.slice(at + 1, close).split('#').forEach((piece, index) => { if (index) { flush(); tokens.push({ any: true }); } literal += piece; });
        at = close;
        continue;
      }
    }
    if (character === '#') { flush(); tokens.push({ any: true }); continue; }
    if (character === '{') {
      const close = text.indexOf('}', at + 1);
      const expression = close > at ? text.slice(at + 1, close).trim() : '';
      if (expression && !/[{\n]/.test(expression)) {
        // `{@}` `{@2}`: 앞 칸에서 맞은 자리 값을 다시 쓴다(결과 칸에서 쓴다)
        const same = sameSlotOf(expression);
        if (same !== undefined) { flush(); tokens.push({ same }); at = close; continue; }
        // `{#%S}`: 집합 S의 원소(기호)를 하나도 품지 않은 아무 글 — 수식의 한 덩어리를 집는다
        const excluded = excludeSetOf(expression);
        if (excluded !== undefined) { flush(); tokens.push({ any: true, exclude: (optionsOf?.(excluded) ?? []).map(unquote).filter(Boolean) }); at = close; continue; }
        const options = optionsOf ? optionsOf(expression) : [];
        if (options.length) { flush(); tokens.push({ slot: options }); at = close; continue; }
      }
    }
    literal += character;
  }
  flush();
  return tokens;
};
/** 줄 안의 `{집합식}` 한 자리: 글자 범위와 안의 집합식 */
export interface NoteSlot {
  start: number;
  end: number;
  expression: string;
}

/**
 * `{A}`에 들어갈 원소 글들: 집합 A의 뜻이라 쓴 자리(위치값 · 토글 경로)와 상관없이, 집합 A(토글 · 집합 정의)의 원소와
 * `[A] 셀`로 A 안에 쓴 셀을 모두 모은다(이름이 한 이름일 때). 같음 `=`으로 이은 셀(`[A] B=N=M`)은 B · N · M이 각각 원소다
 * (따옴표로 묶은 셀과 `=`가 논리어가 아닌 때는 한 원소). 원소의 따옴표는 그대로 둔다.
 */
export const slotCellsOf = (index: NoteSetIndex, expression: string): string[] => {
  const plain = !!expression.trim() && !/[.,%()[\]:;']/.test(expression);
  // 틀 줄과 자리 줄 자신(`#`·`{ }`가 든 셀)은 원소가 아니다(`{할로젠}2 : …` 줄의 머리가 `{할로젠}`의 원소로 들어가 `{할로젠}22`가 되던 일)
  const cells = [...evaluateSetExpression(index, expression), ...(plain ? evaluateSetExpression(index, `[${expression}]`) : [])].filter(cell => !/[#{}]/.test(cell));
  const pieces = cells.flatMap(cell => {
    if (!isNoteShorthandOn() || /^'[\s\S]*'$/.test(cell)) return [cell];
    // 따옴표 안의 `=`(`'='`)는 글자라서 원소를 나누지 않는다 → 기호 `=` 자체를 원소로 쓸 수 있다
    const literal = reviewQuotes(cell).literal;
    const cuts = topLevelCuts(cell, '=').filter(cut => !literal.has(cut));
    if (!cuts.length) return [cell];
    const bounds = [-1, ...cuts, cell.length];
    const parts = bounds.slice(1).map((end, at) => cell.slice(bounds[at] + 1, end).trim()).filter(Boolean);
    return parts.length > 1 ? parts : [cell];
  });
  return [...new Set(pieces)];
};

/**
 * 줄 안의 `{A}`를 "집합 A의 원소가 들어갈 자리"로 읽는다. 노트에 있는 집합(원소가 하나 이상)을 가리키는 것만 자리이고,
 * 집합이 아닌 이름(`:{원인}`처럼 칸 이름표로 쓴 것)은 자리가 아니다. 따옴표로 묶은 글 안에서도 자리다(`'{A}아, 반가워'`).
 */
export const readNoteSlots = (text: string, index: NoteSetIndex): NoteSlot[] => {
  if (!text.includes('{')) return [];
  const slots: NoteSlot[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== '{') continue;
    const close = text.indexOf('}', at + 1);
    if (close < 0) break;
    const expression = text.slice(at + 1, close).trim();
    if (expression && !/[{\n]/.test(expression) && slotCellsOf(index, expression).length > 0) {
      slots.push({ start: at, end: close + 1, expression });
      at = close;
    }
  }
  return slots;
};

/**
 * 자리마다 그 집합의 원소를 하나씩 넣은 줄들(여러 자리면 모든 짝, limit줄까지). 칸을 나누는 기호(`: ; <`)나 줄바꿈이 든 원소는
 * 따옴표로 묶여 있지 않으면 줄을 깨뜨리므로 쓰지 않는다.
 */
export const expandNoteSlots = (text: string, slots: NoteSlot[], index: NoteSetIndex, limit = 200): string[] => {
  const usable = (cell: string) => /^'[\s\S]*'$/.test(cell) || !/[:;<\n]/.test(cell);
  const options = slots.map(slot => [...new Set(slotCellsOf(index, slot.expression).filter(cell => cell.trim() && usable(cell)))]);
  let choices: string[][] = [[]];
  options.forEach(list => { choices = choices.flatMap(choice => list.map(cell => [...choice, cell])).slice(0, limit); });
  return choices.map(choice => {
    let out = '';
    let last = 0;
    slots.forEach((slot, at) => { out += text.slice(last, slot.start) + choice[at]; last = slot.end; });
    return out + text.slice(last);
  });
};

export const readNoteTemplate = (segment: string): NoteTemplate | null => {
  if (!segment.includes('#')) return null;
  const cuts = topLevelCuts(segment, relationMarks());
  if (!cuts.length) return null;
  const { cell, marks } = splitHeadMarks(segment);
  if (!marks.length || !templateTokens(cell).some(token => token.any)) return null;
  // 붙여 쓴 같은 연결어(`::`)는 칸 하나를 건너뛰는 하나의 기호다: 칸은 앞 기호 묶음의 마지막 기호 다음에서 다음 기호 묶음의 첫 기호까지
  const starts: number[] = [];
  const lasts: number[] = [];
  const separators: string[] = [];
  let run = 0;
  cuts.forEach((cut, index) => {
    if (!run) starts.push(cut);
    if (index + 1 < cuts.length && cuts[index + 1] === cut + 1 && segment[cut + 1] === segment[cut]) { run += 1; return; }
    lasts.push(cut);
    separators.push(segment[cut].repeat(run + 1));
    run = 0;
  });
  const results = lasts.map((last, at) => segment.slice(last + 1, at + 1 < starts.length ? starts[at + 1] : segment.length).trim());
  if (results.some(result => !result)) return null;
  return { marks, pattern: cell, results, separators };
};

/**
 * 셀 하나가 틀의 첫 칸 꼴에 맞으면 나머지 칸마다 글에 `#`를 차례로 채워 돌려준다(첫 `#` = 첫 값, 둘째 `#` = 둘째 값 …).
 * `#`는 빈 글도 된다(`#{A}+#`에 `CB+`는 `C` · `B` · 빈 글). `{A}`는 집합 A의 원소 하나이고, 나머지 칸의 `{A}`에는 첫 칸에서 맞은 원소가
 * 차례로 들어간다(`#{A}+# : #+{A}#`에 `CB+`는 `C+B`). 맞지 않거나, 나머지 칸에 첫 칸보다 `#`·`{ }`가 더 많아 채울 값이 모자라면 null이다.
 * 셀 글에 `#`가 있으면 틀 자체라서 null이다.
 */
export const fillNoteTemplate = (template: NoteTemplate, cell: string, optionsOf?: TemplateSlotOptions): string[] | null => {
  if (cell.includes('#')) return null;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = templateTokens(template.pattern, optionsOf);
  // 원소가 겹치면 더 긴 글이 먼저 맞게 한다(`B` · `BN`)
  const source = tokens.map(token => (token.any
    // `{#%S}`는 한 덩어리: S의 기호와 괄호를 품지 않는 가장 긴 글(빈 글은 안 됨). 보통 `#`는 가장 짧은 글.
    ? (token.exclude ? `((?:(?!${token.exclude.map(escape).join('|')})[^()\\n])+)` : '(.*?)')
    : token.slot ? `(${[...new Set(token.slot)].sort((a, b) => b.length - a.length).map(escape).join('|')})` : token.same !== undefined ? '' : escape(token.text))).join('');
  const found = new RegExp(`^${source}$`, 's').exec(cell);
  if (!found) return null;
  // `#`는 hashes, `{A}`와 `{#%S}`는 slots(첫 칸에 나온 순서)에 모은다. 결과 칸의 `{@n}`은 slots의 n번째다.
  const hashes: string[] = [];
  const slots: string[] = [];
  let group = 1;
  tokens.forEach(token => {
    if (token.any && token.exclude) slots.push(found[group++]);
    else if (token.any) hashes.push(found[group++]);
    else if (token.slot) slots.push(found[group++]);
  });
  const filled: string[] = [];
  for (const result of template.results) {
    let usedHash = 0;
    let usedSlot = 0;
    let lacking = false;
    filled.push(templateTokens(result, optionsOf).map(token => {
      if (token.any && !token.exclude) {
        if (usedHash >= hashes.length) { lacking = true; return '#'; }
        return hashes[usedHash++];
      }
      if (token.any || token.slot || token.same === null) {
        if (usedSlot >= slots.length) { lacking = true; return '{}'; }
        return slots[usedSlot++];
      }
      if (token.same !== undefined) {
        if (token.same < 1 || token.same > slots.length) { lacking = true; return '{}'; }
        return slots[token.same - 1];
      }
      return token.text;
    }).join(''));
    if (lacking) return null;
  }
  return filled;
};

export const buildNoteSetIndex = (memos: readonly string[]): NoteSetIndex => {
  const display = new Map<string, string>();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const sets = new Set<string>();
  const marks = new Map<string, { display: string; cells: string[] }>();
  const pending: { expression: string; criterion: string; scope: string[] }[] = [];
  const connected = new Set<string>();
  const see = (name: string) => { const key = normSetName(name); if (key && !display.has(key)) display.set(key, name.trim()); return key; };
  const link = (parent: string | undefined, child: string) => {
    if (!parent || parent === child) return;
    const up = parents.get(child) ?? []; if (!up.includes(parent)) parents.set(child, [...up, parent]);
    const down = children.get(parent) ?? []; if (!down.includes(child)) children.set(parent, [...down, child]);
    sets.add(parent);
  };
  const place = (inner: string, cell: string) => {
    const key = markKeyOf(inner);
    if (!key || !cell) return;
    const entry = marks.get(key) ?? { display: inner.trim(), cells: [] };
    if (!entry.cells.includes(cell)) entry.cells.push(cell);
    marks.set(key, entry);
  };
  memos.forEach(memo => {
    const stack: string[] = [];
    // 맨 끝이 덜 끝난 줄은 바로 밑 줄을 토글 아래 줄처럼 품는다
    expandOpenLines(memo).split('\n').forEach(line => {
      if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
        const key = see(toggleName(line.slice(REVIEW_MEMO_TOGGLE_START.length)));
        sets.add(key);
        link(stack[stack.length - 1], key);
        stack.push(key);
        return;
      }
      if (line === REVIEW_MEMO_TOGGLE_END) { stack.pop(); return; }
      segmentsOf(line).forEach(segment => {
        const parsed = readNoteSetLine(segment);
        if (parsed?.kind === 'ability') { pending.push({ expression: parsed.expression, criterion: parsed.criterion, scope: stack.map(key => display.get(key) ?? key) }); return; }
        if (parsed?.kind === 'define') {
          parsed.members.forEach(member => { const key = see(member); connected.add(key); link(stack[stack.length - 1], key); place(parsed.mark, key); });
          return;
        }
        if (parsed) return;
        // `#`가 든 틀(`[A] #-#: #+#`)은 셀이 아니라 셀을 만드는 틀이라 집합의 요소로 넣지 않는다
        if (readNoteTemplate(segment)) return;
        const { cell, marks: located } = splitHeadMarks(segment);
        if (!cell) return;
        const key = see(cell);
        link(stack[stack.length - 1], key);
        located.forEach(mark => place(mark, key));
        // 연결어(`:` `;` `<`)를 쓴 줄이면 맨 앞 셀과 연결어 뒤에 이어 쓴 값들이 이어진 셀이다
        const relationCuts = topLevelCuts(segment, relationMarks());
        if (relationCuts.length) {
          connected.add(key);
          relationCuts.forEach((cut, at) => {
            segment.slice(cut + 1, relationCuts[at + 1] ?? segment.length).split(',').forEach(piece => {
              const name = normSetName(splitHeadMarks(piece).cell.replace(/^['"]+|['"]+$/g, ''));
              if (name) connected.add(name);
            });
          });
        }
      });
    });
  });
  // 위치 표시가 이미 있는 집합 이름(또는 이름들)이면 그 셀들은 그 집합 안에 있다: `[포유류] 고래`, `[급수 A:C] V`
  // 텍스트 단위 셀(토글이 아니라 줄에 쓴 단어)도 `[ ]`에 넣으면 그 셀 밑의 값을 더하는 집합이 된다: `[삼각형] 직각삼각형`, `[삼각형]:(직각삼각형,예각삼각형)`
  const known = (name: string) => sets.has(name) || display.has(name);
  // `[수학.도형.삼각형]`처럼 이름들이 서로 위아래면(삼각형이 도형 안, 도형이 수학 안) 가장 안쪽 것만 잇는다: `[..삼각형]`을 풀어 쓴 꼴과 같다
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (parents.get(from) ?? []).some(parent => reaches(parent, target, seen));
  };
  marks.forEach((mark, key) => {
    const named = known(key) ? [key] : mark.display.split(/[.,%()]+/).map(normSetName).filter(known);
    const innermost = named.filter(setKey => !named.some(other => other !== setKey && reaches(other, setKey)));
    innermost.forEach(setKey => mark.cells.forEach(cell => link(setKey, cell)));
  });
  // `[급수.[A:C]]`처럼 위치 표시가 교집합식이면, 그 셀은 식 안의 위치 `[A:C]` 안에도 있다
  [...marks.values()].forEach(mark => {
    const node = parseSetExpression(mark.display);
    if (node?.type !== 'and') return;
    node.items.forEach(item => { if (item.type === 'mark') mark.cells.forEach(cell => place(item.inner, cell)); });
  });
  const index: NoteSetIndex = { display, parents, children, sets, marks, placements: marks, abilities: [], connected };
  const abilities = pending.map(item => ({ ...item, members: evaluateSetExpression(index, item.expression).map(normSetName) }));
  // 능력적 정의 `[집합식]:[기준]`는 그 자체가 집합이다: `[집합식:기준]`(= `[[집합식]:[기준]]`)이라는 위치이고, 그 요소는 정의가 걸린 셀들이다
  const withAbilities = new Map<string, MarkSet>([...marks].map(([key, mark]) => [key, { display: mark.display, cells: [...mark.cells] }]));
  abilities.forEach(ability => {
    const display = `${ability.expression}:${ability.criterion}`;
    const key = markKeyOf(display);
    const entry = withAbilities.get(key) ?? { display, cells: [] as string[] };
    ability.members.forEach(cell => { if (!(entry.cells as string[]).includes(cell)) (entry.cells as string[]).push(cell); });
    withAbilities.set(key, entry);
  });
  return { ...index, marks: withAbilities, placements: marks, abilities };
};

/**
 * 집합과 집합을 잇는 줄 `[집합(1)] : [집합(2)]`: 집합(1)의 하위값과 집합(2)의 하위값을 이어 주는 말이다.
 * 하위값이 어느 집합에 속하는지는 `[집합] 텍스트`로 저장한 소속에서 안다. 둘째 `[ ]`가 이름이 있는 집합일 때만 읽고,
 * 그렇지 않으면(`[도형]:[개념:정의]`처럼 칸 이름이거나 노트에 없는 이름) 지금처럼 능력 정의다.
 */
export interface SetLink {
  left: string;
  right: string;
  leftMembers: ReadonlySet<string>;
  rightMembers: ReadonlySet<string>;
}
/** 집합식 하나의 하위값들: 집합 아래에 쓴 항목과, `[집합] 텍스트`로 그 집합에 놓은 셀(그 아래 항목까지) */
const subValuesOf = (index: NoteSetIndex, expression: string): Set<string> => {
  const found = new Set(evaluateSetExpression(index, expression).map(normSetName));
  (index.marks.get(markKeyOf(expression))?.cells ?? []).forEach(cell => descendantsOf(index, cell).forEach(item => found.add(item)));
  return found;
};
export const setLinksOf = (memo: string): SetLink[] => {
  if (!/\]\s*:\s*\[/.test(memo)) return [];
  const index = buildNoteSetIndex([memo]);
  const isSet = (name: string) => index.sets.has(normSetName(name)) || index.marks.has(markKeyOf(name));
  const links: SetLink[] = [];
  index.abilities.forEach(ability => {
    if (topLevelCuts(ability.criterion, ':;<').length) return;
    const names = [...namesIn(ability.criterion), ...namesIn(ability.expression)];
    if (!names.length || !names.every(isSet)) return;
    const left = subValuesOf(index, ability.expression);
    const right = subValuesOf(index, ability.criterion);
    if (left.size && right.size) links.push({ left: ability.expression, right: ability.criterion, leftMembers: left, rightMembers: right });
  });
  return links;
};

/** 집합 안의 가장 아래 셀들(아래 항목이 없는 것)을 쓴 순서대로 */
const leavesOf = (index: NoteSetIndex, key: string, seen = new Set<string>()): string[] => {
  if (seen.has(key)) return [];
  seen.add(key);
  const down = index.children.get(key);
  if (!down || !down.length) return index.sets.has(key) ? [] : [key];
  return down.flatMap(child => leavesOf(index, child, seen));
};

const allLeaves = (index: NoteSetIndex): string[] => {
  const roots = [...index.display.keys()].filter(key => !(index.parents.get(key)?.length));
  return [...new Set(roots.flatMap(key => leavesOf(index, key)))];
};

const unique = (items: string[]) => [...new Set(items)];

/** 셀이 집합이면 그 안의 가장 아래 셀들, 아니면 자기 자신 */
const membersOfName = (index: NoteSetIndex, name: string): string[] => {
  const key = normSetName(name);
  if (!index.display.has(key)) return [];
  return index.sets.has(key) ? leavesOf(index, key) : [key];
};

/** 위치 표시 `[A:C]` 아래에 있는 셀들(집합이면 안의 셀들까지). 표시 글이 집합 이름과 같으면 그 집합도 더한다. */
const membersOfMark = (index: NoteSetIndex, inner: string): string[] => {
  const key = markKeyOf(inner);
  const placed = (index.marks.get(key)?.cells ?? []).flatMap(cell => membersOfName(index, index.display.get(cell) ?? cell));
  return unique([...placed, ...(index.display.has(key) ? membersOfName(index, inner) : [])]);
};

/** `[?]`: 어떤 집합 안에 있으면서 연결어가 쓰이지 않은 셀들(쓴 순서) */
const unconnectedCells = (index: NoteSetIndex): string[] => {
  const placed = new Set([...index.placements.values()].flatMap(mark => mark.cells));
  return [...index.display.keys()].filter(key => !index.sets.has(key) && !index.connected.has(key) && (placed.has(key) || (index.parents.get(key)?.length ?? 0) > 0));
};

const evaluateNode = (index: NoteSetIndex, node: SetExprNode): string[] => {
  if (node.type === 'name') return isUnconnectedName(node.name) ? unconnectedCells(index) : membersOfName(index, node.name);
  if (node.type === 'mark') return isUnconnectedName(node.inner) ? unconnectedCells(index) : membersOfMark(index, node.inner);
  if (node.type === 'or') return unique(node.items.flatMap(item => evaluateNode(index, item)));
  if (node.type === 'and') return node.items.map(item => evaluateNode(index, item)).reduce((left, right) => left.filter(cell => right.includes(cell)));
  const own = new Set(evaluateNode(index, node.of));
  const upper = node.of.type === 'name' ? index.parents.get(normSetName(node.of.name)) : undefined;
  const universe = upper?.length ? unique(upper.flatMap(parent => leavesOf(index, parent))) : allLeaves(index);
  return universe.filter(cell => !own.has(cell));
};

/**
 * 집합식을 계산한다. `,` 합집합 < `.` 교집합 < `%` 여집합.
 * 이름 하나(연산자 없음)는 그 집합의 바로 아래 항목이고, 연산자가 있으면 각 이름은 그 안의 모든 아래 셀로 셈한다.
 * `%X`는 X의 상위 집합 안에서 X가 아닌 나머지다(상위 집합이 없으면 노트 전체에서).
 */
export const evaluateSetExpression = (index: NoteSetIndex, expression: string): string[] => {
  const text = expression.trim();
  if (!text) return [];
  const toDisplay = (keys: string[]) => keys.map(key => index.display.get(key) ?? key);
  if (isUnconnectedName(text)) return toDisplay(unconnectedCells(index));
  // `[A:C]` 위치 표시나 `( )` 묶음이 들어간 식은 식 나무로 계산한다
  if (/[\[\]()]/.test(text)) {
    const node = parseSetExpression(text);
    return node ? toDisplay(unique(evaluateNode(index, node))) : [];
  }
  const simple = !/[.,%]/.test(text);
  if (simple) {
    // `[X]` 홀로는 집합 그 자체다: 그 안의 모든 부분집합과 셀을, 부분집합의 부분집합까지 쓴 순서대로(집합 이름도 그 자리에 든다)
    const key = normSetName(text);
    const ordered: string[] = [];
    const walk = (parent: string, path: ReadonlySet<string>) => (index.children.get(parent) ?? []).forEach(child => {
      ordered.push(child);
      if (!path.has(child)) walk(child, new Set([...path, child]));
    });
    walk(key, new Set([key]));
    return toDisplay(unique(ordered));
  }
  const members = (name: string): string[] => {
    if (isUnconnectedName(name)) return unconnectedCells(index);
    const key = normSetName(name);
    if (!index.display.has(key)) return [];
    return index.sets.has(key) ? leavesOf(index, key) : [key];
  };
  const complement = (name: string): string[] => {
    const key = normSetName(name);
    const own = new Set(members(name));
    const upper = index.parents.get(key);
    const universe = upper?.length ? unique(upper.flatMap(parent => leavesOf(index, parent))) : allLeaves(index);
    return universe.filter(cell => !own.has(cell));
  };
  const factor = (raw: string): string[] => {
    const trimmed = raw.trim();
    let negations = 0;
    while (trimmed[negations] === '%') negations += 1;
    const name = trimmed.slice(negations).trim();
    return negations % 2 === 1 ? complement(name) : members(name);
  };
  const terms = text.split(',').map(term => term.split('.').map(factor).reduce((left, right) => left.filter(item => right.includes(item))));
  return toDisplay(unique(terms.flat()));
};

/** 집합식으로 쓴 이름(연산자 위치)에서 따로 쓴 이름들 */
const namesIn = (expression: string) => expression.split(/[.,%]/).map(name => name.trim()).filter(Boolean);

/** 이름의 위치(속성): 바로 위 집합부터 위로 올라가며(가까운 것 먼저) 상위 집합들 */
export const ancestorsOf = (index: NoteSetIndex, name: string): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  let level = [normSetName(name)];
  while (level.length) {
    const next: string[] = [];
    level.forEach(key => (index.parents.get(key) ?? []).forEach(parent => {
      if (seen.has(parent)) return;
      seen.add(parent);
      result.push(parent);
      next.push(parent);
    }));
    level = next;
  }
  return result.map(key => index.display.get(key) ?? key);
};

/**
 * 이름의 위치를 화면에 보일 때 쓰는 글(`[ ]` 안쪽). 바로 위 집합(최하위 집합)은 늘 남기고, 그 위로는 상위 집합이 하나뿐이면
 * 그 위치를 생략해 `..`로 줄인다: A 안에 B가 있으면 `A.B` 대신 `..B`. 생략한 상위의 위로도 같은 규칙을 이어 가고,
 * 상위가 둘 이상이면 모두 보이며 각각 위로 계속 올라간다(`R1..B`: R1 아래 생략된 A 아래 B).
 * 관계가 바뀌면(상위가 늘면) 생략되었던 이름이 다시 보인다. 추천은 이 생략을 하지 않는다(`ancestorsOf` 그대로).
 */
export const displayedLocations = (index: NoteSetIndex, name: string, covered: ReadonlySet<string> = new Set(), full = false): string[] => {
  const shown = (key: string) => index.display.get(key) ?? key;
  const parentsOf = (key: string, seen: ReadonlySet<string>) => (index.parents.get(key) ?? []).filter(parent => !seen.has(parent));
  // 생략된 이름 위로 보여야 할 위치들(없으면 ['']): 상위가 하나뿐이면 계속 생략, 둘 이상이면 그 상위들이 보인다
  const above = (key: string, seen: ReadonlySet<string>): string[] => {
    const parents = parentsOf(key, seen);
    if (!parents.length) return [''];
    const next = new Set([...seen, key]);
    return parents.length === 1 ? above(parents[0], next) : parents.flatMap(parent => climb(parent, next));
  };
  // 보이는 이름 하나의 위치 글(위로 올라간 모양)
  const climb = (key: string, seen: ReadonlySet<string>): string[] => {
    const parents = parentsOf(key, seen);
    if (!parents.length) return [shown(key)];
    const next = new Set([...seen, key]);
    if (parents.length === 1) return above(parents[0], next).map(prefix => `${prefix}..${shown(key)}`);
    return parents.flatMap(parent => climb(parent, next).map(path => `${path}.${shown(key)}`));
  };
  // full: 생략 없이 맨 위부터 모두 쓴 위치(`수학.도형.삼각형`) — `..`를 풀어 쓸 때 쓴다
  const whole = (key: string, seen: ReadonlySet<string>): string[] => {
    const parents = parentsOf(key, seen);
    if (!parents.length) return [shown(key)];
    const next = new Set([...seen, key]);
    return parents.flatMap(parent => whole(parent, next).map(path => `${path}.${shown(key)}`));
  };
  const start = normSetName(name);
  // covered: 이미 줄 위의 토글 제목으로 알려진 집합들 — 그 집합 위치는 되풀이해 보일 필요가 없다
  const found = (index.parents.get(start) ?? []).filter(parent => !covered.has(parent)).flatMap(parent => (full ? whole(parent, new Set([start])) : climb(parent, new Set([start]))));
  return [...new Set(found)];
};

/**
 * `[ ]` 안에서 쓰는 중인 글자(typed)에 맞춰 추천할 이름들.
 * 뒤따르는 단어 셀(following)을 알면 그 셀의 위치·상위 집합들을, 모르면 쓴 모든 집합 이름을 보여 준다.
 */
export const suggestSetNames = (index: NoteSetIndex, typed: string, following?: string): string[] => {
  const key = normSetName(typed);
  const pool = following && index.display.has(normSetName(following))
    ? ancestorsOf(index, following)
    : [...index.sets].map(set => index.display.get(set) ?? set);
  return unique(pool.filter(name => normSetName(name) !== normSetName(following ?? '\u0000') && (!key || normSetName(name).includes(key))));
};

/**
 * 이 칸(맨 앞 셀 head, 토글 경로 path)에 걸리는 능력 정의들.
 * `[A:B]`는 능력 `[A]:[B]`가 적용되는 데 필요한 속성 조건을 줄인 꼴이라, 셀 왼쪽에 `[A:B]`를 쓰면 그 셀은 그 속성 위치에 있고 그 능력이 걸린다.
 */
export const abilitiesFor = (index: NoteSetIndex, head: string, path: readonly string[] = []): AbilityDefinition[] => {
  const key = normSetName(head);
  const inside = path.map(normSetName);
  const direct = index.abilities.filter(ability => ability.members.includes(key)
    && ability.scope.every((name, depth) => normSetName(name) === inside[depth]));
  const located = index.abilities.filter(ability => !direct.includes(ability)
    && (index.placements.get(markKeyOf(`${ability.expression}:${ability.criterion}`))?.cells ?? []).includes(key));
  return [...direct, ...located];
};

export const isNoteSetExpressionName = (index: NoteSetIndex, expression: string) => namesIn(expression).every(name => index.display.has(normSetName(name)));

export { noteCriterionOf } from './noteDiagram';

export interface QuestionAbility { cell: string; expression: string; criterion: string }

/**
 * 문제의 앞(prompt)·정답 셀이 능력 집합 안에 있으면 그 능력을 돌려준다: "정사각형 ∈ 도형 → 개념:정의".
 * 문제가 어느 토글(속성) 아래의 줄에서 나왔는지는 정답 칸 위치(nodeId)의 상위 토글 제목으로 안다.
 */
export const questionAbilities = (
  question: { promptSpans: readonly { nodeId: string; start: number; end: number }[]; answerSpans: readonly { nodeId: string; start: number; end: number }[] },
  nodes: readonly { id: string; parentId: string | null; text: string }[],
  setMemos: readonly string[]
): QuestionAbility[] => {
  if (!setMemos.length) return [];
  const index = buildNoteSetIndex(setMemos);
  if (!index.abilities.length) return [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result: QuestionAbility[] = [];
  [...question.promptSpans, ...question.answerSpans].forEach(span => {
    const node = byId.get(span.nodeId);
    if (!node) return;
    const path: string[] = [];
    for (let parent = node.parentId ? byId.get(node.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) path.unshift(toggleName(parent.text));
    const cell = headCellOf(node.text.slice(span.start, span.end));
    abilitiesFor(index, cell, path).forEach(ability => {
      if (!result.some(item => item.cell === cell && item.criterion === ability.criterion && item.expression === ability.expression)) {
        result.push({ cell, expression: ability.expression, criterion: ability.criterion });
      }
    });
  });
  return result;
};

export interface BracketContext {
  /** 바꿀 글자(쓰던 이름) 범위 */
  tokenStart: number;
  tokenEnd: number;
  /** 커서 앞까지 쓴 이름 */
  typed: string;
  /** `]` 뒤에 따라오는 단어 셀(있으면) */
  following?: string;
}

/** 추천을 만드는 데 쓰는 자세한 자리 정보 */
export interface BracketDetail extends BracketContext {
  /** `[`의 자리와 `]`의 자리(아직 안 닫았으면 -1) */
  open: number;
  close: number;
  /** `[ ]` 안의 글 전체(닫기 전이면 커서까지) */
  inner: string;
  /** 뒤따르는 단어 셀이 끝나는 자리 */
  followingEnd?: number;
  /** 뒤따르는 단어 셀 뒤에 다른 글이 없는가(줄 끝이나 `//` 앞) */
  standalone: boolean;
}

/** `[ ]` 안에서 이름과 이름을 가르는 논리어(겹친 `[ ]`도 이름을 가른다) */
const BRACKET_LOGIC = '.,%:;<=()[]';

/**
 * 커서가 같은 줄의 `[ ]` 안에 있는지 읽는다(추천은 `[ ]` 안에서만 뜬다. `]`로 닫은 뒤에는 뜨지 않는다).
 * `[급수.[A:C]]`처럼 겹쳐 있으면 커서가 들어 있는 가장 안쪽 `[ ]`를 본다.
 * 안에 `:` `;` 같은 논리어가 있어도 추천은 뜬다 — 커서 앞 마지막 논리어 뒤의 글이 쓰던 이름이다.
 */
export const bracketDetail = (text: string, caret: number): BracketDetail | null => {
  const lineStart = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1;
  const opened: number[] = [];
  for (let position = lineStart; position < caret; position += 1) {
    if (text[position] === '[') opened.push(position);
    else if (text[position] === ']') opened.pop();
  }
  if (!opened.length) return null;
  const open = opened[opened.length - 1];
  const lineEndAt = text.indexOf('\n', caret);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  // 커서 뒤에서 이 `[`와 짝이 맞는 `]`
  let close = -1;
  for (let position = caret, depth = 0; position < lineEnd; position += 1) {
    if (text[position] === '[') depth += 1;
    else if (text[position] === ']') {
      if (depth === 0) { close = position; break; }
      depth -= 1;
    }
  }
  let tokenStart = open + 1;
  for (let index = caret - 1; index > open; index -= 1) {
    if (BRACKET_LOGIC.includes(text[index])) { tokenStart = index + 1; break; }
  }
  while (tokenStart < caret && /\s/.test(text[tokenStart])) tokenStart += 1;
  let tokenEnd = caret;
  // 닫는 `]`가 없으면 아직 쓰는 중이라 커서 앞까지만 바꾼다
  if (close >= 0) while (tokenEnd < close && !BRACKET_LOGIC.includes(text[tokenEnd])) tokenEnd += 1;
  const written = text.slice(tokenStart, caret);
  let following: string | undefined;
  let followingEnd: number | undefined;
  let standalone = true;
  if (close >= 0) {
    const after = text.slice(close + 1, lineEnd);
    const lead = /^\s*/.exec(after)![0].length;
    const rest = after.slice(lead);
    const raw = rest.split(isNoteShorthandOn() ? /[:;<=,\-/()\[\]]/ : /[:;<,/()\[\]]/)[0];
    const word = raw.trim();
    if (word) {
      following = word;
      followingEnd = close + 1 + lead + raw.replace(/\s+$/, '').length;
      const remainder = text.slice(followingEnd, lineEnd).trim();
      standalone = !remainder || remainder.startsWith('//');
    }
  }
  return {
    tokenStart, tokenEnd, typed: written.trim(), following,
    open, close,
    inner: text.slice(open + 1, close >= 0 ? close : caret).trim(),
    followingEnd, standalone
  };
};

export const bracketContext = (text: string, caret: number): BracketContext | null => {
  const detail = bracketDetail(text, caret);
  return detail ? { tokenStart: detail.tokenStart, tokenEnd: detail.tokenEnd, typed: detail.typed, following: detail.following } : null;
};

export interface BracketSuggestion {
  /** 넣을 글(`[ ]` 안쪽 내용) */
  text: string;
  /** 목록에 보이는 글: 넣을 글을 그 `[ ]`로 감싼 꼴(예: `[급수.[A:C]]`). 이름 추천은 넣을 글 그대로. */
  label: string;
  /** 바꿀 범위: 항상 `[ ]` 안쪽이다(닫는 `]` 뒤의 글은 건드리지 않는다) */
  from: number;
  to: number;
  /** 오른쪽에 작게 보이는 종류 */
  tag: '토글' | '교집합' | '상위' | '정의' | '위치';
  /** 넣은 뒤 커서 자리: 넣은 글 앞에서부터의 글자 수(없으면 넣은 글 바로 뒤).  */
  caret?: number;
}

/** 집합 아래로 이어진 모든 항목(자기 자신 포함) */
const descendantsOf = (index: NoteSetIndex, key: string): Set<string> => {
  const seen = new Set<string>([key]);
  const stack = [key];
  while (stack.length) {
    (index.children.get(stack.pop()!) ?? []).forEach(child => { if (!seen.has(child)) { seen.add(child); stack.push(child); } });
  }
  return seen;
};

/**
 * `[ ]` 안 추천 목록(위에서부터).
 *  1. 토글 연결값: 뒤따르는 단어 셀의 위치·상위 집합(없으면 쓴 모든 집합 이름) — `:` 같은 논리어를 써도 뜬다.
 *  2. `[A:C] 급수`처럼 조건 `[A:C]`와 단어 셀을 함께 쓰면, 그 조건 자리에 다른 셀이 없을 때는 둘의 교집합 `급수.[A:C]`,
 *     같은 조건 아래 다른 셀이 이미 있으면 조건이 그 셀들의 상위 집합이라 `[A:C].급수`·`[A:C].(D,급수..)`·`[A:C]:(D,급수)`를 추천한다.
 *     추천은 언제나 `[ ]` 안쪽 글을 바꾸므로 결과는 `[급수.[A:C]] 급수`처럼 집합 기호가 `[ ]` 안에 있다.
 *     (여러 페이지 노트를 이어 붙인 전체에서 같은 조건이 어떻게 쓰였는지로 정한다.)
 */
export const bracketSuggestions = (index: NoteSetIndex, detail: BracketDetail): BracketSuggestion[] => {
  const result: BracketSuggestion[] = [];
  const seen = new Set<string>();
  const add = (item: Omit<BracketSuggestion, 'label'> & { label?: string }) => {
    const id = `${item.from}:${item.to}:${item.text}`;
    if (seen.has(id)) return;
    seen.add(id);
    result.push({ ...item, label: item.label ?? item.text });
  };
  const linked = (typed: string) => suggestSetNames(index, typed, detail.following).filter(name => normSetName(name) !== normSetName(typed));
  const names = linked(detail.typed);
  const from = detail.tokenStart;
  names.forEach(text => add({ text, from, to: detail.tokenEnd, tag: '토글' }));
  // 구조 추천은 `[ ]` 안쪽 내용 전체를 바꾼다: `[A:C] 급수` → `[급수.[A:C]] 급수`. 닫는 `]`와 그 뒤의 글은 그대로 둔다.
  if (detail.close >= 0 && detail.following && !/[\[\]]/.test(detail.inner) && /[:;<=]/.test(detail.inner)) {
    const cell = detail.following;
    const mark = detail.inner;
    const others = (index.marks.get(markKeyOf(mark))?.cells ?? [])
      .filter(key => key !== normSetName(cell))
      .map(key => index.display.get(key) ?? key);
    const range = { from: detail.open + 1, to: detail.close };
    const offer = (text: string, tag: BracketSuggestion['tag']) => add({ ...range, text, label: `[${text}]`, tag });
    if (!others.length) {
      offer(`${cell}.[${mark}]`, '교집합');
    } else {
      offer(`[${mark}].${cell}`, '상위');
      if (detail.standalone) {
        const list = [cell, ...others.slice(0, 4)];
        offer(`[${mark}].(${list.join(',')}..)`, '상위');
        offer(`[${mark}]:(${list.join(',')})`, '정의');
      }
    }
  }
  return result;
};

/** 정리노트에 "쓰인 것처럼" 보이는 위치: 글의 `line`번째 줄(0부터)의 맨 앞 셀이 가진 위치 `[..B]`들 */
/** label: 줄 앞에 보이는 위치(`[..B]`) · full: 생략 없이 푼 위치(`[A.B]`): 지우개로 `..`를 풀 때 실제 글자로 들어간다 */
export interface GhostLocation { line: number; label: string; full: string }

/**
 * 글의 각 줄 맨 앞 셀의 위치를 `[..B]` 꼴로 계산한다(저장하는 글에는 쓰지 않는 보이기용). 위치 생략 규칙(`displayedLocations`)을 따르므로
 * 관계가 바뀌면 `..`가 풀린다. 빈 줄 · 집합을 적은 줄(`[X]` · `[집합식]:[기준]` · `[개념:정의]`) · 이미 `[ ]`로 위치를 쓴 칸 · 위치를 모르는 셀은 뺀다.
 */
export const ghostLocationsOf = (index: NoteSetIndex, text: string, enclosing: readonly string[] = []): GhostLocation[] => {
  const result: GhostLocation[] = [];
  const covered = new Set(enclosing.map(normSetName).filter(Boolean));
  text.split('\n').forEach((line, at) => {
    const segment = segmentsOf(line)[0];
    if (!segment || readNoteSetLine(segment)) return;
    const { cell, marks } = splitHeadMarks(segment);
    if (marks.length || !cell || !index.display.has(normSetName(cell))) return;
    const locations = displayedLocations(index, cell, covered);
    if (locations.length) result.push({ line: at, label: locations.map(item => `[${item}]`).join(' '), full: displayedLocations(index, cell, covered, true).map(item => `[${item}]`).join(' ') });
  });
  return result;
};

/** 커서가 있는 칸의 맨 앞 셀 */
export interface HeadCellAtCaret {
  /** 셀 글이 시작하는 자리와 끝나는 자리(앞뒤 띄어쓰기는 뺀다) */
  cellStart: number;
  cellEnd: number;
  cell: string;
}

/**
 * 커서가 같은 줄 칸(`//` 사이)의 맨 앞 셀 끝에 있고, 그 셀 왼쪽에 위치 표시 `[ ]`가 아직 없으면 그 셀.
 * 셀 뒤에 관계 기호(`:` `;` `<` …)가 이어져도 기호 앞까지가 셀이다. 괄호·`[ ]`·`>`로 시작하는 칸은 셀이 아니다.
 */
export const headCellAtCaret = (text: string, caret: number): HeadCellAtCaret | null => {
  const lineStart = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1;
  const lineBreak = text.indexOf('\n', caret);
  const line = text.slice(lineStart, lineBreak < 0 ? text.length : lineBreak);
  const at = caret - lineStart;
  const slashes = topLevelCuts(line, '/').filter(cut => isReviewSlash(line, cut));
  const segmentStart = slashes.filter(cut => cut < at).reduce((last, cut) => cut + 1, 0);
  const segmentEnd = slashes.find(cut => cut >= at) ?? line.length;
  const segment = line.slice(segmentStart, segmentEnd);
  const relationCuts = topLevelCuts(segment, relationMarks());
  const headEnd = relationCuts.length ? relationCuts[0] : segment.length;
  const head = segment.slice(0, headEnd);
  if (/[\[\]()'>]/.test(head)) return null;
  const lead = /^\s*/.exec(head)![0].length;
  const trimmedEnd = head.replace(/\s+$/, '').length;
  if (trimmedEnd <= lead) return null;
  const cellStart = lineStart + segmentStart + lead;
  const cellEnd = lineStart + segmentStart + trimmedEnd;
  // 커서는 셀 안(글자 사이)이나 끝, 셀 뒤 띄어쓰기에 있다
  if (caret <= cellStart || caret > lineStart + segmentStart + headEnd) return null;
  return { cellStart, cellEnd, cell: text.slice(cellStart, cellEnd) };
};

/**
 * 노트 셀을 쓰면 그 셀의 위치(바로 위 집합부터 위로 올라가는 상위 집합들)를 추천한다.
 * 고르면(탭) 셀 앞에 `[위치] `가 붙어 위치를 표시하고, 커서는 있던 자리(셀 안)에 그대로 둔다.
 */
export const cellLocationSuggestions = (index: NoteSetIndex, context: HeadCellAtCaret, caret: number): BracketSuggestion[] => {
  if (!index.display.has(normSetName(context.cell))) return [];
  return ancestorsOf(index, context.cell)
    .filter(name => normSetName(name) !== normSetName(context.cell))
    .map(name => {
      const text = `[${name}] `;
      return { text, label: `[${name}]`, from: context.cellStart, to: context.cellStart, tag: '위치' as const, caret: text.length + (caret - context.cellStart) };
    });
};

/** 집합 안의 요소 한 줄: 아래 항목이 있는 집합이면 isSet, depth는 계층 깊이 */
export interface SetMemberRow { name: string; depth: number; isSet: boolean }

/**
 * `[집합]` 안에 있는 모든 요소. 이름 하나인 집합이면 아래 항목들을 계층 그대로(깊이 순서) 보이고,
 * 집합식(`급수.[A:C]`)이나 위치 표시(`[A:C]`)이면 식으로 계산한 셀들과 그 위치에 직접 둔 셀들을 합쳐 보인다.
 */
export const setContents = (index: NoteSetIndex, inner: string): SetMemberRow[] => {
  const text = inner.trim();
  if (!text) return [];
  const rows: SetMemberRow[] = [];
  const seen = new Set<string>();
  const push = (name: string, depth: number) => {
    const key = normSetName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({ name: index.display.get(key) ?? name, depth, isSet: index.sets.has(key) });
  };
  const key = normSetName(text);
  if (!/[\[\]().,%]/.test(text) && index.sets.has(key)) {
    const walk = (parent: string, depth: number, path: Set<string>) => {
      (index.children.get(parent) ?? []).forEach(child => {
        push(child, depth);
        if (index.sets.has(child) && !path.has(child)) walk(child, depth + 1, new Set([...path, child]));
      });
    };
    walk(key, 0, new Set([key]));
  }
  evaluateSetExpression(index, text).forEach(name => push(name, 0));
  evaluateSetExpression(index, `[${text}]`).forEach(name => push(name, 0));
  return rows;
};

/**
 * `[집합]()` 의 괄호 사이에 커서가 있으면 그 `[ ]` 안쪽 글(집합). 아니면 null.
 * `[집합].()` · `[집합]:()` 도 같다(정의 줄을 쓰기 시작하는 꼴).
 */
export const setMembersTrigger = (text: string, caret: number): string | null => {
  if (text[caret] !== ')') return null;
  const lead = /\]\s*[.:]?\s*\($/.exec(text.slice(0, caret));
  if (!lead) return null;
  const close = lead.index;
  const lineStart = close === 0 ? 0 : text.lastIndexOf('\n', close - 1) + 1;
  for (let position = close, depth = 0; position >= lineStart; position -= 1) {
    if (text[position] === ']') depth += 1;
    else if (text[position] === '[') {
      depth -= 1;
      if (depth === 0) return text.slice(position + 1, close).trim() || null;
    }
  }
  return null;
};
