const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateBookingFee,
  bookingConflicts,
  defaultScenes
} = require('../cloudfunctions/bookingApi/lib/core');

test('calculates weekday base fee and deposit', () => {
  const result = calculateBookingFee({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 6
  });

  assert.equal(result.ok, true);
  assert.equal(result.holiday_type, 'workday');
  assert.equal(result.base_fee, 360);
  assert.equal(result.total_fee, 360);
  assert.equal(result.deposit_amount, 180);
});

test('uses holiday override on a weekday', () => {
  const result = calculateBookingFee({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 6
  }, {
    holidays: [{ date: '2026-07-22', type: 'holiday', name: '测试节日' }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.holiday_type, 'holiday');
  assert.equal(result.base_fee, 420);
  assert.equal(result.deposit_amount, 210);
});

test('uses workday override on a weekend makeup day', () => {
  const result = calculateBookingFee({
    scene_id: 'classroom',
    date: '2026-07-25',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 6
  }, {
    holidays: [{ date: '2026-07-25', type: 'workday', name: '测试补班' }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.holiday_type, 'workday');
  assert.equal(result.base_fee, 360);
});

test('adds overtime fee outside 10:00-22:00', () => {
  const result = calculateBookingFee({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '08:00',
    end_time: '10:00',
    people_count: 4
  });

  assert.equal(result.ok, true);
  assert.equal(result.overtime_fee, 60);
  assert.equal(result.total_fee, 420);
});

test('adds extra person fee above scene capacity', () => {
  const result = calculateBookingFee({
    scene_id: 'study',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 6
  }, {
    scenes: defaultScenes
  });

  assert.equal(result.ok, true);
  assert.equal(result.extra_person_fee, 100);
  assert.equal(result.total_fee, 400);
});

test('rejects rentals shorter than two hours', () => {
  const result = calculateBookingFee({
    scene_id: 'study',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '11:30',
    people_count: 2
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(','), /2 小时起租/);
});

test('blocks real overlap but allows back-to-back bookings', () => {
  const existing = [{
    _id: 'a',
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    status: 'pending'
  }];

  const direct = bookingConflicts({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '11:30',
    end_time: '13:30',
    people_count: 4
  }, existing);

  const backToBack = bookingConflicts({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '12:00',
    end_time: '14:00',
    people_count: 4
  }, existing);

  assert.equal(direct.ok, false);
  assert.equal(backToBack.ok, true);
  assert.equal(backToBack.turnaround_warnings.length, 1);
});

test('allows a booking ending when the next booking starts and returns a reminder', () => {
  const result = bookingConflicts({
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '08:00',
    end_time: '10:00',
    people_count: 4
  }, [{
    _id: 'a',
    start_time: '10:00',
    end_time: '12:00',
    status: 'pending'
  }]);

  assert.equal(result.ok, true);
  assert.equal(result.turnaround_warnings.length, 1);
  assert.equal(result.turnaround_warnings[0].relation, 'next');
});

test('ignores cancelled booking and excluded booking', () => {
  const input = {
    scene_id: 'classroom',
    date: '2026-07-22',
    start_time: '10:00',
    end_time: '12:00',
    people_count: 4,
    exclude_id: 'current'
  };
  const result = bookingConflicts(input, [
    { _id: 'cancelled', start_time: '10:00', end_time: '12:00', status: 'cancelled' },
    { _id: 'current', start_time: '10:00', end_time: '12:00', status: 'pending' }
  ]);

  assert.equal(result.ok, true);
});
