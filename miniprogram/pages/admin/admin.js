const { callBookingApi } = require('../../utils/api');

const statusOptions = [
  { label: '待确认', value: 'pending' },
  { label: '已付订金', value: 'deposit_paid' },
  { label: '已完工', value: 'completed' },
  { label: '已取消', value: 'cancelled' }
];

function today() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildTimeSlots() {
  const slots = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return slots;
}

function money(value) {
  return Number(value || 0).toFixed(0);
}

function statusLabel(value) {
  const option = statusOptions.find((item) => item.value === value);
  return option ? option.label : value;
}

Page({
  data: {
    scenes: [],
    sceneFilterOptions: [{ _id: '', name: '全部场景' }],
    sceneFilterIndex: 0,
    statusOptions,
    statusFilterOptions: [{ label: '全部状态', value: '' }, ...statusOptions],
    statusFilterIndex: 0,
    timeSlots: buildTimeSlots(),
    filters: {
      date: today(),
      scene_id: '',
      status: '',
      keyword: ''
    },
    bookings: [],
    summary: {
      total: '0'
    },
    error: '',
    editing: false,
    saving: false,
    editingId: '',
    editStartIndex: 20,
    editEndIndex: 24,
    editForm: {
      date: today(),
      start_time: '10:00',
      end_time: '12:00',
      people_count: 1
    }
  },

  onLoad() {
    this.loadScenes();
    this.loadBookings();
  },

  async loadScenes() {
    const res = await callBookingApi({ action: 'getScenes' });
    if (res.ok) {
      this.setData({
        scenes: res.data,
        sceneFilterOptions: [{ _id: '', name: '全部场景' }, ...res.data]
      });
    }
  },

  decorateBookings(bookings) {
    return bookings.map((item) => ({
      ...item,
      status_label: statusLabel(item.status),
      total_display: money(item.total_fee),
      deposit_display: money(item.deposit_amount)
    }));
  },

  async loadBookings() {
    this.setData({ error: '' });
    const res = await callBookingApi({
      action: 'adminSearchBookings',
      ...this.data.filters
    }).catch((error) => ({
      ok: false,
      errors: [error.message]
    }));

    if (!res.ok) {
      this.setData({
        error: (res.errors || ['无法加载订单，请确认当前微信 openid 已加入 admins 集合']).join('\n')
      });
      return;
    }

    const bookings = this.decorateBookings(res.data);
    const total = bookings.reduce((sum, item) => sum + Number(item.total_fee || 0), 0);
    this.setData({
      bookings,
      summary: {
        total: money(total)
      }
    });
  },

  onDateChange(event) {
    this.setData({ 'filters.date': event.detail.value }, () => this.loadBookings());
  },

  onSceneFilterChange(event) {
    const index = Number(event.detail.value);
    const scene = this.data.sceneFilterOptions[index];
    this.setData({
      sceneFilterIndex: index,
      'filters.scene_id': scene._id
    }, () => this.loadBookings());
  },

  onStatusFilterChange(event) {
    const index = Number(event.detail.value);
    const status = this.data.statusFilterOptions[index];
    this.setData({
      statusFilterIndex: index,
      'filters.status': status.value
    }, () => this.loadBookings());
  },

  onKeywordInput(event) {
    this.setData({ 'filters.keyword': event.detail.value });
  },

  async updateBooking(payload) {
    const res = await callBookingApi({
      action: 'adminUpdateBooking',
      ...payload
    }).catch((error) => ({
      ok: false,
      errors: [error.message]
    }));

    if (!res.ok) {
      wx.showModal({
        title: '操作失败',
        content: (res.errors || ['请稍后再试']).join('\n'),
        showCancel: false
      });
      return false;
    }

    const warnings = (res.data && res.data.warnings) || [];
    if (warnings.length) {
      wx.showModal({
        title: '改签提示',
        content: warnings.join('\n'),
        showCancel: false
      });
    }
    await this.loadBookings();
    return true;
  },

  onStatusChange(event) {
    const status = statusOptions[Number(event.detail.value)].value;
    this.updateBooking({
      booking_id: event.currentTarget.dataset.id,
      status
    });
  },

  quickStatus(event) {
    this.updateBooking({
      booking_id: event.currentTarget.dataset.id,
      status: event.currentTarget.dataset.status
    });
  },

  startEdit(event) {
    const id = event.currentTarget.dataset.id;
    const booking = this.data.bookings.find((item) => item._id === id);
    if (!booking) return;
    this.setData({
      editing: true,
      editingId: id,
      editStartIndex: this.data.timeSlots.indexOf(booking.start_time),
      editEndIndex: this.data.timeSlots.indexOf(booking.end_time),
      editForm: {
        date: booking.date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        people_count: booking.people_count
      }
    });
  },

  cancelEdit() {
    this.setData({ editing: false, editingId: '' });
  },

  onEditDateChange(event) {
    this.setData({ 'editForm.date': event.detail.value });
  },

  onEditStartChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      editStartIndex: index,
      'editForm.start_time': this.data.timeSlots[index]
    });
  },

  onEditEndChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      editEndIndex: index,
      'editForm.end_time': this.data.timeSlots[index]
    });
  },

  onEditPeopleInput(event) {
    this.setData({ 'editForm.people_count': Number(event.detail.value || 0) });
  },

  async saveEdit() {
    this.setData({ saving: true });
    const ok = await this.updateBooking({
      booking_id: this.data.editingId,
      ...this.data.editForm
    });
    this.setData({ saving: false });
    if (ok) this.cancelEdit();
  }
});
