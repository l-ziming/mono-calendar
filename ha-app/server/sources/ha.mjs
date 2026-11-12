export class HomeAssistant {
  constructor(base, token) {
    this.base = base.replace(/\/$/, '');
    this.token = token;
  }
  async request(path, data) {
    const response = await fetch(this.base + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`HA HTTP ${response.status}`);
    }
    return response.json();
  }
  async states(ids) {
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await this.request('/api/states/' + encodeURIComponent(id))];
        } catch (error) {
          if (error.message === 'HA HTTP 404') {
            return [id, null];
          }
          throw error;
        }
      }),
    );
    return Object.fromEntries(entries.filter(([, s]) => s));
  }
  service(domain, action, data) {
    return this.request(`/api/services/${domain}/${action}`, data);
  }
  async forecast(id, type = 'hourly') {
    const data = await this.request('/api/services/weather/get_forecasts?return_response', { entity_id: id, type });
    return data.service_response?.[id]?.forecast || [];
  }
  async location() {
    const data = await this.request('/api/config');
    return { name: data.location_name || '', latitude: data.latitude, longitude: data.longitude };
  }
  async history(id, start, end) {
    const query = new URLSearchParams({
      filter_entity_id: id,
      end_time: end,
      minimal_response: '1',
      no_attributes: '1',
      significant_changes_only: '0',
    });
    const data = await this.request('/api/history/period/' + encodeURIComponent(start) + '?' + query);
    if (!Array.isArray(data) || !data.every(Array.isArray)) {
      throw new Error('Invalid history response');
    }
    return data.flat().map((x) => ({
      time: x.last_changed || x.last_updated,
      value: x.state !== '' && Number.isFinite(Number(x.state)) ? Number(x.state) : null,
    }));
  }
  async calendarEvents(id, start, end) {
    const data = await this.request(
      '/api/calendars/' + encodeURIComponent(id) + '?' + new URLSearchParams({ start, end }),
    );
    if (!Array.isArray(data)) {
      throw new Error('Invalid calendar response');
    }
    return data.map(({ summary, start, end, status, location, transparency }) => ({
      summary,
      start,
      end,
      status,
      ...(location ? { location } : {}),
      ...(transparency ? { transparency } : {}),
    }));
  }
  /** An image entity's current picture (PNG/JPEG/GIF/WebP/BMP, at most 2 MB). */
  async image(id) {
    const response = await fetch(this.base + '/api/image_proxy/' + encodeURIComponent(id), {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`HA HTTP ${response.status}`);
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(type)) {
      throw new Error('Not an image');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 2000000) {
      throw new Error('Image too large');
    }
    return { type, body };
  }
}
