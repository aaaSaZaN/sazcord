// Таб «Приватность»: тумблер «полностью удалять мои сообщения» + выгрузка
// данных пользователя в JSON (право по ст. 14 152-ФЗ). Ссылка на
// политику обработки ПДн показывается, только если на сервере включён
// compliance-модуль (config.privacy.enabled).

import { useEffect, useState } from 'react';
import { Trash2, Download, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';
import { ToggleRow } from './shared';

export function PrivacyTab() {
  const { auth, updateUser } = useAuth();
  const toast = useToast();
  const user = auth?.user;
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Серверная конфигурация compliance-модуля. Запрашиваем один раз —
  // по `enabled` решаем, показывать ли ссылку на политику.
  const [privacyEnabled, setPrivacyEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (!cancelled) setPrivacyEnabled(!!cfg?.privacy?.enabled);
      })
      .catch(() => {
        /* серверу плохо — оставим выключенным */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setHide = async (next: boolean) => {
    setSaving(true);
    try {
      const { user: u } = await api.updateMe(auth.token, { hideOnDelete: !!next });
      updateUser(u);
    } catch (e: any) {
      toast.error(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  // Скачивание JSON-выгрузки. Сервер уже отдаёт правильный
  // Content-Disposition, нам остаётся только превратить blob в файл.
  const onExport = async () => {
    if (!auth?.token) return;
    setExporting(true);
    try {
      const blob = await api.dataExport(auth.token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sazcord-data-${user?.username || 'me'}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Данные выгружены');
    } catch (e: any) {
      toast.error(e.message || 'Не удалось скачать данные');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="space-y-4">
      <ToggleRow
        title="Полностью удалять мои сообщения"
        description="При удалении сообщение полностью исчезает у обеих сторон. Иначе остаётся плашка «сообщение удалено»."
        icon={<Trash2 size={16} />}
        checked={!!user?.hideOnDelete}
        onChange={setHide}
        disabled={saving}
      />

      <div className="h-px bg-border" />

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Мои данные</div>
        <div className="rounded-lg border border-border bg-bg-2 p-3 space-y-3">
          <div>
            <div className="text-sm font-medium">Скачать мои данные</div>
            <p className="text-xs text-slate-400 mt-1">
              JSON со всеми данными вашей учётной записи: профиль, отправленные сообщения, группы,
              выпущенные приглашения, мьюты. Право, предусмотренное ст. 14 152-ФЗ.
            </p>
          </div>
          <button
            type="button"
            className="h-9 px-3 rounded-lg bg-bg-3 hover:bg-bg-4 border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
            onClick={onExport}
            disabled={exporting}
          >
            <Download size={14} />
            {exporting ? 'Готовим…' : 'Скачать (JSON)'}
          </button>
          {privacyEnabled && (
            <div className="text-xs">
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline inline-flex items-center gap-1"
              >
                Политика обработки персональных данных
                <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
