// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusChime } from './useFocusChime.js';

afterEach(() => vi.unstubAllGlobals());
describe('Focus completion chime', () => {
  it('does not create audio until a gesture unlock and stays silent before that', async () => {
    const tone = { frequency: {}, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const audio = { state: 'running', currentTime: 1, resume: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue(), createOscillator: vi.fn(() => tone), createGain: vi.fn(() => gain) };
    const AudioContext = vi.fn(function () { return audio; });
    vi.stubGlobal('AudioContext', AudioContext);
    const { result, unmount } = renderHook(() => useFocusChime());
    result.current.play();
    expect(AudioContext).not.toHaveBeenCalled();
    await act(async () => { await result.current.unlock(); });
    expect(result.current.unlocked).toBe(true);
    result.current.play();
    expect(tone.start).toHaveBeenCalledOnce();
    expect(tone.stop).toHaveBeenCalledWith(1.65);
    unmount();
    expect(audio.close).toHaveBeenCalledOnce();
  });
});
