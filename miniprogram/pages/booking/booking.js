const { callBookingApi } = require('../../utils/api');

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

Page({
  data: {
    scenes: [],
    currentScene: {},
    sceneIndex: 0,
    timeSlots: buildTimeSlots(),
    startIndex: 20,
    endIndex: 24,
    submitting: false,
    form: {
      scene_id: '',
      date: today(),
      start_time: '10:00',
      end_time: '12:00',
      people_count: 1,
      customer_name: '',
      phone: '',
      wechat: ''
    },
    fee: {
      base_fee: 0,
      overtime_fee: 0,
      extra_person_fee: 0,
      reschedule_fee: 0,
      total_fee: 0,
      deposit_amount: 0,
      warnings: []
    },
    feeDisplay: {
      base_fee: '0',
      overtime_fee: '0',
      extra_person_fee: '0',
      total_fee: '0',
      deposit_amount: '0'
    }
  },

  onLoad() {
    this.loadScenes();
  },

  money(value) {
    return Number(value || 0).toFixed(0);
  },

  buildFeeDisplay(fee) {
    return {
      base_fee: this.money(fee.base_fee),
      overtime_fee: this.money(fee.overtime_fee),
      extra_person_fee: this.money(fee.extra_person_fee),
      total_fee: this.money(fee.total_fee),
      deposit_amount: this.money(fee.deposit_amount)
    };
  },

  async loadScenes() {
    const res = await callBookingApi({ action: 'getScenes' });
    if (!res.ok) {
      wx.showToast({ title: '场景加载失败', icon: 'none' });
      return;
    }
    const scenes = res.data;
    this.setData({
      scenes,
      currentScene: scenes[0],
      'form.scene_id': scenes[0]._id
    });
    this.recalculate();
  },

  setFormValue(key, value) {
    this.setData({ [`form.${key}`]: value }, () => this.recalculate());
  },

  onSceneChange(event) {
    const index = Number(event.detail.value);
    const scene = this.data.scenes[index];
    this.setData({
      sceneIndex: index,
      currentScene: scene,
      'form.scene_id': scene._id
    }, () => this.recalculate());
  },

  onDateChange(event) {
    this.setFormValue('date', event.detail.value);
  },

  onStartChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      startIndex: index,
      'form.start_time': this.data.timeSlots[index]
    }, () => this.recalculate());
  },

  onEndChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      endIndex: index,
      'form.end_time': this.data.timeSlots[index]
    }, () => this.recalculate());
  },

  onPeopleChange(event) {
    this.setFormValue('people_count', Number(event.detail.value || 0));
  },

  onNameChange(event) {
    this.setData({ 'form.customer_name': event.detail.value });
  },

  onPhoneChange(event) {
    this.setData({ 'form.phone': event.detail.value });
  },

  onWechatChange(event) {
    this.setData({ 'form.wechat': event.detail.value });
  },

  async recalculate() {
    if (!this.data.form.scene_id) return;
    const res = await callBookingApi({
      action: 'calculateBookingFee',
      ...this.data.form
    });
    if (res.ok) {
      this.setData({
        fee: res.data,
        feeDisplay: this.buildFeeDisplay(res.data)
      });
    } else {
      const emptyFee = {
        base_fee: 0,
        overtime_fee: 0,
        extra_person_fee: 0,
        reschedule_fee: 0,
        total_fee: 0,
        deposit_amount: 0,
        warnings: res.errors || []
      };
      this.setData({
        fee: emptyFee,
        feeDisplay: this.buildFeeDisplay(emptyFee)
      });
    }
  },

  async submitBooking() {
    this.setData({ submitting: true });
    const res = await callBookingApi({
      action: 'createBooking',
      ...this.data.form
    }).catch((error) => ({
      ok: false,
      errors: [error.message]
    }));
    this.setData({ submitting: false });

    if (!res.ok) {
      wx.showModal({
        title: '无法提交',
        content: (res.errors || ['请稍后再试']).join('\n'),
        showCancel: false
      });
      return;
    }

    const hasTightTurnaround = (res.data.turnaround_warnings || []).length > 0;
    wx.showModal({
      title: hasTightTurnaround ? '预约已提交 · 紧邻档期' : '预约已提交',
      content: `预计总金额 ¥${this.money(res.data.fee.total_fee)}，应付订金 ¥${this.money(res.data.fee.deposit_amount)}。管理员确认后会联系你。${hasTightTurnaround ? '\n\n本订单与前后档期紧接，棚主会联系相关客户协调准时进退场。' : ''}`,
      showCancel: false
    });
  },

  goAdmin() {
    wx.navigateTo({
      url: '/pages/admin/admin'
    });
  }
});
