import { useEffect, useMemo, useRef, useState } from 'react'
import { usePresence, type PresenceChannel } from '@/hooks/usePresence';

/** 通道状态文案 */
const CHANNEL_LABEL: Record<PresenceChannel, string> = {
  connecting: '建立链路',
  websocket: '实时推送',
  sse: '流式订阅',
  polling: '定时轮询',
  offline: '离线演示',
};

const CHANNEL_HINT: Record<PresenceChannel, string> = {
  connecting: '正在与观测中枢建立实时链路…',
  websocket: 'WebSocket 长连接，在线变化即时同步',
  sse: '反向代理不支持 WebSocket，已切换到 SSE 流',
  polling: '流式通道不可用，降级为 12 秒轮询',
  offline: '未连接到统计服务，当前仅显示本机',
};

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return '0 秒';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 时 ${m % 60} 分`;
}

/** 把时间戳转成等宽显示 */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 在线观测员徽标
 * 常驻顶栏，显示实时在线人数；点击展开明细面板。
 */
export function PresenceBadge() {
  const { snapshot, channel } = usePresence();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevOnline = useRef(snapshot.online);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 人数变化时给数字一个跳动脉冲，提示"有人在进出"
  useEffect(() => {
    if (snapshot.online !== prevOnline.current) {
      prevOnline.current = snapshot.online;
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 900);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [snapshot.online]);

  // 点击外部关闭面板
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 迷你趋势图路径（近 10 分钟采样）
  const spark = useMemo(() => {
    const values = snapshot.timeline?.length ? snapshot.timeline : [0, 0];
    const max = Math.max(1, ...values);
    const w = 132;
    const h = 30;
    const step = values.length > 1 ? w / (values.length - 1) : w;
    return values
      .map((v, i) => {
        const x = i * step;
        const y = h - (v / max) * (h - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [snapshot.timeline]);

  const live = channel === 'websocket' || channel === 'sse' || channel === 'polling';
  const updated = new Date(snapshot.timestamp || Date.now());
  const updatedText = `${pad(updated.getHours())}:${pad(updated.getMinutes())}:${pad(updated.getSeconds())}`;

  return (
    <div className="globe-presence" ref={panelRef}>
      <button
        type="button"
        className={`globe-presence__badge${open ? ' is-open' : ''}`}
        data-live={live ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`当前在线 ${snapshot.online} 人，查看统计详情`}
      >
        <span className="globe-presence__pulse" data-channel={channel} aria-hidden>
          <i />
        </span>

        <span className="globe-presence__body">
          <span className="globe-presence__label">在线浏览</span>
          <span className={`globe-presence__count${pulse ? ' is-pulse' : ''}`}>
            {String(snapshot.online).padStart(2, '0')}
            <em>人</em>
          </span>
        </span>

        <span className="globe-presence__spark" aria-hidden>
          <svg viewBox="0 0 132 30" preserveAspectRatio="none">
            <path d={spark} />
          </svg>
        </span>

        <span className="globe-presence__chevron" data-open={open ? 'true' : 'false'} aria-hidden>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="globe-presence__panel" role="dialog" aria-label="在线统计详情">
          <header className="globe-presence__head">
            <div>
              <h3>实时在线统计</h3>
              <p>VISITOR PRESENCE · {CHANNEL_LABEL[channel]}</p>
            </div>
            <span className="globe-presence__dot" data-live={live ? 'true' : 'false'} />
          </header>

          <div className="globe-presence__grid">
            <div className="globe-presence__stat">
              <span>当前在线</span>
              <strong>{String(snapshot.online).padStart(2, '0')}</strong>
              <em>独立访客</em>
            </div>
            <div className="globe-presence__stat">
              <span>活跃连接</span>
              <strong>{String(snapshot.connections).padStart(2, '0')}</strong>
              <em>标签页 / 会话</em>
            </div>
            <div className="globe-presence__stat">
              <span>今日峰值</span>
              <strong>{String(snapshot.peak).padStart(2, '0')}</strong>
              <em>进程启动以来</em>
            </div>
            <div className="globe-presence__stat">
              <span>平均驻留</span>
              <strong className="is-text">{formatDuration(snapshot.avgDurationMs)}</strong>
              <em>当前在线访客</em>
            </div>
          </div>

          <div className="globe-presence__chart">
            <div className="globe-presence__chart-head">
              <span>近 10 分钟趋势</span>
              <span className="globe-presence__mono">{updatedText}</span>
            </div>
            <div className="globe-presence__bars" aria-hidden>
              {(snapshot.timeline?.length ? snapshot.timeline : [0]).map((v, i) => {
                const values = snapshot.timeline?.length ? snapshot.timeline : [0];
                const max = Math.max(1, ...values);
                return (
                  <span
                    key={i}
                    style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
                    data-last={i === values.length - 1 ? 'true' : 'false'}
                    title={`${v} 人`}
                  />
                );
              })}
            </div>
          </div>

          <footer className="globe-presence__foot">
            <span>{CHANNEL_HINT[channel]}</span>
          </footer>
        </div>
      )}
    </div>
  );
}

export default PresenceBadge;
