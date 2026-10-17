// Game-time helpers. The clock is game minutes since Day 1 00:00.
export const TICK_MINUTES = 10;
export const TICK_REAL_MS = 2500;
export const STEP_REAL_MS = 400;
export const WAKE_MINUTE = 7 * 60;
export const SLEEP_MINUTE = 22 * 60;
export const START_CLOCK = WAKE_MINUTE;

export const dayOf = (clock: number) => Math.floor(clock / 1440) + 1;
export const minuteOfDay = (clock: number) => clock % 1440;
export const isSleepTime = (clock: number) => {
  const m = minuteOfDay(clock);
  return m >= SLEEP_MINUTE || m < WAKE_MINUTE;
};
export const hoursBetween = (a: number, b: number) => Math.abs(b - a) / 60;
