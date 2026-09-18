export type BookingStatus = 'pending' | 'deposit_paid' | 'completed' | 'cancelled';
export type HolidayType = 'holiday' | 'workday';

export interface Scene {
  _id: string;
  name: string;
  weekday_rate: number;
  holiday_rate: number;
  capacity: number;
  color?: string;
}

export interface Booking {
  _id: string;
  scene_id: string;
  scene_name: string;
  date: string;
  start_time: string;
  end_time: string;
  people_count: number;
  customer_name: string;
  phone: string;
  wechat: string;
  status: BookingStatus;
  change_count: number;
  holiday_type: HolidayType;
  base_fee: number;
  overtime_fee: number;
  extra_person_fee: number;
  reschedule_fee: number;
  total_fee: number;
  deposit_amount: number;
}

export interface FeeResult {
  base_fee: number;
  overtime_fee: number;
  extra_person_fee: number;
  reschedule_fee: number;
  total_fee: number;
  deposit_amount: number;
  warnings: string[];
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  errors?: string[];
  code?: string;
}
