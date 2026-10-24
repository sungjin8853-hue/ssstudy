/**
 * 측정 화면의 정리노트는 한 번의 학습이 끝나도 곧바로 비우지 않고 "이어 쓰는 노트지"로 이어진다.
 * (페이지 단위가 끝날 때까지, 단위가 없는 과목은 그날 하루 동안)
 *
 * 저장은 그대로 학습 기록마다 한 조각씩이다(복습 문제와 일정이 기록 단위로 붙어 있기 때문).
 *  - 학습을 시작할 때: 이어 쓸 기록들의 노트를 오래된 순서로 이어 붙여 노트지에 미리 채워 둔다(mergeSheetParts).
 *  - 학습을 저장할 때: 노트지 전체에서 "새로 쓴 부분"만 이번 기록의 노트로 저장한다(splitNoteSheet).
 *    이미 저장된 부분을 고쳤다면 그 부분이 있던 기록의 노트를 고친 대로 바꾼다. 같은 글이 두 기록에 겹쳐 저장되지 않는다.
 */
export interface SheetPart { logId: string; memo: string }
export interface SheetUpdate { logId: string; memo: string }
export interface SheetSplit {
  /** 이번 기록에 저장할 새 노트(없으면 빈 문자열) */
  added: string;
  /** 이미 저장된 기록 중 고쳐진 노트 */
  updates: SheetUpdate[];
}

const toLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/\s+$/, ''));

const trimEdges = (lines: string[]) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]) start += 1;
  while (end > start && !lines[end - 1]) end -= 1;
  return lines.slice(start, end);
};

/** 기록 사이를 한 줄 비우고 이어 붙인 글(오래된 기록이 위). */
export const mergeSheetParts = (parts: SheetPart[]) => parts
  .map(part => trimEdges(toLines(part.memo)).join('\n'))
  .filter(Boolean)
  .join('\n\n');

type Op = { type: 'keep' | 'del'; index: number } | { type: 'ins'; index: number };

/** 줄 단위 비교. 앞뒤로 같은 줄은 먼저 걷어 내고 가운데만 가장 긴 공통 부분으로 맞춘다. */
const diffLines = (a: string[], b: string[]): Op[] => {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const ops: Op[] = [];
  for (let i = 0; i < head; i += 1) ops.push({ type: 'keep', index: i });
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n > 0 || m > 0) {
    if (n * m > 4_000_000) {
      for (let i = 0; i < n; i += 1) ops.push({ type: 'del', index: head + i });
      for (let j = 0; j < m; j += 1) ops.push({ type: 'ins', index: head + j });
    } else {
      // table[i][j] = a[head+i..]와 b[head+j..]의 공통 줄 수
      const width = m + 1;
      const table = new Uint32Array((n + 1) * width);
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          table[i * width + j] = a[head + i] === b[head + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a[head + i] === b[head + j]) { ops.push({ type: 'keep', index: head + i }); i += 1; j += 1; }
        else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: 'del', index: head + i }); i += 1; }
        else { ops.push({ type: 'ins', index: head + j }); j += 1; }
      }
      while (i < n) { ops.push({ type: 'del', index: head + i }); i += 1; }
      while (j < m) { ops.push({ type: 'ins', index: head + j }); j += 1; }
    }
  }
  for (let i = 0; i < tail; i += 1) ops.push({ type: 'keep', index: a.length - tail + i });
  return ops;
};

/**
 * 노트지(sheet) 전체를 "이어 쓴 기록들(parts)"과 "이번 기록"으로 나눈다.
 *  - 끝에 새로 이어 쓴 글 → 이번 기록(added)
 *  - 이미 저장된 글을 고치거나 지움, 또는 그 사이에 끼워 쓴 글 → 그 글이 있던 기록(updates)
 *  - 어떤 기록의 글을 모두 지우고 새로 쓴 글은 이번 기록으로 옮긴다.
 */
export const splitNoteSheet = (parts: SheetPart[], sheet: string): SheetSplit => {
  const pieces = parts
    .map(part => ({ logId: part.logId, original: trimEdges(toLines(part.memo)) }))
    .filter(piece => piece.original.length > 0);
  const base: string[] = [];
  const owner: number[] = [];
  pieces.forEach((piece, pieceIndex) => {
    if (pieceIndex > 0) { base.push(''); owner.push(-1); }
    piece.original.forEach(line => { base.push(line); owner.push(pieceIndex); });
  });
  const target = trimEdges(toLines(sheet));
  const kept: number[] = pieces.map(() => 0);
  const lines: { text: string; keep: boolean }[][] = pieces.map(() => []);
  const addedRuns: string[] = [];
  const ops = diffLines(base, target);

  let anchor = -1;
  let consumed = 0;
  let previous: Op['type'] | null = null;
  let runTarget = -1;
  ops.forEach(op => {
    if (op.type === 'keep' || op.type === 'del') {
      consumed += 1;
      const own = owner[op.index];
      if (own >= 0) {
        anchor = own;
        if (op.type === 'keep') { lines[own].push({ text: base[op.index], keep: true }); kept[own] += 1; }
      }
    } else {
      const text = target[op.index];
      // 이어서 쓴 여러 줄은 한 덩어리로 같은 곳에 둔다
      const append = previous !== 'del' && consumed >= base.length;
      const into = previous === 'ins' ? runTarget : append || pieces.length === 0 ? -1 : (anchor >= 0 ? anchor : 0);
      runTarget = into;
      if (into < 0) addedRuns.push(text);
      else lines[into].push({ text, keep: false });
    }
    previous = op.type;
  });

  const updates: SheetUpdate[] = [];
  const added: string[] = [...addedRuns];
  const moved: string[] = [];
  pieces.forEach((piece, pieceIndex) => {
    let next = lines[pieceIndex];
    if (kept[pieceIndex] === 0) {
      // 남은 글이 하나도 없으면 그 기록은 비우고, 거기에 새로 쓴 글은 이번 기록으로 옮긴다.
      next.filter(line => !line.keep).forEach(line => moved.push(line.text));
      next = [];
    }
    const memo = trimEdges(next.map(line => line.text)).join('\n');
    if (memo !== piece.original.join('\n')) updates.push({ logId: piece.logId, memo });
  });
  // 옮겨 온 글은 끝에 새로 이어 쓴 글보다 앞에 둔다(노트지에서 위에 있던 글이므로).
  return { added: trimEdges([...moved, ...(moved.length && added.length ? [''] : []), ...added]).join('\n'), updates };
};
