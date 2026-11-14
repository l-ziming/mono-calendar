// Validate labels and entity mappings before reading sensors or allowing writes.
export function displaySettings(config) {
  const entities = config.entities || {};
  const defaults = {
    rooms: [
      {
        id: 'living',
        name: '客厅',
        temperature: entities.living_temperature || '',
        humidity: entities.living_humidity || '',
      },
      {
        id: 'bedroom',
        name: '卧室',
        temperature: entities.bedroom_temperature || '',
        humidity: entities.bedroom_humidity || '',
      },
    ],
    devices: [
      { id: 'bedroom_light', name: '卧室落地灯', entity: entities.bedroom_light || '', type: 'toggle' },
      { id: 'desk_light', name: '屏幕挂灯', entity: entities.desk_light || '', type: 'toggle' },
      { id: 'fan', name: '风扇', entity: entities.climate || '', type: 'nest_fan' },
    ],
  };
  const result = {};
  for (const [key, limit] of [
    ['rooms', 6],
    ['devices', 8],
  ]) {
    const values = config[key] === undefined ? [] : config[key];
    if (!Array.isArray(values) || values.length > limit) {
      throw new Error(`Invalid ${key}: use at most ${limit} entries`);
    }
    // Empty lists preserve existing installs when Supervisor adds the new default options during an upgrade.
    if (!values.length) {
      result[key] = defaults[key];
      continue;
    }
    const ids = new Set(),
      controlled = new Set();
    result[key] = values.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.id !== 'string' ||
        !/^[a-z][a-z0-9_]{0,31}$/.test(value.id) ||
        ids.has(value.id) ||
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 32 ||
        /[\x00-\x1f\x7f]/.test(value.name)
      ) {
        throw new Error(`Invalid ${key} entry`);
      }
      ids.add(value.id);
      const item = { id: value.id, name: value.name.trim() };
      if (key === 'rooms') {
        for (const field of ['temperature', 'humidity']) {
          const selector = value[field] ?? '';
          if (
            typeof selector !== 'string' ||
            (selector && !/^[a-z_]+\.[a-z0-9_]+(?:#[A-Za-z0-9_]+)?$/.test(selector))
          ) {
            throw new Error('Invalid room sensor selector');
          }
          item[field] = selector;
        }
      } else {
        item.type = value.type ?? 'toggle';
        item.entity = value.entity;
        const pattern = item.type === 'nest_fan' ? /^climate\.[a-z0-9_]+$/ : /^(?:light|switch|fan)\.[a-z0-9_]+$/;
        if (
          !['toggle', 'nest_fan'].includes(item.type) ||
          typeof item.entity !== 'string' ||
          !pattern.test(item.entity) ||
          controlled.has(item.entity)
        ) {
          throw new Error('Invalid controllable device');
        }
        controlled.add(item.entity);
      }
      return item;
    });
  }
  return result;
}
