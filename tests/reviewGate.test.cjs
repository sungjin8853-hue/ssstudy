const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const loadedSources = new Map();

function loadSource(relativePath) {
  const basePath = path.resolve(__dirname, '..', relativePath);
  const filename = ['', '.ts', '.tsx'].map(extension => basePath + extension).find(file => fs.existsSync(file));
  if (loadedSources.has(filename)) return loadedSources.get(filename).exports;
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loadedSources.set(filename, loaded);
  loaded.require = name => name.startsWith('.')
    ? loadSource(path.resolve(path.dirname(filename), name))
    : Module.createRequire(filename)(name);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  });
  loaded._compile(outputText, filename);
  return loaded.exports;
}

const gate = loadSource('utils/reviewGate.ts');
global.window = { location: { href: 'http://127.0.0.1:4175/' } };
const { buildDueReviewGroups } = loadSource('components/SessionLogger.tsx');
delete global.window;

const now = Date.parse('2026-09-13T04:00:00.000Z');
const second = 1000;
const hour = 60 * 60 * second;
const day = 24 * hour;
const source = (overrides = {}) => ({
  id: 'note-a', subjectId: 'main', timestamp: '2026-09-12T20:00:00.000Z',
  pagesRead: 4, startPage: 1, endPage: 4, timeSpentMinutes: 20,
  reviewMemo: '[alpha] label: beta, other: gamma',
  reviewStep: 0, nextReviewDate: '2026-09-12T23:00:00.000Z', reviewEnabled: true,
  reviewSubjectIdsSnapshot: ['practice'],
  ...overrides
});
const wrong = { logId: 'note-a', passed: false, wrongQuestionKeys: ['answer:0'] };
const right = { logId: 'note-a', passed: true, wrongQuestionKeys: [] };
const withRetry = (overrides = {}) => gate.applyReviewGateOutcomes([source(overrides)], [wrong], false, now)[0];
const withoutRetry = ({ reviewGateRetry, ...log }) => log;
const subjects = [
  { id: 'main', name: 'Main', totalPages: 100, completedPages: 4, targetDate: '2026-10-31', reviewSubjectIds: ['practice'] },
  { id: 'practice', name: 'Practice', totalPages: 100, completedPages: 0, targetDate: '2026-10-31' }
];

test('brackets remain topics while colon values become hidden answers', () => {
  const memo = '[alpha] label: beta, other: gamma, number: 23';
  const parsed = gate.parseReviewGateMemo(memo);
  assert.deepEqual(parsed.topics, ['alpha']);
  assert.deepEqual(parsed.prompts, ['[alpha] label', 'other', 'number']);
  assert.deepEqual(parsed.answers, ['beta', 'gamma', '23']);
  assert.equal(parsed.parts.map(part => part.text).join(''), memo);
  assert.deepEqual(gate.parseReviewGateMemo('label:answer,').prompts, ['label']);
  assert.deepEqual(gate.parseReviewGateMemo('label:answer,').answers, ['answer']);
});

test('questions are stable items and do not depend on a difficulty stage', () => {
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] label: beta, other: gamma'), ['answer:0', 'answer:1']);
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] plain recall'), ['note']);
  assert.deepEqual(gate.getReviewGateQuestionKeys(' '), []);
});

test('retries use the current interval, not the next interval', () => {
  const expectedIntervals = [2 * hour, day, 4 * day, 7 * day, 14 * day, 28 * day, 56 * day];
  expectedIntervals.forEach((expectedInterval, step) => {
    const log = withRetry({ reviewStep: step });
    assert.equal(log.reviewGateRetry.intervalMs, expectedInterval);
    assert.equal(Date.parse(log.reviewGateRetry.dueAt), now + expectedInterval);
  });
});

test('only wrong items get a retry', () => {
  const logs = [source(), source({ id: 'note-b' }), source({ id: 'empty', reviewMemo: ' ' })];
  const results = gate.applyReviewGateOutcomes(logs, [wrong, { ...right, logId: 'note-b' }], false, now);
  assert.ok(results[0].reviewGateRetry);
  assert.deepEqual(results[0].reviewGateRetry.questionKeys, ['answer:0']);
  assert.equal(results[1].reviewGateRetry, undefined);
  assert.equal(results[2], logs[2]);
  assert.equal(logs[0].reviewGateRetry, undefined);
  assert.equal(results.length, logs.length);
});

test('scheduling retry leaves original dates, study totals and review records untouched', () => {
  const original = source({
    basicReviewTimeRecords: [{ pages: 4, minutes: 5, reviewNumber: 1, timestamp: new Date(now).toISOString() }],
    reviewSubjectTimeRecords: [{ subjectId: 'practice', pages: 4, minutes: 10, timestamp: new Date(now).toISOString() }]
  });
  const result = gate.applyReviewGateOutcomes([original], [wrong], false, now)[0];
  assert.deepEqual(withoutRetry(result), original);
});

test('pending retry is not duplicated or postponed by another normal attempt', () => {
  const log = withRetry();
  const again = gate.applyReviewGateOutcomes([log], [wrong, wrong], false, now + second);
  assert.equal(again.length, 1);
  assert.equal(again[0], log);
});

test('due boundary, deduplication and refresh persistence', () => {
  const saved = JSON.parse(JSON.stringify([withRetry()]));
  assert.deepEqual(gate.getDueReviewGateRetries(saved, now + 2 * hour - 1), []);
  assert.equal(gate.getDueReviewGateRetries([...saved, ...saved], now + 2 * hour).length, 1);
  assert.equal(gate.getDueReviewGateRetries([source({ reviewGateRetry: { dueAt: 'invalid' } })], now).length, 0);
});

test('retry failure preserves original cycle interval even after regular review advances', () => {
  const log = { ...withRetry(), reviewStep: 4, nextReviewDate: new Date(now + 14 * day).toISOString() };
  const failedAt = now + 2 * hour;
  const again = gate.applyReviewGateOutcomes([log], [wrong], true, failedAt)[0];
  assert.equal(again.reviewGateRetry.intervalMs, 2 * hour);
  assert.equal(again.reviewGateRetry.dueAt, new Date(failedAt + 2 * hour).toISOString());
  assert.deepEqual(withoutRetry(again), withoutRetry(log));
});

test('retry success removes only retry, without advancing regular schedule or adding study time', () => {
  const log = { ...withRetry(), reviewStep: 2 };
  const result = gate.applyReviewGateOutcomes([log], [right], true, now + 3 * hour)[0];
  assert.equal(result.reviewGateRetry, undefined);
  assert.deepEqual(withoutRetry(result), withoutRetry(log));
  assert.equal(gate.applyReviewGateOutcomes([result], [right], true, now)[0], result);
});

test('passing a regular gate also clears an already pending retry for that note', () => {
  const result = gate.applyReviewGateOutcomes([withRetry()], [right], false, now)[0];
  assert.equal(result.reviewGateRetry, undefined);
});

test('editing the original note updates retry content without changing due time', () => {
  const log = withRetry();
  const edited = gate.updateReviewGateMemo(log, '[topic] label: changed answer');
  assert.equal(edited.reviewMemo, '[topic] label: changed answer');
  assert.equal(edited.reviewGateRetry.dueAt, log.reviewGateRetry.dueAt);
  assert.equal(gate.updateReviewGateMemo(edited, edited.reviewMemo), edited);
  assert.equal(gate.updateReviewGateMemo(edited, ' ').reviewGateRetry, undefined);
  assert.equal(gate.updateReviewGateMemo(edited, 'plain recall note').reviewGateRetry, undefined);
});

test('a failed retry can narrow the next retry to the items still wrong', () => {
  const first = gate.applyReviewGateOutcomes(
    [source()],
    [{ logId: 'note-a', passed: false, wrongQuestionKeys: ['answer:0', 'answer:1'] }],
    false,
    now
  )[0];
  const narrowed = gate.applyReviewGateOutcomes(
    [first],
    [{ logId: 'note-a', passed: false, wrongQuestionKeys: ['answer:1'] }],
    true,
    now + 2 * hour
  )[0];
  assert.deepEqual(narrowed.reviewGateRetry.questionKeys, ['answer:1']);
});

test('condensing retry does not condense original review or alter its statistics', () => {
  const log = withRetry();
  const other = withRetry({ id: 'note-b' });
  const result = gate.clearReviewGateRetries([log, other], [log.id]);
  assert.deepEqual(withoutRetry(result[0]), withoutRetry(log));
  assert.equal(result[0].reviewGateRetry, undefined);
  assert.equal(result[1], other);
});

test('queue keeps regular subject reviews separate from gate-only retries', () => {
  const log = withRetry();
  const groups = buildDueReviewGroups([log], subjects, now + 2 * hour);
  const regular = groups.find(group => !group.isGateRetry);
  const retry = groups.find(group => group.isGateRetry);
  assert.equal(groups.length, 2);
  assert.equal(regular.reviewType, 'subject');
  assert.equal(regular.subjectId, 'practice');
  assert.equal(retry.reviewType, 'basic');
  assert.equal(retry.subjectId, 'main');
  assert.deepEqual(retry.reviewSubjectIds, []);
  assert.notEqual(regular.id, retry.id);
});

test('handling the regular review does not hide a due retry for the same log', () => {
  const groups = buildDueReviewGroups([withRetry()], subjects, now + 2 * hour, new Set(['note-a']));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].isGateRetry, true);
});

test('same-subject retries combine, different subjects stay separate, and each interval is retained', () => {
  const logs = gate.applyReviewGateOutcomes([
    source(), source({ id: 'note-b', reviewStep: 4, startPage: 5, endPage: 8 }),
    source({ id: 'note-c', subjectId: 'other' })
  ], [wrong, { ...wrong, logId: 'note-b' }, { ...wrong, logId: 'note-c' }], false, now);
  const early = buildDueReviewGroups(logs, subjects, now + 2 * hour).filter(group => group.isGateRetry);
  assert.equal(early.length, 2);
  assert.equal(early.find(group => group.subjectId === 'main').logs.length, 1);
  const later = buildDueReviewGroups(logs, subjects, now + 14 * day).filter(group => group.isGateRetry);
  assert.equal(later.length, 2);
  assert.deepEqual(later.find(group => group.subjectId === 'main').logs.map(log => log.id), ['note-a', 'note-b']);
  const retried = gate.applyReviewGateOutcomes(logs, [wrong, { ...wrong, logId: 'note-b' }], true, now + 14 * day);
  assert.equal(Date.parse(retried[0].reviewGateRetry.dueAt), now + 14 * day + 2 * hour);
  assert.equal(Date.parse(retried[1].reviewGateRetry.dueAt), now + 28 * day);
});

test('linked review subjects merge only matching sequences and contiguous page ranges', () => {
  const linkedSubjects = [
    { ...subjects[0], reviewSubjectIds: ['practice', 'practice-b'] },
    subjects[1],
    { ...subjects[1], id: 'practice-b', name: 'Practice B' }
  ];
  const dueLogs = [
    source({ id: 'range-a', startPage: 1, endPage: 2, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'range-b', startPage: 3, endPage: 4, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'range-gap', startPage: 7, endPage: 8, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'different-sequence', startPage: 5, endPage: 6, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice'] }),
    source({ id: 'different-subject', startPage: 9, endPage: 10, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'], reviewSubjectId: 'practice-b' })
  ];
  const groups = buildDueReviewGroups(dueLogs, linkedSubjects, now).filter(group => !group.isGateRetry);
  const practiceGroups = groups.filter(group => group.subjectId === 'practice');
  const practiceBGroups = groups.filter(group => group.subjectId === 'practice-b');

  assert.equal(practiceGroups.length, 3);
  assert.deepEqual(
    practiceGroups.map(group => group.logs.map(log => log.id)).sort((a, b) => a[0].localeCompare(b[0])),
    [['different-sequence'], ['range-a', 'range-b'], ['range-gap']]
  );
  assert.equal(practiceBGroups.length, 1);
  assert.deepEqual(practiceBGroups[0].logs.map(log => log.id), ['different-subject']);
});
