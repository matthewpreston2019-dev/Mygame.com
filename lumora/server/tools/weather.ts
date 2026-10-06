// Weather via Open-Meteo (free, no API key, non-commercial use). https://open-meteo.com
import { optNum, str, ToolInputError, type ToolDef } from './types';

const CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

export const weatherTool: ToolDef = {
  name: 'weather',
  risk: 'safe',
  spec: {
    name: 'weather',
    description: 'Get current weather and a daily forecast (up to 7 days) for a city or place.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or place name, optionally with country, e.g. "Lisbon, Portugal"' },
        days: { type: 'number', description: 'Forecast days 1-7 (default 3)' },
        units: { type: 'string', enum: ['metric', 'imperial'] },
      },
      required: ['location'],
    },
  },
  async run(args, ctx) {
    const location = str(args.location, 'location', 120);
    const days = Math.min(7, Math.max(1, Math.round(optNum(args.days) ?? 3)));
    const imperial = args.units === 'imperial';
    const name = location.split(',')[0].trim();
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`,
      { signal: ctx.signal },
    );
    if (!geo.ok) throw new Error(`Geocoding failed (${geo.status})`);
    const g = (await geo.json()) as { results?: { name: string; country?: string; admin1?: string; latitude: number; longitude: number; country_code?: string }[] };
    const hint = location.split(',').slice(1).join(',').trim().toLowerCase();
    const place =
      (hint && g.results?.find((r) => [r.country, r.admin1, r.country_code].some((x) => x?.toLowerCase().includes(hint)))) || g.results?.[0];
    if (!place) throw new ToolInputError(`Could not find "${location}"`);
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
      timezone: 'auto',
      forecast_days: String(days),
      ...(imperial ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' } : {}),
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: ctx.signal });
    if (!res.ok) throw new Error(`Weather service failed (${res.status})`);
    const w = (await res.json()) as {
      current: Record<string, number | string>;
      current_units: Record<string, string>;
      daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: number[]; precipitation_sum: number[] };
      daily_units: Record<string, string>;
      timezone: string;
    };
    const u = w.current_units;
    const c = w.current;
    const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const lines = [
      `Weather for ${label} (timezone ${w.timezone}). Data: Open-Meteo.com`,
      `Now (${c.time}): ${CODES[Number(c.weather_code)] ?? 'Unknown'}, ${c.temperature_2m}${u.temperature_2m} (feels like ${c.apparent_temperature}${u.apparent_temperature}), humidity ${c.relative_humidity_2m}${u.relative_humidity_2m}, wind ${c.wind_speed_10m}${u.wind_speed_10m}, precipitation ${c.precipitation}${u.precipitation}`,
      'Forecast:',
      ...w.daily.time.map(
        (d, i) =>
          `- ${d}: ${CODES[w.daily.weather_code[i]] ?? 'Unknown'}, ${w.daily.temperature_2m_min[i]}–${w.daily.temperature_2m_max[i]}${w.daily_units.temperature_2m_max}, precipitation ${w.daily.precipitation_sum[i]}${w.daily_units.precipitation_sum}${w.daily.precipitation_probability_max ? ` (${w.daily.precipitation_probability_max[i]}% chance)` : ''}`,
      ),
    ];
    return {
      content: lines.join('\n'),
      summary: `${label}: ${CODES[Number(c.weather_code)] ?? ''} ${c.temperature_2m}${u.temperature_2m}`,
      sources: [{ title: `Open-Meteo forecast — ${label}`, url: `https://open-meteo.com/en/docs#latitude=${place.latitude}&longitude=${place.longitude}` }],
    };
  },
};
