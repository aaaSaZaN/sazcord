// Главный компонент окна настроек: модалка со списком табов слева и
// контентом справа. Сами табы лежат в собственных файлах
// (см. ./ProfileTab, ./PasswordTab, …) — этот файл только роутит между
// ними и решает, какие пункты вообще показывать (admin/desktop only).

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AppWindow,
  Bell,
  Headphones,
  KeyRound,
  Keyboard,
  Languages,
  Lock,
  Gauge,
  Info,
  RefreshCw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { modalVariants, overlayVariants, reducedVariants } from '../../utils/motion';
import { useAuth } from '../../context/AuthContext';
import { useConfig } from '../../context/ConfigContext';
import { useI18n } from '../../i18n';
import { isDesktop } from '../../utils/desktop';
import { ProfileTab } from './ProfileTab';
import { PasswordTab } from './PasswordTab';
import { AudioTab } from './AudioTab';
import { NotificationsTab } from './NotificationsTab';
import { KeybindsTab } from './KeybindsTab';
import { PrivacyTab } from './PrivacyTab';
import { InvitesTab } from './InvitesTab';
import { AppTab } from './AppTab';
import { UpdatesTab } from './UpdatesTab';
import { ServerTab } from './ServerTab';
import { AboutTab } from './AboutTab';

// adminOnly — видна только админам; inviterOnly — тому, кто может
// выпускать приглашения; desktopOnly — только в Electron-обёртке.
// Логика фильтрации в render'е панели (см. TABS). Подписи берутся из
// словаря по ключу `settings.tab.<id>`.
const ALL_TABS = [
  { id: 'profile', icon: User },
  { id: 'password', icon: Lock },
  { id: 'audio', icon: Headphones },
  { id: 'notifications', icon: Bell },
  { id: 'keybinds', icon: Keyboard, desktopOnly: true },
  { id: 'app', icon: AppWindow, desktopOnly: true },
  { id: 'privacy', icon: ShieldCheck },
  // Виден везде: у APK и веба свои каналы обновления, см. UpdatesTab.
  { id: 'updates', icon: RefreshCw },
  // Не adminOnly: при INVITE_WHO_CAN_CREATE=members вкладка нужна и
  // обычному участнику — иначе цепочка доверия существует только в API.
  { id: 'invites', icon: KeyRound, inviterOnly: true },
  { id: 'server', icon: Gauge, adminOnly: true },
  { id: 'about', icon: Info },
];

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { auth } = useAuth();
  const { t, lang, setLang } = useI18n();
  const isAdmin = !!auth?.user?.isAdmin;
  const { invitesByMembers } = useConfig();
  const mayInvite = isAdmin || !!invitesByMembers;
  const desktop = isDesktop();
  const TABS = ALL_TABS.filter((t) => {
    if (t.adminOnly && !isAdmin) return false;
    if (t.inviterOnly && !mayInvite) return false;
    if (t.desktopOnly && !desktop) return false;
    return true;
  });
  const [tab, setTab] = useState('profile');
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings"
          className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
          onClick={onClose}
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="card w-full max-w-3xl h-[min(640px,90vh)] overflow-hidden flex flex-col md:flex-row"
            onClick={(e) => e.stopPropagation()}
            variants={panelV}
          >
            {/* Sidebar */}
            <aside className="md:w-56 shrink-0 bg-bg-2 md:border-r border-b md:border-b-0 border-border p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
              <div className="hidden md:block text-xs uppercase tracking-wider text-slate-500 px-2 mb-2">
                {t('settings.title')}
              </div>
              {TABS.map((tab_) => {
                const Icon = tab_.icon;
                const active = tab === tab_.id;
                return (
                  <button
                    key={tab_.id}
                    onClick={() => setTab(tab_.id)}
                    type="button"
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors
                  ${active ? 'bg-accent text-white' : 'text-slate-200 hover:bg-bg-3'}`}
                  >
                    <Icon size={16} />
                    <span>{t(`settings.tab.${tab_.id}`)}</span>
                  </button>
                );
              })}
              {/* Переключатель языка живёт в подвале списка табов, а не
                  отдельным пунктом: менять его нужно раз в жизни, а искать
                  его люди будут именно в настройках. */}
              <label className="md:mt-auto flex items-center gap-2 px-2 py-1 text-xs text-slate-500 shrink-0">
                <Languages size={14} />
                <select
                  className="bg-transparent text-slate-200 text-xs outline-none"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as 'ru' | 'en')}
                  aria-label={t('settings.language')}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
            </aside>

            {/* Content */}
            {/* min-h-0 обязателен на обоих flex-детях: в колонке flex-item
                без него не сжимается ниже контента (min-height:auto),
                контейнер с overflow-hidden обрезает хвост — и на телефоне
                настройки невозможно прокрутить. */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="text-base font-semibold">{t(`settings.tab.${tab}`)}</div>
                <button className="btn-ghost" onClick={onClose} title={t('common.close')}>
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                {tab === 'profile' && <ProfileTab />}
                {tab === 'password' && <PasswordTab />}
                {tab === 'audio' && <AudioTab />}
                {tab === 'notifications' && <NotificationsTab />}
                {tab === 'keybinds' && desktop && <KeybindsTab />}
                {tab === 'app' && desktop && <AppTab />}
                {tab === 'privacy' && <PrivacyTab />}
                {tab === 'updates' && <UpdatesTab />}
                {tab === 'invites' && mayInvite && <InvitesTab />}
                {tab === 'server' && isAdmin && <ServerTab />}
                {tab === 'about' && <AboutTab />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
