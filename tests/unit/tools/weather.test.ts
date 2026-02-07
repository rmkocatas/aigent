import { describe, it, expect, vi, beforeEach } from 'vitest';
import { weatherHandler } from '../../../src/core/tools/builtins/weather.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => { mockFetch.mockReset(); });

const geoResponse = {
  results: [{ latitude: 51.5, longitude: -0.12, name: 'London', country: 'United Kingdom' }],
};

const weatherResponse = {
  current_weather: {
    temperature: 15.2, windspeed: 12.5, winddirection: 230, weathercode: 2, is_day: 1, time: '2024-06-15T14:00',
  },
  timezone: 'Europe/London',
};

describe('weather tool', () => {
  it('fetches weather by city', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(geoResponse) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(weatherResponse) });

    const r = await weatherHandler({ city: 'London' }, ctx);
    expect(r).toContain('London');
    expect(r).toContain('15.2°C');
    expect(r).toContain('Partly cloudy');
  });

  it('fetches weather by coordinates', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(weatherResponse) });

    const r = await weatherHandler({ latitude: 51.5, longitude: -0.12 }, ctx);
    expect(r).toContain('15.2°C');
  });

  it('throws when city not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: [] }) });

    await expect(weatherHandler({ city: 'Nonexistent' }, ctx)).rejects.toThrow('City not found');
  });

  it('throws when no location provided', async () => {
    await expect(weatherHandler({}, ctx)).rejects.toThrow('Provide either');
  });

  it('throws when geocoding fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(weatherHandler({ city: 'London' }, ctx)).rejects.toThrow('Geocoding failed');
  });

  it('throws when weather API fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(geoResponse) })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(weatherHandler({ city: 'London' }, ctx)).rejects.toThrow('Weather API failed');
  });

  it('includes wind and time info', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(weatherResponse) });
    const r = await weatherHandler({ latitude: 51.5, longitude: -0.12 }, ctx);
    expect(r).toContain('12.5 km/h');
    expect(r).toContain('Daytime');
  });

  it('shows nighttime correctly', async () => {
    const nightWeather = { ...weatherResponse, current_weather: { ...weatherResponse.current_weather, is_day: 0 } };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(nightWeather) });
    const r = await weatherHandler({ latitude: 0, longitude: 0 }, ctx);
    expect(r).toContain('Nighttime');
  });

  it('handles unknown weather code', async () => {
    const unknownWeather = { ...weatherResponse, current_weather: { ...weatherResponse.current_weather, weathercode: 999 } };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(unknownWeather) });
    const r = await weatherHandler({ latitude: 0, longitude: 0 }, ctx);
    expect(r).toContain('Unknown');
  });
});
