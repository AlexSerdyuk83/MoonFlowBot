import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export function getNowInTimezone(timezoneName: string): dayjs.Dayjs {
  return dayjs().tz(timezoneName);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function isValidTimeHHmm(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function weekdayKeyFromDate(date: Date, timezoneName: string): string {
  return dayjs(date).tz(timezoneName).format('dddd').toLowerCase();
}

export function isoDateInTimezone(date: Date, timezoneName: string): string {
  return dayjs(date).tz(timezoneName).format('YYYY-MM-DD');
}
