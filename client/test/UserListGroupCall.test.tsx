import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserList from '../src/components/UserList';

const users = [
  { id: 1, username: 'me', displayName: 'Me', online: true },
  { id: 2, username: 'bob', displayName: 'Bob', online: true },
];

const groups = [
  { id: 10, name: 'Alpha', members: [{ id: 1 }, { id: 2 }] },
  { id: 11, name: 'Beta', members: [{ id: 1 }, { id: 2 }, { id: 3 }] },
];

function expectTextBefore(container: HTMLElement, first: string, second: string) {
  const text = container.textContent || '';
  expect(text.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(second)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(first)).toBeLessThan(text.indexOf(second));
}

describe('UserList — групповой звонок индикатор', () => {
  it('показывает «Идёт звонок» только в активной группе', () => {
    render(
      <UserList
        users={users}
        groups={groups}
        selfId={1}
        selected={null}
        activeGroupCalls={new Set([10])}
      />,
    );

    // Подпись «Идёт звонок» есть только у Alpha; у Beta — обычный «N участ.»
    const callLabels = screen.getAllByText('Идёт звонок');
    expect(callLabels).toHaveLength(1);
    // У Beta стандартная подпись с количеством участников.
    expect(screen.getByText(/3 участ\./)).toBeInTheDocument();
    // У Alpha — 2 участника, но этой подписи быть не должно, потому что её
    // вытеснила «Идёт звонок».
    expect(screen.queryByText(/2 участ\./)).toBeNull();
  });

  it('без активных звонков индикатор не показывается', () => {
    render(
      <UserList
        users={users}
        groups={groups}
        selfId={1}
        selected={null}
        activeGroupCalls={new Set()}
      />,
    );
    expect(screen.queryByText('Идёт звонок')).toBeNull();
    expect(screen.getByText(/2 участ\./)).toBeInTheDocument();
    expect(screen.getByText(/3 участ\./)).toBeInTheDocument();
  });

  it('устойчив к отсутствию пропса activeGroupCalls', () => {
    render(<UserList users={users} groups={groups} selfId={1} selected={null} />);
    // Не падает и не показывает индикатор.
    expect(screen.queryByText('Идёт звонок')).toBeNull();
  });

  it('сортирует группы внутри секции по последней активности', () => {
    const { container } = render(
      <UserList
        users={users}
        groups={groups}
        selfId={1}
        selected={null}
        lastActivityByChat={{ 'g:10': 100, 'g:11': 200 }}
      />,
    );

    expectTextBefore(container, 'Beta', 'Alpha');
  });

  it('сортирует пользователей внутри online/offline секций по последней активности', () => {
    const list = [
      { id: 1, username: 'me', displayName: 'Me', online: true },
      { id: 2, username: 'bob', displayName: 'Bob', online: true, lastActivityAt: 100 },
      { id: 3, username: 'cara', displayName: 'Cara', online: true, lastActivityAt: 300 },
      { id: 4, username: 'dan', displayName: 'Dan', online: false, lastActivityAt: 100 },
      { id: 5, username: 'eve', displayName: 'Eve', online: false, lastActivityAt: 400 },
    ];
    const { container } = render(
      <UserList
        users={list}
        groups={[]}
        selfId={1}
        selected={null}
        lastActivityByChat={{ 'u:2': 500 }}
      />,
    );

    expectTextBefore(container, 'Bob', 'Cara');
    expectTextBefore(container, 'Eve', 'Dan');
  });
});
