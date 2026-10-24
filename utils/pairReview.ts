import type { NoteQuestion } from './reviewQuestions';
import { clampCombineLength, readCombineLength } from './combineLength';

/**
 * 관계쌍 묶음 복습(P3 · 18:16 "관계쌍을 묶음 단위로", 18:36 "사이 모든 쌍", 19:09 "자유도는 중요도 순").
 * 복습할 때가 된 보통 문제들을 관계쌍(이웃한 두 칸)으로 묶어 쌍마다 한 문제만 내고, 같은 쌍에만 걸친 나머지 문제는 그 결과를 함께 받는다.
 *  - 쌍은 중요도 순(우선순위 → 중요도)으로 차례를 정한다. 가장 기본적인 사실이 먼저다.
 *  - 쌍의 자유도 f = 그 쌍만 묻는 문제들의 자유도 중 가장 큰 값(첫 시도 쉬움 +1 · 다시 −1, 0~3).
 *  - f = 0: 그 쌍만 묻는 가장 쉬운 문제(기본 관계 → 역방향 → 순서 …).
 *  - f ≥ 1: 이웃 쌍과 이어 묻는 문제(두 걸음 · 빈칸 · 재구성) 중 f+1쌍까지 걸친 것을 낸다 — 자유도가 오를수록 한 문제가 덮는 범위가 넓어져 문제 수가 준다.
 *    걸치는 쌍 수는 사용자가 정한 최대 길이(2~10, 기본 4)를 넘지 않는다.
 *    그 문제가 걸친 쌍이 모두 자유도 1 이상일 때만(덜 익은 쌍을 건너뛰어 묻지 않는다).
 * 문제 키와 일정은 문제마다 그대로이고, 함께 받은 문제는 같은 등급으로 일정이 쌓인다.
 */
export interface PairCandidate { logId: string; question: NoteQuestion; freedom: number }
export interface PlannedPair {
  logId: string;
  question: NoteQuestion;
  /** 이 문제의 결과를 함께 받는 문제들(자기 자신이 첫째) */
  covered: { logId: string; questionKey: string }[];
}

const KIND_RANK: Record<string, number> = {
  direct: 0, reverse: 1, 'order-next': 2, 'order-previous': 3, remaining: 4, blank: 5, far: 6, reconstruct: 7, 'order-reconstruct': 8
};

const rankOf = (question: NoteQuestion) => KIND_RANK[question.kind] ?? 9;
const keyOf = (candidate: PairCandidate) => `${candidate.logId}\u0000${candidate.question.key}`;

export const planPairReview = (candidates: PairCandidate[], maxPairs: number = readCombineLength()): { planned: PlannedPair[]; absorbed: Set<string> } => {
  const limit = clampCombineLength(maxPairs);
  const usable = candidates.filter(candidate => candidate.question.bundles?.length);
  const bundlesOf = (candidate: PairCandidate) => candidate.question.bundles!.map(bundle => `${candidate.logId}\u0000${bundle}`);
  const freedom = new Map<string, number>();
  const order = new Map<string, [number, number]>();
  usable.forEach(candidate => {
    const bundles = bundlesOf(candidate);
    if (bundles.length === 1) freedom.set(bundles[0], Math.max(freedom.get(bundles[0]) ?? 0, Math.floor(candidate.freedom || 0)));
    bundles.forEach(bundle => {
      const rank: [number, number] = [candidate.question.priority, candidate.question.importance];
      const previous = order.get(bundle);
      if (!previous || rank[0] < previous[0] || (rank[0] === previous[0] && rank[1] < previous[1])) order.set(bundle, rank);
    });
  });
  const freedomOf = (bundle: string) => freedom.get(bundle) ?? 0;
  const bundleOrder = [...order.keys()].sort((a, b) => order.get(a)![0] - order.get(b)![0] || order.get(a)![1] - order.get(b)![1]);

  const covered = new Set<string>();
  const selected: PairCandidate[] = [];
  const selectedKeys = new Set<string>();
  const easiest = (list: PairCandidate[]) => [...list].sort((a, b) => rankOf(a.question) - rankOf(b.question) || a.question.difficulty - b.question.difficulty || a.question.level - b.question.level)[0];
  bundleOrder.forEach(bundle => {
    if (covered.has(bundle)) return;
    const options = usable.filter(candidate => !selectedKeys.has(keyOf(candidate)) && bundlesOf(candidate).includes(bundle));
    if (!options.length) return;
    const level = freedomOf(bundle);
    let pick: PairCandidate | undefined;
    if (level >= 1) {
      const combos = options.filter(candidate => {
        const bundles = bundlesOf(candidate);
        return bundles.length > 1 && bundles.length <= Math.min(level + 1, limit) && bundles.every(other => freedomOf(other) >= 1);
      });
      pick = [...combos].sort((a, b) => bundlesOf(b).length - bundlesOf(a).length || a.question.difficulty - b.question.difficulty || rankOf(a.question) - rankOf(b.question))[0];
      // 이어 물을 문제가 없으면 그 쌍만 묻는 문제 중 덜 쉬운 것(역방향 · 남은 조건 …)으로 난도를 올린다
      if (!pick) pick = [...options.filter(candidate => bundlesOf(candidate).length === 1)].sort((a, b) => rankOf(b.question) - rankOf(a.question) || b.question.difficulty - a.question.difficulty)[0];
    }
    if (!pick) {
      const singles = options.filter(candidate => bundlesOf(candidate).length === 1);
      pick = singles.length ? easiest(singles) : [...options].sort((a, b) => bundlesOf(a).length - bundlesOf(b).length || rankOf(a.question) - rankOf(b.question))[0];
    }
    selected.push(pick);
    selectedKeys.add(keyOf(pick));
    bundlesOf(pick).forEach(other => covered.add(other));
  });

  const planned = selected.map(candidate => ({ logId: candidate.logId, question: candidate.question, covered: [{ logId: candidate.logId, questionKey: candidate.question.key }] }));
  const absorbed = new Set<string>();
  usable.forEach(candidate => {
    if (selectedKeys.has(keyOf(candidate))) return;
    const bundles = bundlesOf(candidate);
    if (!bundles.every(bundle => covered.has(bundle))) return;
    // 이 문제의 쌍을 가장 많이 덮는 뽑힌 문제가 결과를 함께 준다
    let best = -1;
    let bestOverlap = -1;
    selected.forEach((pick, index) => {
      const overlap = bundlesOf(pick).filter(bundle => bundles.includes(bundle)).length;
      if (overlap > bestOverlap) { best = index; bestOverlap = overlap; }
    });
    if (best < 0 || bestOverlap <= 0) return;
    planned[best].covered.push({ logId: candidate.logId, questionKey: candidate.question.key });
    absorbed.add(keyOf(candidate));
  });
  return { planned: planned.filter(item => item.covered.length > 1), absorbed };
};
