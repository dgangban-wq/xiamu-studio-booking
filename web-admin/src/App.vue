<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { getScenes, searchBookings, updateBooking } from './api/cloud';
import type { ApiResult, Booking, BookingStatus, Scene } from './types';

const statusOptions: Array<{ label: string; value: BookingStatus | '' }> = [
  { label: '全部状态', value: '' },
  { label: '待确认', value: 'pending' },
  { label: '已付订金', value: 'deposit_paid' },
  { label: '已完工', value: 'completed' },
  { label: '已取消', value: 'cancelled' }
];

const statusText: Record<BookingStatus, string> = {
  pending: '待确认',
  deposit_paid: '已付订金',
  completed: '已完工',
  cancelled: '已取消'
};

const scenes = ref<Scene[]>([]);
const bookings = ref<Booking[]>([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const filters = reactive({
  date: new Date().toISOString().slice(0, 10),
  scene_id: '',
  status: '' as BookingStatus | '',
  keyword: ''
});
const edit = reactive({
  open: false,
  booking_id: '',
  date: '',
  start_time: '',
  end_time: '',
  people_count: 1
});

const totalRevenue = computed(() => bookings.value.reduce((sum, item) => sum + Number(item.total_fee || 0), 0));
const activeBookings = computed(() => bookings.value.filter((item) => item.status !== 'cancelled').length);
const groupedByScene = computed(() => {
  return scenes.value.map((scene) => ({
    scene,
    items: bookings.value.filter((booking) => booking.scene_id === scene._id)
  }));
});

function money(value: number) {
  return Number(value || 0).toFixed(0);
}

async function loadScenes() {
  const res = await getScenes();
  if (res.ok && res.data) scenes.value = res.data;
}

async function loadBookings() {
  loading.value = true;
  error.value = '';
  const res = await searchBookings({
    date: filters.date,
    scene_id: filters.scene_id,
    status: filters.status,
    keyword: filters.keyword
  }).catch((err): ApiResult<Booking[]> => ({
    ok: false,
    errors: [err.message]
  }));
  loading.value = false;

  if (!res.ok || !res.data) {
    error.value = (res.errors || ['无法加载订单，请确认当前登录用户已加入 admins 集合']).join('\n');
    return;
  }
  bookings.value = res.data;
}

async function setStatus(booking: Booking, status: BookingStatus) {
  const res = await updateBooking({
    booking_id: booking._id,
    status
  });
  if (!res.ok) {
    error.value = (res.errors || ['状态更新失败']).join('\n');
    return;
  }
  await loadBookings();
}

function startEdit(booking: Booking) {
  edit.open = true;
  edit.booking_id = booking._id;
  edit.date = booking.date;
  edit.start_time = booking.start_time;
  edit.end_time = booking.end_time;
  edit.people_count = booking.people_count;
}

async function saveEdit() {
  const res = await updateBooking({ ...edit });
  if (!res.ok) {
    error.value = (res.errors || ['改签失败']).join('\n');
    return;
  }
  notice.value = res.data?.warnings?.join('\n') || '改签已保存';
  edit.open = false;
  await loadBookings();
}

onMounted(async () => {
  await loadScenes();
  await loadBookings();
});
</script>

<template>
  <main class="shell">
    <aside class="rail">
      <div>
        <p class="eyebrow">XIAMU STUDIO</p>
        <h1>夏暮后台</h1>
      </div>
      <div class="metric">
        <span>有效订单</span>
        <strong>{{ activeBookings }}</strong>
      </div>
      <div class="metric accent">
        <span>预计收入</span>
        <strong>¥{{ money(totalRevenue) }}</strong>
      </div>
    </aside>

    <section class="workspace">
      <div class="toolbar">
        <label>
          日期
          <input v-model="filters.date" type="date" @change="loadBookings" />
        </label>
        <label>
          场景
          <select v-model="filters.scene_id" @change="loadBookings">
            <option value="">全部场景</option>
            <option v-for="scene in scenes" :key="scene._id" :value="scene._id">{{ scene.name }}</option>
          </select>
        </label>
        <label>
          状态
          <select v-model="filters.status" @change="loadBookings">
            <option v-for="status in statusOptions" :key="status.value" :value="status.value">{{ status.label }}</option>
          </select>
        </label>
        <label class="search">
          搜索
          <input v-model="filters.keyword" placeholder="姓名或手机号" @keyup.enter="loadBookings" />
        </label>
        <button :disabled="loading" @click="loadBookings">{{ loading ? '加载中' : '刷新' }}</button>
      </div>

      <p v-if="error" class="message error">{{ error }}</p>
      <p v-if="notice" class="message">{{ notice }}</p>

      <div class="calendar">
        <article v-for="group in groupedByScene" :key="group.scene._id" class="lane">
          <header>
            <span class="dot" :style="{ background: group.scene.color || '#3aa6ff' }"></span>
            <strong>{{ group.scene.name }}</strong>
            <small>{{ group.items.length }} 单</small>
          </header>
          <div v-if="group.items.length" class="cards">
            <div v-for="booking in group.items" :key="booking._id" class="booking-card">
              <div class="row">
                <strong>{{ booking.start_time }}-{{ booking.end_time }}</strong>
                <span>{{ statusText[booking.status] }}</span>
              </div>
              <h3>{{ booking.customer_name }}</h3>
              <p>{{ booking.people_count }} 人 · {{ booking.phone }} · {{ booking.wechat }}</p>
              <div class="fees">
                <span>总额 ¥{{ money(booking.total_fee) }}</span>
                <span>订金 ¥{{ money(booking.deposit_amount) }}</span>
                <span>改签 {{ booking.change_count || 0 }} 次</span>
              </div>
              <div class="actions">
                <button @click="setStatus(booking, 'deposit_paid')">订金</button>
                <button @click="setStatus(booking, 'completed')">完工</button>
                <button @click="startEdit(booking)">改签</button>
                <button class="warn" @click="setStatus(booking, 'cancelled')">取消</button>
              </div>
            </div>
          </div>
          <div v-else class="empty">暂无占用</div>
        </article>
      </div>
    </section>

    <div v-if="edit.open" class="modal">
      <form class="dialog" @submit.prevent="saveEdit">
        <header>
          <h2>订单改签</h2>
          <button type="button" @click="edit.open = false">关闭</button>
        </header>
        <label>
          日期
          <input v-model="edit.date" type="date" required />
        </label>
        <label>
          开始时间
          <input v-model="edit.start_time" type="time" step="1800" required />
        </label>
        <label>
          结束时间
          <input v-model="edit.end_time" type="time" step="1800" required />
        </label>
        <label>
          拍摄人数
          <input v-model.number="edit.people_count" type="number" min="1" required />
        </label>
        <button class="primary" type="submit">保存改签</button>
      </form>
    </div>
  </main>
</template>
