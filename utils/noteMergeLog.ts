import { MergeUpdate, NoteMergeKind } from './noteMerge';

/** 합친 기록: 합치기 전 글을 남겨 두어 되돌릴 수 있게 한다. */
export const NOTE_MERGE_RECORDS_KEY = 'swp_note_merges_v1';
const MAX_MERGE_RECORDS = 300;

export interface NoteMergeRecord {
  id: string;
  /** 합친 시각(ISO) */
  at: string;
  /** 새로 쓴 글이 있는 기록 */
  sourceLogId: string;
  /** 합쳐진(바뀐) 이전 기록 */
  targetLogId: string;
  before: string;
  after: string;
  steps: { statement: string; kind: NoteMergeKind }[];
  undone?: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const readNoteMergeRecords = (storage: Store = localStorage): NoteMergeRecord[] => {
  try {
    const value = JSON.parse(storage.getItem(NOTE_MERGE_RECORDS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
};

const write = (records: NoteMergeRecord[], storage: Store) => {
  try { storage.setItem(NOTE_MERGE_RECORDS_KEY, JSON.stringify(records.slice(-MAX_MERGE_RECORDS))); } catch { /* 저장 공간이 없으면 기록만 못 남긴다 */ }
};

export const recordNoteMerges = (sourceLogId: string, updates: MergeUpdate[], at = new Date().toISOString(), storage: Store = localStorage): NoteMergeRecord[] => {
  if (!updates.length) return [];
  const added = updates.map((update, index) => ({
    id: `${sourceLogId}:${update.logId}:${at}:${index}`, at, sourceLogId, targetLogId: update.logId,
    before: update.before, after: update.after, steps: update.steps
  }));
  write([...readNoteMergeRecords(storage), ...added], storage);
  return added;
};

/**
 * 합치기를 되돌릴 때 쓸 글. 그 뒤에 이전 기록의 글을 또 고쳤다면(현재 글이 합친 직후의 글과 다르면) 덮어쓰지 않도록 null.
 */
export const undoNoteMerge = (recordId: string, currentMemo: string, storage: Store = localStorage): string | null => {
  const records = readNoteMergeRecords(storage);
  const record = records.find(item => item.id === recordId);
  if (!record || record.undone || currentMemo !== record.after) return null;
  write(records.map(item => (item.id === recordId ? { ...item, undone: true } : item)), storage);
  return record.before;
};
