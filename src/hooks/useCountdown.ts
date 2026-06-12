import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';

export function useGameTimer() {
  const tick = useGameStore((s) => s.tick);
  const status = useGameStore((s) => s.session?.status);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (status === 'RUNNING') {
      intervalRef.current = window.setInterval(() => {
        tick();
      }, 1000);
    }
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status, tick]);
}
