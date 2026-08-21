import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GroupCallView from '../src/components/GroupCallView';
import { SettingsProvider } from '../src/context/SettingsContext';

const usersById = {
  1: { id: 1, username: 'me', displayName: 'Me' },
  2: { id: 2, username: 'bob', displayName: 'Bob' },
  3: { id: 3, username: 'cara', displayName: 'Cara' },
};

function renderGroupCall(overrides = {}) {
  const call = {
    state: 'in-call',
    group: { id: 10, name: 'Alpha', members: Object.values(usersById) },
    localStream: null,
    remotes: { 2: null, 3: null },
    participants: [1, 2, 3],
    peersMedia: {
      2: { mic: true, camera: false, screen: true, screenAudio: true },
      3: { mic: true, camera: false, screen: false, screenAudio: false },
    },
    muted: false,
    deafened: true,
    cameraOn: false,
    sharingScreen: false,
    withVideo: false,
    speakingUserIds: new Set(),
    toggleMute: () => {},
    toggleDeafen: () => {},
    toggleCamera: () => {},
    toggleScreenShare: () => {},
    leave: () => {},
    ...overrides,
  };

  render(
    <SettingsProvider>
      <GroupCallView call={call} usersById={usersById} selfId={1} />
    </SettingsProvider>,
  );
}

describe('GroupCallView audio controls', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps screen audio audible while deafened and mutes other users', async () => {
    renderGroupCall();

    const audios = document.querySelectorAll('audio');
    expect(audios).toHaveLength(2);

    await waitFor(() => {
      expect((audios[0] as HTMLAudioElement).muted).toBe(false);
      expect((audios[1] as HTMLAudioElement).muted).toBe(true);
    });
  });

  it('persists per-user and per-stream volume changes', async () => {
    renderGroupCall();

    fireEvent.contextMenu(screen.getByText('Bob'));
    fireEvent.change(screen.getByLabelText('Громкость пользователя'), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByLabelText('Громкость стрима'), {
      target: { value: '55' },
    });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('sazcord.settings') || '{}');
      expect(saved.userVolumes['2']).toBe(35);
      expect(saved.streamVolumes['2']).toBe(55);
    });
  });
});
