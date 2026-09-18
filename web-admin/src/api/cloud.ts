import cloudbase from '@cloudbase/js-sdk';
import type { ApiResult, Booking, Scene } from '../types';

const envId = import.meta.env.VITE_TCB_ENV_ID;

if (!envId) {
  console.warn('VITE_TCB_ENV_ID is missing. Copy .env.example to .env.local first.');
}

const app = cloudbase.init({
  env: envId
});

export const auth = app.auth({
  persistence: 'local'
});

export async function ensureLogin() {
  const state = await auth.getLoginState();
  if (!state) {
    await auth.signInAnonymously();
  }
}

async function callBookingApi<T>(data: Record<string, unknown>): Promise<ApiResult<T>> {
  await ensureLogin();
  const res = await app.callFunction({
    name: 'bookingApi',
    data
  });
  return res.result as ApiResult<T>;
}

export function getScenes() {
  return callBookingApi<Scene[]>({ action: 'getScenes' });
}

export function searchBookings(filters: Record<string, unknown>) {
  return callBookingApi<Booking[]>({
    action: 'adminSearchBookings',
    ...filters
  });
}

export function updateBooking(payload: Record<string, unknown>) {
  return callBookingApi<{
    booking_id: string;
    warnings: string[];
  }>({
    action: 'adminUpdateBooking',
    ...payload
  });
}
