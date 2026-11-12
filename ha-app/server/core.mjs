import lunar from './vendor/chinese_calendar.mjs';
import { clock, sunHours, co2Trend, airGrades, roundToStep, wrap, QUARTER } from './metrics.mjs';
import { readLines } from './assistant/text.mjs';
import { outdoorAQI } from './sources/aqi.mjs';

const formatters = new Map();
function timeFormats(timezone) {
  if (!formatters.has(timezone)) {
    const value = {
      day: new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }),
      hour: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }),
    };
    if (formatters.size >= 8) {
      formatters.delete(formatters.keys().next().value);
    }
    formatters.set(timezone, value);
  }
  return formatters.get(timezone);
}

export const half = (value) => {
  if (!Number.isFinite(Number(value)) || value === null || value === '') {
    return null;
  }
  return roundToStep(Number(value), 0.5);
};
export function localDay(now, timezone) {
  const parts = Object.fromEntries(
    timeFormats(timezone)
      .day.formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 1901 &&
    Number(value.slice(0, 4)) <= 2099
  );
}
// Keep the festival list and names aligned with Android's Almanac.java.
// The lunar library supplies dates and solar terms; its broader festival list is not the panel's list.
const SOLAR_FESTIVALS = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '10-31': '万圣夜',
  '11-1': '万圣节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
};
const LUNAR_FESTIVALS = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
};
const daysCache = new Map();
export function dayInfo(iso) {
  if (daysCache.has(iso)) {
    return daysCache.get(iso);
  }
  if (!validDate(iso)) {
    throw new Error('invalid date');
  }
  const [year, month, day] = iso.split('-').map(Number);
  const solar = lunar.Solar.fromYmd(year, month, day);
  const lunarDate = solar.getLunar();
  const events = [];
  const festival = LUNAR_FESTIVALS[`${lunarDate.getMonth()}-${lunarDate.getDay()}`];
  // Negative lunar months are leap months and do not repeat festivals.
  if (festival) {
    events.push(festival);
  }
  if (lunarDate.getDay() >= 29) {
    const next = lunarDate.next(1);
    if (next.getMonth() === 1 && next.getDay() === 1) {
      events.push('除夕');
    }
  }
  let solarFestival = SOLAR_FESTIVALS[`${month}-${day}`];
  const weekday = solar.getWeek();
  if (month === 11 && weekday === 4 && day >= 22 && day <= 28) {
    solarFestival = '感恩节';
  }
  if (month === 5 && weekday === 0 && day >= 8 && day <= 14) {
    solarFestival = '母亲节';
  }
  if (month === 6 && weekday === 0 && day >= 15 && day <= 21) {
    solarFestival = '父亲节';
  }
  if (solarFestival) {
    events.unshift(solarFestival);
  }
  const term = lunarDate.getJieQi();
  const result = {
    iso,
    day: day,
    weekday: '日一二三四五六'[new Date(iso + 'T12:00:00Z').getUTCDay()],
    lunar: `${lunarDate.getMonthInChinese()}月${lunarDate.getDayInChinese()}`,
    ganzhi: `${lunarDate.getYearInGanZhiByLiChun()}年 ${lunarDate.getMonthInGanZhi()}月 ${lunarDate.getDayInGanZhi()}日`,
    meta: `${lunarDate.getZhiXing()}日 冲${lunarDate.getDayChongDesc().replace(/\([^)]*\)/g, '')} 煞${lunarDate.getDaySha()}`,
    label:
      events[0] ||
      term ||
      (lunarDate.getDay() === 1 ? lunarDate.getMonthInChinese() + '月' : lunarDate.getDayInChinese()),
    events,
    term,
    event: Boolean(term || events.length),
    yi: lunarDate.getDayYi(),
    ji: lunarDate.getDayJi(),
  };
  if (daysCache.size >= 512) {
    daysCache.delete(daysCache.keys().next().value);
  }
  daysCache.set(iso, result);
  return result;
}
const seasonsCache = new Map();
export function upcoming(iso) {
  if (seasonsCache.has(iso)) {
    return seasonsCache.get(iso);
  }
  const events = [];
  for (let delta = 1; delta <= 370 && events.length < 5; delta++) {
    const day = new Date(Date.parse(iso) + delta * 86400000).toISOString().slice(0, 10);
    if (!validDate(day)) {
      break;
    }
    const info = dayInfo(day);
    const names = [...info.events, ...(info.term ? [info.term] : [])];
    let countdown = `${delta}天`;
    if (delta === 1) {
      countdown = '明天';
    } else if (delta === 2) {
      countdown = '后天';
    }
    for (const name of names) {
      events.push({
        name,
        date: day.slice(5).replace('-', '/'),
        days: delta,
        countdown,
      });
      if (events.length === 5) {
        break;
      }
    }
  }
  if (seasonsCache.size >= 64) {
    seasonsCache.delete(seasonsCache.keys().next().value);
  }
  seasonsCache.set(iso, events);
  return events;
}
export function entityState(states, selector) {
  return states[selector?.split('#')[0]];
}
export function reading(states, selector) {
  if (!selector) {
    return null;
  }
  const [entityId, attribute] = selector.split('#');
  const state = states[entityId];
  if (!state || ['unknown', 'unavailable'].includes(state.state)) {
    return null;
  }
  const value = attribute ? state.attributes?.[attribute] : state.state;
  return value === undefined || value === null || value === '' ? null : value;
}
export function celsius(value, unit) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return null;
  }
  let temperature = Number(value);
  if (unit === '°F') {
    temperature = ((Number(value) - 32) * 5) / 9;
  }
  return half(temperature);
}
/** What /data and the assistant read from HA: readings in display units plus today's almanac facts. */
export function buildView(config, snapshot, now = new Date()) {
  const entities = config.entities;
  const states = snapshot.states;
  const readEntity = (key) => reading(states, entities[key]);
  const temperature = (key) =>
    celsius(
      readEntity(key),
      entityState(states, entities[key])?.attributes?.unit_of_measurement ||
        entityState(states, entities[key])?.attributes?.temperature_unit ||
        config.temperature_unit,
    );
  const massConcentration = (key, unit) => {
    const raw = readEntity(key);
    if (raw === null || raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
      return null;
    }
    const actual = String(entityState(states, entities[key])?.attributes?.unit_of_measurement || unit)
      .replace(/μ/g, 'µ')
      .replace(/³/g, '3')
      .replace(/\s/g, '');
    if (actual === unit) {
      return Number(raw);
    }
    if (actual === 'mg/m3' && unit === 'µg/m3') {
      return Number(raw) * 1000;
    }
    if (actual === 'µg/m3' && unit === 'mg/m3') {
      return Number(raw) / 1000;
    }
    return null;
  };
  const aqi = outdoorAQI({
    value: readEntity('outdoor_aqi'),
    standard: config.aqi_input_standard || 'US',
    pm25: massConcentration('outdoor_pm25_24h', 'µg/m3'),
    pm10: massConcentration('outdoor_pm10_24h', 'µg/m3'),
    primary: readEntity('outdoor_aqi_primary'),
    period: config.aqi_cn_period,
  });
  const today = localDay(now, config.timezone);
  const climate = states[entities.climate];
  const climateAttributes = climate?.attributes || {};
  const availableClimate = climate && !['unknown', 'unavailable'].includes(climate.state);
  const forecast = (snapshot.forecast || [])
    .filter((x) => new Date(x.datetime) >= now)
    .slice(0, 6)
    .map((x) => ({
      ...x,
      hour: timeFormats(config.timezone).hour.format(new Date(x.datetime)),
      time: clock(Date.parse(x.datetime), config.timezone),
      temperature: celsius(x.temperature, snapshot.forecastUnit),
      wind: windSpeed(x.wind_speed, snapshot.windUnit),
      bearing: bearing(x.wind_bearing),
    }));
  const at = now.getTime();
  const quarter = Math.floor(at / QUARTER) * QUARTER;
  const location = snapshot.location || {};
  const solar = sunHours(today, config.latitude ?? location.latitude, config.longitude ?? location.longitude);
  const solarTime = (hour) => {
    if (hour === null) {
      return null;
    }
    for (const delta of [-1, 0, 1]) {
      const time = Date.parse(today) + delta * 86400000 + Math.round(hour * 60) * 60000;
      if (localDay(new Date(time), config.timezone) === today) {
        return clock(time, config.timezone);
      }
    }
    return null;
  };
  const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
  const tomorrowForecast = (snapshot.dailyForecast || []).filter(
    (x) => Number.isFinite(Date.parse(x.datetime)) && localDay(new Date(x.datetime), config.timezone) === tomorrow,
  );
  const daily = tomorrowForecast.find((x) => x.is_daytime !== false);
  const night = tomorrowForecast.find((x) => x.is_daytime === false);
  const co2Reading = readEntity('co2');
  let co2 = null;
  if (co2Reading !== null && Number(co2Reading) >= 0) {
    co2 = Number(co2Reading);
  }
  const view = {
    today,
    header: dayInfo(today),
    upcoming: upcoming(today),
    city: config.city || location.name || '',
    sunrise: solarTime(solar.rise),
    sunset: solarTime(solar.set),
    tomorrow: daily
      ? {
          condition: daily.condition,
          low: celsius(daily.templow ?? night?.temperature, snapshot.forecastUnit),
          high: celsius(daily.temperature, snapshot.forecastUnit),
        }
      : null,
    outside: temperature('outdoor_temperature'),
    outdoorHumidity: readEntity('outdoor_humidity'),
    aqi: aqi.value,
    condition: readEntity('weather'),
    forecast,
    living: temperature('living_temperature'),
    livingHumidity: readEntity('living_humidity'),
    bedroom: temperature('bedroom_temperature'),
    bedroomHumidity: readEntity('bedroom_humidity'),
    setpoint: availableClimate
      ? celsius(climateAttributes.temperature, climateAttributes.temperature_unit || config.temperature_unit)
      : null,
    targetLow: availableClimate
      ? celsius(climateAttributes.target_temp_low, climateAttributes.temperature_unit || config.temperature_unit)
      : null,
    targetHigh: availableClimate
      ? celsius(climateAttributes.target_temp_high, climateAttributes.temperature_unit || config.temperature_unit)
      : null,
    modes: availableClimate ? climateAttributes.hvac_modes || [] : [],
    mode: availableClimate ? climate.state : null,
    action: availableClimate ? climateAttributes.hvac_action : null,
    co2,
    pm25: massConcentration('pm25', 'µg/m3'),
    pm1: massConcentration('pm1', 'µg/m3'),
    pm10: massConcentration('pm10', 'µg/m3'),
    hcho: massConcentration('hcho', 'mg/m3'),
    tvoc: massConcentration('tvoc', 'mg/m3'),
  };
  view.hint = readLines(readEntity('assistant_text'));
  view.co2History = co2Trend(
    snapshot.co2History,
    view.co2,
    quarter,
    snapshot.online ? quarter : Date.parse(snapshot.updated),
    snapshot.historyStale ? Date.parse(snapshot.historyUpdated) || 0 : quarter,
  );
  view.grades = airGrades(view);
  return view;
}
/** Forecast wind in m/s from HA's wind_speed_unit (km/h by default), or null. */
export function windSpeed(value, unit = 'km/h') {
  const speed = Number(value);
  const factor = { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444, 'ft/s': 0.3048 }[unit];
  if (value === null || value === undefined || value === '' || !Number.isFinite(speed) || factor === undefined) {
    return null;
  }
  return Math.round(speed * factor * 10) / 10;
}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Where the wind comes from, in degrees; HA allows a number or a compass point. */
export function bearing(value) {
  if (typeof value === 'string' && COMPASS.includes(value.toUpperCase())) {
    return COMPASS.indexOf(value.toUpperCase()) * 22.5;
  }
  const degrees = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(degrees)) {
    return null;
  }
  return wrap(degrees, 360);
}
// Only server-created hit targets reach this function. Client input never selects a HA entity/service.
export function planAction(action, config, snapshot) {
  const entities = config.entities;
  const states = snapshot.states;
  if (!snapshot.online) {
    throw new Error('HA 暂不可用');
  }
  function available(id) {
    if (!id || !states[id] || ['unknown', 'unavailable'].includes(states[id].state)) {
      throw new Error('设备未配置或不可用');
    }
    return states[id];
  }
  if (action.startsWith('mode:')) {
    const mode = action.slice(5);
    const climateState = available(entities.climate);
    if (!['heat', 'cool', 'heat_cool', 'off'].includes(mode) || !climateState.attributes.hvac_modes?.includes(mode)) {
      throw new Error('设备不支持此模式');
    }
    return [['climate', 'set_hvac_mode', { entity_id: entities.climate, hvac_mode: mode }]];
  }
  const rangeTarget = /^range:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(action);
  if (rangeTarget || /^range_(low|high)_(down|up)$/.test(action)) {
    const climateState = available(entities.climate);
    const attributes = climateState.attributes;
    const unit = attributes.temperature_unit || config.temperature_unit;
    if (
      climateState.state !== 'heat_cool' ||
      attributes.target_temp_low == null ||
      attributes.target_temp_high == null
    ) {
      throw new Error('区间不可用');
    }
    let lowTarget = celsius(attributes.target_temp_low, unit);
    let highTarget = celsius(attributes.target_temp_high, unit);
    const delta = action.endsWith('up') ? 0.5 : -0.5;
    const adjustingLow = action.startsWith('range_low');
    const minimum = Math.max(5, celsius(attributes.min_temp ?? (unit === '°F' ? 41 : 5), unit));
    const maximum = Math.min(32, celsius(attributes.max_temp ?? (unit === '°F' ? 89.6 : 32), unit));
    // Nest enforces 1.66667°C internally; use 2°C on this panel's half-degree grid.
    if (rangeTarget) {
      lowTarget = Number(rangeTarget[1]);
      highTarget = Number(rangeTarget[2]);
      if (lowTarget < minimum || highTarget > maximum || highTarget - lowTarget < 2) {
        throw new Error('温度区间需相差至少 2°C 且在设备范围内');
      }
    } else if (adjustingLow) {
      lowTarget = Math.max(minimum, Math.min(highTarget - 2, lowTarget + delta));
    } else {
      highTarget = Math.min(maximum, Math.max(lowTarget + 2, highTarget + delta));
    }
    const step = attributes.target_temp_step || (unit === '°F' ? 1 : 0.5);
    function nativeRangeTarget(value) {
      let nativeValue = value;
      if (unit === '°F') {
        // Keep this multiplication order: decimal step ties differ from value * 9 / 5.
        nativeValue = value * 1.8 + 32;
      }
      return Number(roundToStep(nativeValue, step).toFixed(2));
    }
    const nativeLow = nativeRangeTarget(lowTarget);
    const nativeHigh = nativeRangeTarget(highTarget);
    let nativeGap = nativeHigh - nativeLow;
    if (unit === '°F') {
      nativeGap /= 1.8;
    }
    if (nativeGap < 1.66667) {
      throw new Error('设备步长无法满足温度间隔');
    }
    return [
      [
        'climate',
        'set_temperature',
        { entity_id: entities.climate, target_temp_low: nativeLow, target_temp_high: nativeHigh },
      ],
    ];
  }
  const temperatureTarget = /^temp:(?:(heat|cool):)?(\d+(?:\.\d+)?)$/.exec(action);
  if (temperatureTarget || action === 'temp_down' || action === 'temp_up') {
    const climateState = available(entities.climate);
    const attributes = climateState.attributes;
    if (!['heat', 'cool'].includes(climateState.state) || attributes.temperature == null) {
      throw new Error('当前模式不支持单温度设定');
    }
    if (temperatureTarget?.[1] && temperatureTarget[1] !== climateState.state) {
      throw new Error('空调模式已变化');
    }
    const unit = attributes.temperature_unit || config.temperature_unit;
    const fahrenheit = unit === '°F';
    let value;
    if (temperatureTarget) {
      value = Number(temperatureTarget[2]);
    } else {
      const delta = action === 'temp_up' ? 0.5 : -0.5;
      value = celsius(attributes.temperature, unit) + delta;
    }
    if (temperatureTarget && (value < 5 || value > 30)) {
      throw new Error('设定温度超出范围');
    }
    if (fahrenheit) {
      value = (value * 9) / 5 + 32;
    }
    const step = attributes.target_temp_step || (fahrenheit ? 1 : 0.5);
    value = roundToStep(value, step);
    value = Math.max(
      Math.max(attributes.min_temp ?? -Infinity, fahrenheit ? 41 : 5),
      Math.min(Math.min(attributes.max_temp ?? Infinity, fahrenheit ? 86 : 30), value),
    );
    return [['climate', 'set_temperature', { entity_id: entities.climate, temperature: Number(value.toFixed(2)) }]];
  }
  throw new Error('未知操作');
}
