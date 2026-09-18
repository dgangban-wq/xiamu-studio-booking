const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storeKey = 'xiamu-offline-booking-v1';

function createMemoryStorage(storedState = null, options = {}) {
  const values = new Map();
  if (storedState) values.set(storeKey, JSON.stringify(storedState));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (options.failSet && key === storeKey) throw new Error('quota exceeded');
      if (options.ignoreSet && key === storeKey) return;
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
    readState: () => JSON.parse(values.get(storeKey) || '{"bookings":[],"holidays":[],"meta":{}}')
  };
}

function createLockNavigator() {
  let tail = Promise.resolve();
  return {
    locks: {
      request: async (_name, _options, callback) => {
        const previous = tail;
        let release;
        tail = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback();
        } finally {
          release();
        }
      }
    }
  };
}

function loadOfflineRules(storedState = null, runtime = {}) {
  const appPath = path.join(__dirname, '..', 'offline-app', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8');
  const rulesOnly = source.split("window.addEventListener('beforeinstallprompt'")[0];
  const context = {
    localStorage: runtime.localStorage || {
      getItem: () => storedState ? JSON.stringify(storedState) : null,
      setItem: () => {}
    },
    navigator: runtime.navigator || {},
    setTimeout,
    alert: () => {},
    console
  };

  vm.createContext(context);
  vm.runInContext(`${rulesOnly}\nglobalThis.testApi = {
  state,
  getState: () => state,
  isDate,
  normalizeState,
  hasConflict,
  createBookingAtomically: typeof createBookingAtomically === 'function'
    ? createBookingAtomically
    : async () => ({ ok: false, reason: 'missing' }),
  updateBookingStatusAtomically: typeof updateBookingStatusAtomically === 'function'
    ? updateBookingStatusAtomically
    : async () => ({ ok: false, reason: 'missing' }),
  rescheduleBookingAtomically: typeof rescheduleBookingAtomically === 'function'
    ? rescheduleBookingAtomically
    : async () => ({ ok: false, reason: 'missing' }),
  mergeBookingsSafely: typeof mergeBookingsSafely === 'function'
    ? mergeBookingsSafely
    : () => { throw new Error('mergeBookingsSafely is missing'); },
  hasScheduleChanged: typeof hasScheduleChanged === 'function'
    ? hasScheduleChanged
    : () => { throw new Error('hasScheduleChanged is missing'); },
  getTurnaroundWarnings: typeof getTurnaroundWarnings === 'function'
    ? getTurnaroundWarnings
    : () => [],
  formatTurnaroundWarning: typeof formatTurnaroundWarning === 'function'
    ? formatTurnaroundWarning
    : () => '',
  shiftDate: typeof shiftDate === 'function'
    ? shiftDate
    : () => { throw new Error('shiftDate is missing'); },
  classifyHorizontalGesture: typeof classifyHorizontalGesture === 'function'
    ? classifyHorizontalGesture
    : () => { throw new Error('classifyHorizontalGesture is missing'); },
  getBookingFieldErrors: typeof getBookingFieldErrors === 'function'
    ? getBookingFieldErrors
    : () => { throw new Error('getBookingFieldErrors is missing'); },
  getBackupHealth: typeof getBackupHealth === 'function'
    ? getBackupHealth
    : () => { throw new Error('getBackupHealth is missing'); },
  normalizeIncomeRecord: typeof normalizeIncomeRecord === 'function'
    ? normalizeIncomeRecord
    : () => { throw new Error('normalizeIncomeRecord is missing'); },
  getIncomePeriodBounds: typeof getIncomePeriodBounds === 'function'
    ? getIncomePeriodBounds
    : () => { throw new Error('getIncomePeriodBounds is missing'); },
  summarizeIncome: typeof summarizeIncome === 'function'
    ? summarizeIncome
    : () => { throw new Error('summarizeIncome is missing'); },
  createIncomeAtomically: typeof createIncomeAtomically === 'function'
    ? createIncomeAtomically
    : async () => ({ ok: false, reason: 'missing' })
};`, context);
  return context.testApi;
}

function booking(overrides = {}) {
  return {
    id: 'existing',
    scene_id: 'classroom',
    scene_name: '教室',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 4,
    customer_name: '上一单客户',
    phone: '13800138000',
    wechat: 'xiamu-test',
    status: 'pending',
    change_count: 0,
    ...overrides
  };
}

test('offline app allows adjacent bookings and marks the tight turnaround', () => {
  const api = loadOfflineRules();
  api.state.bookings.push(booking());
  const next = booking({
    id: 'new',
    start_time: '12:00',
    end_time: '14:00',
    customer_name: '下一单客户'
  });

  assert.equal(Boolean(api.hasConflict(next)), false);
  const warnings = api.getTurnaroundWarnings(next);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].relation, 'previous');
});

test('offline app still blocks actual time overlap', () => {
  const api = loadOfflineRules();
  api.state.bookings.push(booking());
  const overlapping = booking({
    id: 'new',
    start_time: '11:30',
    end_time: '13:30'
  });

  assert.equal(Boolean(api.hasConflict(overlapping)), true);
});

test('offline app reminder tells the owner to notify the next customer', () => {
  const api = loadOfflineRules();
  const message = api.formatTurnaroundWarning({
    relation: 'next',
    gapMinutes: 0,
    booking: booking({
      id: 'next',
      start_time: '12:00',
      end_time: '14:00',
      customer_name: '下一单客户'
    })
  });

  assert.match(message, /下一单 12:00-14:00/);
  assert.match(message, /提醒下一单客户/);

  const previousMessage = api.formatTurnaroundWarning({
    relation: 'previous',
    gapMinutes: 0,
    booking: booking()
  });
  assert.match(previousMessage, /提醒下一单（本单）客户/);
});

test('offline app does not show tight turnaround reminders on cancelled orders', () => {
  const api = loadOfflineRules();
  api.state.bookings.push(booking({
    id: 'active',
    start_time: '12:00',
    end_time: '14:00'
  }));
  const cancelled = booking({ status: 'cancelled' });

  assert.equal(api.getTurnaroundWarnings(cancelled, cancelled.id).length, 0);
});

test('offline app starts successfully when saved bookings already exist', () => {
  assert.doesNotThrow(() => loadOfflineRules({
    bookings: [booking()],
    holidays: [],
    meta: {}
  }));
});

test('offline app rejects impossible calendar dates from imported data', () => {
  const api = loadOfflineRules();

  assert.equal(api.isDate('2026-02-30'), false);
  assert.equal(api.isDate('2026-02-28'), true);

  const normalized = api.normalizeState({
    bookings: [booking({ date: '2026-02-30' })],
    holidays: [{ date: '2026-02-30', type: 'holiday', name: 'invalid' }],
    meta: {}
  });

  assert.equal(normalized.bookings.length, 0);
  assert.equal(normalized.holidays.length, 0);
});

test('offline app repairs conflicting active orders found in saved data', () => {
  const api = loadOfflineRules();
  const normalized = api.normalizeState({
    bookings: [booking(), booking({ id: 'overlap', start_time: '11:00', end_time: '13:00' })],
    holidays: [],
    meta: {}
  });

  assert.equal(normalized.bookings.length, 1);
});

test('offline app increments reschedule count only when the schedule changes', () => {
  const api = loadOfflineRules();
  const current = booking();

  assert.equal(api.hasScheduleChanged(current, { ...current, people_count: 6 }), false);
  assert.equal(api.hasScheduleChanged(current, { ...current }), false);
  assert.equal(api.hasScheduleChanged(current, { ...current, start_time: '10:30', end_time: '12:30' }), true);
  assert.equal(api.hasScheduleChanged(current, { ...current, date: '2026-07-23' }), true);
});

test('offline app serializes simultaneous same-slot bookings across tabs', async () => {
  const storage = createMemoryStorage();
  const navigator = createLockNavigator();
  const firstTab = loadOfflineRules(null, { localStorage: storage, navigator });
  const secondTab = loadOfflineRules(null, { localStorage: storage, navigator });

  const [first, second] = await Promise.all([
    firstTab.createBookingAtomically(booking({ id: undefined, customer_name: 'first' })),
    secondTab.createBookingAtomically(booking({ id: undefined, customer_name: 'second' }))
  ]);

  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].filter((result) => result.reason === 'conflict').length, 1);
  assert.equal(storage.readState().bookings.length, 1);
});

test('offline app rolls back an order when local storage write fails', async () => {
  const storage = createMemoryStorage(null, { failSet: true });
  const api = loadOfflineRules(null, { localStorage: storage, navigator: createLockNavigator() });

  const result = await api.createBookingAtomically(booking({ id: undefined }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'storage');
  assert.equal(api.getState().bookings.length, 0);
});

test('offline app detects a silent local storage write failure', async () => {
  const storage = createMemoryStorage({ bookings: [booking()], holidays: [], meta: {} }, { ignoreSet: true });
  const api = loadOfflineRules(null, { localStorage: storage, navigator: createLockNavigator() });

  const result = await api.createBookingAtomically(booking({
    id: undefined,
    start_time: '13:00',
    end_time: '15:00',
    customer_name: 'not persisted'
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'storage');
  assert.equal(storage.readState().bookings.length, 1);
  assert.equal(api.getState().bookings.length, 1);
});

test('offline app skips conflicting active orders while importing a backup', () => {
  const api = loadOfflineRules();
  const existing = booking();
  const overlapping = booking({
    id: 'incoming-conflict',
    start_time: '11:00',
    end_time: '13:00',
    customer_name: 'incoming'
  });

  const result = api.mergeBookingsSafely([existing], [overlapping]);

  assert.equal(result.bookings.length, 1);
  assert.equal(result.skippedConflicts, 1);

  const replacement = booking({ people_count: 5 });
  const replaced = api.mergeBookingsSafely([existing], [replacement]);
  assert.equal(replaced.bookings.length, 1);
  assert.equal(replaced.bookings[0].people_count, 5);
  assert.equal(replaced.skippedConflicts, 0);
});

test('offline app preserves concurrent status and booking writes from different tabs', async () => {
  const storage = createMemoryStorage({ bookings: [booking()], holidays: [], meta: {} });
  const navigator = createLockNavigator();
  const firstTab = loadOfflineRules(null, { localStorage: storage, navigator });
  const secondTab = loadOfflineRules(null, { localStorage: storage, navigator });

  const [, created] = await Promise.all([
    firstTab.updateBookingStatusAtomically('existing', 'completed'),
    secondTab.createBookingAtomically(booking({
      id: undefined,
      start_time: '13:00',
      end_time: '15:00',
      customer_name: 'new booking'
    }))
  ]);

  const saved = storage.readState();
  assert.equal(created.ok, true);
  assert.equal(saved.bookings.length, 2);
  assert.equal(saved.bookings.find((item) => item.id === 'existing').status, 'completed');
});

test('offline app reschedule transaction does not count people-only edits', async () => {
  const storage = createMemoryStorage({ bookings: [booking()], holidays: [], meta: {} });
  const api = loadOfflineRules(null, { localStorage: storage, navigator: createLockNavigator() });

  const peopleEdit = await api.rescheduleBookingAtomically('existing', { people_count: 5 });
  const timeEdit = await api.rescheduleBookingAtomically('existing', { start_time: '10:30', end_time: '12:30' });

  assert.equal(peopleEdit.ok, true);
  assert.equal(peopleEdit.booking.change_count, 0);
  assert.equal(timeEdit.ok, true);
  assert.equal(timeEdit.booking.change_count, 1);
});

test('calendar swipe date helper crosses month and leap-year boundaries safely', () => {
  const api = loadOfflineRules();

  assert.equal(api.shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(api.shiftDate('2028-02-29', 1), '2028-03-01');
  assert.equal(api.shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(api.shiftDate('not-a-date', 1), '');
});

test('horizontal gesture classifier ignores vertical drags, tiny moves and Android edge swipes', () => {
  const api = loadOfflineRules();

  assert.equal(api.classifyHorizontalGesture({ startX: 100, deltaX: -80, deltaY: 12, width: 390 }), 'left');
  assert.equal(api.classifyHorizontalGesture({ startX: 200, deltaX: 82, deltaY: 8, width: 390 }), 'right');
  assert.equal(api.classifyHorizontalGesture({ startX: 100, deltaX: 35, deltaY: 2, width: 390 }), 'none');
  assert.equal(api.classifyHorizontalGesture({ startX: 100, deltaX: 65, deltaY: 90, width: 390 }), 'none');
  assert.equal(api.classifyHorizontalGesture({ startX: 12, deltaX: 90, deltaY: 4, width: 390 }), 'none');
  assert.equal(api.classifyHorizontalGesture({ startX: 380, deltaX: -90, deltaY: 4, width: 390 }), 'none');
});

test('booking validation maps messages to the fields that need attention', () => {
  const api = loadOfflineRules();
  const errors = api.getBookingFieldErrors(booking({
    customer_name: '',
    phone: '123',
    wechat: '',
    start_time: '10:00',
    end_time: '11:00'
  }));

  assert.match(errors.end, /2 小时/);
  assert.match(errors.customer, /客户姓名/);
  assert.match(errors.phone, /手机号/);
  assert.match(errors.wechat, /微信号/);
});

test('backup health warns after bookings change beyond the latest backup', () => {
  const api = loadOfflineRules();
  const stale = api.getBackupHealth({
    bookings: [booking({ updated_at: '2026-07-22T12:00:00.000Z' })],
    meta: { last_backup_at: '2026-07-22T10:00:00.000Z' }
  });
  const current = api.getBackupHealth({
    bookings: [booking({ updated_at: '2026-07-22T09:00:00.000Z' })],
    meta: { last_backup_at: '2026-07-22T10:00:00.000Z' }
  });

  assert.equal(stale.status, 'stale');
  assert.equal(current.status, 'current');
  assert.equal(api.getBackupHealth({ bookings: [], meta: {} }).status, 'empty');
});

test('old backups migrate with an empty income ledger', () => {
  const api = loadOfflineRules();
  const normalized = api.normalizeState({ bookings: [booking()], holidays: [], meta: {} });

  assert.deepEqual(Array.from(normalized.incomes), []);
});

test('income records reject invalid dates, amounts and categories', () => {
  const api = loadOfflineRules();
  const valid = api.normalizeIncomeRecord({
    id: 'income-1',
    date: '2026-07-23',
    amount: 180,
    category: 'deposit',
    customer_name: '小夏',
    note: '微信收款'
  });

  assert.equal(valid.amount, 180);
  assert.equal(valid.category, 'deposit');
  assert.equal(api.normalizeIncomeRecord({ ...valid, amount: 0 }), null);
  assert.equal(api.normalizeIncomeRecord({ ...valid, amount: -1 }), null);
  assert.equal(api.normalizeIncomeRecord({ ...valid, date: '2026-02-30' }), null);
  assert.equal(api.normalizeIncomeRecord({ ...valid, category: 'unknown' }), null);
});

test('income day week and month totals use Monday as the first day of week', () => {
  const api = loadOfflineRules();
  const records = [
    { id: 'day', date: '2026-07-23', amount: 100, category: 'deposit' },
    { id: 'monday', date: '2026-07-20', amount: 200, category: 'balance' },
    { id: 'sunday-before', date: '2026-07-19', amount: 300, category: 'full' },
    { id: 'month', date: '2026-07-01', amount: 400, category: 'extra' },
    { id: 'next-month', date: '2026-08-01', amount: 500, category: 'other' }
  ].map((item) => api.normalizeIncomeRecord(item));
  const summary = api.summarizeIncome(records, '2026-07-23');
  const week = api.getIncomePeriodBounds('2026-07-23', 'week');

  assert.deepEqual({ ...week }, { start: '2026-07-20', end: '2026-07-26' });
  assert.equal(summary.day, 100);
  assert.equal(summary.week, 300);
  assert.equal(summary.month, 1000);
});

test('income entries are persisted atomically and invalid entries are rejected', async () => {
  const storage = createMemoryStorage({ bookings: [booking()], holidays: [], incomes: [], meta: {} });
  const api = loadOfflineRules(null, { localStorage: storage, navigator: createLockNavigator() });

  const created = await api.createIncomeAtomically({
    date: '2026-07-23',
    amount: 180,
    category: 'deposit',
    booking_id: 'existing',
    customer_name: '上一单客户',
    note: '订金'
  });
  const invalid = await api.createIncomeAtomically({ date: '2026-07-23', amount: 0, category: 'deposit' });

  assert.equal(created.ok, true);
  assert.equal(storage.readState().incomes.length, 1);
  assert.equal(storage.readState().incomes[0].booking_id, 'existing');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid');
});

test('offline entry files request the cache-busted startup script', () => {
  const appDir = path.join(__dirname, '..', 'offline-app');
  const entryFiles = [
    fs.readFileSync(path.join(appDir, 'index.html'), 'utf8'),
    fs.readFileSync(path.join(appDir, '夏暮工作室预约App-双击打开.html'), 'utf8')
  ];
  const serviceWorker = fs.readFileSync(path.join(appDir, 'sw.js'), 'utf8');

  entryFiles.forEach((html) => {
    assert.match(html, /styles\.css\?v=19/);
    assert.match(html, /app\.js\?v=19/);
  });
  assert.match(serviceWorker, /xiamu-offline-v19/);
  assert.match(serviceWorker, /\.\/styles\.css\?v=19/);
  assert.match(serviceWorker, /\.\/app\.js\?v=19/);
});

test('v1.1 mobile interaction shell exposes visible alternatives to swipe gestures', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'offline-app', 'index.html'), 'utf8');

  assert.match(html, /class="tabs bottom-nav"/);
  assert.match(html, /id="calendarPrev"/);
  assert.match(html, /id="calendarToday"/);
  assert.match(html, /id="calendarNext"/);
  assert.match(html, /id="bookingSubmitBar"/);
  assert.match(html, /id="saveSuccessDialog"/);
  assert.match(html, /data-field-error="phone"/);
});

test('v1.2 exposes income accounting and an in-app responsive guide', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'offline-app', 'index.html'), 'utf8');

  assert.match(html, /data-tab="income"/);
  assert.match(html, /id="incomeToday"/);
  assert.match(html, /id="incomePeriodTotal"/);
  assert.match(html, /id="incomeDialog"/);
  assert.match(html, /id="openGuideViewer"/);
  assert.match(html, /id="guideViewerDialog"/);
  assert.match(html, /id="closeGuideViewer"/);
});

test('settings exposes the current version and v1.1 to v1.2 changelog', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'offline-app', 'index.html'), 'utf8');

  assert.match(html, /id="appVersion">v1\.2</);
  assert.match(html, /id="openChangelog"/);
  assert.match(html, /id="changelogDialog"/);
  assert.match(html, /版本 1\.2/);
  assert.match(html, /版本 1\.1/);
});
