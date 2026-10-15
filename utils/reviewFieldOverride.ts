export interface ReviewFieldOverride {
  label: string;
  start: number;
  end: number;
}

// Only a complete, same-line brace label immediately after a relation separator is metadata.
export const readReviewFieldOverride = (text: string, from: number, to = text.length): ReviewFieldOverride | undefined => {
  let start = from;
  while (start < to && /[^\S\r\n]/.test(text[start])) start += 1;
  if (text[start] !== '{') return undefined;
  let depth = 0;
  for (let index = start; index < to; index += 1) {
    if (text[index] === '\r' || text[index] === '\n') return undefined;
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return { label: text.slice(start + 1, index).trim(), start, end: index + 1 };
    }
  }
  return undefined;
};

export const stripReviewFieldOverrides = (text: string): string => {
  let result = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== ':' && text[index] !== ';') continue;
    const override = readReviewFieldOverride(text, index + 1);
    if (!override) continue;
    result += text.slice(start, override.start);
    start = override.end;
    index = override.end - 1;
  }
  return result + text.slice(start);
};

export const getReviewFieldOverrides = (text: string, inherited: ReadonlyMap<number, string> = new Map()): ReadonlyMap<number, string> => {
  const result = new Map(inherited);
  let depth = 0;
  let field = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === ':' || character === ';') {
      const override = readReviewFieldOverride(text, index + 1);
      if (depth === 0) {
        field += 1;
        if (override) result.set(field, override.label);
      }
      if (override) index = override.end - 1;
    } else if (character === '\n') { depth = 0; field = 0; }
    else if (character === '/' && depth === 0) field = 0;
    else if (character === '[') depth += 1;
    else if (character === ']') depth = Math.max(0, depth - 1);
  }
  return result;
};
