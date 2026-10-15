import type { ReviewMemoDocument, ReviewMemoNode, StudyLog } from '../types';
import { parseReviewMemoBlocks, serializeReviewMemoBlocks } from './reviewMemo';
import { parseReviewMemoSyntax } from './reviewMemoLogic';

export const newReviewMemoNodeId = () => crypto.randomUUID();

export const withReviewMemoLogicalOperators = (document: ReviewMemoDocument): ReviewMemoDocument => {
  const syntaxById = new Map(document.nodes.map(node => [node.id, parseReviewMemoSyntax(node.text)]));
  const parentOperators = new Map(document.nodes.filter(node => node.type === 'toggle')
    .map(node => [node.id, syntaxById.get(node.id)?.childrenRelation?.operator]));
  const nodes = document.nodes.map(node => {
    const inheritedOperator = node.parentId !== null ? parentOperators.get(node.parentId) : undefined;
    const syntax = inheritedOperator ? parseReviewMemoSyntax(node.text, inheritedOperator) : syntaxById.get(node.id)!;
    const operators = syntax.logicalOperators.length ? syntax.logicalOperators : undefined;
    const expressions = syntax.logicalExpressions.length ? syntax.logicalExpressions : undefined;
    const separators = syntax.relationSeparators.length ? syntax.relationSeparators : undefined;
    const children = node.type === 'toggle' ? syntax.childrenRelation : undefined;
    if (JSON.stringify(node.logicalOperators) === JSON.stringify(operators)
      && JSON.stringify(node.logicalExpressions) === JSON.stringify(expressions)
      && JSON.stringify(node.relationSeparators) === JSON.stringify(separators)
      && JSON.stringify(node.childrenRelation) === JSON.stringify(children)) return node;
    const { logicalOperators, logicalExpressions, relationSeparators, childrenRelation, ...plainNode } = node;
    return { ...plainNode, ...(operators ? { logicalOperators: operators } : {}),
      ...(expressions ? { logicalExpressions: expressions } : {}),
      ...(separators ? { relationSeparators: separators } : {}), ...(children ? { childrenRelation: children } : {}) };
  });
  return nodes.every((node, index) => node === document.nodes[index]) ? document : { ...document, nodes };
};

export const isReviewMemoDocument = (value: unknown): value is ReviewMemoDocument => {
  if (!value || typeof value !== 'object') return false;
  const document = value as ReviewMemoDocument;
  if (document.version !== 1 || !Array.isArray(document.nodes)) return false;
  const byId = new Map<string, ReviewMemoNode>();
  for (const node of document.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || byId.has(node.id)
      || (node.parentId !== null && typeof node.parentId !== 'string')
      || !['text', 'toggle'].includes(node.type) || typeof node.text !== 'string'
      || !Number.isInteger(node.order) || node.order < 0) return false;
    byId.set(node.id, node);
  }
  for (const node of document.nodes) {
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || parent.type !== 'toggle' || seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = parent.parentId;
    }
  }
  return true;
};

export const getReviewMemoChildren = (document: ReviewMemoDocument, parentId: string | null = null) => (
  document.nodes.filter(node => node.parentId === parentId).sort((a, b) => a.order - b.order)
);

export const reviewMemoDocumentToText = (document: ReviewMemoDocument, parentId: string | null = null): string => (
  serializeReviewMemoBlocks(getReviewMemoChildren(document, parentId).map(node => (
    node.type === 'text' ? { type: 'text', text: node.text }
      : { type: 'toggle', title: node.text, text: reviewMemoDocumentToText(document, node.id) }
  )))
);

export const getReviewMemoSubdocument = (document: ReviewMemoDocument, parentId: string): ReviewMemoDocument => {
  const ids = new Set([parentId]);
  const descendants: ReviewMemoNode[] = [];
  const visit = (id: string) => {
    for (const child of getReviewMemoChildren(document, id)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      descendants.push({ ...child, parentId: id === parentId ? null : id });
      visit(child.id);
    }
  };
  visit(parentId);
  return { version: 1, nodes: descendants };
};

// Legacy text remains a compatibility view for the existing review-question parser.
export const reviewMemoDocumentFromText = (memo: string, previous?: ReviewMemoDocument): ReviewMemoDocument => {
  const old = isReviewMemoDocument(previous) ? previous : { version: 1 as const, nodes: [] };
  const nodes: ReviewMemoNode[] = [];
  const visit = (text: string, parentId: string | null) => {
    const blocks = parseReviewMemoBlocks(text);
    const siblings = getReviewMemoChildren(old, parentId);
    const used = new Set<string>();
    const matches = blocks.map(block => {
      const match = siblings.find(node => !used.has(node.id) && node.type === block.type
        && node.text === (block.type === 'toggle' ? block.title : block.text));
      if (match) used.add(match.id);
      return match;
    });
    blocks.forEach((block, order) => {
      const match = matches[order] || siblings.find(node => !used.has(node.id) && node.type === block.type);
      if (match) used.add(match.id);
      const id = match?.id || newReviewMemoNodeId();
      nodes.push({ id, parentId, type: block.type, text: block.type === 'toggle' ? block.title : block.text, order });
      if (block.type === 'toggle') visit(block.text, id);
    });
  };
  visit(memo, null);
  return withReviewMemoLogicalOperators({ version: 1, nodes });
};

export const resolveReviewMemoDocument = (memo: string, document?: ReviewMemoDocument): ReviewMemoDocument => (
  isReviewMemoDocument(document) && reviewMemoDocumentToText(document) === memo
    ? withReviewMemoLogicalOperators(document) : reviewMemoDocumentFromText(memo, document)
);

export const withReviewMemoDocument = (log: StudyLog): StudyLog => {
  if (log.reviewMemo === undefined && !log.reviewMemoDocument) return log;
  const memo = log.reviewMemo ?? (isReviewMemoDocument(log.reviewMemoDocument)
    ? reviewMemoDocumentToText(log.reviewMemoDocument) : '');
  return { ...log, reviewMemo: memo, reviewMemoDocument: resolveReviewMemoDocument(memo, log.reviewMemoDocument) };
};

export const canMoveReviewMemoNode = (document: ReviewMemoDocument, sourceId: string, targetId: string) => {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  if (byId.get(sourceId)?.type !== 'toggle' || byId.get(targetId)?.type !== 'toggle') return false;
  const seen = new Set<string>();
  let ancestor: string | null = targetId;
  while (ancestor !== null) {
    if (ancestor === sourceId || seen.has(ancestor)) return false;
    seen.add(ancestor);
    ancestor = byId.get(ancestor)?.parentId ?? null;
  }
  return true;
};

export const moveReviewMemoNode = (document: ReviewMemoDocument, sourceId: string, targetId: string): ReviewMemoDocument => {
  if (!canMoveReviewMemoNode(document, sourceId, targetId)) return document;
  const source = document.nodes.find(node => node.id === sourceId)!;
  const targetChildren = getReviewMemoChildren(document, targetId).filter(node => node.id !== sourceId);
  const oldSiblings = getReviewMemoChildren(document, source.parentId).filter(node => node.id !== sourceId);
  return withReviewMemoLogicalOperators({ version: 1, nodes: document.nodes.map(node => {
    if (node.id === sourceId) return { ...node, parentId: targetId, order: targetChildren.length };
    if (node.parentId === targetId) return { ...node, order: targetChildren.findIndex(child => child.id === node.id) };
    if (node.parentId === source.parentId) return { ...node, order: oldSiblings.findIndex(child => child.id === node.id) };
    return node;
  }) });
};
