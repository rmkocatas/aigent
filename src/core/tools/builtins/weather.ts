// ============================================================
// OpenClaw Deploy — Weather Tool (Open-Meteo API)
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
  55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export const weatherDefinition: ToolDefinition = {
  name: 'weather',
  description: 'Get current weather for a city or coordinates using the free Open-Meteo API.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name (e.g. "London", "Tokyo").' },
      latitude: { type: 'number', description: 'Latitude (use instead of city).' },
      longitude: { type: 'number', description: 'Longitude (use instead of city).' },
    },
  },
};

export const weatherHandler: ToolHandler = async (input) => {
  const city = input.city as string | undefined;
  let lat = input.latitude as number | undefined;
  let lon = input.longitude as number | undefined;
  let locationName = '';

  if (!city && (lat === undefined || lon === undefined)) {
    throw new Error('Provide either a city name or both latitude and longitude');
  }

  // Geocode city name
  if (city) {
    await rateLimit();
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(10_000) });

    if (!geoRes.ok) throw new Error(`Geocoding failed: ${geoRes.status}`);

    const geoData = await geoRes.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country: string }> };
    if (!geoData.results?.length) throw new Error(`City not found: ${city}`);

    const place = geoData.results[0];
    lat = place.latitude;
    lon = place.longitude;
    locationName = `${place.name}, ${place.country}`;
  } else {
    locationName = `${lat}, ${lon}`;
  }

  // Fetch weather
  await rateLimit();
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
  const weatherRes = await fetch(weatherUrl, { signal: AbortSignal.timeout(10_000) });

  if (!weatherRes.ok) throw new Error(`Weather API failed: ${weatherRes.status}`);

  const data = await weatherRes.json() as {
    current_weather: {
      temperature: number;
      windspeed: number;
      winddirection: number;
      weathercode: number;
      is_day: number;
      time: string;
    };
    timezone: string;
  };

  const w = data.current_weather;
  const condition = WMO_CODES[w.weathercode] ?? 'Unknown';

  const lines = [
    `Weather for ${locationName}`,
    `Condition: ${condition}`,
    `Temperature: ${w.temperature}°C`,
    `Wind: ${w.windspeed} km/h (${w.winddirection}°)`,
    `Time: ${w.time} (${data.timezone})`,
    w.is_day ? 'Daytime' : 'Nighttime',
  ];

  return lines.join('\n');
};
