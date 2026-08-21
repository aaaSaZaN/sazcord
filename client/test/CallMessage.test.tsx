import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CallMessage from '../src/components/CallMessage';

const baseMsg = {
  id: 1,
  senderId: 1,
  receiverId: 2,
  createdAt: Date.now(),
  kind: 'call',
};

describe('CallMessage', () => {
  it('shows duration for completed call', () => {
    render(
      <CallMessage
        message={{
          ...baseMsg,
          payload: {
            callId: 'c1',
            withVideo: false,
            status: 'ended',
            outcome: 'completed',
            durationMs: 65000,
          },
        }}
        selfId={1}
      />,
    );
    expect(screen.getByText(/Звонок/)).toBeInTheDocument();
    expect(screen.getByText(/длительность 1:05/)).toBeInTheDocument();
  });

  it('shows missed for missed outgoing', () => {
    render(
      <CallMessage
        message={{
          ...baseMsg,
          payload: { callId: 'c2', withVideo: false, status: 'ended', outcome: 'missed' },
        }}
        selfId={1}
      />,
    );
    expect(screen.getByText(/не отвечен/)).toBeInTheDocument();
  });

  // Контракт изменился: кнопка «Подключиться» в плашке чата больше не
  // рисуется (см. CallMessage.tsx, комментарий о том, почему её убрали).
  // Реджойн происходит только из самого окна звонка — там у того, кто ушёл,
  // вместо красной End-кнопки появляется зелёная Connect. Это снимает
  // путаницу, когда оба собеседника видели в чате одинаковую кнопку.
  it('does not render Rejoin button even in status=waiting', () => {
    const onRejoin = vi.fn();
    render(
      <CallMessage
        message={{
          ...baseMsg,
          payload: {
            callId: 'c3',
            withVideo: true,
            status: 'waiting',
            startedAt: Date.now() - 10000,
            reconnectUntil: Date.now() + 60_000,
          },
        }}
        selfId={1}
        onRejoin={onRejoin}
      />,
    );
    expect(screen.queryByRole('button', { name: /Подключиться/i })).toBeNull();
    // Сабтайтл с таймером ожидания всё равно должен быть виден,
    // чтобы юзер понимал «звонок ещё активен, пир ждёт реконнекта».
    expect(screen.getByText(/ждём собеседника/i)).toBeInTheDocument();
    expect(onRejoin).not.toHaveBeenCalled();
  });

  it('does not render Rejoin when call already ended', () => {
    render(
      <CallMessage
        message={{
          ...baseMsg,
          payload: {
            callId: 'c4',
            withVideo: false,
            status: 'ended',
            outcome: 'expired',
          },
        }}
        selfId={1}
        onRejoin={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Подключиться/i })).toBeNull();
  });
});
