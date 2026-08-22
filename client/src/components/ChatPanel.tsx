import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  Video,
  ArrowLeft,
  Send,
  Mic,
  Pencil,
  Trash2,
  Paperclip,
  Users as UsersIcon,
  Settings as SettingsIcon,
  X,
  File as FileIcon,
  Smile,
  Forward as ForwardIcon,
  Reply as ReplyIcon,
  CheckSquare,
  Upload,
} from 'lucide-react';
import Avatar from './Avatar';
import ContextMenu from './ContextMenu';
import ReactionPicker from './ReactionPicker';
import VoiceRecorder from './VoiceRecorder';
import MessageList from './MessageList';
import {
  getDisplayName,
  getAvatarUrl,
  hasCustomDisplayName,
  formatDuration,
  isDeletedUser,
} from '../utils/user';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} МБ`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} КБ`;
}

function formatLimit(bytes) {
  const mb = Math.round(bytes / 1024 / 1024);
  if (mb < 1024) return `${mb} МБ`;
  return `${(mb / 1024).toFixed(1)} ГБ`;
}

const TYPING_SEND_INTERVAL_MS = 1800;

// Размер встроенного окна звонка хранится в localStorage и переживает
// перезагрузку. Минимум подобран так, чтобы аватарка (112) с её зелёной
// рамкой и панель управления звонком (≈ 80px) оставались полностью
// видимыми, плюс по 20px воздуха сверху-снизу от аватарок (фидбек юзера:
// «уменьшаться оно должно максимум до размера аватарки +20px»).
// Чату при этом гарантируем минимум CALL_CHAT_MIN_HEIGHT, чтобы поле
// ввода и хотя бы пара сообщений были видны.
const CALL_HEIGHT_STORAGE_KEY = 'sazcord.callHeight';
const CALL_BLOCK_MIN_HEIGHT = 240;
const CALL_CHAT_MIN_HEIGHT = 200;
const CALL_HEIGHT_DEFAULT = 360;

export default function ChatPanel({
  peer,
  group,
  messages,
  selfId,
  loading,
  onSend,
  onSendVoice,
  onSendFile,
  onEditMessage,
  onDeleteMessage,
  onRequestForward = null,
  onRejoinCall,
  onCallAudio,
  onCallVideo,
  onBack,
  onShowProfile,
  onShowGroupSettings,
  onShowGroupMemberProfile,
  onTypingChange = null,
  typingUsers = [],
  onStartGroupCall,
  onJoinGroupCall,
  groupCallActive = false,
  inGroupCall = false,
  firstUnreadId,
  maxFileBytes = 500 * 1024 * 1024,
  usersById,
  callSlot = null,
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [menu, setMenu] = useState(null); // { messageId, x, y }
  const [reactionPicker, setReactionPicker] = useState(null); // { messageId, x, y }
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    percent: number;
    loaded: number;
    total: number;
  } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [previewZoom, setPreviewZoom] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  // Сообщение, на которое сейчас отвечаем (preview-бар над composer).
  // null — обычный режим. При отправке кладём replyTo.id в payload и
  // сбрасываем. Esc / крестик в preview закрывают.
  const [replyingTo, setReplyingTo] = useState(null);
  // Режим мульти-выбора сообщений. При активации обычные клики/контекст-
  // меню заменяются на toggle выделения, а внизу появляется bottom-bar
  // с действиями (Переслать N, Отмена). Сделано на Set<number> чтобы
  // быстро было toggle'ить и считать size.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const typingActiveRef = useRef(false);
  // Resizable embedded call. callHeight — высота блока звонка в px.
  // rootRef нужен, чтобы посчитать максимально допустимую высоту с учётом
  // фактической высоты ChatPanel (минус место под чат). callBlockRef
  // указывает на сам блок звонка, его top — точка от которой считается
  // драг.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const callBlockRef = useRef<HTMLDivElement | null>(null);
  const [callHeight, setCallHeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CALL_HEIGHT_STORAGE_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= CALL_BLOCK_MIN_HEIGHT) return n;
      }
    } catch {
      /* */
    }
    return CALL_HEIGHT_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  // Сохраняем высоту блока звонка в localStorage при каждом изменении.
  // Сохраняем в effect, а не в onPointerUp, чтобы клавиатурные изменения
  // высоты (если когда-то добавим) тоже персистились без дубликата кода.
  useEffect(() => {
    try {
      localStorage.setItem(CALL_HEIGHT_STORAGE_KEY, String(callHeight));
    } catch {
      /* */
    }
  }, [callHeight]);
  // Авто-зажим callHeight при ресайзе окна: если окно стало уже/ниже,
  // сохранённая высота могла стать больше, чем доступно (превратило бы
  // чат в 0). Перерасчёт на каждом пересоздании контейнера и при resize.
  useEffect(() => {
    if (!callSlot) return undefined;
    const clamp = () => {
      const root = rootRef.current;
      const block = callBlockRef.current;
      if (!root || !block) return;
      const rootBottom = root.getBoundingClientRect().bottom;
      const blockTop = block.getBoundingClientRect().top;
      const available = rootBottom - blockTop;
      const maxH = Math.max(CALL_BLOCK_MIN_HEIGHT, available - CALL_CHAT_MIN_HEIGHT);
      setCallHeight((prev) => Math.min(prev, maxH));
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [callSlot]);

  const handleCallResizeStart = useCallback(
    (e: React.PointerEvent) => {
      // Только основная кнопка / тач — игнорируем правую/среднюю.
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = callHeight;
      setResizing(true);

      const onMove = (ev: PointerEvent) => {
        const root = rootRef.current;
        const block = callBlockRef.current;
        if (!root || !block) return;
        const rootBottom = root.getBoundingClientRect().bottom;
        const blockTop = block.getBoundingClientRect().top;
        const available = rootBottom - blockTop;
        const maxH = Math.max(CALL_BLOCK_MIN_HEIGHT, available - CALL_CHAT_MIN_HEIGHT);
        const desired = startH + (ev.clientY - startY);
        const next = Math.max(CALL_BLOCK_MIN_HEIGHT, Math.min(maxH, desired));
        setCallHeight(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setResizing(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [callHeight],
  );
  const lastTypingSentAtRef = useRef(0);

  const isGroup = !!group;
  const target = isGroup ? group : peer;
  const { auth } = useAuth();

  // Карта отправителей для отображения аватарки/имени рядом с сообщением
  // в групповом чате. Строится из members + глобального usersById.
  const sendersById = useMemo(() => {
    const map = new Map();
    if (usersById) {
      for (const u of Object.values(usersById) as any[]) map.set(u.id, u);
    }
    if (isGroup && Array.isArray(group?.members)) {
      for (const m of group.members) map.set(m.id, m);
    }
    return map;
  }, [group, isGroup, usersById]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, target?.id]);

  // При смене собеседника сбрасываем редактирование/запись/pending/режим
  // выделения/preview ответа: всё это контекстно для конкретного чата.
  useEffect(() => {
    setEditingId(null);
    setEditDraft('');
    setRecording(false);
    setMenu(null);
    setPendingAttachments([]);
    setReplyingTo(null);
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [target?.id, isGroup]);

  // Toggle одного id в режиме мульти-выбора. Если последний удаляется —
  // автоматически выходим из режима. Этим решаем UX-проблему «забыл выйти
  // из выделения и теперь обычные клики не открывают меню».
  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) {
        // Откладываем выход в setSelectionMode чтобы не делать setState
        // во время другого setState (React не любит).
        queueMicrotask(() => setSelectionMode(false));
      }
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Esc глобально: закрывает preview-бар ответа (если не редактируем) и
  // выходит из режима выделения. Не вешаем на input — там Esc вообще не
  // обрабатывается (textarea без замечательных шорткатов).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (replyingTo) {
        setReplyingTo(null);
        e.stopPropagation();
        return;
      }
      if (selectionMode) {
        exitSelection();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replyingTo, selectionMode, exitSelection]);

  const stopTyping = useCallback(() => {
    if (!typingActiveRef.current) return;
    onTypingChange?.(false);
    typingActiveRef.current = false;
    lastTypingSentAtRef.current = 0;
  }, [onTypingChange]);

  const sendTypingStart = useCallback(() => {
    const now = Date.now();
    if (typingActiveRef.current && now - lastTypingSentAtRef.current < TYPING_SEND_INTERVAL_MS) {
      return;
    }
    onTypingChange?.(true);
    typingActiveRef.current = true;
    lastTypingSentAtRef.current = now;
  }, [onTypingChange]);

  useEffect(
    () => () => {
      stopTyping();
    },
    [stopTyping, target?.id, isGroup],
  );

  if (!target) {
    // Если активен звонок, но чат ещё не выбран — всё равно показываем
    // звонок сверху, чтобы пользователь видел и контролы, и плейсхолдер
    // под ними.
    if (callSlot) {
      return (
        <div className="flex flex-col h-full chat-scroll">
          <div className="flex-1 min-h-[280px] flex flex-col">{callSlot}</div>
          <div className="flex-1 min-h-[200px] grid place-items-center text-slate-500 p-8 text-center">
            <div className="card px-6 py-5 max-w-sm">
              <div className="text-lg mb-1">Выбери собеседника или группу слева</div>
              <div className="text-sm">Чат можно открывать прямо во время звонка.</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full grid place-items-center text-slate-500 p-8 text-center chat-scroll">
        <div className="card px-6 py-5 max-w-sm">
          <div className="text-lg mb-1">Выбери собеседника или группу слева</div>
          <div className="text-sm">Можно писать или звонить любому пользователю.</div>
        </div>
      </div>
    );
  }

  const cancelUpload = () => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
    setUploading(false);
    setUploadProgress(null);
    setSending(false);
  };

  const send = async () => {
    const trimmed = text.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!trimmed && !hasAttachments) || sending || uploading) return;
    const replyToId = replyingTo?.id ?? null;
    setReplyingTo(null);
    setSending(true);
    if (hasAttachments) {
      setUploading(true);
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      try {
        await onSendFile?.(pendingAttachments, {
          caption: trimmed,
          replyToId,
          onProgress: (percent, loaded, total) => {
            setUploadProgress({ percent, loaded, total });
          },
          signal: controller.signal,
        });
        setPendingAttachments([]);
        setText('');
        stopTyping();
      } catch (err: any) {
        // Abort handled
      } finally {
        setUploading(false);
        setUploadProgress(null);
        uploadAbortRef.current = null;
        setSending(false);
      }
    } else {
      try {
        await onSend(trimmed, replyToId);
        setText('');
        stopTyping();
      } finally {
        setSending(false);
      }
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditDraft(m.content);
  };

  const commitEdit = async () => {
    const id = editingId;
    const next = editDraft.trim();
    if (!id || !next) {
      cancelEdit();
      return;
    }
    const existing = messages.find((m) => m.id === id);
    if (existing && next === existing.content) {
      cancelEdit();
      return;
    }
    try {
      await onEditMessage?.(id, next);
    } finally {
      cancelEdit();
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  // Правый клик по сообщению — единое контекстное меню: «Реакция» выводит
  // ReactionPicker в той же точке для чужих; «Ответить»/«Переслать»/
  // «Выделить» всегда; для своих текстовых добавляются «Редактировать» и
  // «Удалить». Для удалённых/системных/звонковых меню не показываем — их
  // нечего пересылать и под ними нет осмысленных действий.
  //
  // В режиме мульти-выбора правый клик НЕ показывает меню, а используется
  // как ещё один способ toggle'нуть выделение (обычный левый клик тоже
  // работает — см. onMessageClick).
  const onMessageContext = (e, m) => {
    if (m.deleted || m.kind === 'call' || m.kind === 'system' || m.kind === 'groupcall') return;
    e.preventDefault();
    if (selectionMode) {
      toggleSelected(m.id);
      return;
    }
    setMenu({ messageId: m.id, x: e.clientX, y: e.clientY });
  };

  // Левый клик по сообщению используется ТОЛЬКО в режиме выделения —
  // иначе он бы конфликтовал со ссылками/реакциями в нормальном режиме.
  const onMessageClick = (e, m) => {
    if (!selectionMode) return;
    if (m.deleted || m.kind === 'call' || m.kind === 'system' || m.kind === 'groupcall') return;
    e.preventDefault();
    toggleSelected(m.id);
  };

  // «Выделить» — вход в режим мульти-выбора с уже отмеченным первым
  // сообщением. Закрывает контекстное меню.
  const startSelectionFrom = (m) => {
    setMenu(null);
    setSelectionMode(true);
    setSelectedIds(new Set([m.id]));
  };

  // «Переслать N сообщений» из bottom-bar. Передаём наверх массив выделенных
  // сообщений (UI там сам решит — открыть ForwardModal со списком).
  const requestForwardSelection = () => {
    if (selectedIds.size === 0) return;
    const list = messages.filter((m) => selectedIds.has(m.id));
    if (list.length === 0) return;
    onRequestForward?.(list.length === 1 ? list[0] : list);
    exitSelection();
  };

  const onPickFile = () => {
    if (!onSendFile || uploading) return;
    fileInputRef.current?.click();
  };

  const addPendingAttachment = (file) => {
    if (file.size > maxFileBytes) {
      onSendFile?.(null, { error: 'too-large', limit: maxFileBytes });
      return;
    }
    setPendingAttachments((prev) => [...prev, file]);
  };

  const removePendingAttachment = (index) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    addPendingAttachment(file);
  };

  const onTextChange = (e) => {
    const next = e.target.value;
    setText(next);
    if (next.trim()) sendTypingStart();
    else stopTyping();
  };

  const dragCounterRef = useRef(0);

  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    try {
      const types = e.dataTransfer?.types;
      if (
        types &&
        (Array.from(types).includes('Files') ||
          (typeof (types as any).contains === 'function' && (types as any).contains('Files')))
      ) {
        setIsDragging(true);
      }
    } catch {
      /* ignore */
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    for (const file of files) {
      addPendingAttachment(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          addPendingAttachment(file);
          e.preventDefault();
        }
      }
    }
  };

  const onAddReaction = async (emoji) => {
    if (!reactionPicker) return;
    const messageId = reactionPicker.messageId;
    const groupId = isGroup ? group?.id : undefined;

    try {
      await api.addReaction(auth?.token, messageId, emoji, groupId);
    } catch (err) {
      console.error('Failed to add reaction:', err);
    }

    setReactionPicker(null);
  };

  const onReactionClick = async (messageId, emoji, hasReacted) => {
    const groupId = isGroup ? group?.id : undefined;
    try {
      await api.addReaction(auth?.token, messageId, emoji, groupId);
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  if (!peer && !group) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-4">
        {onBack && (
          <button className="btn-ghost md:hidden absolute top-4 left-4" onClick={onBack} aria-label="Назад">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="text-base font-medium">Выберите собеседника или группу</div>
      </div>
    );
  }

  const menuMessage = menu ? messages.find((m) => m.id === menu.messageId) : null;
  const reactionMessage = reactionPicker
    ? messages.find((m) => m.id === reactionPicker.messageId)
    : null;

  const displayName = isGroup ? group?.name || 'Группа' : getDisplayName(peer);
  const avatarUrl = isGroup ? group?.avatarPath || null : getAvatarUrl(peer);
  // Удалённому аккаунту нельзя звонить и писать — история остаётся
  // read-only. Сами кнопки скрываем, а поле ввода делаем disabled.
  const peerDeleted = !isGroup && isDeletedUser(peer);
  const typingLabel = (() => {
    if (peerDeleted || typingUsers.length === 0) return null;
    if (!isGroup) return 'печатает…';
    const firstName = getDisplayName(typingUsers[0]);
    const rest = typingUsers.length - 1;
    return rest > 0 ? `${firstName} и ещё ${rest} печатают…` : `${firstName} печатает…`;
  })();
  const subtitle =
    typingLabel ||
    (isGroup
      ? `${group?.members?.length || 0} участ.`
      : peerDeleted
        ? 'аккаунт удалён'
        : (hasCustomDisplayName(peer) ? `@${peer?.username} • ` : '') +
          (peer?.online ? 'в сети' : 'не в сети'));

  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col h-full bg-bg-0/20 ${isDragging ? 'ring-2 ring-accent ring-inset' : ''} ${
        resizing ? 'select-none' : ''
      }`}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 border-2 border-dashed border-accent rounded-2xl m-2 pointer-events-none transition-all">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 border border-accent/40 text-accent flex items-center justify-center mb-3 shadow-lg shadow-accent/20">
            <Upload size={32} />
          </div>
          <div className="text-lg font-semibold text-white">Перетащите файлы сюда</div>
          <div className="text-sm text-slate-400 mt-1">Документы, изображения, видео, архивы любого типа</div>
        </div>
      )}
      <header className="chat-header flex items-center gap-2 p-3 border-b border-white/10">
        {onBack && (
          <button className="btn-ghost md:hidden" onClick={onBack} aria-label="Назад">
            <ArrowLeft size={18} />
          </button>
        )}
        {/* Блок профиля/группы — фиксированная ширина текстового слота
            (sm:w-[260px]/w-[180px]), чтобы кнопки звонка были рядом с именем
            и НЕ дрожали при смене статуса «в сети» ↔ «печатает…». Длинные
            строки тримим через truncate. */}
        <button
          className="interactive-scale flex items-center gap-3 min-w-0 text-left shrink-0 rounded-xl p-1.5 -m-1.5"
          onClick={() => {
            if (isGroup) onShowGroupSettings?.(group.id);
            else onShowProfile?.(peer.id);
          }}
          title={isGroup ? 'Настройки группы' : 'Открыть профиль'}
        >
          {isGroup && !avatarUrl ? (
            <div
              className="avatar grid place-items-center bg-bg-3/90 text-slate-200 shrink-0"
              style={{ width: 38, height: 38 }}
              aria-hidden
            >
              <UsersIcon size={18} />
            </div>
          ) : (
            <Avatar
              name={displayName}
              src={avatarUrl}
              size={38}
              online={isGroup ? undefined : peer.online}
              showStatus={!isGroup}
            />
          )}
          {/* Слот имени/статуса с фиксированной шириной — это ключ к
              стабильности: subtitle меняется («в сети» / «печатает…» / число
              участников), но визуальный «контейнер» остаётся одинаковым,
              значит кнопки звонка не сдвигаются ни на пиксель. Ширина
              подобрана так, чтобы кнопки сидели сразу за ником, без
              лишней «дырки» между ним и иконками — но и не наезжали при
              появлении «печатает…». */}
          <div className="min-w-0 w-[130px] sm:w-[150px] md:w-[170px]">
            <div className="truncate font-semibold">{displayName}</div>
            <div
              className={`text-xs truncate ${typingLabel ? 'text-slate-300' : 'text-slate-500'}`}
            >
              {subtitle}
            </div>
          </div>
        </button>
        {/* Кнопки звонка / настроек — сразу за именем, а не у края */}
        <div className="flex items-center gap-1 shrink-0">
          {isGroup ? (
            <>
              <button
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100 disabled:opacity-40"
                style={{ width: 36, height: 36 }}
                onClick={() => onStartGroupCall?.(group, { withVideo: false })}
                disabled={!onStartGroupCall}
                title="Голосовая встреча"
                type="button"
              >
                <Phone size={16} />
              </button>
              <button
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100 disabled:opacity-40"
                style={{ width: 36, height: 36 }}
                onClick={() => onStartGroupCall?.(group, { withVideo: true })}
                disabled={!onStartGroupCall}
                title="Видео-встреча"
                type="button"
              >
                <Video size={16} />
              </button>
              <button
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100"
                style={{ width: 36, height: 36 }}
                onClick={() => onShowGroupSettings?.(group.id)}
                title="Настройки группы"
                type="button"
              >
                <SettingsIcon size={16} />
              </button>
            </>
          ) : peerDeleted ? null : (
            <>
              {/* Оффлайн-пир НЕ блокирует звонок.
                  Раньше тут стоял disabled={!peer.online}, и кнопки в шапке
                  были мертвы, хотя ровно тот же звонок спокойно уходил из
                  модалки профиля (там гейта нет) — то есть кнопка ничего не
                  защищала, просто путала.
                  На сервере звонок оффлайн-пиру полностью поддержан:
                  call:invite шлёт ему Web Push и пишет системное сообщение
                  в чат, а если никто не ответил за 30 секунд —
                  callRegistry финализирует звонок как «пропущенный» и
                  закрывает окно у звонящего. Ровно как в Discord. */}
              <button
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100 disabled:opacity-40"
                style={{ width: 36, height: 36 }}
                onClick={onCallAudio}
                title={peer.online ? 'Голосовой звонок' : 'Позвонить (пользователь не в сети)'}
                type="button"
              >
                <Phone size={16} />
              </button>
              <button
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100 disabled:opacity-40"
                style={{ width: 36, height: 36 }}
                onClick={onCallVideo}
                title={peer.online ? 'Видео-звонок' : 'Видеозвонок (пользователь не в сети)'}
                type="button"
              >
                <Video size={16} />
              </button>
            </>
          )}
        </div>
        {/* Пустой spacer — чтобы header по ширине ощущался ровно, но кнопки всё равно у имени */}
        <div className="flex-1" />
      </header>

      {/* Активный звонок (1:1 или групповой) — встраивается СРАЗУ после
          хедера, выше списка сообщений. Это «дискорд-стайл»: имя/кнопки
          сверху, звонок под ними, чат ещё ниже. Высота блока звонка
          фиксирована (callHeight, в px) и регулируется драг-хендлом
          ниже — пользователь сам решает, сколько места отдаёт звонку,
          сколько чату. Чат ниже flex-1 + min-h, поэтому всегда виден
          инпут и хотя бы кусок сообщений. */}
      {callSlot && (
        <>
          <div
            ref={callBlockRef}
            className="flex flex-col flex-shrink-0"
            style={{ height: callHeight }}
          >
            {callSlot}
          </div>
          {/* Драг-хендл между звонком и чатом. Тонкая полоска — сам
              cursor: row-resize плюс лёгкий ховер выделяет хват-зону.
              pointerdown запускает обработчик, дальше глобальные
              pointermove/up на window'е. */}
          <div
            role="separator"
            aria-label="Изменить высоту окна звонка"
            aria-orientation="horizontal"
            onPointerDown={handleCallResizeStart}
            className={`relative flex-shrink-0 cursor-row-resize bg-bg-1/70 border-y border-white/10 transition-colors ${
              resizing ? 'bg-accent/40' : 'hover:bg-white/5'
            }`}
            style={{ height: 6 }}
          >
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-[3px] rounded-full bg-slate-500/60"
            />
          </div>
        </>
      )}

      {/* Баннер активного группового звонка — виден всем, кроме тех, кто уже внутри */}
      {isGroup && groupCallActive && !inGroupCall && (
        <div className="px-4 py-2 bg-emerald-500/15 border-b border-emerald-500/30 flex items-center gap-3">
          <Phone size={14} className="text-emerald-300 shrink-0" />
          <div className="flex-1 text-sm text-emerald-200 truncate">
            В этой группе сейчас идёт звонок
          </div>
          <button
            type="button"
            className="btn-primary h-7 px-3 text-xs"
            onClick={() => onJoinGroupCall?.(group)}
          >
            Подключиться
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className={`chat-scroll flex-1 overflow-y-auto px-4 py-4 space-y-2 ${callSlot ? 'min-h-[200px]' : ''}`}
      >
        {loading && <div className="text-center text-slate-500 text-sm">Загрузка…</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm">
            Ещё нет сообщений. Напиши первым!
          </div>
        )}
        <MessageList
          messages={messages}
          selfId={selfId}
          firstUnreadId={firstUnreadId}
          editingId={editingId}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          commitEdit={commitEdit}
          cancelEdit={cancelEdit}
          onMessageContext={onMessageContext}
          onMessageClick={onMessageClick}
          onReactionClick={onReactionClick}
          onRejoinCall={onRejoinCall}
          onJoinGroupCall={onJoinGroupCall}
          inGroupCall={inGroupCall}
          isGroup={isGroup}
          group={group}
          sendersById={sendersById}
          onShowGroupMemberProfile={onShowGroupMemberProfile}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
        />
      </div>

      {/* Bottom-bar режима мульти-выбора. Замещает обычный composer-panel,
          но рендерится на том же месте, чтобы не ломать раскладку. Кнопки:
          «Переслать N» и «Отмена». Эта панель видна только пока
          selectionMode=true и есть хотя бы одно выделение (см. toggleSelected
          выше — при опустошении автоматически выходим из режима). */}
      {selectionMode && selectedIds.size > 0 ? (
        <div className="composer-panel p-3 border-t border-white/10 flex items-center gap-2">
          <button
            type="button"
            onClick={exitSelection}
            className="btn-icon bg-white/10 hover:bg-white/20 text-white"
            style={{ height: 40, width: 40 }}
            title="Отмена (Esc)"
          >
            <X size={16} />
          </button>
          <div className="flex-1 text-sm text-slate-200">
            Выбрано {selectedIds.size}{' '}
            {selectedIds.size === 1
              ? 'сообщение'
              : selectedIds.size < 5
                ? 'сообщения'
                : 'сообщений'}
          </div>
          <button
            type="button"
            onClick={requestForwardSelection}
            className="btn-primary h-10 px-4 flex items-center gap-2"
            title="Переслать выделенные"
          >
            <ForwardIcon size={16} />
            <span>Переслать</span>
          </button>
        </div>
      ) : (
      <div className="composer-panel p-3 border-t border-white/10">
        {/* Preview-бар «Ответ на …» — рендерится ВНУТРИ composer-panel,
            над input'ом, чтобы пользователь сразу видел контекст ответа.
            Клик по крестику или Esc снимает выбор. */}
        {replyingTo && !peerDeleted && (
          <ReplyPreviewBar
            message={replyingTo}
            sendersById={sendersById}
            selfId={selfId}
            onCancel={() => setReplyingTo(null)}
          />
        )}
        {uploadProgress && (
          <div className="mb-2 p-2.5 rounded-xl bg-bg-2 border border-border flex flex-col gap-1.5 animate-fadeIn">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <Upload size={14} className="text-accent animate-pulse" />
                <span className="font-medium">Загрузка… {uploadProgress.percent}%</span>
                <span className="text-slate-400">
                  ({formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)})
                </span>
              </div>
              <button
                type="button"
                onClick={cancelUpload}
                className="px-2 py-0.5 rounded bg-danger/20 text-danger hover:bg-danger/30 text-xs flex items-center gap-1 transition-colors"
                title="Отменить загрузку"
              >
                <X size={12} />
                Отмена
              </button>
            </div>
            <div className="w-full bg-bg-3 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-accent h-full rounded-full transition-all duration-150"
                style={{ width: `${Math.max(2, uploadProgress.percent)}%` }}
              />
            </div>
          </div>
        )}
        {peerDeleted ? (
          <div className="px-3 py-2 rounded-lg bg-bg-3 text-slate-400 text-sm text-center">
            Этот аккаунт был удалён. Написать или позвонить уже не получится — история остаётся
            только для чтения.
          </div>
        ) : recording ? (
          <VoiceRecorder
            onSend={async (blob, durationMs) => {
              const replyToId = replyingTo?.id ?? null;
              setReplyingTo(null);
              await onSendVoice?.(blob, durationMs, replyToId);
              setRecording(false);
            }}
            onCancel={() => setRecording(false)}
            onError={() => setRecording(false)}
          />
        ) : (
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
            <button
              onClick={onPickFile}
              disabled={uploading}
              className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100"
              style={{ height: 40, width: 40 }}
              title={`Прикрепить файл (до ${formatLimit(maxFileBytes)})`}
              type="button"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              className="input resize-none max-h-40"
              placeholder={
                uploading
                  ? 'Загрузка файла…'
                  : pendingAttachments.length > 0
                    ? 'Добавьте текст или отправьте…'
                    : isGroup
                      ? `Сообщение в «${group.name}»`
                      : `Сообщение для @${peer.username}`
              }
              value={text}
              onChange={onTextChange}
              onKeyDown={onKey}
              onPaste={handlePaste}
              rows={1}
              disabled={uploading}
            />
            <button
              onClick={() => {
                stopTyping();
                setRecording(true);
              }}
              disabled={uploading}
              className="btn-icon bg-white/5 hover:bg-white/10 text-slate-100"
              style={{ height: 40, width: 40 }}
              title="Записать голосовое"
              type="button"
            >
              <Mic size={16} />
            </button>
            <button
              onClick={send}
              disabled={(!text.trim() && pendingAttachments.length === 0) || sending || uploading}
              className="btn-primary h-10"
              title="Отправить"
              type="button"
            >
              <Send size={16} />
            </button>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {pendingAttachments.map((file, index) => {
              const isImage = file.type.startsWith('image/');
              const isVideo = file.type.startsWith('video/');
              const previewUrl = isImage || isVideo ? URL.createObjectURL(file) : null;
              return (
                <div key={index} className="relative group message-row">
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setPreviewZoom(previewUrl)}
                      className="media-card w-16 h-16 object-cover rounded-xl overflow-hidden"
                    >
                      <img src={previewUrl} alt={file.name} className="w-16 h-16 object-cover" />
                    </button>
                  ) : isVideo ? (
                    <div className="media-card w-16 h-16 rounded-xl bg-bg-3 grid place-items-center overflow-hidden">
                      <video src={previewUrl} className="w-16 h-16 object-cover" muted />
                    </div>
                  ) : (
                    <div className="media-card w-16 h-16 rounded-xl bg-bg-3/90 grid place-items-center flex-col gap-0.5 p-1">
                      <FileIcon size={16} className="text-slate-400 shrink-0" />
                      <div className="text-[9px] text-slate-400 truncate w-full text-center leading-tight">
                        {file.name.slice(0, 12)}
                        {file.name.length > 12 ? '...' : ''}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(index)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-soft"
                    title="Удалить"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {previewZoom && (
          <div
            className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm grid place-items-center p-4 cursor-zoom-out"
            onClick={() => setPreviewZoom(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPreviewZoom(null);
            }}
            role="dialog"
            tabIndex={-1}
          >
            <img
              src={previewZoom}
              alt="Preview"
              className="message-row max-h-[90vh] max-w-[95vw] object-contain rounded-xl shadow-soft"
            />
          </div>
        )}
      </div>
      )}

      {menu && menuMessage && (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            // «Ответить» — всегда (включая свои сообщения: можно процитировать
            // и себя). Закрывает меню и поднимает preview-бар над composer.
            {
              label: 'Ответить',
              icon: <ReplyIcon size={14} />,
              onClick: () => setReplyingTo(menuMessage),
            },
            // «Реакция» — только для чужих (сервер не разрешает реагировать
            // на собственные сообщения). Закрываем текущее меню и открываем
            // ReactionPicker в той же точке.
            ...(menuMessage.senderId !== selfId
              ? [
                  {
                    label: 'Реакция',
                    icon: <Smile size={14} />,
                    onClick: () => {
                      const x = menu.x;
                      const y = menu.y;
                      const id = menuMessage.id;
                      setMenu(null);
                      setReactionPicker({ messageId: id, x, y });
                    },
                  },
                ]
              : []),
            // «Переслать» — для всех типов, кроме deleted/system/call/groupcall
            // (контекстное меню для них уже не открывается).
            {
              label: 'Переслать',
              icon: <ForwardIcon size={14} />,
              onClick: () => onRequestForward?.(menuMessage),
            },
            // «Выделить» — переход в режим мульти-выбора. Дальше пользователь
            // докликает остальные сообщения и через bottom-bar пересылает.
            {
              label: 'Выделить',
              icon: <CheckSquare size={14} />,
              onClick: () => startSelectionFrom(menuMessage),
            },
            // Действия владельца сообщения.
            ...(menuMessage.senderId === selfId && menuMessage.kind === 'text'
              ? [
                  { divider: true },
                  {
                    label: 'Редактировать',
                    icon: <Pencil size={14} />,
                    onClick: () => startEdit(menuMessage),
                  },
                ]
              : []),
            ...(menuMessage.senderId === selfId
              ? [
                  ...(menuMessage.kind === 'text' ? [] : [{ divider: true }]),
                  {
                    label: 'Удалить',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: () => onDeleteMessage?.(menuMessage.id),
                  },
                ]
              : []),
          ]}
        />
      )}
      {reactionPicker && reactionMessage && (
        <ReactionPicker
          anchor={{ x: reactionPicker.x, y: reactionPicker.y }}
          onSelect={onAddReaction}
          onClose={() => setReactionPicker(null)}
        />
      )}
    </div>
  );
}

// Превью «Ответ на …» над composer'ом. Содержит вертикальную акцентную
// полоску, автора и краткое содержание оригинала, плюс крестик отмены.
// Тип контента (voice/image/video/file) показываем мини-иконкой,
// иначе берём первые 200 символов content (он уже обрезан на сервере
// при выдаче истории / dm:new, но и здесь truncate'им через CSS).
function ReplyPreviewBar({ message, sendersById, selfId, onCancel }) {
  // Имя автора — если это сам юзер, пишем «Себе» (Telegram-стайл),
  // иначе ищем в sendersById.
  let authorName;
  if (message.senderId === selfId) {
    authorName = 'Себе';
  } else {
    const author = sendersById?.get(message.senderId);
    authorName = author ? getDisplayName(author) : `Пользователь #${message.senderId}`;
  }
  const preview = (() => {
    if (message.deleted) return 'удалённое сообщение';
    if (message.kind === 'voice') return 'голосовое сообщение';
    if (message.kind === 'image') return message.content || 'изображение';
    if (message.kind === 'video') return message.content || 'видео';
    if (message.kind === 'file') return message.content || message.attachmentName || 'файл';
    return message.content || '';
  })();
  return (
    <div className="flex items-stretch gap-2 mb-2 rounded-md bg-bg-3/60 border border-white/10 px-2 py-1.5">
      <ReplyIcon size={16} className="self-center text-accent shrink-0" aria-hidden />
      <span aria-hidden className="w-[3px] rounded-full bg-accent self-stretch" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-accent truncate">{authorName}</div>
        <div className="text-[12px] text-slate-300 truncate">{preview}</div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="btn-icon bg-transparent hover:bg-white/10 text-slate-300 self-center"
        style={{ width: 28, height: 28 }}
        title="Отменить ответ (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
