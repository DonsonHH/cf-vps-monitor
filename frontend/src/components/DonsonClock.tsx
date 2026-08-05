import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

function formatBeijingTime(now: Date) {
  return formatter.format(now).replace(/\s/g, '');
}

function formatBeijingDate(now: Date) {
  return dateFormatter.format(now).replace(/\s/g, '');
}

/** A dedicated Beijing time block for the Donson public dashboard. */
export default function DonsonClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className="donson-clock donson-time-block" dateTime={now.toISOString()} title="Asia/Shanghai">
      <span className="donson-time-icon" aria-hidden="true"><Clock3 size={20} /></span>
      <span className="donson-time-copy">
        <span className="donson-eyebrow">BEIJING TIME · UTC+8</span>
        <strong>{formatBeijingTime(now)}</strong>
        <span className="donson-time-date">{formatBeijingDate(now)}</span>
      </span>
      <span className="donson-time-status"><i aria-hidden="true" /> 同步中</span>
    </time>
  );
}
