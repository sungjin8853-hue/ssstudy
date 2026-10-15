import { readReviewFieldOverride } from './reviewFieldOverride';

export interface MemoColorPart {
  text: string;
  colonIndex?: number;
}

export const splitReviewMemoColonColors = (text: string, inherited: ReadonlyMap<number, string> = new Map()): MemoColorPart[] => {
  const parts: MemoColorPart[] = [];
  let start = 0;
  let colonIndex = 0;
  let fieldIndex = 0;
  const scopes: Array<{ colonIndex: number; fieldIndex: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[') { scopes.push({ colonIndex, fieldIndex }); colonIndex = 0; fieldIndex = 0; }
    if (text[index] === ']') {
      const parent = scopes.pop();
      if (parent) { colonIndex = parent.colonIndex; fieldIndex = parent.fieldIndex; }
    }
    if (text[index] === '\n' || text[index] === '/') { colonIndex = 0; fieldIndex = 0; scopes.length = 0; }
    if (text[index] !== ':' && text[index] !== ';') continue;
    const override = readReviewFieldOverride(text, index + 1);
    fieldIndex += 1;
    if (override || inherited.has(fieldIndex)) {
      if (override) index = override.end - 1;
      continue;
    }
    if (index > start) parts.push({ text: text.slice(start, index) });
    parts.push({ text: text[index], colonIndex: colonIndex++ });
    start = index + 1;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
};

export const getReviewMemoColonColor = (index: number, dark: boolean) => {
  const colors = dark
    ? ['#fb7185', '#fbbf24', '#cbd5e1', '#a1a1aa', '#94a3b8']
    : ['#dc2626', '#a16207', '#475569', '#71717a', '#64748b'];
  return colors[Math.min(index, colors.length - 1)];
};
