// Pure calculations for readings: clock times, sunrise and sunset, the CO₂ trend and air grades.
// Coordinates stay on the server; the display receives times, never location.
export const QUARTER = 15 * 60000;
export function roundToStep(value, step) {
  return Math.round(value / step) * step;
}
export function wrap(value, period) {
  return ((value % period) + period) % period;
}
const clocks = new Map();
export function clock(at, timezone) {
  if (!clocks.has(timezone)) {
    clocks.set(
      timezone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return clocks.get(timezone).format(new Date(at));
}
// US Naval Observatory Almanac sunrise algorithm (90°50' apparent horizon).
// Reference: https://www.edwilliams.org/sunrise_sunset_algorithm.htm . Approximate civil times.
export function sunHours(iso, latitude, longitude) {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(Number(latitude)) ||
    !Number.isFinite(Number(longitude)) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { rise: null, set: null };
  }
  const radiansPerDegree = Math.PI / 180;
  const sinDegrees = (degrees) => Math.sin(degrees * radiansPerDegree);
  const cosDegrees = (degrees) => Math.cos(degrees * radiansPerDegree);
  const year = Number(iso.slice(0, 4));
  const dayOfYear = (Date.parse(iso) - Date.UTC(year, 0, 1)) / 86400000 + 1;
  function sunEvent(isSunrise) {
    const approximateTime = dayOfYear + ((isSunrise ? 6 : 18) - longitude / 15) / 24;
    const meanAnomaly = 0.9856 * approximateTime - 3.289;
    const trueLongitude = wrap(
      meanAnomaly + 1.916 * sinDegrees(meanAnomaly) + 0.02 * sinDegrees(2 * meanAnomaly) + 282.634,
      360,
    );
    let rightAscension = wrap(Math.atan(0.91764 * Math.tan(trueLongitude * radiansPerDegree)) / radiansPerDegree, 360);
    rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
    const sinDeclination = 0.39782 * sinDegrees(trueLongitude);
    const cosHourAngle =
      (cosDegrees(90 + 50 / 60) - sinDeclination * sinDegrees(latitude)) /
      (Math.sqrt(1 - sinDeclination * sinDeclination) * cosDegrees(latitude));
    // Polar day/night has no sunrise or sunset.
    if (cosHourAngle < -1 || cosHourAngle > 1) {
      return null;
    }
    return wrap(
      (isSunrise ? 360 - Math.acos(cosHourAngle) / radiansPerDegree : Math.acos(cosHourAngle) / radiansPerDegree) / 15 +
        rightAscension / 15 -
        0.06571 * approximateTime -
        6.622 -
        longitude / 15,
      24,
    );
  }
  return { rise: sunEvent(true), set: sunEvent(false) };
}
export function co2Trend(history, current, at, currentAt = at, historyUntil = at) {
  const end = at;
  const start = end - 24 * 3600000;
  const records = (history || [])
    .map((x) => ({
      at: Date.parse(x.time),
      value:
        x.value !== null && x.value !== '' && Number.isFinite(Number(x.value)) && Number(x.value) >= 0
          ? Number(x.value)
          : null,
    }))
    .filter((x) => Number.isFinite(x.at) && x.at <= end)
    .sort((a, b) => a.at - b.at);
  const points = [];
  let index = 0;
  let value = null;
  for (let time = start; time <= end; time += QUARTER) {
    while (index < records.length && records[index].at <= time) {
      value = records[index].value;
      index++;
    }
    points.push({ at: time, value: time <= historyUntil ? value : null });
  }
  // A failed history read may still show a genuinely fresh current point; never invent a curve.
  if (
    current !== null &&
    current !== '' &&
    Number.isFinite(Number(current)) &&
    currentAt >= start &&
    currentAt <= end
  ) {
    const point = { at: currentAt, value: Number(current) };
    if (points.at(-1).at === currentAt) {
      points[points.length - 1] = point;
    } else if (currentAt === end) {
      points.push(point);
    }
  }
  return points;
}
export function airGrades(view) {
  const numericValue = (x) => (x === null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const co2 = numericValue(view.co2);
  const aqi = numericValue(view.aqi);
  const aqiLevelIndex = aqi === null ? -1 : [50, 100, 150, 200, 300, Infinity].findIndex((limit) => aqi <= limit);
  let co2Label = '—';
  let co2Level = 0;
  if (co2 !== null) {
    if (co2 <= 1000) {
      co2Label = '良好';
    } else if (co2 <= 1500) {
      co2Label = '偏高';
      co2Level = 1;
    } else {
      co2Label = '超标';
      co2Level = 2;
    }
  }
  return {
    co2: {
      label: co2Label,
      level: co2Level,
    },
    aqi: {
      label: ['优', '良', '轻度污染', '中度污染', '重度污染', '严重污染'][aqiLevelIndex] || '—',
      level: aqiLevelIndex,
    },
    metrics: [
      ['PM2.5', 'pm25', 50, 'µg/m³'],
      ['PM10', 'pm10', 100, 'µg/m³'],
      ['PM1', 'pm1', 15, 'µg/m³'],
      ['甲醛', 'hcho', 0.08, 'mg/m³'],
      ['TVOC', 'tvoc', 0.6, 'mg/m³'],
    ].map(([label, key, limit, unit]) => {
      const value = numericValue(view[key]);
      let grade = '—';
      if (value !== null) {
        grade = Number(view[key]) <= limit ? '正常' : '偏高';
      }
      return { label, key, value, limit, unit, grade };
    }),
  };
}
