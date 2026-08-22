// Русский словарь — язык оригинала. Английский (./en.ts) может отставать,
// недостающие ключи он добирает отсюда.
//
// Покрыты экраны, через которые проходит новый человек (вход,
// регистрация, приглашение), оболочка настроек и разделы, добавленные в
// этой ветке. Остальной интерфейс пока живёт строками в компонентах —
// перевод продолжается.

export const ru: Record<string, string> = {
  // --- Общее ---------------------------------------------------------------
  'common.loading': 'Загрузка…',
  'common.close': 'Закрыть',
  'common.cancel': 'Отмена',
  'common.save': 'Сохранить',
  'common.refresh': 'Обновить',
  'common.login': 'Войти',
  'common.username': 'Имя пользователя',
  'common.password': 'Пароль',
  'common.passwordRepeat': 'Повторите пароль',
  'common.deletedUser': 'Удалённый аккаунт',
  'common.notSet': 'не задана',

  // --- Вход ----------------------------------------------------------------
  'login.title': 'Вход в Sazcord',
  'login.subtitle': 'Войди, чтобы увидеть всех и начать общение.',
  'login.submitting': 'Входим…',
  'login.error': 'Ошибка входа',
  'login.noAccount': 'Нет аккаунта?',
  'login.register': 'Зарегистрироваться',

  // --- Регистрация ---------------------------------------------------------
  'register.title': 'Регистрация',
  'register.rules': '3–24 символа: буквы, цифры, {chars}',
  'register.repeatPassword': 'Повторите пароль',
  'register.submit': 'Создать аккаунт',
  'register.submitting': 'Создаём…',
  'register.error': 'Ошибка регистрации',
  'register.passwordMismatch': 'Пароли не совпадают',
  'register.consentRequired': 'Нужно подтвердить согласие на обработку персональных данных',
  'register.inviteLabel': 'Код приглашения',
  'register.invitePlaceholder': 'Запросите у администратора',
  'register.inviteHint': 'На этом сервере регистрация только по приглашению.',
  'register.bootstrapHint': 'Сервер пустой — этот аккаунт станет первым и получит права администратора. Заводи его сразу, пока адрес не узнали посторонние.',
  'register.haveAccount': 'Уже есть аккаунт?',
  'register.closedTitle': 'Регистрация закрыта',
  'register.closedText':
    'На этом сервере регистрация новых пользователей отключена. Обратитесь к администратору.',
  'register.consent': 'Я ознакомлен(а) и согласен(на) с',
  'register.consentLink': 'политикой обработки персональных данных',
  'register.privacyPolicy': 'Политика конфиденциальности',

  // --- Приглашение ---------------------------------------------------------
  'invite.checking': 'Проверяем приглашение…',
  'invite.title': 'Вас пригласили в Sazcord',
  'invite.by': 'Приглашение от {name}',
  'invite.valid': 'Приглашение действительно',
  'invite.displayName': 'Отображаемое имя',
  'invite.bio': 'О себе',
  'invite.optional': 'Необязательно',
  'invite.submit': 'Принять приглашение',
  'invite.invalidTitle': 'Приглашение недействительно',
  'invite.invalidText':
    'Ссылка отозвана, просрочена или уже использована. Попросите новую у того, кто вас позвал.',

  // --- Друзья --------------------------------------------------------------
  'friends.title': 'Друзья',
  'friends.add': 'Добавить в друзья',
  'friends.exactNameHint': 'Нужно точное имя — поиска по части имени на этом сервере нет.',
  'friends.incoming': 'Заявки к вам',
  'friends.outgoing': 'Отправленные',
  'friends.list': 'Друзья',
  'friends.accept': 'Принять',
  'friends.reject': 'Отклонить',
  'friends.cancel': 'Отменить заявку',
  'friends.remove': 'Удалить из друзей',
  'friends.empty':
    'Пока никого. На этом сервере вы видите только друзей и тех, с кем состоите в одной группе — добавьте кого-нибудь по имени пользователя.',
  'friends.requestSent': 'Заявка отправлена',
  'friends.nowFriends': 'Теперь вы друзья',
  'friends.requestAccepted': 'Заявка принята',
  'friends.requestRejected': 'Заявка отклонена',
  'friends.requestCancelled': 'Заявка отменена',
  'friends.removed': 'Удалено из друзей',
  'friends.addFailed': 'Не удалось отправить заявку',
  'friends.acceptFailed': 'Не удалось принять заявку',
  'friends.removeFailed': 'Не получилось',

  // --- Настройки: оболочка -------------------------------------------------
  'settings.title': 'Настройки',
  'settings.tab.profile': 'Профиль',
  'settings.tab.password': 'Пароль',
  'settings.tab.audio': 'Звук',
  'settings.tab.notifications': 'Уведомления',
  'settings.tab.keybinds': 'Горячие клавиши',
  'settings.tab.app': 'Приложение',
  'settings.tab.privacy': 'Приватность',
  'settings.tab.updates': 'Обновления',
  'settings.tab.invites': 'Приглашения',
  'settings.tab.server': 'Сервер',
  'settings.tab.about': 'О приложении',
  'about.tagline': 'Свой сервер, свои правила',
  'about.version': 'Версия',
  'about.license': 'Лицензия',
  'about.source': 'Исходный код',
  'about.note': 'Свободное ПО под GNU AGPL v3. Если вы запускаете изменённую версию как сетевой сервис, вы обязаны открыть её исходники пользователям.',
  'settings.language': 'Язык',
};
