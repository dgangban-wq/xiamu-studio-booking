const scenes = [
  { id: 'classroom', name: '教室', weekdayRate: 180, holidayRate: 210, capacity: 6 },
  { id: 'study', name: '书房', weekdayRate: 150, holidayRate: 180, capacity: 4 },
  { id: 'white-studio', name: '白棚', weekdayRate: 120, holidayRate: 150, capacity: 6 },
  { id: 'office', name: '办公室', weekdayRate: 120, holidayRate: 150, capacity: 4 },
  { id: 'game-room', name: '游戏部', weekdayRate: 150, holidayRate: 180, capacity: 6 }
];

const statuses = [
  ['pending', '待确认'],
  ['deposit_paid', '已付订金'],
  ['completed', '已完工'],
  ['cancelled', '已取消']
];

const incomeCategories = [
  ['deposit', '订金'],
  ['balance', '尾款'],
  ['full', '全款'],
  ['extra', '加收'],
  ['other', '其他']
];

const defaultHolidayRules = [
  ...rangeRules('2026-01-01', '2026-01-03', 'holiday', '2026 元旦'),
  { date: '2026-01-04', type: 'workday', name: '2026 元旦调休上班' },
  ...rangeRules('2026-02-15', '2026-02-23', 'holiday', '2026 春节'),
  { date: '2026-02-14', type: 'workday', name: '2026 春节调休上班' },
  { date: '2026-02-28', type: 'workday', name: '2026 春节调休上班' },
  ...rangeRules('2026-04-04', '2026-04-06', 'holiday', '2026 清明节'),
  ...rangeRules('2026-05-01', '2026-05-05', 'holiday', '2026 劳动节'),
  { date: '2026-05-09', type: 'workday', name: '2026 劳动节调休上班' },
  ...rangeRules('2026-06-19', '2026-06-21', 'holiday', '2026 端午节'),
  ...rangeRules('2026-09-25', '2026-09-27', 'holiday', '2026 中秋节'),
  ...rangeRules('2026-10-01', '2026-10-07', 'holiday', '2026 国庆节'),
  { date: '2026-09-20', type: 'workday', name: '2026 国庆节调休上班' },
  { date: '2026-10-10', type: 'workday', name: '2026 国庆节调休上班' }
].map((item) => ({ ...item, source: 'default' }));

const storeKey = 'xiamu-offline-booking-v1';
let state;
state = normalizeState(loadState());
let deferredInstallPrompt = null;
let activeTab = 'book';
let incomePeriod = 'day';
let openSwipeShell = null;
let toastTimer = null;
let lastNativeBackAt = 0;
const scrollPositions = { book: 0, orders: 0, calendar: 0, income: 0, settings: 0 };
const uiPreferenceKey = 'xiamu-ui-preferences-v1';

const $ = (id) => document.getElementById(id);

function rangeRules(startDate, endDate, type, name) {
  const rules = [];
  const current = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);

  while (current <= end) {
    rules.push({
      date: formatLocalDate(current),
      type,
      name
    });
    current.setDate(current.getDate() + 1);
  }

  return rules;
}

function today() {
  return formatLocalDate(new Date());
}

function formatLocalDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDate(value, days) {
  if (!isDate(value) || !Number.isInteger(days)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(year, month - 1, day + days, 12, 0, 0);
  return formatLocalDate(next);
}

function getIncomePeriodBounds(anchorDate, period) {
  if (!isDate(anchorDate) || !['day', 'week', 'month'].includes(period)) return { start: '', end: '' };
  if (period === 'day') return { start: anchorDate, end: anchorDate };
  const [year, month, day] = anchorDate.split('-').map(Number);
  const anchor = new Date(year, month - 1, day, 12, 0, 0);
  if (period === 'week') {
    const mondayOffset = (anchor.getDay() + 6) % 7;
    const start = new Date(year, month - 1, day - mondayOffset, 12, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12, 0, 0);
    return { start: formatLocalDate(start), end: formatLocalDate(end) };
  }
  const start = new Date(year, month - 1, 1, 12, 0, 0);
  const end = new Date(year, month, 0, 12, 0, 0);
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

function getIncomeRecordsInPeriod(records, anchorDate, period) {
  const bounds = getIncomePeriodBounds(anchorDate, period);
  if (!bounds.start) return [];
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && record.date >= bounds.start && record.date <= bounds.end);
}

function summarizeIncome(records, anchorDate = today()) {
  const safeRecords = (Array.isArray(records) ? records : []).map(normalizeIncomeRecord).filter(Boolean);
  const total = (period) => Math.round(getIncomeRecordsInPeriod(safeRecords, anchorDate, period)
    .reduce((sum, record) => sum + record.amount, 0) * 100) / 100;
  return { day: total('day'), week: total('week'), month: total('month') };
}

function classifyHorizontalGesture({ startX, deltaX, deltaY, width }) {
  const viewportWidth = Number(width || 0);
  const edgeInset = 24;
  if (!Number.isFinite(startX) || !Number.isFinite(deltaX) || !Number.isFinite(deltaY) || viewportWidth <= edgeInset * 2) return 'none';
  if (startX < edgeInset || startX > viewportWidth - edgeInset) return 'none';
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return 'none';
  return deltaX < 0 ? 'left' : 'right';
}

function loadState() {
  const fallback = { bookings: [], holidays: [], incomes: [], meta: {} };
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeState(input) {
  const source = input && typeof input === 'object' ? input : {};
  const holidays = Array.isArray(source.holidays) ? source.holidays.map(normalizeHoliday).filter(Boolean) : [];
  const incomes = Array.isArray(source.incomes) ? source.incomes.map(normalizeIncomeRecord).filter(Boolean) : [];
  const normalizedBookings = Array.isArray(source.bookings)
    ? source.bookings.map((booking) => normalizeBooking(booking, holidays)).filter(Boolean)
    : [];
  const bookingResult = mergeBookingsSafely([], normalizedBookings);
  return {
    bookings: bookingResult.bookings,
    holidays,
    incomes,
    meta: source.meta && typeof source.meta === 'object' ? source.meta : {}
  };
}

function saveState() {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(storeKey, serialized);
    const saved = localStorage.getItem(storeKey);
    if (saved !== serialized) throw new Error('保存校验失败');
    return true;
  } catch {
    alert('本机存储失败。请先导出备份，并检查浏览器是否处于无痕模式或手机存储空间是否已满。');
    return false;
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function money(value) {
  const amount = Number(value || 0);
  return `¥${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
}

function toMinutes(time) {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [hour, minute] = time.split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN;
  return hour * 60 + minute;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

function getHolidayRule(date, holidayRules = null) {
  const customRules = Array.isArray(holidayRules) ? holidayRules : (state?.holidays || []);
  return customRules.find((item) => item.date === date) || defaultHolidayRules.find((item) => item.date === date);
}

function isHoliday(date, holidayRules = null) {
  const override = getHolidayRule(date, holidayRules);
  if (override) return override.type === 'holiday';
  const day = new Date(`${date}T00:00:00+08:00`).getDay();
  return day === 0 || day === 6;
}

function getScene(id) {
  return scenes.find((scene) => scene.id === id) || scenes[0];
}

function isValidScene(id) {
  return scenes.some((scene) => scene.id === id);
}

function validateBooking(input, options = {}) {
  const errors = [];
  const start = toMinutes(input.start_time);
  const end = toMinutes(input.end_time);
  const duration = end - start;

  if (!isValidScene(input.scene_id)) errors.push('请选择有效场景');
  if (!isDate(input.date)) errors.push('请选择有效日期');
  if (!Number.isFinite(start) || !Number.isFinite(end)) errors.push('请选择有效开始和结束时间');
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.push('结束时间必须晚于开始时间');
  if (Number.isFinite(duration) && duration < 120) errors.push('单场租用必须 2 小时起租');
  if (Number.isFinite(start) && Number.isFinite(end) && (start % 30 !== 0 || end % 30 !== 0)) {
    errors.push('预约时间必须按 30 分钟为单位');
  }
  if (!Number.isInteger(input.people_count) || input.people_count <= 0) errors.push('拍摄人数必须为正整数');

  if (!options.skipCustomer) {
    if (!String(input.customer_name || '').trim()) errors.push('请填写客户姓名');
    if (!/^1\d{10}$/.test(String(input.phone || '').trim())) errors.push('请填写有效手机号');
    if (!String(input.wechat || '').trim()) errors.push('请填写微信号');
  }

  return { errors, start, end, duration };
}

function getBookingFieldErrors(input) {
  const errors = {};
  const start = toMinutes(input.start_time);
  const end = toMinutes(input.end_time);
  if (!isValidScene(input.scene_id)) errors.scene = '请选择有效场景';
  if (!isDate(input.date)) errors.date = '请选择有效日期';
  if (!Number.isFinite(start)) errors.start = '请选择有效开始时间';
  if (!Number.isFinite(end)) errors.end = '请选择有效结束时间';
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end <= start) errors.end = '结束时间必须晚于开始时间';
    else if (end - start < 120) errors.end = '单场租用必须 2 小时起租';
    else if (start % 30 !== 0 || end % 30 !== 0) errors.end = '预约时间必须按 30 分钟为单位';
  }
  if (!Number.isInteger(input.people_count) || input.people_count <= 0) errors.people = '拍摄人数必须为正整数';
  if (!String(input.customer_name || '').trim()) errors.customer = '请填写客户姓名';
  if (!/^1\d{10}$/.test(String(input.phone || '').trim())) errors.phone = '请填写有效手机号';
  if (!String(input.wechat || '').trim()) errors.wechat = '请填写微信号';
  return errors;
}

function getBackupHealth(sourceState = state) {
  const bookings = Array.isArray(sourceState?.bookings) ? sourceState.bookings : [];
  const incomes = Array.isArray(sourceState?.incomes) ? sourceState.incomes : [];
  const lastBackupAt = sourceState?.meta?.last_backup_at || '';
  const dataCountText = `${bookings.length} 条订单 · ${incomes.length} 笔收入`;
  if (!bookings.length && !incomes.length) {
    return { status: 'empty', title: '本机数据正常', text: '暂无订单和收入' };
  }
  if (!lastBackupAt || !Number.isFinite(Date.parse(lastBackupAt))) {
    return { status: 'stale', title: '数据尚未备份', text: dataCountText };
  }
  const backupTime = Date.parse(lastBackupAt);
  const changedItems = [...bookings, ...incomes];
  const latestChange = Math.max(...changedItems.map((item) => Date.parse(item.updated_at || item.created_at || 0) || 0));
  if (latestChange > backupTime) {
    return { status: 'stale', title: '有新变更待备份', text: dataCountText };
  }
  return { status: 'current', title: '备份状态良好', text: `已保护 ${dataCountText}` };
}

function calculateFee(input, changeCount = 0, options = {}) {
  const check = validateBooking(input, options);
  const scene = getScene(input.scene_id);
  const holiday = isHoliday(input.date, options.holidays || null);
  const hourlyRate = holiday ? scene.holidayRate : scene.weekdayRate;
  const durationHours = Math.max(0, Number.isFinite(check.duration) ? check.duration : 0) / 60;
  const overtimeMinutes = Number.isFinite(check.start) && Number.isFinite(check.end)
    ? Math.max(0, Math.min(check.end, 600) - check.start) + Math.max(0, check.end - Math.max(check.start, 1320))
    : 0;
  const extraPeople = Math.max(0, input.people_count - scene.capacity);
  const baseFee = hourlyRate * durationHours;
  const overtimeFee = (overtimeMinutes / 60) * 30;
  const extraPersonFee = extraPeople * 50;
  const rescheduleFee = changeCount > 1 ? 50 : 0;
  const warnings = [...check.errors];

  if (holiday) warnings.push('已按节假日/周末价格计算');
  if (overtimeFee > 0) warnings.push('包含营业时间外时段，已计入加班费');
  if (extraPersonFee > 0) warnings.push(`超出 ${scene.capacity} 人限制，已计入超人费`);
  if (rescheduleFee > 0) warnings.push('第二次及以后改签需额外加收 50 元');

  return {
    valid: check.errors.length === 0,
    scene,
    start: check.start,
    end: check.end,
    durationHours,
    baseFee,
    overtimeFee,
    extraPersonFee,
    rescheduleFee,
    totalFee: baseFee + overtimeFee + extraPersonFee + rescheduleFee,
    depositFee: hourlyRate,
    warnings
  };
}

function getScheduleRelations(input, excludeId = '', bookings = state.bookings) {
  const newStart = toMinutes(input.start_time);
  const newEnd = toMinutes(input.end_time);
  if (input.status === 'cancelled' || !isValidScene(input.scene_id) || !isDate(input.date) || !Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
    return { conflict: null, turnaroundWarnings: [] };
  }

  const activeBookings = bookings.filter((booking) => {
    if (booking.id === excludeId || booking.status === 'cancelled') return false;
    if (booking.scene_id !== input.scene_id || booking.date !== input.date) return false;
    return true;
  });
  const conflict = activeBookings.find((booking) => {
    const oldStart = toMinutes(booking.start_time);
    const oldEnd = toMinutes(booking.end_time);
    return oldStart < newEnd && oldEnd > newStart;
  });
  const turnaroundWarnings = activeBookings.flatMap((booking) => {
    const oldStart = toMinutes(booking.start_time);
    const oldEnd = toMinutes(booking.end_time);
    const previousGap = newStart - oldEnd;
    const nextGap = oldStart - newEnd;

    if (previousGap >= 0 && previousGap < 15) {
      return [{ relation: 'previous', gapMinutes: previousGap, booking }];
    }
    if (nextGap >= 0 && nextGap < 15) {
      return [{ relation: 'next', gapMinutes: nextGap, booking }];
    }
    return [];
  });

  return { conflict: conflict || null, turnaroundWarnings };
}

function hasConflict(input, excludeId = '') {
  return getScheduleRelations(input, excludeId).conflict;
}

function getTurnaroundWarnings(input, excludeId = '') {
  return getScheduleRelations(input, excludeId).turnaroundWarnings;
}

function syncStateFromStorage() {
  state = normalizeState(loadState());
  return state;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withDataLock(task) {
  const lockName = `${storeKey}-write`;
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(lockName, { mode: 'exclusive' }, task);
  }

  const leaseKey = `${lockName}-lease`;
  const token = uid();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const now = Date.now();
    let lease = null;
    try {
      lease = JSON.parse(localStorage.getItem(leaseKey) || 'null');
    } catch {
      lease = null;
    }

    if (!lease || Number(lease.expires_at || 0) <= now) {
      localStorage.setItem(leaseKey, JSON.stringify({ token, expires_at: now + 5000 }));
      await wait(20);
      const confirmed = JSON.parse(localStorage.getItem(leaseKey) || 'null');
      if (confirmed?.token === token) {
        try {
          return await task();
        } finally {
          const current = JSON.parse(localStorage.getItem(leaseKey) || 'null');
          if (current?.token === token) localStorage.removeItem(leaseKey);
        }
      }
    }
    await wait(20 + Math.floor(Math.random() * 20));
  }
  throw new Error('local data lock timeout');
}

async function createBookingAtomically(input) {
  try {
    return await withDataLock(async () => {
      syncStateFromStorage();
      const fee = calculateFee(input);
      if (!fee.valid) return { ok: false, reason: 'invalid', warnings: fee.warnings };

      const relations = getScheduleRelations(input, '', state.bookings);
      if (relations.conflict) {
        return { ok: false, reason: 'conflict', conflict: relations.conflict };
      }

      const now = new Date().toISOString();
      const booking = {
        id: uid(),
        ...input,
        scene_id: fee.scene.id,
        scene_name: fee.scene.name,
        people_count: Number(input.people_count),
        customer_name: String(input.customer_name || '').trim(),
        phone: String(input.phone || '').trim(),
        wechat: String(input.wechat || '').trim(),
        status: 'pending',
        change_count: 0,
        base_fee: fee.baseFee,
        overtime_fee: fee.overtimeFee,
        extra_person_fee: fee.extraPersonFee,
        reschedule_fee: 0,
        total_fee: fee.totalFee,
        deposit_amount: fee.depositFee,
        created_at: now,
        updated_at: now
      };
      const previousState = state;
      state = { ...state, bookings: [...state.bookings, booking] };
      if (!saveState()) {
        state = previousState;
        return { ok: false, reason: 'storage' };
      }
      return { ok: true, booking, fee, turnaroundWarnings: relations.turnaroundWarnings };
    });
  } catch {
    return { ok: false, reason: 'storage' };
  }
}

async function mutateStateAtomically(mutator) {
  try {
    return await withDataLock(async () => {
      syncStateFromStorage();
      const previousState = state;
      const result = await mutator(state);
      if (!result || result.ok === false) return result || { ok: false, reason: 'invalid' };
      state = result.state || state;
      if (!saveState()) {
        state = previousState;
        return { ok: false, reason: 'storage' };
      }
      return { ...result, ok: true };
    });
  } catch {
    return { ok: false, reason: 'storage' };
  }
}

function createIncomeAtomically(input) {
  return mutateStateAtomically((latest) => {
    const record = normalizeIncomeRecord({
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (!record) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      state: { ...latest, incomes: [...latest.incomes, record] },
      income: record
    };
  });
}

function deleteIncomeAtomically(id) {
  return mutateStateAtomically((latest) => {
    const incomes = latest.incomes.filter((record) => record.id !== id);
    if (incomes.length === latest.incomes.length) return { ok: false, reason: 'missing' };
    return { ok: true, state: { ...latest, incomes } };
  });
}

function updateBookingStatusAtomically(id, status) {
  return mutateStateAtomically((latest) => {
    if (!statuses.some(([value]) => value === status)) return { ok: false, reason: 'invalid' };
    const index = latest.bookings.findIndex((booking) => booking.id === id);
    if (index < 0) return { ok: false, reason: 'missing' };
    const bookings = [...latest.bookings];
    bookings[index] = { ...bookings[index], status, updated_at: new Date().toISOString() };
    return { ok: true, state: { ...latest, bookings } };
  });
}

function rescheduleBookingAtomically(id, patch) {
  return mutateStateAtomically((latest) => {
    const index = latest.bookings.findIndex((booking) => booking.id === id);
    if (index < 0) return { ok: false, reason: 'missing' };
    const current = latest.bookings[index];
    const next = { ...current, ...patch };
    const changeCount = Number(current.change_count || 0) + (hasScheduleChanged(current, next) ? 1 : 0);
    const fee = calculateFee(next, changeCount);
    if (!fee.valid) return { ok: false, reason: 'invalid', warnings: fee.warnings };
    const relations = getScheduleRelations(next, current.id, latest.bookings);
    if (relations.conflict) return { ok: false, reason: 'conflict', conflict: relations.conflict };

    const bookings = [...latest.bookings];
    bookings[index] = {
      ...next,
      change_count: changeCount,
      base_fee: fee.baseFee,
      overtime_fee: fee.overtimeFee,
      extra_person_fee: fee.extraPersonFee,
      reschedule_fee: fee.rescheduleFee,
      total_fee: fee.totalFee,
      deposit_amount: fee.depositFee,
      updated_at: new Date().toISOString()
    };
    return {
      ok: true,
      state: { ...latest, bookings },
      booking: bookings[index],
      fee,
      turnaroundWarnings: relations.turnaroundWarnings
    };
  });
}

function formatTurnaroundWarning(warning) {
  const booking = warning.booking;
  const gapText = warning.gapMinutes === 0 ? '立即' : `${warning.gapMinutes} 分钟后`;
  if (warning.relation === 'previous') {
    return `上一单 ${booking.start_time}-${booking.end_time} 结束后，本单${gapText}开始。请提醒下一单（本单）客户准时到场，并协调上一单准时收尾。`;
  }
  return `本单结束后，下一单 ${booking.start_time}-${booking.end_time} ${gapText}开始。请提醒下一单客户提前候场，并提醒本单客户准时收尾。`;
}

function renderTurnaroundAlert(element, warnings) {
  if (!element) return;
  const text = element.querySelector('.turnaround-text');
  element.hidden = warnings.length === 0;
  if (text) text.textContent = warnings.map(formatTurnaroundWarning).join('\n');
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    ...data,
    people_count: Number(data.people_count || 0),
    customer_name: data.customer_name || '',
    phone: data.phone || '',
    wechat: data.wechat || ''
  };
}

function normalizeBooking(raw, holidayRules = []) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidScene(raw.scene_id)) return null;
  const scene = getScene(raw.scene_id);
  const booking = {
    id: String(raw.id || uid()),
    scene_id: scene.id,
    scene_name: scene.name,
    date: String(raw.date || ''),
    start_time: String(raw.start_time || ''),
    end_time: String(raw.end_time || ''),
    people_count: Number(raw.people_count || 0),
    customer_name: String(raw.customer_name || '').trim(),
    phone: String(raw.phone || '').trim(),
    wechat: String(raw.wechat || '').trim(),
    status: statuses.some(([value]) => value === raw.status) ? raw.status : 'pending',
    change_count: Math.max(0, Math.trunc(Number(raw.change_count || 0))),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || new Date().toISOString()
  };
  const fee = calculateFee(booking, booking.change_count, { holidays: holidayRules });

  if (!fee.valid) return null;

  return {
    ...booking,
    base_fee: fee.baseFee,
    overtime_fee: fee.overtimeFee,
    extra_person_fee: fee.extraPersonFee,
    reschedule_fee: fee.rescheduleFee,
    total_fee: fee.totalFee,
    deposit_amount: fee.depositFee
  };
}

function normalizeHoliday(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isDate(raw.date)) return null;
  if (!['holiday', 'workday'].includes(raw.type)) return null;
  return {
    date: raw.date,
    type: raw.type,
    name: String(raw.name || '').trim(),
    source: 'custom'
  };
}

function normalizeIncomeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const amount = Number(raw.amount);
  const category = String(raw.category || '');
  if (!isDate(String(raw.date || ''))) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return null;
  if (!incomeCategories.some(([value]) => value === category)) return null;
  const now = new Date().toISOString();
  return {
    id: String(raw.id || uid()),
    date: String(raw.date),
    amount: Math.round(amount * 100) / 100,
    category,
    booking_id: String(raw.booking_id || ''),
    customer_name: String(raw.customer_name || '').trim().slice(0, 50),
    note: String(raw.note || '').trim().slice(0, 200),
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || raw.created_at || now
  };
}

function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function addOption(select, value, label, selectedValue = '') {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = value === selectedValue;
  select.appendChild(option);
}

function refreshIcons() {
  if (typeof window !== 'undefined' && window.lucide?.createIcons) {
    window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }
}

function showToast(message, duration = 2200) {
  const toast = $('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function getUiPreferences() {
  try {
    return JSON.parse(localStorage.getItem(uiPreferenceKey) || '{}');
  } catch {
    return {};
  }
}

function updateUiPreferences(patch) {
  try {
    localStorage.setItem(uiPreferenceKey, JSON.stringify({ ...getUiPreferences(), ...patch }));
  } catch {
    // UI preferences are optional and must never block booking operations.
  }
}

function renderFieldErrors(input, forceAll = false) {
  const errors = getBookingFieldErrors(input);
  document.querySelectorAll('[data-field-error]').forEach((element) => {
    const fieldName = element.dataset.fieldError;
    const inputElement = fieldName === 'scene' ? $('scene') : $(fieldName);
    const shouldShow = forceAll || inputElement?.dataset.touched === 'true';
    element.textContent = shouldShow ? (errors[fieldName] || '') : '';
    element.closest('.field')?.classList.toggle('has-error', shouldShow && Boolean(errors[fieldName]));
  });
  return errors;
}

function minutesToTime(minutes) {
  const normalized = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function applyDuration(minutes) {
  const start = toMinutes($('start').value);
  if (!Number.isFinite(start)) return;
  const target = start + minutes;
  if (target >= 1440) {
    showToast('所选时长会跨天，请手动调整开始时间');
    return;
  }
  $('end').value = minutesToTime(target);
  document.querySelectorAll('.duration-chips button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.duration) === minutes);
  });
  updateFeePreview();
}

function updateAvailabilityPreview(input) {
  const preview = $('availabilityPreview');
  if (!preview) return;
  const fee = calculateFee(input, 0, { skipCustomer: true });
  const conflict = fee.valid ? hasConflict(input) : null;
  const reminders = fee.valid && !conflict ? getTurnaroundWarnings(input) : [];
  preview.classList.toggle('conflict', Boolean(conflict));
  preview.classList.toggle('warning', !conflict && reminders.length > 0);
  const text = preview.querySelector('span');
  const icon = preview.querySelector('svg, i');
  if (conflict) {
    if (text) text.textContent = `与 ${conflict.start_time}-${conflict.end_time} ${conflict.customer_name} 的订单重叠`;
    if (icon) icon.setAttribute('data-lucide', 'circle-x');
  } else if (reminders.length) {
    if (text) text.textContent = '时段可保存，但与相邻订单不足 15 分钟，请提醒客户';
    if (icon) icon.setAttribute('data-lucide', 'triangle-alert');
  } else if (fee.valid) {
    if (text) text.textContent = '当前时段可预约';
    if (icon) icon.setAttribute('data-lucide', 'circle-check');
  } else {
    if (text) text.textContent = '完善日期和时间后检查档期';
    if (icon) icon.setAttribute('data-lucide', 'clock-3');
  }
  refreshIcons();
}

function switchTab(tabId, options = {}) {
  const screen = $(tabId);
  const button = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!screen || !button || tabId === activeTab) return;
  scrollPositions[activeTab] = window.scrollY;
  document.querySelectorAll('.tab').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    if (selected) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.screen').forEach((item) => item.classList.toggle('active', item === screen));
  activeTab = tabId;
  document.body.dataset.activeTab = tabId;
  closeOpenSwipe();
  renderAll();
  requestAnimationFrame(() => window.scrollTo({ top: options.top ? 0 : (scrollPositions[tabId] || 0), behavior: 'auto' }));
}

function setSwipeOffset(shell, offset) {
  if (!shell) return;
  shell.style.setProperty('--swipe-x', `${offset}px`);
  shell.querySelectorAll('.swipe-reveal').forEach((reveal) => {
    const isVisible = offset > 0 ? reveal.classList.contains('swipe-paid') : offset < 0 && reveal.classList.contains('swipe-manage');
    reveal.setAttribute('aria-hidden', String(!isVisible));
    reveal.querySelectorAll('button').forEach((button) => { button.tabIndex = isVisible ? 0 : -1; });
  });
}

function closeOpenSwipe(except = null) {
  if (openSwipeShell && openSwipeShell !== except) setSwipeOffset(openSwipeShell, 0);
  if (openSwipeShell !== except) openSwipeShell = null;
}

async function copyText(value, label) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast(`${label}已复制`);
  } catch {
    showToast(`复制失败，请长按复制${label}`);
  }
}

function fillSelects() {
  const sceneSelect = $('scene');
  const sceneFilter = $('sceneFilter');
  const statusFilter = $('statusFilter');
  clearElement(sceneSelect);
  clearElement(sceneFilter);
  clearElement(statusFilter);

  scenes.forEach((scene) => addOption(sceneSelect, scene.id, `${scene.name} · ${scene.weekdayRate}/${scene.holidayRate}/h`));
  addOption(sceneFilter, '', '全部场景');
  scenes.forEach((scene) => addOption(sceneFilter, scene.id, scene.name));
  addOption(statusFilter, '', '全部状态');
  statuses.forEach(([value, label]) => addOption(statusFilter, value, label));
  const incomeCategory = $('incomeCategory');
  if (incomeCategory) {
    clearElement(incomeCategory);
    incomeCategories.forEach(([value, label]) => addOption(incomeCategory, value, label));
  }
}

function updateFeePreview() {
  const input = formData($('bookingForm'));
  const fee = calculateFee(input);
  $('totalFee').textContent = money(fee.totalFee);
  $('baseFee').textContent = money(fee.baseFee);
  $('overtimeFee').textContent = money(fee.overtimeFee);
  $('extraFee').textContent = money(fee.extraPersonFee);
  $('depositFee').textContent = money(fee.depositFee);
  $('stickyTotalFee').textContent = money(fee.totalFee);
  $('stickyDepositFee').textContent = money(fee.depositFee);
  $('datePriceType').textContent = isHoliday(input.date) ? '节假日价' : '工作日价';
  $('warnings').textContent = fee.warnings.filter((warning) => !warning.startsWith('请填写') && !warning.includes('必须 2 小时')).join('\n');
  renderFieldErrors(input);
  updateAvailabilityPreview(input);
  renderTurnaroundAlert($('turnaroundPreview'), getTurnaroundWarnings(input));
}

async function setBookingStatusFromUi(booking, nextStatus, control = null, options = {}) {
  if (!options.skipConfirm && ['completed', 'cancelled'].includes(nextStatus) && !confirm(`确定把订单状态改为“${statusName(nextStatus)}”吗？`)) return false;
  if (control) control.disabled = true;
  const result = await updateBookingStatusAtomically(booking.id, nextStatus);
  if (control) control.disabled = false;
  if (!result.ok) {
    if (result.reason === 'missing') alert('该订单已在另一个窗口中发生变化，请刷新后重试。');
    return false;
  }
  showToast(`订单已标记为${statusName(nextStatus)}`);
  renderAll();
  if (nextStatus === 'deposit_paid' && !state.incomes.some((record) => record.booking_id === booking.id && record.category === 'deposit')) {
    const latestBooking = state.bookings.find((item) => item.id === booking.id) || booking;
    if (confirm('订单状态已更新。是否现在把实际收到的订金记入收入？')) openIncomeDialog(latestBooking);
  }
  return true;
}

async function cancelBookingFromUi(booking, control = null) {
  if (booking.status === 'cancelled') return false;
  if (!confirm(`确定取消 ${booking.date} ${booking.start_time} ${booking.customer_name} 的订单吗？\n取消后不占用档期，但记录仍会保留。`)) return false;
  return setBookingStatusFromUi(booking, 'cancelled', control, { skipConfirm: true });
}

function openOrderDetail(booking) {
  const content = $('orderDetailContent');
  clearElement(content);
  const collected = state.incomes.filter((record) => record.booking_id === booking.id).reduce((sum, record) => sum + record.amount, 0);
  const rows = [
    ['场景', booking.scene_name],
    ['档期', `${booking.date} ${booking.start_time}-${booking.end_time}`],
    ['客户', `${booking.customer_name} · ${booking.people_count}人`],
    ['手机号', booking.phone],
    ['微信号', booking.wechat],
    ['状态', statusName(booking.status)],
    ['费用', `总额 ${money(booking.total_fee)} · 已收 ${money(collected)} · 待收 ${money(Math.max(0, booking.total_fee - collected))}`],
    ['改签', `${booking.change_count || 0} 次`]
  ];
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    const name = document.createElement('small');
    const detail = document.createElement('strong');
    name.textContent = label;
    detail.textContent = value;
    row.append(name, detail);
    content.appendChild(row);
  });
  if (booking.status !== 'cancelled') {
    const recordButton = document.createElement('button');
    recordButton.type = 'button';
    recordButton.className = 'primary order-income-button';
    recordButton.innerHTML = '<i data-lucide="wallet-cards"></i>记一笔收款';
    recordButton.addEventListener('click', () => {
      $('orderDetailDialog').close();
      openIncomeDialog(booking);
    });
    content.appendChild(recordButton);
  }
  $('orderDetailDialog').showModal();
  refreshIcons();
}

function attachOrderSwipe(shell, booking) {
  const card = shell.querySelector('.order-card');
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let tracking = false;
  let dragged = false;
  setSwipeOffset(shell, 0);

  card.addEventListener('touchstart', (event) => {
    if (event.target.closest('button, select, input, a')) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    deltaX = 0;
    dragged = false;
    tracking = true;
    closeOpenSwipe(shell);
    shell.classList.add('dragging');
  }, { passive: true });

  card.addEventListener('touchmove', (event) => {
    if (!tracking) return;
    const touch = event.touches[0];
    deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (Math.abs(deltaX) < Math.abs(deltaY) || Math.abs(deltaX) < 8) return;
    dragged = true;
    const min = -168;
    const max = booking.status === 'pending' ? 92 : 0;
    setSwipeOffset(shell, Math.max(min, Math.min(max, deltaX)));
  }, { passive: true });

  card.addEventListener('touchend', (event) => {
    if (!tracking) return;
    tracking = false;
    shell.classList.remove('dragging');
    const touch = event.changedTouches[0];
    const direction = classifyHorizontalGesture({
      startX,
      deltaX: touch.clientX - startX,
      deltaY: touch.clientY - startY,
      width: window.innerWidth
    });
    const offset = direction === 'left' ? -168 : (direction === 'right' && booking.status === 'pending' ? 92 : 0);
    setSwipeOffset(shell, offset);
    openSwipeShell = offset ? shell : null;
  }, { passive: true });

  card.addEventListener('click', (event) => {
    if (dragged || event.target.closest('button, select, input, a')) return;
    openOrderDetail(booking);
  });
}

function renderOrders() {
  const keyword = $('search').value.trim();
  const status = $('statusFilter').value;
  const sceneId = $('sceneFilter').value;
  const list = $('ordersList');
  const template = $('orderTemplate');
  clearElement(list);
  openSwipeShell = null;

  const filtered = state.bookings
    .filter((booking) => !keyword || booking.customer_name.includes(keyword) || booking.phone.includes(keyword) || booking.date.includes(keyword))
    .filter((booking) => !status || booking.status === status)
    .filter((booking) => !sceneId || booking.scene_id === sceneId)
    .sort((a, b) => `${b.date} ${b.start_time}`.localeCompare(`${a.date} ${a.start_time}`));

  $('orderResultCount').textContent = `${filtered.length} 条`;

  if (!filtered.length) {
    const empty = document.createElement('section');
    empty.className = 'order-card empty-state';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'calendar-plus');
    const text = document.createElement('p');
    text.className = 'order-contact';
    text.textContent = keyword || status || sceneId ? '没有符合筛选条件的订单' : '还没有订单';
    const button = document.createElement('button');
    button.className = 'text-button';
    button.type = 'button';
    button.textContent = '新建预约';
    button.addEventListener('click', () => switchTab('book', { top: true }));
    empty.append(icon, text, button);
    list.appendChild(empty);
    refreshIcons();
    return;
  }

  for (const booking of filtered) {
    const shell = template.content.firstElementChild.cloneNode(true);
    const card = shell.querySelector('.order-card');
    shell.dataset.bookingId = booking.id;
    card.querySelector('.order-title').textContent = `${booking.scene_name} · ${booking.customer_name}`;
    card.querySelector('.order-time').textContent = `${booking.date} ${booking.start_time}-${booking.end_time} · ${booking.people_count}人`;
    card.querySelector('.order-contact').textContent = `${booking.phone} / ${booking.wechat}`;
    const statusPill = card.querySelector('.status-pill');
    statusPill.textContent = statusName(booking.status);
    statusPill.dataset.status = booking.status;
    card.querySelector('.fee-line').textContent = `总额 ${money(booking.total_fee)} · 订金 ${money(booking.deposit_amount)} · 改签 ${booking.change_count || 0} 次`;
    const turnaroundWarnings = getTurnaroundWarnings(booking, booking.id);
    renderTurnaroundAlert(card.querySelector('.turnaround-alert'), turnaroundWarnings);
    card.classList.toggle('has-turnaround', turnaroundWarnings.length > 0);

    const select = card.querySelector('.status-select');
    statuses.forEach(([value, label]) => addOption(select, value, label, booking.status));
    select.addEventListener('change', async () => {
      const changed = await setBookingStatusFromUi(booking, select.value, select);
      if (!changed) select.value = booking.status;
    });

    const cancelButton = card.querySelector('.cancel-order');
    const swipeCancel = shell.querySelector('.swipe-cancel');
    if (booking.status === 'cancelled') {
      cancelButton.textContent = '已取消';
      cancelButton.disabled = true;
      swipeCancel.disabled = true;
    } else {
      cancelButton.addEventListener('click', () => cancelBookingFromUi(booking, cancelButton));
      swipeCancel.addEventListener('click', () => cancelBookingFromUi(booking, swipeCancel));
    }

    card.querySelector('.reschedule').addEventListener('click', () => openEdit(booking));
    shell.querySelector('.swipe-reschedule').addEventListener('click', () => openEdit(booking));
    card.querySelector('.copy-phone').addEventListener('click', () => copyText(booking.phone, '手机号'));
    card.querySelector('.copy-wechat').addEventListener('click', () => copyText(booking.wechat, '微信号'));

    const markPaid = shell.querySelector('.mark-paid');
    if (booking.status !== 'pending') {
      markPaid.disabled = true;
      markPaid.textContent = booking.status === 'deposit_paid' ? '订金已付' : '不可操作';
    } else {
      markPaid.addEventListener('click', () => setBookingStatusFromUi(booking, 'deposit_paid', markPaid));
    }

    attachOrderSwipe(shell, booking);
    list.appendChild(shell);
  }
  refreshIcons();
}

function statusName(value) {
  return statuses.find(([status]) => status === value)?.[1] || value;
}

function changeCalendarDate(days) {
  const date = shiftDate($('calendarDate').value, days);
  if (!date) return;
  $('calendarDate').value = date;
  const board = $('calendarList');
  board.classList.remove('slide-left', 'slide-right');
  board.classList.add(days > 0 ? 'slide-left' : 'slide-right');
  renderCalendar();
  setTimeout(() => board.classList.remove('slide-left', 'slide-right'), 220);
}

function renderCalendar() {
  const date = $('calendarDate').value;
  const list = $('calendarList');
  clearElement(list);

  const ruler = document.createElement('div');
  ruler.className = 'time-ruler';
  [0, 6, 12, 18, 24].forEach((hour) => {
    const label = document.createElement('span');
    label.style.setProperty('--position', `${hour / 24 * 100}%`);
    label.textContent = `${String(hour).padStart(2, '0')}:00`;
    ruler.appendChild(label);
  });
  list.appendChild(ruler);

  scenes.forEach((scene) => {
    const lane = document.createElement('article');
    lane.className = 'schedule-lane';
    const laneLabel = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = scene.name;

    const items = state.bookings
      .filter((booking) => booking.date === date && booking.scene_id === scene.id && booking.status !== 'cancelled')
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const count = document.createElement('small');
    count.textContent = items.length ? `${items.length} 单` : '空闲';
    laneLabel.append(title, count);
    lane.appendChild(laneLabel);

    const track = document.createElement('div');
    track.className = 'schedule-track';

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'lane-empty';
      empty.textContent = '全天可预约';
      track.appendChild(empty);
    } else {
      items.forEach((item) => {
        const block = document.createElement('button');
        const start = toMinutes(item.start_time);
        const end = toMinutes(item.end_time);
        block.type = 'button';
        block.className = 'schedule-block';
        block.dataset.status = item.status;
        block.style.setProperty('--start', `${start / 1440 * 100}%`);
        block.style.setProperty('--duration', `${Math.max(0, end - start) / 1440 * 100}%`);
        block.textContent = `${item.start_time} ${item.customer_name}`;
        block.title = `${item.start_time}-${item.end_time} ${item.customer_name} · ${statusName(item.status)}`;
        const turnaroundWarnings = getTurnaroundWarnings(item, item.id);
        block.classList.toggle('has-turnaround', turnaroundWarnings.length > 0);
        block.addEventListener('click', () => openOrderDetail(item));
        track.appendChild(block);
      });
    }

    lane.appendChild(track);
    list.appendChild(lane);
  });
}

function getHolidayRulesForDisplay() {
  const map = new Map(defaultHolidayRules.map((item) => [item.date, item]));
  state.holidays.forEach((item) => map.set(item.date, item));
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function deleteHolidayRule(item, control = null) {
  if (!confirm(`确定删除 ${item.date} 的自定义日期规则吗？`)) return false;
  if (control) control.disabled = true;
  const result = await mutateStateAtomically((latest) => ({
    ok: true,
    state: { ...latest, holidays: latest.holidays.filter((holiday) => holiday.date !== item.date) }
  }));
  if (!result.ok) {
    if (control) control.disabled = false;
    return false;
  }
  showToast('自定义日期规则已删除');
  renderAll();
  return true;
}

function attachHolidaySwipe(shell) {
  const row = shell.querySelector('.holiday-row');
  const reveal = shell.querySelector('.holiday-delete-reveal');
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  reveal.tabIndex = -1;
  reveal.setAttribute('aria-hidden', 'true');
  row.addEventListener('touchstart', (event) => {
    if (event.target.closest('button')) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    deltaX = 0;
  }, { passive: true });
  row.addEventListener('touchmove', (event) => {
    if (!startX) return;
    deltaX = Math.min(0, event.touches[0].clientX - startX);
    if (Math.abs(deltaX) < Math.abs(event.touches[0].clientY - startY)) return;
    shell.style.setProperty('--holiday-swipe-x', `${Math.max(-82, deltaX)}px`);
  }, { passive: true });
  row.addEventListener('touchend', (event) => {
    if (!startX) return;
    const touch = event.changedTouches[0];
    const direction = classifyHorizontalGesture({ startX, deltaX: touch.clientX - startX, deltaY: touch.clientY - startY, width: window.innerWidth });
    const open = direction === 'left';
    shell.style.setProperty('--holiday-swipe-x', open ? '-82px' : '0px');
    reveal.tabIndex = open ? 0 : -1;
    reveal.setAttribute('aria-hidden', String(!open));
    startX = 0;
  }, { passive: true });
}

function renderHolidays() {
  const list = $('holidayList');
  clearElement(list);
  const customOnly = $('customHolidayOnly')?.checked;
  const rules = getHolidayRulesForDisplay().filter((item) => !customOnly || item.source !== 'default');
  $('holidayRuleCount').textContent = `（${rules.length} 条）`;

  if (!rules.length) {
    const empty = document.createElement('div');
    empty.textContent = '暂无日期规则';
    list.appendChild(empty);
    return;
  }

  const monthGroups = new Map();
  rules.forEach((item) => {
    const month = item.date.slice(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month).push(item);
  });

  monthGroups.forEach((items, month) => {
    const group = document.createElement('details');
    group.className = 'holiday-month';
    group.open = month === today().slice(0, 7) || items.some((item) => item.source !== 'default');
    const summary = document.createElement('summary');
    summary.textContent = `${month.replace('-', ' 年 ')} 月 · ${items.length} 条`;
    group.appendChild(summary);

    items.forEach((item) => {
      const shell = document.createElement('div');
      shell.className = item.source === 'default' ? 'holiday-row-shell' : 'holiday-row-shell holiday-swipe-shell';
      const row = document.createElement('div');
      row.className = 'holiday-row';
      const source = item.source === 'default' ? '内置' : '自定义';
      row.append(`${item.date.slice(5)} · ${item.type === 'holiday' ? '节假日' : '补班'} · ${item.name || '未命名'} · ${source}`);

      if (item.source !== 'default') {
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'holiday-delete-reveal';
        reveal.textContent = '删除';
        reveal.addEventListener('click', () => deleteHolidayRule(item, reveal));
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '删除';
        button.addEventListener('click', () => deleteHolidayRule(item, button));
        row.appendChild(button);
        shell.append(reveal, row);
        attachHolidaySwipe(shell);
      } else {
        shell.appendChild(row);
      }
      group.appendChild(shell);
    });
    list.appendChild(group);
  });
}

function incomeCategoryName(value) {
  return incomeCategories.find(([category]) => category === value)?.[1] || value;
}

function shiftIncomeAnchor(direction) {
  const anchor = $('incomeAnchorDate').value;
  if (!isDate(anchor)) return;
  if (incomePeriod === 'day') $('incomeAnchorDate').value = shiftDate(anchor, direction);
  if (incomePeriod === 'week') $('incomeAnchorDate').value = shiftDate(anchor, direction * 7);
  if (incomePeriod === 'month') {
    const [year, month, day] = anchor.split('-').map(Number);
    const lastDay = new Date(year, month - 1 + direction + 1, 0).getDate();
    $('incomeAnchorDate').value = formatLocalDate(new Date(year, month - 1 + direction, Math.min(day, lastDay), 12, 0, 0));
  }
  renderIncome();
}

function incomePeriodLabel(bounds, period) {
  if (period === 'day') return `${bounds.start} 实收`;
  if (period === 'week') return `${bounds.start.slice(5)} 至 ${bounds.end.slice(5)}`;
  return `${bounds.start.slice(0, 4)} 年 ${Number(bounds.start.slice(5, 7))} 月`;
}

function renderIncomeChart(records, bounds, period) {
  const chart = $('incomeChart');
  clearElement(chart);
  const buckets = [];
  if (period === 'day') {
    incomeCategories.forEach(([value, label]) => {
      buckets.push({ label, total: records.filter((record) => record.category === value).reduce((sum, record) => sum + record.amount, 0) });
    });
  } else {
    let date = bounds.start;
    while (date && date <= bounds.end) {
      buckets.push({
        label: period === 'week' ? `${Number(date.slice(8))}日` : String(Number(date.slice(8))),
        total: records.filter((record) => record.date === date).reduce((sum, record) => sum + record.amount, 0)
      });
      date = shiftDate(date, 1);
    }
  }
  chart.style.setProperty('--bar-count', String(buckets.length));
  const max = Math.max(0, ...buckets.map((bucket) => bucket.total));
  buckets.forEach((bucket) => {
    const bar = document.createElement('div');
    bar.className = 'income-bar';
    bar.title = `${bucket.label} ${money(bucket.total)}`;
    const column = document.createElement('i');
    column.style.setProperty('--bar-height', max ? `${Math.max(3, bucket.total / max * 100)}%` : '3px');
    const label = document.createElement('span');
    label.textContent = bucket.label;
    bar.append(column, label);
    chart.appendChild(bar);
  });
}

function renderIncome() {
  const anchor = isDate($('incomeAnchorDate')?.value) ? $('incomeAnchorDate').value : today();
  const summary = summarizeIncome(state.incomes, today());
  $('incomeToday').textContent = money(summary.day);
  $('incomeWeek').textContent = money(summary.week);
  $('incomeMonth').textContent = money(summary.month);

  const bounds = getIncomePeriodBounds(anchor, incomePeriod);
  const records = getIncomeRecordsInPeriod(state.incomes, anchor, incomePeriod)
    .sort((a, b) => `${b.date} ${b.created_at}`.localeCompare(`${a.date} ${a.created_at}`));
  const total = Math.round(records.reduce((sum, record) => sum + record.amount, 0) * 100) / 100;
  $('incomePeriodLabel').textContent = incomePeriodLabel(bounds, incomePeriod);
  $('incomePeriodTotal').textContent = money(total);
  $('incomeRecordCount').textContent = `${records.length} 笔`;
  document.querySelectorAll('[data-income-period]').forEach((button) => button.classList.toggle('active', button.dataset.incomePeriod === incomePeriod));
  renderIncomeChart(records, bounds, incomePeriod);

  const list = $('incomeList');
  clearElement(list);
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'income-empty';
    empty.textContent = '这个周期还没有实际收款记录';
    list.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('article');
    row.className = 'income-record';
    const icon = document.createElement('span');
    icon.className = 'income-record-icon';
    const iconElement = document.createElement('i');
    iconElement.setAttribute('data-lucide', record.category === 'deposit' ? 'badge-dollar-sign' : 'banknote');
    icon.appendChild(iconElement);
    const copy = document.createElement('div');
    copy.className = 'income-record-copy';
    const title = document.createElement('strong');
    title.textContent = `${incomeCategoryName(record.category)}${record.customer_name ? ` · ${record.customer_name}` : ''}`;
    const detail = document.createElement('small');
    detail.textContent = `${record.date}${record.note ? ` · ${record.note}` : ''}`;
    copy.append(title, detail);
    const amount = document.createElement('strong');
    amount.className = 'income-record-amount';
    amount.textContent = money(record.amount);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'plain-icon';
    remove.setAttribute('aria-label', `删除 ${record.date} ${money(record.amount)} 收入`);
    const trash = document.createElement('i');
    trash.setAttribute('data-lucide', 'trash-2');
    remove.appendChild(trash);
    remove.addEventListener('click', async () => {
      if (!confirm(`确定删除 ${record.date} 的 ${money(record.amount)} 收款记录吗？`)) return;
      remove.disabled = true;
      const result = await deleteIncomeAtomically(record.id);
      if (result.ok) {
        showToast('收款记录已删除');
        renderAll();
      } else {
        remove.disabled = false;
      }
    });
    row.append(icon, copy, amount, remove);
    list.appendChild(row);
  });
  refreshIcons();
}

function fillIncomeBookingOptions(selectedId = '') {
  const select = $('incomeBooking');
  clearElement(select);
  addOption(select, '', '不关联订单', selectedId);
  state.bookings
    .filter((booking) => booking.status !== 'cancelled')
    .sort((a, b) => `${b.date} ${b.start_time}`.localeCompare(`${a.date} ${a.start_time}`))
    .slice(0, 100)
    .forEach((booking) => addOption(select, booking.id, `${booking.date} · ${booking.customer_name} · ${booking.scene_name}`, selectedId));
}

function applyBookingToIncomeForm(bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const collected = state.incomes.filter((record) => record.booking_id === booking.id).reduce((sum, record) => sum + record.amount, 0);
  const remaining = Math.max(0, Number(booking.total_fee || 0) - collected);
  $('incomeCustomer').value = booking.customer_name;
  $('incomeCategory').value = collected > 0 ? (remaining > 0 ? 'balance' : 'extra') : 'deposit';
  $('incomeAmount').value = remaining > 0 ? String(collected > 0 ? remaining : booking.deposit_amount) : '';
  $('incomeNote').value = `${booking.scene_name} ${booking.date} ${booking.start_time}-${booking.end_time}${remaining > 0 ? '' : ' · 订单已收足，请填写额外实收'}`;
}

function isIncomeDirty() {
  return Boolean($('incomeBooking')?.value || $('incomeAmount')?.value || $('incomeCustomer')?.value || $('incomeNote')?.value);
}

function openIncomeDialog(booking = null) {
  syncStateFromStorage();
  fillIncomeBookingOptions(booking?.id || '');
  $('incomeDate').value = today();
  $('incomeAmount').value = '';
  $('incomeCategory').value = 'deposit';
  $('incomeCustomer').value = '';
  $('incomeNote').value = '';
  $('incomeFormError').textContent = '';
  if (booking) applyBookingToIncomeForm(booking.id);
  $('incomeDialog').showModal();
  refreshIcons();
}

async function saveIncome(event) {
  event.preventDefault();
  const input = {
    date: $('incomeDate').value,
    amount: Number($('incomeAmount').value),
    category: $('incomeCategory').value,
    booking_id: $('incomeBooking').value,
    customer_name: $('incomeCustomer').value,
    note: $('incomeNote').value
  };
  if (!normalizeIncomeRecord(input)) {
    $('incomeFormError').textContent = '请选择有效日期，并填写大于 0 的实际收款金额。';
    (!isDate(input.date) ? $('incomeDate') : $('incomeAmount')).focus();
    return;
  }
  const submit = $('incomeForm').querySelector('[type="submit"]');
  submit.disabled = true;
  const result = await createIncomeAtomically(input);
  submit.disabled = false;
  if (!result.ok) {
    $('incomeFormError').textContent = result.reason === 'storage' ? '本机保存失败，请先导出备份并检查存储空间。' : '收款信息不完整，请检查后重试。';
    return;
  }
  $('incomeDialog').close();
  showToast(`已记录 ${money(result.income.amount)} 实收`);
  renderAll();
}

function renderBackupMeta() {
  const lastBackup = $('lastBackup');
  if (!lastBackup) return;
  lastBackup.textContent = state.meta.last_backup_at
    ? new Date(state.meta.last_backup_at).toLocaleString()
    : '暂无记录';
  const health = getBackupHealth();
  $('backupHealthTitle').textContent = health.title;
  $('backupHealthText').textContent = health.text;
  $('settingsBackupTitle').textContent = health.title;
  $('pullStatusText').textContent = `${health.title} · ${state.bookings.length} 条订单 · ${state.incomes.length} 笔收入`;
  $('backupHealthCard').classList.toggle('stale', health.status === 'stale');
  $('backupStatusPanel').classList.toggle('stale', health.status === 'stale');
}

function renderSummary() {
  const date = today();
  const activeBookings = state.bookings.filter((booking) => booking.status !== 'cancelled');
  const todayBookings = activeBookings
    .filter((booking) => booking.date === date)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const todayRevenue = summarizeIncome(state.incomes, date).day;
  const nextBooking = activeBookings
    .filter((booking) => `${booking.date} ${booking.start_time}` >= `${date} 00:00`)
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))[0];

  $('todayCount').textContent = String(todayBookings.length);
  $('todayRevenue').textContent = money(todayRevenue);
  $('nextBooking').textContent = nextBooking
    ? `${nextBooking.date} ${nextBooking.start_time} · ${nextBooking.scene_name} · ${nextBooking.customer_name}${getTurnaroundWarnings(nextBooking, nextBooking.id).length ? ' · 紧邻档期' : ''}`
    : '暂无预约';
}

function renderAll() {
  renderSummary();
  renderOrders();
  renderCalendar();
  renderIncome();
  renderHolidays();
  renderBackupMeta();
  updateFeePreview();
  refreshIcons();
}

function openEdit(booking) {
  $('editId').value = booking.id;
  $('editDate').value = booking.date;
  $('editStart').value = booking.start_time;
  $('editEnd').value = booking.end_time;
  $('editPeople').value = booking.people_count;
  $('editOriginal').textContent = `原档期：${booking.date} ${booking.start_time}-${booking.end_time} · ${booking.people_count}人 · 已改签 ${booking.change_count || 0} 次`;
  $('editDialog').dataset.original = JSON.stringify({
    date: booking.date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    people_count: Number(booking.people_count)
  });
  updateEditImpact();
  $('editDialog').showModal();
}

function isEditDirty() {
  try {
    const original = JSON.parse($('editDialog').dataset.original || '{}');
    return original.date !== $('editDate').value
      || original.start_time !== $('editStart').value
      || original.end_time !== $('editEnd').value
      || Number(original.people_count) !== Number($('editPeople').value);
  } catch {
    return false;
  }
}

function updateEditImpact() {
  const booking = state.bookings.find((item) => item.id === $('editId').value);
  const impact = $('editImpact');
  if (!booking || !impact) return;
  const next = {
    ...booking,
    date: $('editDate').value,
    start_time: $('editStart').value,
    end_time: $('editEnd').value,
    people_count: Number($('editPeople').value || 0)
  };
  const count = Number(booking.change_count || 0) + (hasScheduleChanged(booking, next) ? 1 : 0);
  const fee = calculateFee(next, count);
  const conflict = fee.valid ? hasConflict(next, booking.id) : null;
  const reminders = fee.valid && !conflict ? getTurnaroundWarnings(next, booking.id) : [];
  impact.className = 'edit-impact';
  if (conflict) {
    impact.classList.add('error');
    impact.textContent = `无法保存：与 ${conflict.start_time}-${conflict.end_time} ${conflict.customer_name} 的订单重叠。`;
  } else if (!fee.valid) {
    impact.classList.add('error');
    impact.textContent = fee.warnings.filter((warning) => !warning.startsWith('请填写')).join('；');
  } else {
    const messages = [`改签后总额 ${money(fee.totalFee)}`];
    if (fee.rescheduleFee > 0) messages.push('本次产生 50 元改签费');
    if (reminders.length) messages.push('与相邻订单不足 15 分钟，请提醒客户');
    if (reminders.length || fee.rescheduleFee > 0) impact.classList.add('warning');
    impact.textContent = messages.join(' · ');
  }
}

function showSaveSuccess(booking, warnings = []) {
  const details = $('saveSuccessDetails');
  clearElement(details);
  [
    `${booking.scene_name} · ${booking.customer_name}`,
    `${booking.date} ${booking.start_time}-${booking.end_time} · ${booking.people_count}人`,
    `总金额 ${money(booking.total_fee)} · 订金 ${money(booking.deposit_amount)}`
  ].forEach((value) => {
    const row = document.createElement('strong');
    row.textContent = value;
    details.appendChild(row);
  });
  if (warnings.length) {
    const warning = document.createElement('small');
    warning.textContent = `紧邻档期：${warnings.map(formatTurnaroundWarning).join(' ')}`;
    details.appendChild(warning);
  }
  $('saveSuccessDialog').dataset.bookingId = booking.id;
  $('saveSuccessDialog').showModal();
}

function hasScheduleChanged(current, next) {
  return current.date !== next.date
    || current.start_time !== next.start_time
    || current.end_time !== next.end_time;
}

async function saveEdit() {
  syncStateFromStorage();
  const booking = state.bookings.find((item) => item.id === $('editId').value);
  if (!booking) {
    alert('该订单已在另一个窗口中发生变化，请刷新后重试。');
    $('editDialog').close();
    renderAll();
    return;
  }

  const patch = {
    date: $('editDate').value,
    start_time: $('editStart').value,
    end_time: $('editEnd').value,
    people_count: Number($('editPeople').value || 0)
  };
  const next = { ...booking, ...patch };
  const nextChangeCount = Number(booking.change_count || 0) + (hasScheduleChanged(booking, next) ? 1 : 0);
  const fee = calculateFee(next, nextChangeCount);
  const conflict = hasConflict(next, booking.id);
  const turnaroundWarnings = getTurnaroundWarnings(next, booking.id);

  if (!fee.valid || conflict) {
    alert([...fee.warnings, conflict ? '该时间段与已有订单的实际预约时间重叠' : ''].filter(Boolean).join('\n'));
    return;
  }
  if (turnaroundWarnings.length && !confirm(`【紧邻档期提醒】\n${turnaroundWarnings.map(formatTurnaroundWarning).join('\n')}\n\n收尾时间不占用档期，仍要保存这次改签吗？`)) return;

  const button = $('saveEdit');
  button.disabled = true;
  const result = await rescheduleBookingAtomically(booking.id, patch);
  button.disabled = false;
  if (!result.ok) {
    if (result.reason === 'conflict') alert('保存失败：该场景的实际预约时间已被另一笔订单占用。');
    if (result.reason === 'invalid') alert(result.warnings.join('\n'));
    if (result.reason === 'missing') alert('该订单已在另一个窗口中发生变化，请刷新后重试。');
    return;
  }
  $('editDialog').close();
  const savedMessages = [];
  if (result.fee.rescheduleFee > 0) savedMessages.push('第二次及以后改签需额外加收 50 元');
  if (result.turnaroundWarnings.length) savedMessages.push(`紧邻档期，请务必提醒相关客户：\n${result.turnaroundWarnings.map(formatTurnaroundWarning).join('\n')}`);
  if (savedMessages.length) alert(savedMessages.join('\n\n'));
  renderAll();
}

function mergeBookingsSafely(current, incoming) {
  const bookings = [...current];
  let skippedConflicts = 0;

  incoming.forEach((candidate) => {
    const existingIndex = bookings.findIndex((booking) => booking.id === candidate.id);
    const withoutExisting = existingIndex >= 0
      ? bookings.filter((_, index) => index !== existingIndex)
      : bookings;
    const conflict = getScheduleRelations(candidate, '', withoutExisting).conflict;
    if (conflict) {
      skippedConflicts += 1;
      return;
    }
    bookings.splice(0, bookings.length, ...withoutExisting, candidate);
  });

  return { bookings, skippedConflicts };
}

function requestCloseDialog(dialog) {
  if (!dialog?.open) return true;
  if (dialog.id === 'editDialog' && isEditDirty() && !confirm('改签内容尚未保存，确定放弃修改吗？')) return false;
  if (dialog.id === 'incomeDialog' && isIncomeDirty() && !confirm('收款信息尚未保存，确定放弃吗？')) return false;
  dialog.close();
  return true;
}

function attachSheetDismiss(dialog) {
  const handle = dialog.querySelector('.sheet-handle');
  if (!handle) return;
  let startY = 0;
  let deltaY = 0;
  handle.addEventListener('touchstart', (event) => {
    startY = event.touches[0].clientY;
    deltaY = 0;
  }, { passive: true });
  handle.addEventListener('touchmove', (event) => {
    deltaY = Math.max(0, event.touches[0].clientY - startY);
    dialog.querySelector('.dialog-card').style.transform = `translateY(${Math.min(deltaY, 120)}px)`;
  }, { passive: true });
  handle.addEventListener('touchend', () => {
    dialog.querySelector('.dialog-card').style.transform = '';
    if (deltaY > 80) requestCloseDialog(dialog);
  }, { passive: true });
}

function bindCalendarSwipe() {
  const board = $('calendarList');
  let startX = 0;
  let startY = 0;
  board.addEventListener('touchstart', (event) => {
    if (event.target.closest('button')) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });
  board.addEventListener('touchend', (event) => {
    if (!startX) return;
    const touch = event.changedTouches[0];
    const direction = classifyHorizontalGesture({
      startX,
      deltaX: touch.clientX - startX,
      deltaY: touch.clientY - startY,
      width: window.innerWidth
    });
    startX = 0;
    if (direction === 'left') changeCalendarDate(1);
    if (direction === 'right') changeCalendarDate(-1);
  }, { passive: true });
}

function bindPullStatus() {
  let startY = 0;
  let startX = 0;
  let pulling = false;
  document.addEventListener('touchstart', (event) => {
    if (window.scrollY > 0 || !['book', 'calendar'].includes(activeTab) || event.target.closest('input, select, button')) return;
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    pulling = true;
  }, { passive: true });
  document.addEventListener('touchend', (event) => {
    if (!pulling) return;
    pulling = false;
    const touch = event.changedTouches[0];
    const deltaY = touch.clientY - startY;
    const deltaX = touch.clientX - startX;
    if (deltaY < 70 || Math.abs(deltaY) < Math.abs(deltaX) * 1.25) return;
    const status = $('pullStatus');
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 1800);
  }, { passive: true });
}

function handleNativeBack() {
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) {
    requestCloseDialog(openDialog);
    return;
  }
  if (activeTab !== 'book') {
    switchTab('book', { top: true });
    return;
  }
  const now = Date.now();
  if (now - lastNativeBackAt < 1800) {
    window.XiamuNative?.exitApp?.();
    return;
  }
  lastNativeBackAt = now;
  showToast('再按一次返回键退出 App');
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.tab === activeTab) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      switchTab(button.dataset.tab);
    });
  });

  const bookingForm = $('bookingForm');
  bookingForm.addEventListener('input', (event) => {
    if (event.target.matches('input, select')) event.target.dataset.touched = 'true';
    updateFeePreview();
  });
  bookingForm.addEventListener('change', updateFeePreview);
  bookingForm.addEventListener('focusout', (event) => {
    if (!event.target.matches('input, select')) return;
    event.target.dataset.touched = 'true';
    renderFieldErrors(formData(bookingForm));
  });

  $('start').addEventListener('change', () => {
    const start = toMinutes($('start').value);
    if (Number.isFinite(start) && start + 120 < 1440) $('end').value = minutesToTime(start + 120);
    updateFeePreview();
  });
  document.querySelectorAll('.duration-chips button').forEach((button) => {
    button.addEventListener('click', () => applyDuration(Number(button.dataset.duration)));
  });

  $('bookingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = formData(form);
    const fee = calculateFee(input);
    const conflict = hasConflict(input);
    const turnaroundWarnings = getTurnaroundWarnings(input);
    form.querySelectorAll('input, select').forEach((control) => { control.dataset.touched = 'true'; });
    const fieldErrors = renderFieldErrors(input, true);
    if (!fee.valid) {
      const firstField = Object.keys(fieldErrors)[0];
      const control = firstField === 'scene' ? $('scene') : $(firstField);
      control?.focus();
      showToast('请先修正表单中的红色提示');
      return;
    }
    if (conflict) {
      $('availabilityPreview').scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('该时段与已有订单重叠，请调整时间');
      return;
    }
    if (turnaroundWarnings.length && !confirm(`【紧邻档期提醒】\n${turnaroundWarnings.map(formatTurnaroundWarning).join('\n')}\n\n收尾时间不占用档期，仍要保存预约吗？`)) return;

    const submitButtons = document.querySelectorAll('[type="submit"][form="bookingForm"], #bookingForm [type="submit"]');
    submitButtons.forEach((button) => { button.disabled = true; });
    const result = await createBookingAtomically(input);
    submitButtons.forEach((button) => { button.disabled = false; });
    if (!result.ok) {
      if (result.reason === 'conflict') alert('保存失败：该场景的实际预约时间已被另一笔订单占用，请刷新档期后重新选择。');
      if (result.reason === 'invalid') alert(result.warnings.join('\n'));
      return;
    }

    form.reset();
    form.querySelectorAll('[data-touched]').forEach((control) => delete control.dataset.touched);
    $('date').value = today();
    $('start').value = '10:00';
    $('end').value = '12:00';
    $('people').value = 1;
    renderAll();
    showSaveSuccess(result.booking, result.turnaroundWarnings);
  });

  let searchTimer = null;
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderOrders, 120);
  });
  $('clearSearch').addEventListener('click', () => {
    $('search').value = '';
    renderOrders();
    $('search').focus();
  });
  $('sceneFilter').addEventListener('change', renderOrders);
  $('statusFilter').addEventListener('change', renderOrders);
  document.querySelectorAll('#statusChips button').forEach((button) => {
    button.addEventListener('click', () => {
      $('statusFilter').value = button.dataset.status;
      document.querySelectorAll('#statusChips button').forEach((item) => item.classList.toggle('active', item === button));
      renderOrders();
    });
  });

  $('calendarDate').addEventListener('change', renderCalendar);
  $('calendarPrev').addEventListener('click', () => changeCalendarDate(-1));
  $('calendarNext').addEventListener('click', () => changeCalendarDate(1));
  $('calendarToday').addEventListener('click', () => {
    $('calendarDate').value = today();
    renderCalendar();
  });
  bindCalendarSwipe();

  $('incomeAnchorDate').addEventListener('change', renderIncome);
  $('incomePrev').addEventListener('click', () => shiftIncomeAnchor(-1));
  $('incomeNext').addEventListener('click', () => shiftIncomeAnchor(1));
  $('incomeTodayButton').addEventListener('click', () => {
    $('incomeAnchorDate').value = today();
    renderIncome();
  });
  document.querySelectorAll('[data-income-period]').forEach((button) => {
    button.addEventListener('click', () => {
      incomePeriod = button.dataset.incomePeriod;
      renderIncome();
    });
  });
  $('addIncome').addEventListener('click', () => openIncomeDialog());
  $('incomeForm').addEventListener('submit', saveIncome);
  $('incomeBooking').addEventListener('change', () => {
    if ($('incomeBooking').value) applyBookingToIncomeForm($('incomeBooking').value);
  });
  $('closeIncomeDialog').addEventListener('click', () => requestCloseDialog($('incomeDialog')));
  $('cancelIncome').addEventListener('click', () => requestCloseDialog($('incomeDialog')));
  $('incomeDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    requestCloseDialog($('incomeDialog'));
  });

  const guideCanvas = $('guideViewerCanvas');
  $('openGuideViewer').addEventListener('click', () => {
    guideCanvas.classList.remove('zoomed');
    guideCanvas.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    $('guideViewerDialog').showModal();
  });
  $('zoomGuide').addEventListener('click', () => guideCanvas.classList.toggle('zoomed'));
  $('resetGuideZoom').addEventListener('click', () => {
    guideCanvas.classList.remove('zoomed');
    guideCanvas.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  });
  $('closeGuideViewer').addEventListener('click', () => $('guideViewerDialog').close());
  $('openChangelog').addEventListener('click', () => $('changelogDialog').showModal());
  $('closeChangelog').addEventListener('click', () => $('changelogDialog').close());

  const preferences = getUiPreferences();
  $('localAlert').hidden = Boolean(preferences.local_alert_dismissed);
  $('swipeOrderHint').hidden = Boolean(preferences.order_swipe_hint_seen);
  $('dismissLocalAlert').addEventListener('click', () => {
    $('localAlert').hidden = true;
    updateUiPreferences({ local_alert_dismissed: true });
  });
  $('backupHealthCard').addEventListener('click', () => switchTab('settings', { top: true }));
  $('ordersList').addEventListener('touchstart', () => {
    if (!$('swipeOrderHint').hidden) {
      updateUiPreferences({ order_swipe_hint_seen: true });
      setTimeout(() => { $('swipeOrderHint').hidden = true; }, 1400);
    }
  }, { passive: true, once: true });

  $('addHoliday').addEventListener('click', async () => {
    const date = $('holidayDate').value;
    if (!isDate(date)) {
      alert('请选择有效日期');
      return;
    }
    const holiday = {
      date,
      type: $('holidayType').value,
      name: $('holidayName').value.trim(),
      source: 'custom'
    };
    const result = await mutateStateAtomically((latest) => ({
      ok: true,
      state: {
        ...latest,
        holidays: [...latest.holidays.filter((item) => item.date !== date), holiday]
      }
    }));
    if (result.ok) {
      $('holidayRulesDetails').open = true;
      showToast('日期规则已保存');
      renderAll();
    }
  });
  $('customHolidayOnly').addEventListener('change', renderHolidays);

  $('exportData').addEventListener('click', async () => {
    const result = await mutateStateAtomically((latest) => ({
      ok: true,
      state: {
        ...latest,
        meta: { ...latest.meta, last_backup_at: new Date().toISOString() }
      }
    }));
    if (!result.ok) return;
    const filename = `xiamu-backup-${today()}.json`;
    const content = JSON.stringify(state, null, 2);
    if (window.XiamuNative?.isNative) {
      try {
        await window.XiamuNative.exportBackup(filename, content);
        renderBackupMeta();
      } catch {
        alert('备份未能打开系统保存窗口，请检查手机存储空间后重试。');
      }
      return;
    }

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    renderBackupMeta();
  });

  $('importData').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
      const raw = JSON.parse(await file.text());
      const data = normalizeState(raw);
      const skipped = {
        bookings: Array.isArray(raw.bookings) ? raw.bookings.length - data.bookings.length : 0,
        holidays: Array.isArray(raw.holidays) ? raw.holidays.length - data.holidays.length : 0,
        incomes: Array.isArray(raw.incomes) ? raw.incomes.length - data.incomes.length : 0
      };
      const mode = $('importMode').value;
      const actionText = mode === 'replace' ? '覆盖本机所有订单、收入和自定义日期规则' : '合并到本机数据';
      if (!confirm(`即将${actionText}。\n导入订单 ${data.bookings.length} 条、收入 ${data.incomes.length} 笔、自定义日期规则 ${data.holidays.length} 条。\n确定继续吗？`)) return;

      const importResult = await withDataLock(async () => {
        syncStateFromStorage();
        const previousState = state;
        const bookingResult = mode === 'replace'
          ? mergeBookingsSafely([], data.bookings)
          : mergeBookingsSafely(state.bookings, data.bookings);
        const holidayMap = new Map((mode === 'replace' ? [] : state.holidays).map((holiday) => [holiday.date, holiday]));
        data.holidays.forEach((holiday) => holidayMap.set(holiday.date, holiday));
        const incomeMap = new Map((mode === 'replace' ? [] : state.incomes).map((income) => [income.id, income]));
        data.incomes.forEach((income) => incomeMap.set(income.id, income));
        state = {
          ...state,
          bookings: bookingResult.bookings,
          holidays: [...holidayMap.values()],
          incomes: [...incomeMap.values()]
        };
        if (!saveState()) {
          state = previousState;
          return { ok: false, skippedConflicts: bookingResult.skippedConflicts };
        }
        return { ok: true, skippedConflicts: bookingResult.skippedConflicts };
      });

      if (!importResult.ok) return;
      renderAll();
      alert(`导入完成。已跳过无效订单 ${Math.max(0, skipped.bookings)} 条、撞档订单 ${importResult.skippedConflicts} 条、无效收入 ${Math.max(0, skipped.incomes)} 笔、无效日期规则 ${Math.max(0, skipped.holidays)} 条。`);
    } catch {
      alert('备份文件格式不正确。请选择从本 App 导出的 .json 备份文件。');
    }
  });

  $('clearData').addEventListener('click', async () => {
    const answer = prompt('清空会删除本机所有订单和收入记录。建议先导出备份。\n如确认清空，请输入：清空');
    if (answer !== '清空') return;
    const result = await mutateStateAtomically((latest) => ({
      ok: true,
      state: { ...latest, bookings: [], incomes: [] }
    }));
    if (result.ok) renderAll();
  });

  $('saveEdit').addEventListener('click', saveEdit);
  ['editDate', 'editStart', 'editEnd', 'editPeople'].forEach((id) => $(id).addEventListener('input', updateEditImpact));

  $('editDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    requestCloseDialog($('editDialog'));
  });
  $('editDialog').querySelectorAll('button[value="cancel"]').forEach((editCancel) => {
    editCancel.addEventListener('click', (event) => {
      if (!isEditDirty()) return;
      event.preventDefault();
      requestCloseDialog($('editDialog'));
    });
  });
  $('continueBooking').addEventListener('click', () => {
    $('saveSuccessDialog').close();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('viewSavedOrder').addEventListener('click', () => {
    const booking = state.bookings.find((item) => item.id === $('saveSuccessDialog').dataset.bookingId);
    $('saveSuccessDialog').close();
    if (booking) $('search').value = booking.phone;
    switchTab('orders', { top: true });
  });
  $('closeOrderDetail').addEventListener('click', () => $('orderDetailDialog').close());
  document.querySelectorAll('dialog.bottom-sheet').forEach(attachSheetDismiss);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.order-swipe-shell')) closeOpenSwipe();
  });
  bindPullStatus();
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 42), { passive: true });
  if (window.visualViewport) {
    const fullHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      document.body.classList.toggle('keyboard-open', window.visualViewport.height < fullHeight * 0.72);
    });
  }
  window.addEventListener('xiamu:native-back', handleNativeBack);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('installBtn').hidden = false;
});

window.addEventListener('storage', (event) => {
  if (event.key !== storeKey) return;
  syncStateFromStorage();
  renderAll();
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').hidden = true;
});

if (!window.XiamuNative?.isNative && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

fillSelects();
$('date').value = today();
$('calendarDate').value = today();
$('incomeAnchorDate').value = today();
$('incomeDate').value = today();
$('holidayDate').value = today();
bindEvents();
renderAll();
