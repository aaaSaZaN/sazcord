// Renderer-скрипт picker'а. Работает внутри picker.html, без Node API —
// только то, что preload (picker-preload.js) положил в window.pickerAPI.
//
// Логика:
//   - При загрузке: читаем bootstrap (wantsAudio, platform), берём список
//     источников, фильтруем по выбранной вкладке (screens/windows),
//     рендерим грид. Один первый источник получает фокус как preselected.
//   - Выбор: клик по карточке — выделяет, double-click = подтверждение.
//   - Кнопки: «Поделиться» и «Отмена», плюс Esc/×.
//   - Auto-refresh раз в 2 секунды: list окон обновляется (новое окно
//     открыли — оно появилось в picker'е), но текущее выделение сохраняем
//     по id, если оно ещё в списке.
//   - Audio toggle: на macOS отключаем (loopback там не работает),
//     на Linux — предупреждение, на Windows активный.

(function () {
  const api = window.pickerAPI;
  const boot = api.bootstrap();

  let activeKind = 'screen'; // 'screen' | 'window'
  let sources = [];
  let selectedId = null;
  let refreshTimer = null;
  let confirmInFlight = false;

  const els = {
    grid: document.getElementById('grid'),
    empty: document.getElementById('empty'),
    tabs: Array.from(document.querySelectorAll('.tab')),
    audioRow: document.getElementById('audio-row'),
    audioInput: document.getElementById('audio-input'),
    audioHint: document.getElementById('audio-hint'),
    btnConfirm: document.getElementById('btn-confirm'),
    btnCancel: document.getElementById('btn-cancel'),
    btnCancelX: document.getElementById('btn-cancel-x'),
  };

  // Audio toggle UX.
  //
  //   wantsAudio=false   — юзер в ScreenQualityModal не включал звук,
  //                        не предлагаем менять решение здесь, скрываем
  //                        строку совсем (меньше шума, понятнее UX).
  //   wantsAudio=true    — звук был запрошен; галочка по умолчанию
  //                        выставлена, но юзер может снять прямо в
  //                        picker'е. На macOS и Linux отключаем —
  //                        loopback там не поддерживается Electron'ом.
  if (!boot.wantsAudio) {
    els.audioRow.style.display = 'none';
    els.audioInput.checked = false;
  } else if (boot.platform === 'darwin') {
    els.audioRow.classList.add('disabled');
    els.audioInput.checked = false;
    els.audioInput.disabled = true;
    els.audioHint.textContent = '— на macOS звук системы недоступен';
  } else if (boot.platform === 'linux') {
    // Electron умеет audio:'loopback' только на Windows. Если отдать его
    // на Linux, Chromium отклоняет ВЕСЬ запрос getDisplayMedia и
    // демонстрация не стартует вовсе. Поэтому чекбокс выключен.
    els.audioRow.classList.add('disabled');
    els.audioInput.checked = false;
    els.audioInput.disabled = true;
    els.audioHint.textContent = '— на Linux системный звук недоступен';
  } else {
    els.audioInput.checked = true;
    els.audioHint.textContent = '— общий микшер всех приложений';
  }

  function setKind(kind) {
    if (kind !== 'screen' && kind !== 'window') return;
    activeKind = kind;
    for (const tab of els.tabs) {
      tab.classList.toggle('active', tab.dataset.kind === kind);
    }
    // При смене вкладки селект сбрасываем, если выбранный источник
    // не относится к новой вкладке.
    const sel = sources.find((s) => s.id === selectedId);
    if (!sel || sel.kind !== kind) {
      selectedId = null;
    }
    render();
  }

  for (const tab of els.tabs) {
    tab.addEventListener('click', () => setKind(tab.dataset.kind));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  function render() {
    const filtered = sources.filter((s) => s.kind === activeKind);

    if (!filtered.length) {
      els.grid.innerHTML = '';
      els.empty.hidden = false;
      if (boot.platform === 'darwin') {
        els.empty.innerHTML = `
          <div style="max-width:380px;margin:0 auto;line-height:1.5;">
            <p style="margin-bottom:12px;">На macOS для демонстрации экрана требуется разрешение на <strong>Запись экрана</strong> (Screen Recording).</p>
            <p style="color:var(--text-3);font-size:12px;margin-bottom:16px;">Включите тумблер напротив <strong>Sazcord</strong> в Системных настройках Mac.</p>
            <button type="button" class="btn btn-primary" id="btn-open-settings" style="display:inline-block;padding:8px 16px;">
              Открыть Настройки Mac
            </button>
          </div>
        `;
        const btnSettings = document.getElementById('btn-open-settings');
        if (btnSettings) {
          btnSettings.addEventListener('click', () => api.openSecuritySettings());
        }
      } else {
        els.empty.textContent =
          activeKind === 'screen'
            ? 'Экраны не найдены.'
            : 'Открытые окна не найдены. Попробуйте развернуть нужное приложение.';
      }
      els.btnConfirm.disabled = true;
      return;
    }
    els.empty.hidden = true;

    // Авто-выбор первого источника, чтобы Поделиться сразу было активной.
    if (!selectedId || !filtered.find((s) => s.id === selectedId)) {
      selectedId = filtered[0].id;
    }

    const html = filtered
      .map((s) => {
        const isSelected = s.id === selectedId;
        const safeName = escapeHtml(s.name || '');
        const icon = s.appIcon
          ? `<img class="icon" src="${s.appIcon}" alt="" />`
          : '';
        const thumb = s.thumbnail
          ? `<img src="${s.thumbnail}" alt="" />`
          : '';
        return (
          `<button type="button" class="card${isSelected ? ' selected' : ''}" ` +
          `data-id="${escapeHtml(s.id)}" title="${safeName}">` +
          `<div class="thumb">${thumb}</div>` +
          `<div class="meta">${icon}<span class="name">${safeName}</span></div>` +
          `</button>`
        );
      })
      .join('');
    els.grid.innerHTML = html;

    // Делегированные клики: select + double-click confirm.
    for (const card of els.grid.querySelectorAll('.card')) {
      card.addEventListener('click', () => {
        selectedId = card.dataset.id;
        for (const c of els.grid.querySelectorAll('.card')) {
          c.classList.toggle('selected', c.dataset.id === selectedId);
        }
        els.btnConfirm.disabled = false;
      });
      card.addEventListener('dblclick', () => {
        selectedId = card.dataset.id;
        confirm();
      });
    }

    els.btnConfirm.disabled = !selectedId;
  }

  async function refreshSources() {
    try {
      const list = await api.getSources();
      // Sanity check: пустой массив бывает в момент стартовой инициализации
      // — не затираем уже отрисованный список преждевременно.
      if (!Array.isArray(list)) return;
      sources = list;
      render();
    } catch (err) {
      // Если main процесс уже сложил handlers (closed) — getSources
      // отвалится. Просто перестаём дёргать.
      console.warn('picker: getSources failed', err);
      stopAutoRefresh();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    // Первый рефреш сразу, потом каждые 2 секунды.
    void refreshSources();
    // На Linux НЕ поллим. С Wayland/PipeWire каждый desktopCapturer
    // .getSources() идёт через xdg-desktop-portal: опрос раз в 2 секунды
    // либо дёргает системный диалог по кругу, либо выдаёт новые id для тех
    // же источников — выбранный юзером id «протухает» ещё до подтверждения,
    // и демонстрация не стартует. Список берём один раз.
    if (boot.platform === 'linux') return;
    refreshTimer = setInterval(refreshSources, 2000);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function confirm() {
    if (confirmInFlight) return;
    if (!selectedId) return;
    confirmInFlight = true;
    stopAutoRefresh();
    try {
      await api.select(selectedId, !!els.audioInput.checked);
    } catch (err) {
      console.warn('picker: select failed', err);
      confirmInFlight = false;
    }
  }

  async function cancel() {
    stopAutoRefresh();
    try {
      await api.cancel();
    } catch {
      /* main мог уже закрыть picker — ок */
    }
  }

  els.btnConfirm.addEventListener('click', confirm);
  els.btnCancel.addEventListener('click', cancel);
  els.btnCancelX.addEventListener('click', cancel);

  // Глобальные шорткаты: Esc — отмена, Enter — подтвердить (если есть выбор).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && !els.btnConfirm.disabled) {
      e.preventDefault();
      confirm();
    }
  });

  startAutoRefresh();
})();
