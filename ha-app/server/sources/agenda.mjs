const formatters = new Map();
function local(value, timezone) {
  if (!formatters.has(timezone)) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    if (formatters.size >= 8) {
      formatters.delete(formatters.keys().next().value);
    }
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatters
      .get(timezone)
      .formatToParts(new Date(value))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function dateOnly(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function instant(value) {
  // HA supplies offsets. Reject floating date-times rather than interpreting the server's timezone.
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}
function summary(value, fallback) {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return clean.length > 160 ? clean.slice(0, 159) + '…' : clean || fallback;
}
function sourceStatus(configured, source) {
  if (!configured?.length && !source) {
    return 'unconfigured';
  }
  return ['ok', 'loading', 'stale', 'unavailable'].includes(source?.status) ? source.status : 'loading';
}
export function calendarWindow(day) {
  if (!dateOnly(day)) {
    throw new Error('Invalid calendar day');
  }
  // Query a small UTC superset, then filter by the configured display timezone (including DST).
  return calendarRange(day, 1);
}
/** UTC superset for a run of local days; the display receives up to six items per day for local selection. */
export function calendarRange(day, days) {
  if (!dateOnly(day) || !Number.isInteger(days) || days < 1 || days > 62) {
    throw new Error('Invalid calendar range');
  }
  const at = Date.parse(day);
  return { start: new Date(at - 86400000).toISOString(), end: new Date(at + (days + 1) * 86400000).toISOString() };
}
/**
 * Every event of the next `days` local days, one item per day it covers: `time` is its start (HH:MM) on its
 * first day and 全天 otherwise, `end` the finish on a single-day timed event (24:00 past midnight), `until`
 * the last day of a multi-day event. The display picks the day, hides finished events and marks the running one.
 */
export function agendaDays(config, snapshot, firstDay, days) {
  const timezone = config.timezone;
  const items = [];
  const add = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
  const last = add(firstDay, days - 1);
  const status = sourceStatus(config.calendars, snapshot.agenda);
  for (const event of ['ok', 'stale'].includes(status) ? snapshot.agenda.events || [] : []) {
    if (!event || event.status === 'cancelled') {
      continue;
    }
    const start = event.start?.date ?? event.start?.dateTime ?? event.start;
    const end = event.end?.date ?? event.end?.dateTime ?? event.end;
    let firstEventDay;
    let lastEventDay;
    let time = null;
    let endTime = null;
    let order = -Infinity;
    if (dateOnly(start) && dateOnly(end)) {
      if (end <= start) {
        continue;
      }
      firstEventDay = start;
      lastEventDay = add(end, -1);
    } else {
      const begin = instant(start);
      const stop = instant(end);
      if (!Number.isFinite(begin) || !Number.isFinite(stop) || stop < begin) {
        continue;
      }
      const startLocal = local(begin, timezone);
      const endLocal = local(stop, timezone);
      firstEventDay = startLocal.day;
      lastEventDay = local(Math.max(begin, stop - 1), timezone).day;
      time = startLocal.time;
      order = begin;
      endTime = endLocal.day === firstEventDay ? endLocal.time : '24:00';
    }
    const title = summary(event.summary, '未命名日程');
    for (
      let day = firstEventDay < firstDay ? firstDay : firstEventDay;
      day <= lastEventDay && day <= last;
      day = add(day, 1)
    ) {
      const timed = time !== null && day === firstEventDay;
      items.push({
        date: day,
        time: timed ? time : '全天',
        ...(timed && lastEventDay === firstEventDay ? { end: endTime } : {}),
        ...(lastEventDay > firstEventDay ? { until: lastEventDay } : {}),
        title,
        order: timed ? order : -Infinity,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.title.localeCompare(b.title));
  return items.map(({ order, ...item }) => item);
}

/** Full events for the assistant, independent of the six-row display. All-day labels do not imply busy. */
export function assistantAgenda(config, source, now = new Date()) {
  const timezone = config.timezone;
  const today = local(now, timezone).day;
  const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
  const status = sourceStatus(config.calendars, source);
  const nowAt = now.getTime();
  const horizonAt = nowAt + 6 * 3600000;
  const events = [];
  const seen = new Set();
  for (const event of status === 'ok' ? source?.events || [] : []) {
    if (!event || event.status === 'cancelled') {
      continue;
    }
    const start = event.start?.date ?? event.start?.dateTime ?? event.start;
    const end = event.end?.date ?? event.end?.dateTime ?? event.end;
    const allDay = dateOnly(start) && dateOnly(end);
    const startAt = instant(start);
    const endAt = instant(end);
    if (allDay) {
      if (end <= start || end <= today || start > tomorrow) {
        continue;
      }
    } else {
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
        continue;
      }
      const firstEventDay = local(startAt, timezone).day;
      const lastEventDay = local(Math.max(startAt, endAt - 1), timezone).day;
      if (lastEventDay < today || firstEventDay > tomorrow) {
        continue;
      }
    }
    const title = summary(event.summary, '未命名日程');
    const eventKey = JSON.stringify([title, allDay ? start : startAt, allDay ? end : endAt]);
    if (seen.has(eventKey)) {
      continue;
    }
    seen.add(eventKey);
    let eventStatus = 'upcoming';
    if (allDay) {
      eventStatus = 'all_day';
    } else if (endAt <= nowAt) {
      eventStatus = 'ended';
    } else if (startAt <= nowAt) {
      eventStatus = 'ongoing';
    }
    events.push({
      title,
      start,
      end,
      all_day: allDay,
      time: allDay ? '全天' : local(startAt, timezone).time,
      status: eventStatus,
      ...(event.location ? { location: summary(event.location, '') } : {}),
      blocks_time: !allDay && event.transparency !== 'transparent',
    });
  }
  events.sort(
    (a, b) =>
      (a.all_day ? Date.parse(a.start) : instant(a.start)) - (b.all_day ? Date.parse(b.start) : instant(b.start)) ||
      a.title.localeCompare(b.title),
  );
  const activeEvents = events.filter((x) => x.status !== 'ended');
  const intervals = activeEvents
    .filter((x) => x.blocks_time)
    .map((x) => [Date.parse(x.start), Date.parse(x.end)])
    .filter(([start, end]) => start < horizonAt && end > nowAt)
    .sort((a, b) => a[0] - b[0]);
  const freeWindows = [];
  let cursorAt = nowAt;
  for (const [start, end] of intervals) {
    if (start > cursorAt) {
      freeWindows.push({ start: new Date(cursorAt).toISOString(), end: new Date(start).toISOString() });
    }
    cursorAt = Math.max(cursorAt, end);
  }
  if (cursorAt < horizonAt) {
    freeWindows.push({ start: new Date(cursorAt).toISOString(), end: new Date(horizonAt).toISOString() });
  }
  let availabilityStatus = 'unknown';
  if (status === 'ok') {
    availabilityStatus = 'no_calendar_event';
    if (activeEvents.some((event) => event.blocks_time && event.status === 'ongoing')) {
      availabilityStatus = 'calendar_busy';
    }
  }
  return {
    schedule: activeEvents,
    schedule_today: events.filter((event) => {
      if (event.all_day) {
        return event.start <= today;
      }
      return (
        local(event.start, timezone).day <= today &&
        local(Math.max(instant(event.start), instant(event.end) - 1), timezone).day >= today
      );
    }),
    schedule_status: status,
    availability: {
      status: availabilityStatus,
      horizon_end: new Date(horizonAt).toISOString(),
      free_windows: status === 'ok' ? freeWindows : [],
      note: '空档只代表已同步日历没有占用；全天条目、灯光状态不能证明用户有空、在家或清醒。',
    },
  };
}
