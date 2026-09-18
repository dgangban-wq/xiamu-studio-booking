const cloud = require('wx-server-sdk');
const {
  defaultScenes,
  calculateBookingFee,
  bookingConflicts,
  normalizeBookingInput,
  publicFeeResult,
  isBookingScheduleChanged,
  isValidBookingStatus,
  bookingNeedsConflictCheck
} = require('./lib/core');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

async function getScenes() {
  const result = await db.collection('scenes').get();
  return result.data.length ? result.data : defaultScenes;
}

async function getHolidayOverrides(date) {
  const year = String(date || '').slice(0, 4);
  if (!year) return [];
  const result = await db.collection('holidays').where({
    date: _.gte(`${year}-01-01`).and(_.lte(`${year}-12-31`))
  }).get();
  return result.data;
}

async function assertAdmin() {
  const { OPENID } = cloud.getWXContext();
  const result = await db.collection('admins').where({
    openid: OPENID,
    enabled: true
  }).limit(1).get();

  if (!result.data.length) {
    const error = new Error('无管理员权限');
    error.code = 'NO_ADMIN_PERMISSION';
    throw error;
  }

  return result.data[0];
}

async function listPotentialConflicts(input, database = db) {
  const normalized = normalizeBookingInput(input);
  const result = await database.collection('bookings').where({
    scene_id: normalized.scene_id,
    date: normalized.date,
    status: _.neq('cancelled')
  }).get();
  return result.data;
}

function bookingLockId(sceneId, date) {
  return `booking-${sceneId}-${date}`;
}

async function lockBookingResources(transaction, resources) {
  const unique = new Map(resources.map((item) => [bookingLockId(item.scene_id, item.date), item]));
  for (const [key, resource] of [...unique.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await transaction.collection('booking_locks').doc(key).set({
      data: {
        scene_id: resource.scene_id,
        date: resource.date,
        updated_at: new Date().toISOString()
      }
    });
  }
}

async function getAllBookings(ref, pageSize = 100) {
  const records = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await ref.skip(offset).limit(pageSize).get();
    records.push(...page.data);
    if (page.data.length < pageSize) return records;
  }
}

async function calculateBookingFeeAction(event) {
  const scenes = await getScenes();
  const holidays = await getHolidayOverrides(event.date);
  const result = calculateBookingFee(event, {
    scenes,
    holidays,
    changeCount: event.change_count
  });

  if (!result.ok) return result;
  return {
    ok: true,
    data: publicFeeResult(result)
  };
}

async function checkBookingConflictAction(event) {
  const existingBookings = await listPotentialConflicts(event);
  const result = bookingConflicts(event, existingBookings);
  return {
    ok: result.ok,
    errors: result.errors,
    conflicts: result.conflicts.map((item) => ({
      _id: item._id,
      customer_name: item.customer_name,
      start_time: item.start_time,
      end_time: item.end_time,
      status: item.status
    })),
    turnaround_warnings: publicTurnaroundWarnings(result.turnaround_warnings)
  };
}

function publicTurnaroundWarnings(warnings = []) {
  return warnings.map((item) => ({
    relation: item.relation,
    gap_minutes: item.gap_minutes,
    booking: {
      _id: item.booking._id,
      customer_name: item.booking.customer_name,
      start_time: item.booking.start_time,
      end_time: item.booking.end_time,
      status: item.booking.status
    }
  }));
}

async function createBooking(event) {
  const scenes = await getScenes();
  const holidays = await getHolidayOverrides(event.date);
  const fee = calculateBookingFee(event, { scenes, holidays });

  if (!fee.ok) return fee;

  const now = db.serverDate();
  const payload = {
    scene_id: fee.scene._id,
    scene_name: fee.scene.name,
    date: fee.normalized.date,
    start_time: fee.normalized.start_time,
    end_time: fee.normalized.end_time,
    start_minutes: fee.normalized.start_minutes,
    end_minutes: fee.normalized.end_minutes,
    duration_hours: fee.duration_hours,
    people_count: fee.normalized.people_count,
    customer_name: String(event.customer_name || '').trim(),
    phone: String(event.phone || '').trim(),
    wechat: String(event.wechat || '').trim(),
    status: 'pending',
    change_count: 0,
    holiday_type: fee.holiday_type,
    base_fee: fee.base_fee,
    overtime_fee: fee.overtime_fee,
    extra_person_fee: fee.extra_person_fee,
    reschedule_fee: 0,
    total_fee: fee.total_fee,
    deposit_amount: fee.deposit_amount,
    created_at: now,
    updated_at: now
  };

  const missing = [];
  if (!payload.customer_name) missing.push('客户姓名');
  if (!/^1\d{10}$/.test(payload.phone)) missing.push('有效手机号');
  if (!payload.wechat) missing.push('微信号');
  if (missing.length) {
    return {
      ok: false,
      errors: [`请填写${missing.join('、')}`]
    };
  }

  const result = await db.runTransaction(async (transaction) => {
    // Serialize writes for one scene and date so two simultaneous submissions cannot both pass the conflict check.
    await lockBookingResources(transaction, [{
      scene_id: payload.scene_id,
      date: payload.date
    }]);
    const existingBookings = await listPotentialConflicts(fee.normalized, transaction);
    const conflict = bookingConflicts(fee.normalized, existingBookings);
    if (!conflict.ok) return { conflict };

    const created = await transaction.collection('bookings').add({ data: payload });
    return {
      created,
      turnaround_warnings: conflict.turnaround_warnings
    };
  });

  if (result.conflict) return result.conflict;

  return {
    ok: true,
    data: {
      _id: result.created._id,
      fee: publicFeeResult(fee),
      turnaround_warnings: publicTurnaroundWarnings(result.turnaround_warnings)
    }
  };
}

async function adminSearchBookings(event) {
  await assertAdmin();
  const query = {};
  if (event.date) query.date = event.date;
  if (event.scene_id) query.scene_id = event.scene_id;
  if (event.status) {
    if (!isValidBookingStatus(event.status)) return { ok: false, errors: ['订单状态无效'] };
    query.status = event.status;
  }

  const keyword = String(event.keyword || '').trim().toLowerCase();
  const ref = db.collection('bookings').where(query);
  const result = keyword
    ? { data: await getAllBookings(ref) }
    : await ref.orderBy('date', 'desc').orderBy('start_minutes', 'asc').limit(100).get();
  const data = keyword
    ? result.data
        .filter((item) =>
        String(item.customer_name || '').toLowerCase().includes(keyword) ||
        String(item.phone || '').includes(keyword)
        )
        .sort((left, right) =>
          String(right.date || '').localeCompare(String(left.date || '')) ||
          Number(left.start_minutes || 0) - Number(right.start_minutes || 0)
        )
        .slice(0, 100)
    : result.data;

  return {
    ok: true,
    data
  };
}

async function adminUpdateBooking(event) {
  await assertAdmin();
  const id = event.booking_id;
  if (!id) return { ok: false, errors: ['缺少订单 ID'] };

  if (event.status && !isValidBookingStatus(event.status)) {
    return { ok: false, errors: ['订单状态无效'] };
  }

  const scenes = await getScenes();
  const result = await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection('bookings').doc(id).get()).data;
    if (!current) return { error: { ok: false, errors: ['订单不存在'] } };

    const hasScheduleChange = isBookingScheduleChanged(current, event);
    const needsConflictCheck = bookingNeedsConflictCheck(current, event);
    const hasPeopleChange = event.people_count !== undefined &&
      Number(event.people_count) !== Number(current.people_count);
    const update = {
      updated_at: db.serverDate()
    };
    if (event.status) update.status = event.status;

    if (!hasScheduleChange && !hasPeopleChange && !needsConflictCheck) {
      await transaction.collection('bookings').doc(id).update({ data: update });
      return { update, fee: null, turnaroundWarnings: [] };
    }

    const nextChangeCount = hasScheduleChange
      ? Number(current.change_count || 0) + 1
      : Number(current.change_count || 0);
    const next = {
      ...current,
      scene_id: event.scene_id ?? current.scene_id,
      date: event.date ?? current.date,
      start_time: event.start_time ?? current.start_time,
      end_time: event.end_time ?? current.end_time,
      people_count: event.people_count ?? current.people_count,
      exclude_id: id
    };
    const holidays = await getHolidayOverrides(next.date);
    const fee = calculateBookingFee(next, {
      scenes,
      holidays,
      changeCount: nextChangeCount
    });
    if (!fee.ok) return { error: fee };

    let turnaroundWarnings = [];
    if (needsConflictCheck) {
      await lockBookingResources(transaction, [
        { scene_id: current.scene_id, date: current.date },
        { scene_id: fee.scene._id, date: fee.normalized.date }
      ]);
      const existingBookings = await listPotentialConflicts({
        ...fee.normalized,
        exclude_id: id
      }, transaction);
      const conflict = bookingConflicts({
        ...fee.normalized,
        exclude_id: id
      }, existingBookings);
      if (!conflict.ok) return { error: conflict };
      turnaroundWarnings = publicTurnaroundWarnings(conflict.turnaround_warnings);
    }

    Object.assign(update, {
      scene_id: fee.scene._id,
      scene_name: fee.scene.name,
      date: fee.normalized.date,
      start_time: fee.normalized.start_time,
      end_time: fee.normalized.end_time,
      start_minutes: fee.normalized.start_minutes,
      end_minutes: fee.normalized.end_minutes,
      duration_hours: fee.duration_hours,
      people_count: fee.normalized.people_count,
      holiday_type: fee.holiday_type,
      base_fee: fee.base_fee,
      overtime_fee: fee.overtime_fee,
      extra_person_fee: fee.extra_person_fee,
      reschedule_fee: fee.reschedule_fee,
      total_fee: fee.total_fee,
      deposit_amount: fee.deposit_amount,
      change_count: nextChangeCount
    });
    await transaction.collection('bookings').doc(id).update({ data: update });
    return { update, fee, turnaroundWarnings };
  });

  if (result.error) return result.error;
  return {
    ok: true,
    data: {
      booking_id: id,
      changed: result.update,
      fee: result.fee ? publicFeeResult(result.fee) : null,
      warnings: result.fee ? result.fee.warnings : [],
      turnaround_warnings: result.turnaroundWarnings
    }
  };
}

async function seedDefaults() {
  await assertAdmin();
  const tasks = defaultScenes.map((scene) => {
    const { _id: id, ...data } = scene;
    return db.collection('scenes').doc(id).set({ data });
  });
  await Promise.all(tasks);
  return {
    ok: true,
    data: defaultScenes
  };
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'getScenes':
        return { ok: true, data: await getScenes() };
      case 'calculateBookingFee':
        return calculateBookingFeeAction(event);
      case 'checkBookingConflict':
        return checkBookingConflictAction(event);
      case 'createBooking':
        return createBooking(event);
      case 'adminSearchBookings':
        return adminSearchBookings(event);
      case 'adminUpdateBooking':
        return adminUpdateBooking(event);
      case 'seedDefaults':
        return seedDefaults();
      default:
        return {
          ok: false,
          errors: ['未知 action']
        };
    }
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'SERVER_ERROR',
      errors: [error.message || '服务器错误']
    };
  }
};
