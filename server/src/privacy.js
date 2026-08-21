// Privacy / 152-ФЗ compliance helpers.
//
// Генерирует страницу «Политика обработки персональных данных» и список
// обязательных полей для уведомления оператора. Сама страница рендерится
// из ENV-переменных, чтобы не зашивать в код имя/контакты конкретного
// самохостера. Если необходимый минимум не задан — модуль выключен и
// клиенту это сообщает (`enabled=false`); тогда чекбокс согласия в UI не
// показывается, страница `/privacy` отдаёт 404.
//
// Поддерживаемые переменные:
//   PRIVACY_OPERATOR_NAME      — ФИО физлица или название организации.
//   PRIVACY_OPERATOR_EMAIL     — контакт для запросов субъектов ПДн.
//   PRIVACY_OPERATOR_ADDRESS   — почтовый адрес (опционально).
//   PRIVACY_LAST_UPDATED       — дата последней редакции, формат YYYY-MM-DD
//                                (опц.; иначе возьмём текущую).
//   REQUIRE_PRIVACY_CONSENT    — '1'/'true' — требовать чекбокс на регистрации.

import { retentionHuman } from './retention.js';

function envStr(name) {
  const v = (process.env[name] || '').trim();
  return v || null;
}

function envBool(name) {
  const v = (process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function privacyConfig() {
  const name = envStr('PRIVACY_OPERATOR_NAME');
  const email = envStr('PRIVACY_OPERATOR_EMAIL');
  const address = envStr('PRIVACY_OPERATOR_ADDRESS');
  const lastUpdated = envStr('PRIVACY_LAST_UPDATED');
  // Минимум для compliance — оператор и контакт. Без них рендерить
  // страницу бессмысленно: пользователь не узнает, кому слать запросы.
  const enabled = !!(name && email);
  return {
    enabled,
    operatorName: name,
    operatorEmail: email,
    operatorAddress: address,
    lastUpdated: lastUpdated || new Date().toISOString().slice(0, 10),
    retentionWindow: retentionHuman(),
    requireConsent: enabled && envBool('REQUIRE_PRIVACY_CONSENT'),
  };
}

// Чтобы не тащить шаблонизатор — собираем HTML вручную. Текст составлен
// в духе 152-ФЗ: оператор, перечень собираемых данных, цели, основания,
// сроки, права субъекта. Это шаблон по умолчанию — самохостер может
// заменить страницу на свою через nginx (раздаёт `/privacy` со своего
// статического файла приоритетнее, чем proxy_pass на node).
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function privacyHtml() {
  const cfg = privacyConfig();
  if (!cfg.enabled) return null;
  const name = escapeHtml(cfg.operatorName);
  const email = escapeHtml(cfg.operatorEmail);
  const address = cfg.operatorAddress ? escapeHtml(cfg.operatorAddress) : '';
  const retentionText = cfg.retentionWindow;
  const updated = escapeHtml(cfg.lastUpdated);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Политика обработки персональных данных — ${name}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#070a1a; color:#e6e8eb; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         max-width:760px; margin:0 auto; padding:32px 20px 64px; line-height:1.55; }
  h1,h2 { color:#fff; line-height:1.2; }
  h1 { font-size:1.6rem; margin-bottom:.25rem; }
  h2 { font-size:1.15rem; margin-top:2rem; }
  p,li { color:#c8ccd2; }
  a { color:#60a5fa; }
  code { background:#1a1d22; padding:1px 6px; border-radius:4px; font-size:.9em; }
  .muted { color:#7c828a; font-size:.9rem; }
  ul { padding-left:1.2rem; }
</style>
</head>
<body>
<h1>Политика обработки персональных данных</h1>
<p class="muted">Редакция от ${updated}</p>

<h2>1. Оператор</h2>
<p>Оператором персональных данных в смысле Федерального закона
№ 152-ФЗ «О персональных данных» является:</p>
<ul>
  <li><b>${name}</b></li>
  <li>Контактный e-mail: <a href="mailto:${email}">${email}</a></li>
  ${address ? `<li>Почтовый адрес: ${address}</li>` : ''}
</ul>

<h2>2. Какие данные мы обрабатываем</h2>
<p>При использовании сервиса собираются и хранятся следующие данные:</p>
<ul>
  <li>имя пользователя (логин), отображаемое имя, аватар (если загружены);</li>
  <li>хеш пароля (исходный пароль не хранится и не восстановим);</li>
  <li>содержимое сообщений, голосовых записей и вложений, отправленных через сервис;</li>
  <li>метаданные звонков и сессий: длительность, время начала/окончания, идентификаторы участников;</li>
  <li>технические данные: IP-адрес и заголовок User-Agent в логах веб-сервера.</li>
</ul>
<p>Сервис <b>не использует</b> внешние системы аналитики (Google Analytics, Yandex Metrika и т.&nbsp;п.)
и <b>не передаёт</b> персональные данные третьим лицам.</p>

<h2>3. Цели обработки</h2>
<ul>
  <li>обеспечение работы учётной записи пользователя (вход, аутентификация);</li>
  <li>обмен сообщениями и звонками между зарегистрированными пользователями;</li>
  <li>защита сервиса от несанкционированного доступа и злоупотреблений (rate limiting, журналы доступа).</li>
</ul>

<h2>4. Правовые основания</h2>
<ul>
  <li>согласие субъекта персональных данных, выражаемое при регистрации;</li>
  <li>необходимость исполнения договора об оказании услуг связи (использование мессенджера).</li>
</ul>

<h2>5. Срок хранения</h2>
<p>Сообщения и приложенные файлы автоматически удаляются по истечении
<b>${retentionText}</b> с момента отправки. Данные учётной записи хранятся до
удаления аккаунта пользователем. После удаления аккаунта профиль
помечается как удалённый, история сообщений сохраняется в течение того же
ретенционного срока, после чего удаляется фоновой задачей.</p>

<h2>6. Права субъекта</h2>
<p>В соответствии со ст. 14 152-ФЗ пользователь вправе:</p>
<ul>
  <li>получить сведения об обработке своих данных, направив запрос на адрес оператора;</li>
  <li>скачать собственные данные в машиночитаемом формате — кнопка
      «Скачать мои данные» в настройках профиля или запрос
      <code>GET /api/me/data-export</code>;</li>
  <li>удалить аккаунт — кнопка в настройках профиля; при этом сообщения,
      отправленные другим пользователям, могут оставаться у получателей до
      истечения срока хранения;</li>
  <li>отозвать согласие на обработку данных — фактически реализуется
      удалением аккаунта.</li>
</ul>

<h2>7. Защита данных</h2>
<ul>
  <li>пароли хранятся в виде хеша (bcrypt);</li>
  <li>транспортный уровень — HTTPS (TLS) при наличии настроенного reverse-proxy;</li>
  <li>сессионные токены имеют ограниченный срок жизни;</li>
  <li>применяются базовые меры защиты: helmet/CSP, rate-limit на формах
      входа, проверка типов загружаемых файлов по сигнатуре.</li>
</ul>

<h2>8. Контакты для запросов</h2>
<p>Любые запросы по обработке персональных данных, включая отзыв согласия,
направляйте на <a href="mailto:${email}">${email}</a>.</p>

<p class="muted">
  Настоящая политика сгенерирована автоматически на основании конфигурации
  сервера. Для изменения условий обновите переменные окружения или замените
  страницу <code>/privacy</code> в настройках веб-сервера.
</p>
</body>
</html>`;
}
