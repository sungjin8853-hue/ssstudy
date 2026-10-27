/**
 * 플래시 카드: 줄글 문장(`개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?`)에서 키워드만 따서 가로로 늘어놓는다.
 *   [개념 자동차] [정의 엔진] ──이어지는→ [예시 ?]
 * 키워드는 줄글과 같은 순서다: 문제가 놓인 자리 → 주어진 값 → 이어 주는 말(관계) → 맞힐 칸. 줄글을 만드는 규칙(proseOf)을 그대로 따라가고,
 * 문장 대신 조각으로 돌려준다. 맞힐 칸은 정답을 확인할 때 같은 자리에서 정답으로 바뀐다.
 */
import { AFTER, count as stepWords, operatorOf, OWNER, ProseAttrs, ProseInput, readableLabel, SATISFIED, splitLabel, withoutAnswerPlace } from './questionProse';
import { blankMark } from './questionStatement';
import type { CellKind, CellPiece } from './questionStatement';

/** 키워드 한 칸: 위에 속성 이름(`개념`), 아래에 값 */
export interface FlashChip { label: string[]; value: string }
/** 이어 주는 말과 화살표 방향: forward는 `→`(주어진 값에서 맞힐 칸으로), back은 `←`(맞힐 칸이 앞), equal은 `＝` */
export interface FlashRelation { word: string; arrow: 'forward' | 'back' | 'equal' }
/** 줄 안의 조각(가린 줄 · 덩어리 칸 빈칸): 글, 가린 자리(정답을 알면 함께), 항목 사이의 이음 */
export type FlashPiece = { type: 'text'; value: string } | { type: 'blank'; mark: string; answer: string | null } | { type: 'glue'; glyph: string };

export interface FlashCard {
  /** 문제가 놓인 자리(위쪽 토글 · 줄 앞 집합): 맨 바깥부터 */
  place: Array<FlashChip & { role: 'place' | 'owner' | 'after' }>;
  /** 주어진 값. 가린 줄 문제는 없다(줄 전체가 chain) */
  given: FlashChip | null;
  /** 이미 충족한 값(`남은 것` 문제): 문장의 "… 외에" */
  done: FlashChip | null;
  relation: FlashRelation | null;
  /** 가린 줄 · 덩어리 칸 빈칸 문제의 줄. 있으면 맞힐 칸은 줄 안의 가린 자리들이다 */
  chain: FlashPiece[] | null;
  /** 맞힐 값의 속성 이름과 쓰는 방법(`모두` · `순서대로` · `하나만` · `차례로`) */
  ask: { label: string[]; mode: string | null };
}

const GLUE_GLYPH: Record<CellKind, string> = { and: '＋', sequence: '→', equal: '＝' };
const CELL_RELATION: Record<CellKind, FlashRelation> = {
  and: { word: '모두 해당', arrow: 'forward' },
  sequence: { word: '순서대로', arrow: 'forward' },
  equal: { word: '관계', arrow: 'equal' }
};

const modeOf = (operator: ReturnType<typeof operatorOf>) => (operator === 'and' ? '모두' : operator === 'sequence' ? '순서대로' : operator === 'or' ? '하나만' : null);

/** 문제가 놓인 자리와 충족한 값을 조각으로. `placeOf`(줄글)와 같은 가름이다. */
const placeAndDone = (conditions: readonly string[], labels?: readonly (readonly string[])[], answer?: string) => {
  const entries = withoutAnswerPlace(conditions, answer);
  const chip = (text: string, index: number): FlashChip => ({ label: [...(labels?.[index] ?? [])], value: readableLabel(text) });
  const place = [
    ...entries.filter(item => !SATISFIED.test(item.text) && !AFTER.test(item.text) && !OWNER.test(item.text)).map(item => ({ ...chip(item.text, item.index), role: 'place' as const })),
    ...entries.filter(item => OWNER.test(item.text)).map(item => ({ ...chip(item.text.replace(OWNER, ''), item.index), role: 'owner' as const })),
    ...entries.filter(item => AFTER.test(item.text)).map(item => ({ ...chip(item.text.replace(AFTER, ''), item.index), role: 'after' as const }))
  ];
  const satisfied = entries.filter(item => SATISFIED.test(item.text));
  const done: FlashChip | null = satisfied.length ? {
    label: [...new Set(satisfied.flatMap(item => labels?.[item.index] ?? []))],
    value: satisfied.map(item => readableLabel(item.text.replace(SATISFIED, ''))).join(', ')
  } : null;
  return { place, done };
};

/** 줄글을 만드는 규칙(proseOf)을 그대로 따라 조각으로 돌려준다. 줄글로 바꾸지 않는 종류(노트 회상 · 능력 변환)는 null. */
export const flashOf = (input: ProseInput & { cell?: { given: string; kind: CellKind; pieces: readonly CellPiece[] } }, attrs?: ProseAttrs): FlashCard | null => {
  const { kind, prompt, answer, conditions, direction } = input;
  if (kind === 'recall' || kind === 'convert') return null;
  const { place, done } = placeAndDone(conditions, attrs?.conditions, answer);
  const askLabel = [...(attrs?.answer ?? [])];
  const givenChip: FlashChip = { label: [...(attrs?.prompt ?? [])], value: readableLabel(prompt) };
  const givenOperator = operatorOf(prompt);
  const answerOperator = operatorOf(answer);
  const base = { place, given: givenChip, done: null as FlashChip | null, chain: null as FlashPiece[] | null };

  if (input.cell) {
    // 덩어리 칸 빈칸: 주어진 칸 → 줄(가린 자리는 칸으로)
    const chain: FlashPiece[] = [];
    let order = 0;
    input.cell.pieces.forEach(piece => {
      if (typeof piece === 'string') chain.push({ type: 'text', value: piece });
      else if ('glue' in piece) chain.push({ type: 'glue', glyph: GLUE_GLYPH[piece.glue] });
      else chain.push({ type: 'blank', mark: blankMark(order++), answer: piece.blank });
    });
    return { ...base, given: { label: [...(attrs?.prompt ?? [])], value: readableLabel(input.cell.given) }, relation: CELL_RELATION[input.cell.kind], chain,
      ask: { label: askLabel, mode: order > 1 ? (input.cell.kind === 'and' ? '모두' : '차례로') : null } };
  }
  if (kind === 'blank') {
    // 줄 안의 칸을 가린 문제(`＿ → B → C`): 줄을 그대로 늘어놓고 가린 자리만 칸으로 둔다. `…`는 묻지 않는 부분이다.
    const hidden = splitLabel(answer, ' → ').map(readableLabel);
    const chain: FlashPiece[] = [];
    let order = 0;
    splitLabel(prompt, ' → ').forEach((part, index) => {
      if (index > 0) chain.push({ type: 'glue', glyph: '→' });
      readableLabel(part).split(/(＿)/).filter(text => text !== '').forEach(text => {
        if (text === '＿') { chain.push({ type: 'blank', mark: blankMark(order), answer: null }); order += 1; } else chain.push({ type: 'text', value: text });
      });
    });
    const blanks = Math.max(1, order);
    // 정답을 가린 자리마다 나누어 줄 수 있으면 자리에, 아니면 첫 자리에 정답 전체를
    const perBlank = order > 1 && hidden.length === order;
    let seen = 0;
    const filled = chain.map(piece => {
      if (piece.type !== 'blank') return piece;
      const answerText = perBlank ? hidden[seen] : seen === 0 ? readableLabel(answer) : null;
      seen += 1;
      return { ...piece, answer: answerText };
    });
    return { ...base, given: null, relation: null, chain: filled, ask: { label: askLabel, mode: blanks > 1 ? '차례로' : null } };
  }
  if ((kind === 'direct' || kind === 'reverse') && input.form === 'equal') {
    return { ...base, relation: { word: '대응하는', arrow: 'equal' }, ask: { label: askLabel, mode: null } };
  }
  if (kind === 'direct') return { ...base, relation: { word: '이어지는', arrow: 'forward' }, ask: { label: askLabel, mode: modeOf(answerOperator) } };
  if (kind === 'reverse') {
    const lead = givenOperator === 'and' ? '모두에 ' : givenOperator === 'sequence' ? '순서에 ' : '';
    return { ...base, relation: { word: `${lead}앞서 이어진`, arrow: 'back' }, ask: { label: askLabel, mode: answerOperator === 'or' ? '하나만' : null } };
  }
  if (kind === 'remaining') return { ...base, done, relation: { word: '필요한 것 중 남은', arrow: 'forward' }, ask: { label: askLabel, mode: modeOf(answerOperator) } };
  if (kind === 'reconstruct') return { ...base, relation: { word: '끝까지 이어지는', arrow: 'forward' }, ask: { label: askLabel, mode: '순서대로' } };
  if (kind === 'far') {
    const steps = input.distance && input.distance >= 2 ? stepWords(input.distance) : '몇 걸음';
    return { ...base, relation: { word: `${steps} ${direction === 'reverse' ? '앞' : '뒤'}`, arrow: direction === 'reverse' ? 'back' : 'forward' }, ask: { label: askLabel, mode: null } };
  }
  if (kind === 'order-next') return { ...base, relation: { word: '바로 다음', arrow: 'forward' }, ask: { label: askLabel, mode: null } };
  if (kind === 'order-previous') return { ...base, relation: { word: '바로 앞', arrow: 'back' }, ask: { label: askLabel, mode: null } };
  if (kind === 'order-reconstruct') return { ...base, relation: { word: '다음에 오는', arrow: 'forward' }, ask: { label: askLabel, mode: '순서대로' } };
  return null;
};
