const { scenes: defaultScenes } = require('../data/defaultData');

const BUSINESS_START = 10 * 60;
const BUSINESS_END = 22 * 60;
const MIN_DURATION = 120;
const SLOT_STEP = 30;
const TURNAROUND_REMINDER_MINUTES = 15;
const OVERTIME_RATE = 30;
const EXTRA_PERSON_RATE = 50;
const RESCHEDULE_FEE = 50;

function parseTimeToMinutes(time) {
  if (typeof time === 'number') return time;
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('时间格式必须为 HH:mm');
  }
  const [hour, minute] = time.split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('时间超出范围');
  }
  return hour * 60 + minute;
}

function minutesToTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeBookingInput(input) {
  const startMinutes = parseTimeToMinutes(input.start_time);
  const endMinutes = parseTimeToMinutes(input.end_time);
  return {
    ...input,
    people_count: Number(input.people_count || 0),
    start_minutes: startMinutes,
    end_minutes: endMinutes,
    duration_minutes: endMinutes - startMinutes
  };
}

function validateBookingInput(input) {
  const normalized = normalizeBookingInput(input);
  const errors = [];

  if (!normalized.scene_id && !normalized.scene_name) errors.push('请选择场景');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.date || '')) errors.push('请选择预约日期');
  if (normalized.end_minutes <= normalized.start_minutes) errors.push('结束时间必须晚于开始时间');
  if (normalized.duration_minutes < MIN_DURATION) errors.push('单场租用必须 2 小时起租');
  if (normalized.start_minutes % SLOT_STEP !== 0 || normalized.end_minutes % SLOT_STEP !== 0) {
    errors.push('预约时间必须按 30 分钟为单位');
  }
  if (!Number.isInteger(normalized.people_count) || normalized.people_count <= 0) {
    errors.push('拍摄人数必须为正整数');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: normalized
  };
}

function getChinaDay(date) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('日期格式不正确');
  return parsed.getUTCDay();
}

function resolveHolidayType(date, holidays = []) {
  const override = holidays.find((item) => item.date === date);
  if (override) return override.type;
  const day = getChinaDay(date);
  return day === 0 || day === 6 ? 'holiday' : 'workday';
}

function resolveScene(inputScene, scenes = defaultScenes) {
  const scene = scenes.find((item) => item._id === inputScene || item.name === inputScene);
  if (!scene) throw new Error('场景不存在');
  return scene;
}

function getHourlyRate(scene, holidayType) {
  return holidayType === 'holiday' ? Number(scene.holiday_rate) : Number(scene.weekday_rate);
}

function getOvertimeMinutes(startMinutes, endMinutes) {
  const beforeOpen = Math.max(0, Math.min(endMinutes, BUSINESS_START) - startMinutes);
  const afterClose = Math.max(0, endMinutes - Math.max(startMinutes, BUSINESS_END));
  return beforeOpen + afterClose;
}

function calculateBookingFee(input, options = {}) {
  const validation = validateBookingInput(input);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors
    };
  }

  const normalized = validation.value;
  const scene = resolveScene(normalized.scene_id || normalized.scene_name, options.scenes || defaultScenes);
  const holidayType = resolveHolidayType(normalized.date, options.holidays || []);
  const hourlyRate = getHourlyRate(scene, holidayType);
  const durationHours = normalized.duration_minutes / 60;
  const overtimeMinutes = getOvertimeMinutes(normalized.start_minutes, normalized.end_minutes);
  const extraPeople = Math.max(0, normalized.people_count - Number(scene.capacity));
  const baseFee = hourlyRate * durationHours;
  const overtimeFee = (overtimeMinutes / 60) * OVERTIME_RATE;
  const extraPersonFee = extraPeople * EXTRA_PERSON_RATE;
  const rescheduleFee = Number(options.changeCount || 0) > 1 ? RESCHEDULE_FEE : 0;
  const totalFee = baseFee + overtimeFee + extraPersonFee + rescheduleFee;
  const warnings = [];

  if (holidayType === 'holiday') warnings.push('已按节假日/周末价格计算');
  if (overtimeFee > 0) warnings.push('预约包含营业时间外时段，已计入加班费');
  if (extraPersonFee > 0) warnings.push(`超出 ${scene.capacity} 人限制，已计入超人费`);
  if (rescheduleFee > 0) warnings.push('第二次及以后改签需额外加收 50 元');

  return {
    ok: true,
    scene,
    holiday_type: holidayType,
    hourly_rate: hourlyRate,
    duration_hours: durationHours,
    base_fee: baseFee,
    overtime_fee: overtimeFee,
    extra_person_fee: extraPersonFee,
    reschedule_fee: rescheduleFee,
    total_fee: totalFee,
    deposit_amount: hourlyRate,
    warnings,
    normalized
  };
}

function bookingConflicts(input, existingBookings = []) {
  const validation = validateBookingInput(input);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      conflicts: []
    };
  }

  const normalized = validation.value;
  const inputStart = normalized.start_minutes;
  const inputEnd = normalized.end_minutes;
  const activeBookings = existingBookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
    if (input.exclude_id && booking._id === input.exclude_id) return false;
    return true;
  });
  const conflicts = activeBookings.filter((booking) => {
    const existingStart = Number(booking.start_minutes ?? parseTimeToMinutes(booking.start_time));
    const existingEnd = Number(booking.end_minutes ?? parseTimeToMinutes(booking.end_time));
    return existingStart < inputEnd && existingEnd > inputStart;
  });
  const turnaroundWarnings = activeBookings.flatMap((booking) => {
    const existingStart = Number(booking.start_minutes ?? parseTimeToMinutes(booking.start_time));
    const existingEnd = Number(booking.end_minutes ?? parseTimeToMinutes(booking.end_time));
    const previousGap = inputStart - existingEnd;
    const nextGap = existingStart - inputEnd;

    if (previousGap >= 0 && previousGap < TURNAROUND_REMINDER_MINUTES) {
      return [{ relation: 'previous', gap_minutes: previousGap, booking }];
    }
    if (nextGap >= 0 && nextGap < TURNAROUND_REMINDER_MINUTES) {
      return [{ relation: 'next', gap_minutes: nextGap, booking }];
    }
    return [];
  });

  return {
    ok: conflicts.length === 0,
    conflicts,
    turnaround_warnings: turnaroundWarnings,
    errors: conflicts.length > 0 ? ['该场景当前预约时间与已有订单重叠'] : []
  };
}

function publicFeeResult(result) {
  if (!result.ok) return result;
  return {
    base_fee: result.base_fee,
    overtime_fee: result.overtime_fee,
    extra_person_fee: result.extra_person_fee,
    reschedule_fee: result.reschedule_fee,
    total_fee: result.total_fee,
    deposit_amount: result.deposit_amount,
    hourly_rate: result.hourly_rate,
    duration_hours: result.duration_hours,
    holiday_type: result.holiday_type,
    scene: result.scene,
    warnings: result.warnings
  };
}

module.exports = {
  BUSINESS_START,
  BUSINESS_END,
  MIN_DURATION,
  SLOT_STEP,
  BUFFER_MINUTES: TURNAROUND_REMINDER_MINUTES,
  TURNAROUND_REMINDER_MINUTES,
  OVERTIME_RATE,
  EXTRA_PERSON_RATE,
  RESCHEDULE_FEE,
  defaultScenes,
  parseTimeToMinutes,
  minutesToTime,
  normalizeBookingInput,
  validateBookingInput,
  resolveHolidayType,
  resolveScene,
  calculateBookingFee,
  bookingConflicts,
  publicFeeResult
};
