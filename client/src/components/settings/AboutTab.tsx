// Таб «О приложении». Единственное место, где живут выходные данные:
// название, версия текущей оболочки, лицензия и ссылка на исходники.
// AGPL-3.0 требует, чтобы у пользователя сетевого сервиса была
// возможность добраться до кода — эта ссылка и есть выполнение §13.

import { ExternalLink, Scale, Tag } from 'lucide-react';
import { useI18n } from '../../i18n';
import { currentVersion } from '../../utils/updates';

const REPO_URL = 'https://github.com/aaaSaZaN/sazcord';

export function AboutTab() {
  const { t } = useI18n();
  const version = currentVersion();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="w-14 h-14 rounded-2xl" />
        <div>
          <div className="text-lg font-semibold">Sazcord</div>
          <div className="text-xs text-slate-500">{t('about.tagline')}</div>
        </div>
      </div>

      <div className="card divide-y divide-border">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Tag size={16} className="opacity-70 shrink-0" />
          <div className="text-sm">{t('about.version')}</div>
          <div className="ml-auto text-sm tabular-nums text-slate-400">{version || '—'}</div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Scale size={16} className="opacity-70 shrink-0" />
          <div className="text-sm">{t('about.license')}</div>
          <div className="ml-auto text-sm text-slate-400">AGPL-3.0-or-later</div>
        </div>
        <a
          className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-3 transition-colors"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink size={16} className="opacity-70 shrink-0" />
          <div className="text-sm">{t('about.source')}</div>
          <div className="ml-auto text-xs text-slate-500 truncate">{REPO_URL}</div>
        </a>
      </div>

      <p className="text-xs text-slate-500">{t('about.note')}</p>
    </div>
  );
}
