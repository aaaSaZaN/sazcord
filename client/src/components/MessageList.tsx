import { memo } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  X,
  Heart,
  Zap,
  Trophy,
  Flame,
  ThumbsUp,
  ThumbsDown,
  Laugh,
  Smile,
  Forward as ForwardIcon,
  Reply as ReplyIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  File as FileIcon,
  Mic as MicIcon,
} from 'lucide-react';
import Avatar from './Avatar';
import VoicePlayer from './VoicePlayer';
import CallMessage from './CallMessage';
import SystemMessage from './SystemMessage';
import GroupCallMessage from './GroupCallMessage';
import AttachmentMessage from './AttachmentMessage';
import { getDisplayName } from '../utils/user';
import { renderMarkdown } from '../utils/markdown';

// Скролл к оригиналу при клике на reply-цитату. Подсветка через CSS-класс
// .message-flash (определён в index.css ниже). Если оригинал не в текущем
// окне выдачи (например, очень старый и не подгружен) — просто молча
// ничего не делаем; без bouncing alerts.
function scrollToMessage(id) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`[data-message-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Лёгкое мигание оригинала, чтобы взгляд увидел куда прыгнули.
  el.classList.add('message-flash');
  window.setTimeout(() => {
    el.classList.remove('message-flash');
  }, 1400);
}

// Иконка-превью типа сообщения для цитаты-ответа. Текст не показываем —
// для него отдельная строка с content.
function ReplyKindIcon({ kind }) {
  if (kind === 'image') return <ImageIcon size={12} aria-hidden />;
  if (kind === 'video') return <VideoIcon size={12} aria-hidden />;
  if (kind === 'voice') return <MicIcon size={12} aria-hidden />;
  if (kind === 'file') return <FileIcon size={12} aria-hidden />;
  return null;
}

// Цитата сверху бабла для сообщения-ответа. Клик прокручивает к оригиналу.
// senderId оригинала ищется в sendersById; если нет — fallback на «#id».
// Если оригинал был soft-deleted, content пустой → показываем «удалённое
// сообщение». Если replyTo == null (жёсткое удаление), компонент не
// вызывается.
function ReplyQuote({ replyTo, sendersById, mine }) {
  if (!replyTo) return null;
  const author = sendersById?.get(replyTo.senderId);
  const authorName = author ? getDisplayName(author) : `Пользователь #${replyTo.senderId}`;
  const preview = (() => {
    if (replyTo.deleted) return 'удалённое сообщение';
    if (replyTo.kind === 'voice') return 'голосовое сообщение';
    if (replyTo.kind === 'image') return replyTo.content || 'изображение';
    if (replyTo.kind === 'video') return replyTo.content || 'видео';
    if (replyTo.kind === 'file') return replyTo.content || 'файл';
    return replyTo.content || '';
  })();
  // Цвет акцентной полоски слева — отличаем «свои» / «чужие» баблы.
  const stripeClass = mine ? 'bg-white/60' : 'bg-accent';
  const baseClass = mine ? 'text-white/80' : 'text-slate-300';
  return (
    <button
      type="button"
      onClick={(e) => {
        // Останавливаем bubble, чтобы клик по цитате не толкал onMessageClick
        // у бабла (когда родитель в режиме мульти-выбора).
        e.stopPropagation();
        scrollToMessage(replyTo.id);
      }}
      className={`reply-quote w-full text-left flex items-stretch gap-2 mb-1 rounded-md px-2 py-1
        ${mine ? 'bg-white/10 hover:bg-white/15' : 'bg-black/15 hover:bg-black/25'}`}
      title="К оригиналу"
    >
      <span aria-hidden className={`w-[3px] rounded-full ${stripeClass}`} />
      <span className="flex-1 min-w-0">
        <span className={`block text-[11px] font-semibold ${baseClass} truncate`}>
          {authorName}
        </span>
        <span
          className={`block text-[11px] ${baseClass} truncate flex items-center gap-1 ${replyTo.deleted ? 'italic opacity-70' : ''}`}
        >
          <ReplyKindIcon kind={replyTo.kind} />
          <span className="truncate">{preview}</span>
        </span>
      </span>
    </button>
  );
}

// Маппинг id реакции на иконку lucide-react
const REACTION_ICONS: Record<string, any> = {
  heart: Heart,
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
  laugh: Laugh,
  smile: Smile,
  flame: Flame,
  trophy: Trophy,
  zap: Zap,
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Статус доставки/прочтения для иконки под своим DM-сообщением:
//   - 'sending'   — часики (ещё не ack'нулось)
//   - 'error'     — красный «!» (отвалилось)
//   - 'read'      — две галки (пир открыл чат)
//   - 'delivered' — одна галка (сервер записал, пир ещё не читал)
// Для чужих, групповых и системных сообщений возвращает null — ничего не
// рисуем.
function getMessageStatus(m, selfId) {
  if (m.senderId !== selfId) return null;
  if (m.groupId) return null;
  if (m.kind === 'system' || m.kind === 'call' || m.kind === 'groupcall') return null;
  if (m.status === 'error') return 'error';
  if (m.status === 'sending') return 'sending';
  if (typeof m.id === 'number' && m.id < 0) return 'sending';
  if (m.readAt) return 'read';
  return 'delivered';
}

function StatusIcon({ status, mine }) {
  if (!status) return null;
  const base = mine ? 'text-white/70' : 'text-slate-400';
  if (status === 'sending') {
    return <Clock className={base} size={12} aria-label="отправляется" />;
  }
  if (status === 'error') {
    return <AlertCircle className="text-red-400" size={12} aria-label="не отправлено" />;
  }
  if (status === 'read') {
    // Две галки, акцентный цвет — отличим от «доставлено».
    return <CheckCheck className="text-sky-300" size={12} aria-label="прочитано" />;
  }
  // 'delivered'
  return <Check className={base} size={12} aria-label="доставлено" />;
}

// Плашка «Переслано от <Имя>», рендерится в самом верху бабла для любого
// сообщения с m.forwardedFrom. senderId может быть null, если оригинальный
// автор удалил аккаунт (FK ON DELETE SET NULL на сервере) — в этом случае
// показываем «Переслано (автор удалил аккаунт)». title содержит время
// оригинала, чтобы при наведении было видно «откуда».
function ForwardedHeader({ forwardedFrom, sendersById, mine }) {
  if (!forwardedFrom) return null;
  const author = forwardedFrom.senderId != null ? sendersById?.get(forwardedFrom.senderId) : null;
  const name = author
    ? getDisplayName(author)
    : forwardedFrom.senderId == null
      ? 'автор удалил аккаунт'
      : `пользователь #${forwardedFrom.senderId}`;
  const origTitle = forwardedFrom.createdAt
    ? `Оригинал от ${new Date(forwardedFrom.createdAt).toLocaleString()}`
    : undefined;
  const base = mine ? 'text-white/80' : 'text-slate-300';
  return (
    <div
      className={`flex items-center gap-1.5 mb-1 text-[11px] italic ${base}`}
      title={origTitle}
    >
      <ForwardIcon size={12} aria-hidden />
      <span>
        Переслано от <span className="font-semibold not-italic">{name}</span>
      </span>
    </div>
  );
}

function formatDay(ts) {
  return new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'long', year: 'numeric' });
}

function MessageList({
  messages,
  selfId,
  firstUnreadId,
  editingId,
  editDraft,
  setEditDraft,
  commitEdit,
  cancelEdit,
  onMessageContext,
  onMessageClick = null,
  onReactionClick,
  onRejoinCall,
  onJoinGroupCall,
  inGroupCall = false,
  isGroup = false,
  group,
  sendersById,
  onShowGroupMemberProfile,
  // Режим мульти-выбора. Когда selectionMode=true:
  //   - на каждом баблe слева появляется чекбокс (можно тоггл'ить кликом);
  //   - выделенные баблы получают подсветку (ring + slightly lighter bg);
  //   - клик по баблу = toggle (через onMessageClick от родителя).
  selectionMode = false,
  selectedIds = null,
}) {
  const out = [];
  let lastDay = null;
  let unreadShown = false;
  let lastSenderId = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = new Date(m.createdAt).toDateString();
    const dayChanged = day !== lastDay;
    if (dayChanged) {
      out.push(
        <div key={`d-${m.id}`} className="flex justify-center my-3 select-none">
          <span className="rounded-full border border-white/10 bg-bg-2/70 px-3 py-1 text-xs text-slate-400 shadow-soft">
            {formatDay(m.createdAt)}
          </span>
        </div>,
      );
      lastDay = day;
      lastSenderId = null;
    }

    if (!unreadShown && firstUnreadId && m.id === firstUnreadId && m.senderId !== selfId) {
      out.push(
        <div key={`unread-${m.id}`} className="flex items-center gap-2 my-2 select-none">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-red-500/60" />
          <span className="text-[11px] uppercase tracking-wider text-red-400 font-semibold">
            новые сообщения
          </span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-red-500/60" />
        </div>,
      );
      unreadShown = true;
      lastSenderId = null;
    }

    if (m.kind === 'call') {
      out.push(<CallMessage key={m.id} message={m} selfId={selfId} onRejoin={onRejoinCall} />);
      lastSenderId = null;
      continue;
    }

    if (m.kind === 'system') {
      out.push(<SystemMessage key={m.id} message={m} sendersById={sendersById} />);
      lastSenderId = null;
      continue;
    }

    if (m.kind === 'groupcall') {
      out.push(
        <GroupCallMessage
          key={m.id}
          message={m}
          sendersById={sendersById}
          isJoined={inGroupCall}
          onJoin={() => onJoinGroupCall?.(group)}
        />,
      );
      lastSenderId = null;
      continue;
    }

    const mine = m.senderId === selfId;
    const isEditing = editingId === m.id;
    const isAttachment =
      (m.kind === 'image' || m.kind === 'video' || m.kind === 'file') && m.attachmentPath;
    const sender = !mine && sendersById ? sendersById.get(m.senderId) : null;
    const showSenderHeader = isGroup && !mine && m.senderId !== lastSenderId;

    const senderName = sender
      ? getDisplayName(sender)
      : isGroup && !mine
        ? `Пользователь #${m.senderId}`
        : '';

    // Выделен ли бабл в режиме мульти-выбора. selectedIds — Set | null.
    const isSelected = !!(selectionMode && selectedIds && selectedIds.has(m.id));
    // В режиме выделения бабл также реагирует на левый клик. Удалённые/
    // системные/звонковые — нет (родитель уже отфильтровал кликабельность
    // через onMessageContext).
    const bubbleClickable = selectionMode && !m.deleted;
    out.push(
      <div
        key={m.id}
        data-message-id={m.id}
        className={`message-row flex items-end ${mine ? 'justify-end' : 'justify-start'} ${showSenderHeader ? 'mt-2' : ''} ${isSelected ? 'is-selected' : ''}`}
      >
        {/* Чекбокс выделения в режиме мульти-выбора. Кладём ПЕРЕД
            аватаркой/баблом, чтобы он был визуально слева и не «прыгал»
            между свои/чужие. Кликабельность: чекбокс сам toggle'ит через
            onMessageClick, но и сам бабл тоже работает. */}
        {selectionMode && (
          <div
            className={`shrink-0 mr-2 self-center w-6 h-6 rounded-full border-2 grid place-items-center transition-colors
              ${
                isSelected
                  ? 'bg-accent border-accent text-white'
                  : 'bg-bg-3 border-white/30 text-transparent'
              }`}
            aria-hidden
          >
            <Check size={14} strokeWidth={3} />
          </div>
        )}
        {isGroup && !mine && (
          <div className="w-8 mr-2 shrink-0 flex items-end">
            {showSenderHeader ? (
              <button
                type="button"
                onClick={() => onShowGroupMemberProfile?.(m.senderId)}
                title={senderName}
              >
                <Avatar name={senderName || '?'} src={sender?.avatarPath || null} size={32} />
              </button>
            ) : null}
          </div>
        )}
        <div className={`max-w-[75%] ${showSenderHeader ? '' : ''}`}>
          {showSenderHeader && (
            <div className="text-[11px] text-slate-400 mb-0.5 ml-1">{senderName}</div>
          )}
          <div
            className={`message-bubble px-3 py-2 text-sm whitespace-pre-wrap break-words rounded-2xl
              ${
                m.deleted
                  ? 'message-bubble-deleted'
                  : mine
                    ? 'message-bubble-mine'
                    : 'message-bubble-other'
              }
              ${isSelected ? 'ring-2 ring-accent' : ''}
              ${bubbleClickable ? 'cursor-pointer' : ''}
            `}
            title={new Date(m.createdAt).toLocaleString()}
            onContextMenu={(e) => onMessageContext(e, m)}
            onClick={(e) => onMessageClick?.(e, m)}
          >
            {m.deleted ? (
              <span>сообщение удалено</span>
            ) : isEditing ? (
              <EditBox
                value={editDraft}
                onChange={setEditDraft}
                onSubmit={commitEdit}
                onCancel={cancelEdit}
              />
            ) : (
              <>
                {/* Цитата «Ответ на X» — до forwarded-плашки, до контента. */}
                <ReplyQuote
                  replyTo={m.replyTo}
                  sendersById={sendersById}
                  mine={mine}
                />
                {/* Плашка «Переслано от X» — после reply-цитаты, до
                    любого контента (voice/attachment/text). Никогда не
                    показываем для удалённых или в режиме редактирования. */}
                <ForwardedHeader
                  forwardedFrom={m.forwardedFrom}
                  sendersById={sendersById}
                  mine={mine}
                />
                {m.kind === 'voice' && m.attachmentPath ? (
                  <VoicePlayer src={m.attachmentPath} durationMs={m.durationMs} mine={mine} />
                ) : isAttachment ? (
                  <div className="space-y-1">
                    <AttachmentMessage message={m} mine={mine} />
                    {m.content && (
                      <div className={`text-sm ${mine ? 'text-white' : 'text-slate-100'}`}>
                        {renderMarkdown(m.content)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>{renderMarkdown(m.content)}</div>
                )}
              </>
            )}
            {!m.deleted && !isEditing && (
              <>
                {/* Реакции на сообщение */}
                {m.reactions && m.reactions.length > 0 && (
                  <div
                    className={`flex flex-wrap gap-1.5 mt-1.5 ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.reactions.map((r) => {
                      const Icon = REACTION_ICONS[r.emoji];
                      const hasReacted = r.users.includes(selfId);
                      return (
                        <button
                          key={r.emoji}
                          type="button"
                          onClick={() => onReactionClick?.(m.id, r.emoji, hasReacted)}
                          className={`reaction-chip flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border transition-colors ${
                            hasReacted
                              ? mine
                                ? 'bg-white/20 border-white/30 text-white'
                                : 'bg-accent/20 border-accent/30 text-accent'
                              : mine
                                ? 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
                                : 'bg-bg-3 border-border text-slate-200 hover:bg-bg-2'
                          }`}
                          title={`${r.count} реакций`}
                        >
                          {Icon && <Icon size={16} />}
                          <span className="font-medium">{r.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div
                  className={`text-[10px] mt-0.5 text-right flex items-center justify-end gap-1 ${
                    mine ? 'text-white/70' : 'text-slate-500'
                  }`}
                >
                  {m.editedAt && <span className="italic">изменено</span>}
                  <span>{formatTime(m.createdAt)}</span>
                  <StatusIcon status={getMessageStatus(m, selfId)} mine={mine} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>,
    );
    lastSenderId = m.senderId;
  }
  return <>{out}</>;
}

function EditBox({ value, onChange, onSubmit, onCancel }) {
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="flex flex-col gap-1.5 min-w-[220px]">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        rows={Math.min(6, Math.max(1, value.split('\n').length))}
        className="bg-black/30 text-white rounded-md px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-white/40"
      />
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={onCancel}
          className="btn-icon bg-white/10 hover:bg-white/20 text-white"
          style={{ width: 28, height: 28 }}
          title="Отменить (Esc)"
          type="button"
        >
          <X size={14} />
        </button>
        <button
          onClick={onSubmit}
          className="btn-icon bg-white/25 hover:bg-white/40 text-white"
          style={{ width: 28, height: 28 }}
          title="Сохранить (Enter)"
          type="button"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  );
}

export default memo(MessageList);
