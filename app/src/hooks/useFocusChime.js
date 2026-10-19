import { useCallback, useEffect, useRef, useState } from 'react';

export function useFocusChime() {
  const context = useRef(null);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState('');
  const unlock = useCallback(async () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Sound is not available in this browser.');
      context.current ||= new AudioContext();
      await context.current.resume();
      setUnlocked(context.current.state === 'running');
      setError('');
    } catch (caught) { setError(caught.message || 'Sound could not be enabled.'); }
  }, []);
  const play = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running') return;
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = 'sine';
    tone.frequency.value = 660;
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
    tone.connect(gain);
    gain.connect(audio.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start();
    tone.stop(audio.currentTime + 0.65);
  }, []);
  useEffect(() => () => { void context.current?.close().catch(() => {}); }, []);
  return { unlock, play, unlocked, error };
}
