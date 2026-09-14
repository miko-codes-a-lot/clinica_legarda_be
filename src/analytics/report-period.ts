const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Appointment dates are UTC calendar days; update timestamps are real instants. */
export function reportPeriod(now = new Date(Date.now())) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const mondayOffset = (todayStart.getUTCDay() + 6) % 7;
  const appointmentStart = new Date(
    todayStart.getTime() - mondayOffset * DAY_MS,
  );
  const appointmentEnd = new Date(appointmentStart.getTime() + 7 * DAY_MS);
  const dateKeys = Array.from({ length: 7 }, (_, day) =>
    new Date(appointmentStart.getTime() + day * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
  return {
    today,
    weekOf: dateKeys[0],
    weekEnd: dateKeys[6],
    dateKeys,
    appointmentStart,
    appointmentEnd,
    updateStart: new Date(appointmentStart.getTime() - MANILA_OFFSET_MS),
    updateEnd: new Date(appointmentEnd.getTime() - MANILA_OFFSET_MS),
    todayStart,
    todayEnd: new Date(todayStart.getTime() + DAY_MS),
  };
}
