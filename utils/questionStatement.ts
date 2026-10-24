/**
 * 줄글 문제: 논리 덩어리 칸(`p-d-s` · `p, q, r`)의 안쪽을 가린 문제를 실제 문제집처럼 문장으로 낸다.
 * 가린 자리는 ㉠ ㉡ ㉢ … 로 번호를 붙이고, 정답은 그 번호 순서대로 적는다.
 * 조사(이/가 · 은/는)가 글에 따라 달라지지 않도록 값은 따옴표로 묶고 조사가 필요 없는 말로만 잇는다.
 */
export type CellKind = 'and' | 'sequence' | 'equal';
export type CellPiece = string | { blank: string } | { glue: CellKind };

const MARKS = ['㉠', '㉡', '㉢', '㉣', '㉤', '㉥', '㉦', '㉧', '㉨', '㉩', '㉪', '㉫', '㉬', '㉭'];
export const blankMark = (order: number) => MARKS[order] ?? `(${order + 1})`;

/** 조각들을 한 줄 글로 잇는다: 가린 자리는 `blank(번호)`로, 항목 사이는 논리어 종류에 맞는 `glue`로 쓴다. */
export const renderCellPieces = (pieces: readonly CellPiece[], glue: Record<CellKind, string>, blank: (order: number) => string): string => {
  let order = 0;
  return pieces.map(piece => (typeof piece === 'string' ? piece : 'glue' in piece ? glue[piece.glue] : blank(order++))).join('');
};

export const countCellBlanks = (pieces: readonly CellPiece[]) => pieces.filter(piece => typeof piece !== 'string' && 'blank' in piece).length;

/** 문장에 쓰는 글: 논리어 AND·OR는 풀어 쓰고(`a, b` · `a 또는 b`), 순서(→)와 같음(=)은 그대로 둔다 */
export const readableLabel = (label: string): string => label.replace(/ AND /g, ', ').replace(/ OR /g, ' 또는 ');

/** 속성 이름이 있으면 값 앞에 붙인다: `정의 ‘p’` (이름이 없으면 값만) */
export const attributeTag = (value: string, labels?: readonly string[]) => (labels && labels.length ? `${labels.join('·')} ‘${value}’` : `‘${value}’`);

/**
 * 덩어리 칸 줄글. `where`는 문제가 놓인 자리(`개념 ‘자동차’에서 `), `attrs`는 주어진 칸 · 맞힐 칸의 속성 이름이다.
 * 이름이 있으면 `정의 ‘엔진’에는 예시 ‘a, b’ 모두가 해당한다. ㉠에 알맞은 예시 값은?`처럼 값마다 속성이 문장 안에서 드러난다.
 */
export const cellBlankStatement = ({ given, kind, pieces, where = '', attrs }: {
  given: string; kind: CellKind; pieces: readonly CellPiece[]; where?: string; attrs?: { prompt?: readonly string[]; answer?: readonly string[] };
}): string => {
  const count = countCellBlanks(pieces);
  const shown = renderCellPieces(pieces, { and: ', ', sequence: ' → ', equal: ' = ' }, order => `( ${blankMark(order)} )`);
  const marks = Array.from({ length: count }, (_, order) => blankMark(order)).join(', ');
  const noun = attrs?.answer?.length ? `${attrs.answer.join('·')} 값` : '것';
  const givenTag = attributeTag(readableLabel(given), attrs?.prompt);
  const shownTag = attributeTag(shown, attrs?.answer);
  const lead = kind === 'and' ? `${where}${givenTag}에는 ${shownTag} 모두가 해당한다.`
    : kind === 'equal' ? `${where}${givenTag}에서는 ${shownTag} 관계가 성립한다.` : `${where}${givenTag}에서는 ${shownTag} 순서로 이어진다.`;
  if (count <= 1) return `${lead} ${marks}에 알맞은 ${noun}은?`;
  return `${lead} ${marks}에 알맞은 ${noun}을 ${kind === 'and' ? '쓰시오. (순서는 상관없다)' : '차례로 쓰시오.'}`;
};

/** 정답 칸에 보일 글: 빈칸이 하나면 값만, 여럿이면 번호를 붙여 차례로 적는다. */
export const cellBlankAnswer = (answers: readonly string[]): string => (
  answers.length <= 1 ? answers.join('') : answers.map((answer, order) => `${blankMark(order)} ${answer}`).join('   ')
);
