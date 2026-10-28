export const SESSION_MEMO_KEY = 'swp_session_memos';
export const SESSION_MEMO_RECORDS_KEY = 'swp_session_memo_records_v1';

export interface SessionMemoRecord {
  version: 1;
  text: string;
  classificationCriterion: string | null;
}

type MemoStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const createSessionMemoRecord = (text: string): SessionMemoRecord => {
  let classificationCriterion: string | null = null;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (text[index] === ']' && depth > 0) {
      depth -= 1;
      if (depth > 0) continue;
      const content = text.slice(start + 1, index).trim();
      if (!content) continue;
      // `[a]:[b];[c]`처럼 칸마다 괄호를 쓴 꼴도 `[a:b;c]`와 같다(29일: 세션의 `[a]:[b]`가 `a`만 읽히던 것)
      let joined = content;
      let at = index + 1;
      for (;;) {
        let next = at;
        while (next < text.length && /[^\S\n]/.test(text[next])) next += 1;
        if (!/[:;<]/.test(text[next] ?? '')) break;
        const mark = text[next];
        next += 1;
        while (next < text.length && /[^\S\n]/.test(text[next])) next += 1;
        if (text[next] !== '[') break;
        const close = text.indexOf(']', next);
        const inner = close > next ? text.slice(next + 1, close).trim() : '';
        if (!inner || inner.includes('[') || inner.includes('\n')) break;
        joined += `${mark}${inner}`;
        at = close + 1;
      }
      classificationCriterion = joined;
      break;
    }
  }
  return { version: 1, text, classificationCriterion };
};

const readMap = (storage: MemoStorage, key: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

export const readSessionMemoRecords = (storage: MemoStorage = localStorage): Record<string, SessionMemoRecord> => {
  const legacy = readMap(storage, SESSION_MEMO_KEY);
  const saved = readMap(storage, SESSION_MEMO_RECORDS_KEY);
  const records: Record<string, SessionMemoRecord> = {};
  for (const id of new Set([...Object.keys(saved), ...Object.keys(legacy)])) {
    const record = saved[id] as Partial<SessionMemoRecord> | undefined;
    const text = typeof legacy[id] === 'string' ? legacy[id] as string
      : record?.version === 1 && typeof record.text === 'string' ? record.text : undefined;
    if (text !== undefined) records[id] = createSessionMemoRecord(text);
  }
  const serialized = JSON.stringify(records);
  if (storage.getItem(SESSION_MEMO_RECORDS_KEY) !== serialized) storage.setItem(SESSION_MEMO_RECORDS_KEY, serialized);
  return records;
};

export const readSessionMemos = (storage: MemoStorage = localStorage): Record<string, string> => (
  Object.fromEntries(Object.entries(readSessionMemoRecords(storage)).map(([id, record]) => [id, record.text]))
);

export const writeSessionMemo = (subjectId: string, memo: string, storage: MemoStorage = localStorage) => {
  const id = subjectId || 'global';
  const records = readSessionMemoRecords(storage);
  records[id] = createSessionMemoRecord(memo);
  storage.setItem(SESSION_MEMO_RECORDS_KEY, JSON.stringify(records));
  storage.setItem(SESSION_MEMO_KEY, JSON.stringify(Object.fromEntries(
    Object.entries(records).map(([key, record]) => [key, record.text])
  )));
};
