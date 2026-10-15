import { parseReviewMemoSyntax } from './reviewMemoLogic';

export const getReviewMemoDoubleSpaceEdit = (text: string, start: number, end: number) => {
  if (start !== end || !/\S $/.test(text.slice(0, start))) return null;
  const left = text.slice(0, start);
  const line = left.slice(left.lastIndexOf('\n') + 1);
  const separators = parseReviewMemoSyntax(line).relationSeparators;
  const relation = line.slice((separators[separators.length - 1] ?? -1) + 1);
  if (!relation.trim() || relation.includes(':') || relation.trim() === '>') return null;
  return { text: `${left.slice(0, -1)}:${text.slice(end)}`, caret: start };
};
