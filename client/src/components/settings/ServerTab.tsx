// Таб «Сервер» (только админам): базовые показатели инстанса.
//
// Заготовка. Показывает то, что сервер отдаёт по GET /api/admin/stats —
// то есть цифры, стоящие один индексный запрос или системный вызов.
// Отдельного логина нет: вкладка и эндпоинт закрыты той же авторизацией,
// что и всё остальное (см. server/src/admin.js).
//
// Оформление намеренно плоское — список «подпись → значение», как в
// соседних вкладках. Ни графиков, ни карточек: истории показателей
// сервер не хранит, а рисовать графики по одной точке нечестно.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';
import type { AdminStats } from '../../types';

export function ServerTab() {
  const { auth } = useAuth();
  const toast = useToast();
  const token = auth?.token;
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setStats(await api.adminStats(token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось получить статистику');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !stats) {
    return <div className="text-sm text-slate-500">Загрузка…</div>;
  }
  if (!stats) {
    return (
      <div className="flex flex-col gap-3 items-start">
        <div className="text-sm text-slate-500">Данные недоступны.</div>
        <RefreshButton onClick={refresh} busy={loading} />
      </div>
    );
  }

  const { server, host, process: proc, storage, counts } = stats;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Сервер">
        <Row label="Версия" value={server.version} />
        <Row label="Время работы" value={formatUptime(server.uptimeSec)} />
        <Row label="Node" value={server.node} />
        <Row label="Платформа" value={server.platform} />
        <Row
          label="Режим видимости"
          value={
            server.socialMode === 'private' ? 'private — друзья и группы' : 'local — все видят всех'
          }
        />
        <Row label="Хранение истории" value={server.retention} />
      </Section>

      <Section title="Хост">
        <Row
          label="Средняя нагрузка"
          // На Windows loadavg не существует, сервер шлёт null. Прочерк
          // честнее, чем нули, которые выглядят как «простаивает».
          value={host.loadavg ? host.loadavg.join('  ') : '—'}
        />
        <Row label="Ядер" value={String(host.cpus)} />
        <Row
          label="Память"
          value={`${bytes(host.memTotalBytes - host.memFreeBytes)} из ${bytes(host.memTotalBytes)}`}
        />
        <Row label="Процесс (RSS)" value={bytes(proc.rssBytes)} />
        <Row label="Процесс (heap)" value={bytes(proc.heapUsedBytes)} />
      </Section>

      <Section title="Хранилище">
        <Row
          label="Свободно на диске"
          value={storage.diskFreeBytes == null ? '—' : bytes(storage.diskFreeBytes)}
        />
        <Row label="База данных" value={bytes(storage.dbBytes)} />
        <Row
          label="Вложения"
          value={
            storage.quotaTotalBytes
              ? `${bytes(storage.attachmentBytes)} из ${bytes(storage.quotaTotalBytes)}`
              : `${bytes(storage.attachmentBytes)} (без лимита)`
          }
        />
        <Row
          label="Квота на пользователя"
          value={storage.quotaPerUserBytes ? bytes(storage.quotaPerUserBytes) : 'не задана'}
        />
        <Row
          label="Стоп при остатке"
          value={storage.minFreeBytes ? bytes(storage.minFreeBytes) : 'не задан'}
        />
      </Section>

      <Section title="Данные">
        <Row label="Пользователей" value={String(counts.users)} />
        {counts.usersDeleted > 0 && (
          <Row label="Удалённых аккаунтов" value={String(counts.usersDeleted)} />
        )}
        <Row
          label="Сейчас онлайн"
          value={`${counts.online}${counts.away ? ` (${counts.away} отошли)` : ''}`}
        />
        <Row label="Сообщений" value={String(counts.messages)} />
        <Row label="Вложений" value={String(counts.attachments)} />
        <Row label="Групп" value={String(counts.groups)} />
        <Row label="Подписок на push" value={String(counts.pushSubscriptions)} />
      </Section>

      <RefreshButton onClick={refresh} busy={loading} />
    </div>
  );
}

function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      className="btn-ghost h-9 px-3 text-sm self-start flex items-center gap-2 disabled:opacity-50"
      onClick={onClick}
      disabled={busy}
    >
      <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
      Обновить
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="text-xs uppercase tracking-wider text-slate-500">{title}</div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border/40 last:border-b-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm tabular-nums text-slate-200 select-text text-right">{value}</span>
    </div>
  );
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${m} мин`;
}
