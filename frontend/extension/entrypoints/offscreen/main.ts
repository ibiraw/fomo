/**
 * @file main.ts
 * @description Offscreen audio page. MV3 service workers cannot play audio, so the background opens this hidden
 *              page (chrome.offscreen, reason AUDIO_PLAYBACK) and sends it "fomo.sound" messages to play.
 * @author Reborn1987
 */

import { SoundPlayer, type PlaySoundMessage } from '@/lib/sounds';

const player = new SoundPlayer();

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as Partial<PlaySoundMessage> | undefined;
  if (m?.type === 'fomo.sound' && m.pack && m.event && typeof m.volume === 'number') {
    void player.play(m.pack, m.event, m.volume).catch((err: unknown) => console.error('[limit] sound failed', err));
  }
});
