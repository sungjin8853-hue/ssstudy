import { ListOrder } from '../types';

/**
 * "과목·폴더 관리"에서 같은 폴더(또는 맨 위) 안의 폴더와 과목을 섞어 놓는 순서.
 * 순서를 직접 정한 적이 없으면 예전처럼 폴더가 먼저, 과목이 그 뒤에 나온다.
 * 항목 사이에 끼워 넣으면 그 자리의 항목들 모두에게 순서(listOrder)를 새로 매긴다.
 * 순서는 매긴 폴더 안에서만 뜻이 있다(parentId가 다르면 정하지 않은 것으로 본다. 다른 폴더로 옮겨진 항목은 맨 뒤로 간다).
 */
export const ROOT_LIST_KEY = 'root';

export const orderSiblings = <T extends { listOrder?: ListOrder }>(entries: T[], parentKey: string): T[] => {
  const keyed = entries.map((entry, position) => ({
    entry, position, key: entry.listOrder && entry.listOrder.parentId === parentKey && Number.isFinite(entry.listOrder.index) ? entry.listOrder.index : null
  }));
  return [
    ...keyed.filter(item => item.key !== null).sort((a, b) => (a.key! - b.key!) || (a.position - b.position)),
    ...keyed.filter(item => item.key === null)
  ].map(item => item.entry);
};

export interface SiblingRef { kind: 'folder' | 'subject'; id: string }

/** 보이는 순서의 항목들 사이(insertIndex 자리)에 새 항목을 끼워 넣고, 모두에게 0부터 번호를 매긴다. */
export const insertSiblingOrder = (siblings: SiblingRef[], insertIndex: number, parentKey: string, added: SiblingRef) => {
  const list = [...siblings];
  list.splice(Math.max(0, Math.min(list.length, insertIndex)), 0, added);
  return list.map((item, index) => ({ ...item, listOrder: { parentId: parentKey, index } as ListOrder }));
};

/** 앞말 받침에 맞춰 "와/과"를 고른다. 한글 받침, 숫자 읽기, 영문 끝 글자(L·M·N·R)를 본다. */
export const andParticle = (word: string): '와' | '과' => {
  const last = Array.from(word.trim()).pop();
  if (!last) return '와';
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '와' : '과';
  if (/[0136-8]/.test(last)) return '과';
  if (/[lmnr]/i.test(last)) return '과';
  return '와';
};

export const joinWithAnd = (first: string, second: string): string => `${first}${andParticle(first)} ${second}`;
