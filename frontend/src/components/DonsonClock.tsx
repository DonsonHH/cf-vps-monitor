import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatBeijingTime(now: Date) {
  return formatter.format(now).replace(/\s/g, '');
}

/** A small, self-contained time signal for the Donson public dashboard. */
export default function DonsonClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className="donson-clock" dateTime={now.toISOString()} title="Asia/Shanghai">
      <Clock3 size={14} aria-hidden="true" />
      <span>北京时间</span>
      <strong>{formatBeijingTime(now)}</strong>
    </time>
  );
}
