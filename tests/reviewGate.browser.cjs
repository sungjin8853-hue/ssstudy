const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const url = process.argv[3] || 'http://127.0.0.1:4175/';
const second = 1000;
const hour = 60 * 60 * second;
const now = Date.parse('2026-09-13T04:00:00.000Z');

function fixture(linked, reviewStep = 0, dueOffsetMs = -1000) {
  const main = {
    id: 'gate-main', name: 'GateTest', startPage: 1, totalPages: 100, completedPages: 4,
    targetDate: '2026-10-31', createdAt: '2026-09-13T00:00:00.000Z', tagIds: [],
    reviewSubjectIds: linked ? ['gate-practice'] : [], scheduledWeekdays: [0, 1, 2, 3, 4, 5, 6]
  };
  const subjects = [main];
  if (linked) subjects.push({ ...main, id: 'gate-practice', name: 'PracticeTest', completedPages: 0, reviewSubjectIds: [] });
  const logs = [0, 1].map(index => ({
    id: `gate-note-${index}`, subjectId: main.id, subjectStageId: main.id,
    pagesRead: 2, startPage: index * 2 + 1, endPage: index * 2 + 2,
    timeSpentMinutes: 10, timestamp: '2026-09-13T00:00:00.000Z',
    nextReviewDate: new Date(now + dueOffsetMs).toISOString(), reviewStep, reviewEnabled: true,
    reviewSubjectIdsSnapshot: main.reviewSubjectIds,
    reviewMemo: index === 0 ? '[alpha] label: hidden answer, other: kept answer,' : '[beta] kind: second answer,'
  }));
  return { subjects, logs };
}

async function seed(browser, linked, reviewStep = 0, dueOffsetMs = -1000) {
  return seedData(browser, fixture(linked, reviewStep, dueOffsetMs));
}

async function seedData(browser, data) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(data => {
    if (sessionStorage.getItem('gate-fixture')) return;
    localStorage.setItem('swp_subjects', JSON.stringify(data.subjects));
    localStorage.setItem('swp_logs', JSON.stringify(data.logs));
    localStorage.setItem('swp_tags', '[]');
    sessionStorage.setItem('gate-fixture', 'true');
  }, data);
  await page.goto(url);
  await page.getByRole('heading', { name: '학습 실행', exact: true }).waitFor();
  return { context, page, errors };
}

async function storedLogs(page) {
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('swp_logs') || '[]').length === 2);
  return page.evaluate(() => JSON.parse(localStorage.getItem('swp_logs')));
}
async function openCard(page, label) {
  const card = page.getByRole('button').filter({ hasText: label }).filter({ hasText: 'GateTest' }).first();
  await card.click();
  await card.click();
  await page.getByRole('button', { name: '정답 확인', exact: true }).waitFor();
}
async function answer(page, correct) {
  await page.getByRole('button', { name: '정답 확인', exact: true }).click();
  await page.getByRole('button', { name: correct ? '맞음' : '오답', exact: true }).click();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let activePage;
  try {
    // Isolated storage: no access to the user's preview profile or study data.
    const scheduled = await seed(browser, false, 0, 15 * second);
    activePage = scheduled.page;
    assert.equal(await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).count(), 0);
    await scheduled.page.clock.fastForward(16 * second);
    await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).first().waitFor();
    assert.equal(await scheduled.page.getByRole('button').filter({ hasText: '기본 복습' }).count() > 0, true);
    await scheduled.context.close();
    console.log('PASS: a scheduled regular review appears without changing weekdays');

    const basic = await seed(browser, false);
    activePage = basic.page;
    await openCard(basic.page, '기본 복습');
    assert.equal(await basic.page.getByText(/1단계|2단계|3단계/).count(), 0);
    assert.equal(await basic.page.getByText('[alpha]', { exact: true }).count() > 0, true);
    assert.equal(await basic.page.getByText('hidden answer', { exact: true }).count(), 0);
    await answer(basic.page, false);
    await answer(basic.page, true);
    await answer(basic.page, true);
    await basic.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const afterGate = await storedLogs(basic.page);
    assert.equal(afterGate.length, 2);
    assert.ok(afterGate[0].reviewGateRetry);
    assert.deepEqual(afterGate[0].reviewGateRetry.questionKeys, ['answer:0']);
    assert.equal(afterGate[1].reviewGateRetry, undefined);
    assert.equal(afterGate[0].reviewStep, 1);
    assert.equal(afterGate[1].reviewStep, 1);
    assert.equal(afterGate[0].reviewGateRetry.intervalMs, 2 * hour);

    await basic.page.reload();
    assert.equal((await storedLogs(basic.page))[0].reviewGateRetry.dueAt, afterGate[0].reviewGateRetry.dueAt);
    await basic.page.clock.fastForward(2 * hour + 2 * second);
    await openCard(basic.page, '기본 복습 · 오답');
    assert.equal(await basic.page.getByText('0 / 1', { exact: true }).count(), 1);
    const retryScreenText = await basic.page.locator('body').innerText();
    assert.match(retryScreenText, /kept answer/);
    assert.doesNotMatch(retryScreenText, /second answer/);
    await answer(basic.page, true);
    assert.equal(await basic.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 0);
    await basic.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const afterRetry = await storedLogs(basic.page);
    const { reviewGateRetry, ...originalWithoutRetry } = afterGate[0];
    assert.deepEqual(afterRetry[0], originalWithoutRetry);
    assert.deepEqual(afterRetry[1], afterGate[1]);
    assert.equal(await basic.page.getByText('기본 복습 · 오답', { exact: true }).count(), 0);
    await basic.page.clock.fastForward(23 * hour);
    await basic.page.getByRole('button').filter({ hasText: '기본 복습' }).first().waitFor();
    assert.equal(await basic.page.getByRole('button').filter({ hasText: '기본 복습 · 오답' }).count(), 0);
    assert.deepEqual(basic.errors, []);
    console.log('PASS: no difficulty stages; only the wrong item returns, then the next regular review appears automatically');
    await basic.context.close();

    const linked = await seed(browser, true);
    activePage = linked.page;
    await openCard(linked.page, '과목 복습');
    await answer(linked.page, false);
    await answer(linked.page, true);
    await answer(linked.page, true);
    await linked.page.getByRole('button', { name: '복습과목 시작', exact: true }).click();
    await linked.page.getByRole('button', { name: '완료', exact: true }).waitFor();
    const beforeRetry = await storedLogs(linked.page);
    assert.equal(beforeRetry[0].reviewStep, 0);
    assert.ok(beforeRetry[0].reviewGateRetry);
    await linked.page.reload();
    await storedLogs(linked.page);
    await linked.page.clock.fastForward(2 * hour + 2 * second);
    await openCard(linked.page, '기본 복습 · 오답');
    await answer(linked.page, false);
    assert.equal(await linked.page.getByRole('button', { name: '복습과목 시작', exact: true }).count(), 0);
    await linked.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const failedRetry = await storedLogs(linked.page);
    assert.equal(failedRetry.length, 2);
    assert.equal(failedRetry[0].reviewStep, 0);
    assert.equal(failedRetry[0].nextReviewDate, beforeRetry[0].nextReviewDate);
    assert.equal(failedRetry[0].timeSpentMinutes, beforeRetry[0].timeSpentMinutes);
    assert.ok(Date.parse(failedRetry[0].reviewGateRetry.dueAt) > Date.parse(beforeRetry[0].reviewGateRetry.dueAt));
    assert.equal(failedRetry[0].reviewGateRetry.intervalMs, 2 * hour);
    assert.equal(await linked.page.getByRole('button', { name: '완료', exact: true }).count(), 0);
    assert.deepEqual(linked.errors, []);
    console.log('PASS: linked subject starts after regular gate; retry stays gate-only and reschedules independently');
    await linked.context.close();

    const sequenceData = fixture(true);
    sequenceData.subjects.push({
      ...sequenceData.subjects[1],
      id: 'gate-practice-b',
      name: 'Practice B'
    });
    sequenceData.subjects[0].reviewSubjectIds = ['gate-practice', 'gate-practice-b'];
    sequenceData.logs = [sequenceData.logs[0]];
    sequenceData.logs[0].reviewSubjectIdsSnapshot = ['gate-practice', 'gate-practice-b'];
    const sequence = await seedData(browser, sequenceData);
    activePage = sequence.page;
    await openCard(sequence.page, '과목 복습');
    await answer(sequence.page, false);
    await answer(sequence.page, true);
    await sequence.page.getByRole('button', { name: '복습과목 시작', exact: true }).click();
    await sequence.page.getByRole('button', { name: '노트 보기', exact: true }).click();
    const visibleReviewNotes = await sequence.page.locator('textarea').evaluateAll(elements => elements.map(element => element.value));
    assert.equal(visibleReviewNotes.some(value => value.includes('hidden answer')), true);
    await sequence.page.getByRole('button').filter({ hasText: '복습 제외' }).click();
    await sequence.page.getByPlaceholder('복습 때 바로 떠올릴 핵심어를 적어주세요.').fill('[practice] item: answer,');
    await sequence.page.getByRole('button', { name: '완료', exact: true }).click();
    await sequence.page.getByRole('button', { name: '복습 완료 후 다음 과목', exact: true }).click();
    let sequenceLogs = await sequence.page.evaluate(() => JSON.parse(localStorage.getItem('swp_logs') || '[]'));
    assert.equal(sequenceLogs[0].reviewStep, 0);
    assert.equal(sequenceLogs.find(log => log.subjectId === 'gate-practice').reviewEnabled, true);
    assert.equal(sequenceLogs.find(log => log.subjectId === 'gate-practice').reviewMemo, '[practice] item: answer,');
    await sequence.page.getByText('복습 과목 · Practice B', { exact: true }).waitFor();
    assert.equal(await sequence.page.getByRole('button').filter({ hasText: '복습 제외' }).count(), 1);
    await sequence.page.getByRole('button', { name: '완료', exact: true }).click();
    await sequence.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    sequenceLogs = await sequence.page.evaluate(() => JSON.parse(localStorage.getItem('swp_logs') || '[]'));
    assert.equal(sequenceLogs[0].reviewStep, 1);
    assert.equal(sequenceLogs.find(log => log.subjectId === 'gate-practice-b').reviewEnabled, false);
    await sequence.page.clock.fastForward(2 * hour + 2 * second);
    const queueText = await sequence.page.locator('body').innerText();
    assert.match(queueText, /PracticeTest/);
    assert.deepEqual(sequence.errors, []);
    console.log('PASS: linked subjects run in order; only opted-in review subjects create their own basic review');
    await sequence.context.close();
  } catch (error) {
    if (activePage && !activePage.isClosed()) console.error(await activePage.locator('body').innerText());
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
