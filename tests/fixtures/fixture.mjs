// Explicit sample only; forecasts, battery and clearly labelled schedules are illustrative.
export function fixture(base) {
  const config = structuredClone(base);
  const states = {};
  const values = {
    outdoor_temperature: 15,
    outdoor_humidity: 49,
    outdoor_aqi: 52,
    bedroom_temperature: 17.9,
    bedroom_humidity: 45.7,
    co2: 584,
    pm25: 5,
    pm1: 4,
    pm10: 8,
    hcho: 0.012,
    tvoc: 0.046,
    weather: 'cloudy',
    bedroom_light: 'off',
    desk_light: 'off',
    assistant_text: '傍晚可能有雨，出门请记得带伞。\n明天进入立冬，外出请记得添衣。\n晚餐约定前请留出路上的时间。',
  };
  for (const [name, value] of Object.entries(values)) {
    let domain = 'sensor';
    if (name.includes('light')) domain = 'light';
    else if (name === 'weather') domain = 'weather';
    const id = config.entities[name] || `${domain}.demo_${name}`;
    config.entities[name] = id;
    states[id] = {
      state: String(value),
      attributes: { unit_of_measurement: name.includes('temperature') ? '°C' : undefined },
    };
  }
  states[config.entities.climate] = {
    state: 'heat',
    attributes: {
      current_temperature: 21.2,
      current_humidity: 51,
      temperature: 16.1,
      temperature_unit: '°C',
      hvac_action: 'idle',
      min_temp: 9,
      max_temp: 32,
      target_temp_step: 0.5,
      hvac_modes: ['heat', 'cool', 'heat_cool', 'off'],
      target_temp_low: 16,
      target_temp_high: 24,
      fan_mode: 'off',
      fan_modes: ['on', 'off'],
    },
  };
  const snapshot = {
    states,
    online: true,
    updated: '2026-11-06T21:40:00Z',
    forecastStale: false,
    forecastUnit: '°C',
    windUnit: 'km/h',
    location: { name: '丹佛', latitude: 39.7392, longitude: -104.9903 },
    co2History: Array.from({ length: 97 }, (_, i) => ({
      time: new Date(Date.parse('2026-11-06T21:30:00Z') - (96 - i) * 900000).toISOString(),
      value: i === 96 ? 584 : Math.round(750 + Math.sin(i / 13) * 260 + (i > 32 && i < 56 ? 450 : 0)),
    })),
    dailyForecast: [{ datetime: '2026-11-07T12:00:00-07:00', condition: 'snowy-rainy', templow: 0, temperature: 7 }],
    agenda: {
      status: 'ok',
      events: [
        { summary: '示例 · 家庭安排', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } },
        {
          summary: '示例 · 项目讨论',
          start: { dateTime: '2026-11-06T15:00:00-07:00' },
          end: { dateTime: '2026-11-06T16:00:00-07:00' },
        },
        {
          summary: '示例 · 晚餐约定',
          start: { dateTime: '2026-11-06T18:00:00-07:00' },
          end: { dateTime: '2026-11-06T19:00:00-07:00' },
        },
        {
          summary: '示例 · 牙医复诊',
          start: { dateTime: '2026-11-07T10:00:00-07:00' },
          end: { dateTime: '2026-11-07T11:00:00-07:00' },
        },
      ],
    },
    forecast: [14, 12, 10, 8, 6, 2].map((temperature, i) => ({
      datetime: `2026-11-${i < 2 ? '06' : '07'}T${String((22 + i) % 24).padStart(2, '0')}:00:00Z`,
      temperature,
      condition: ['cloudy', 'cloudy', 'rainy', 'rainy', 'rainy', 'snowy'][i],
      precipitation_probability: [10, 20, 60, 70, 60, 50][i],
      wind_speed: [9, 16, 16, 23, 23, 16][i],
      wind_bearing: [315, 315, 270, 225, 225, 0][i],
    })),
  };
  return { config, snapshot, session: { selected: '2026-11-06', month: '2026-11', followToday: true } };
}
