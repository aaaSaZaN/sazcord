import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

type ClientConfig = {
  maxUploadBytes: number;
  // 'local' — все видят всех; 'private' — только друзья и соучастники групп.
  socialMode: 'local' | 'private';
  // INVITE_WHO_CAN_CREATE=members — вкладка «Приглашения» видна не только админу.
  invitesByMembers: boolean;
};

// Дефолты на случай, если сервер не ответил. Совпадают с серверными:
// 500 МБ, local-режим, приглашения только от админов.
const DEFAULTS: ClientConfig = {
  maxUploadBytes: 500 * 1024 * 1024,
  socialMode: 'local',
  invitesByMembers: false,
};

const ConfigContext = createContext<ClientConfig>(DEFAULTS);

export function ConfigProvider({ children }) {
  const [cfg, setCfg] = useState(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((r) => {
        if (cancelled || !r) return;
        setCfg({ ...DEFAULTS, ...r });
      })
      .catch(() => {
        /* используем дефолты */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ConfigContext.Provider value={cfg}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}
