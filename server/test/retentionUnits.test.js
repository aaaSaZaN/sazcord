import { describe, it, expect, afterEach } from 'vitest';
import {
  parseRetention,
  retentionMs,
  retentionLabel,
  retentionHuman,
  tickMs,
} from '../src/retention.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

afterEach(() => {
  delete process.env.RETENTION;
  delete process.env.RETENTION_DAYS;
});

describe('retention window parsing', () => {
  it('reads the unit suffix', () => {
    expect(parseRetention('30m')).toBe(30 * MIN);
    expect(parseRetention('12h')).toBe(12 * HOUR);
    expect(parseRetention('10d')).toBe(10 * DAY);
  });

  it('treats a bare number as days', () => {
    // Прежняя RETENTION_DAYS означала дни. Прочитать «90» как минуты
    // означало бы стереть трёхмесячную историю на первом же прогоне.
    expect(parseRetention('90')).toBe(90 * DAY);
  });

  it('tolerates whitespace and case', () => {
    expect(parseRetention('  7D ')).toBe(7 * DAY);
  });

  it('rejects garbage instead of returning zero', () => {
    // null здесь означает «откатись на дефолт». Ноль означал бы
    // «удалять всё немедленно» — худший из возможных исходов опечатки.
    for (const bad of ['', '   ', 'abc', '0', '-5d', '5w', '1.5.2', null, undefined]) {
      expect(parseRetention(bad)).toBeNull();
    }
  });
});

describe('retention window resolution', () => {
  it('defaults to 90 days', () => {
    expect(retentionMs()).toBe(90 * DAY);
  });

  it('honours RETENTION', () => {
    process.env.RETENTION = '45m';
    expect(retentionMs()).toBe(45 * MIN);
  });

  it('still honours the legacy RETENTION_DAYS', () => {
    process.env.RETENTION_DAYS = '5';
    expect(retentionMs()).toBe(5 * DAY);
  });

  it('prefers RETENTION when both are set', () => {
    process.env.RETENTION = '2h';
    process.env.RETENTION_DAYS = '5';
    expect(retentionMs()).toBe(2 * HOUR);
  });

  it('falls back to the default when the value is malformed', () => {
    process.env.RETENTION = 'nonsense';
    expect(retentionMs()).toBe(90 * DAY);
  });
});

describe('retention labels', () => {
  it('picks the coarsest unit that divides evenly', () => {
    expect(retentionLabel(90 * DAY)).toBe('90d');
    expect(retentionLabel(12 * HOUR)).toBe('12h');
    expect(retentionLabel(30 * MIN)).toBe('30m');
    expect(retentionLabel(90 * MIN)).toBe('90m');
  });

  it('declines Russian nouns correctly', () => {
    expect(retentionHuman(1 * DAY)).toBe('1 день');
    expect(retentionHuman(2 * DAY)).toBe('2 дня');
    expect(retentionHuman(5 * DAY)).toBe('5 дней');
    expect(retentionHuman(11 * DAY)).toBe('11 дней');
    expect(retentionHuman(21 * DAY)).toBe('21 день');
    expect(retentionHuman(2 * HOUR)).toBe('2 часа');
    expect(retentionHuman(1 * MIN)).toBe('1 минуту');
    expect(retentionHuman(30 * MIN)).toBe('30 минут');
  });
});

describe('sweep interval', () => {
  it('scales with the window so short windows stay accurate', () => {
    // Часовой тик при окне в 30 минут означал бы, что сообщения живут
    // до полутора часов вместо получаса.
    expect(tickMs(30 * MIN)).toBe(450 * 1000);
  });

  it('never sweeps more often than every 30 seconds', () => {
    expect(tickMs(1 * MIN)).toBe(30 * 1000);
  });

  it('never sweeps less often than hourly', () => {
    expect(tickMs(90 * DAY)).toBe(HOUR);
  });
});
