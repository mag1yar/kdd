import { useEffect, useState } from 'react';
import { getVersion } from './api';

// Поллинг раз в 2с: version = MAX(id) из events; смена значения триггерит эффекты.
export function useVersion(intervalMs = 2000): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => getVersion()
      .then(({ version: v }) => { if (alive) setVersion(v); })
      .catch(() => { /* сервер перезапускается — продолжаем поллить */ });
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return version;
}
