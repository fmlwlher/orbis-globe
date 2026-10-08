import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GlobeEngine,
  isWebGLAvailable,
  type GlobeState,
  type LayerKey,
  type LayerVisibility,
} from '@/components/globe/GlobeEngine';
import {
  CATEGORY_META,
  HUB_PLACE,
  PLACES,
  type Category,
  type Place,
} from '@/components/globe/places';
import { formatDistance, formatLatLng, greatCircleDistance } from '@/components/globe/geo';
import './globe.css';

const CATEGORY_ORDER: Category[] = ['capital', 'metropolis', 'landmark', 'observatory'];

const LAYER_LABELS: { key: LayerKey; label: string; hint: string }[] = [
  { key: 'satellite', label: '卫星影像', hint: '真实地表贴图与夜灯' },
  { key: 'grid', label: '经纬网格', hint: '15° 间隔参考线' },
  { key: 'markers', label: '观测标记', hint: '城市 / 地标 / 天文台' },
  { key: 'arcs', label: '航线弧光', hint: '以北京为枢纽的连线' },
  { key: 'atmosphere', label: '大气辉光', hint: '边缘散射光晕' },
  { key: 'stars', label: '深空星场', hint: '远景恒星背景' },
];

const Index = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<GlobeState>({
    lat: 25,
    lng: 20,
    altitude: 12800,
    autoRotate: true,
    zoom: 1,
  });
  const [selected, setSelected] = useState<Place | null>(null);
  const [hovered, setHovered] = useState<Place | null>(null);
  const [activeCategories, setActiveCategories] = useState<Category[]>(CATEGORY_ORDER);
  const [layers, setLayers] = useState<LayerVisibility>({
    satellite: true,
    grid: true,
    markers: true,
    arcs: true,
    atmosphere: true,
    stars: true,
  });
  const [autoRotate, setAutoRotate] = useState(true);
  const [search, setSearch] = useState('');
  const [clockText, setClockText] = useState('--:--:--');
  const [utcText, setUtcText] = useState('--:--:--');

  // ── 引擎初始化 ──────────────────────────────────────────
  // WebGL 支持性在渲染期探测一次即可，结果恒定，无需响应式重算
  const [glFailed, setGlFailed] = useState(
    () => typeof window !== 'undefined' && !isWebGLAvailable()
  );

  useEffect(() => {
    if (!mountRef.current || glFailed) return;

    let engine: GlobeEngine;
    try {
      engine = new GlobeEngine(mountRef.current, {
        onStateChange: setState,
        onSelect: setSelected,
        onHover: (place, screen) => {
          setHovered(place);
          const tip = tooltipRef.current;
          if (!tip) return;
          if (place) {
            const rect = mountRef.current?.getBoundingClientRect();
            const x = screen.x - (rect?.left ?? 0);
            const y = screen.y - (rect?.top ?? 0);
            tip.style.transform = `translate3d(${x + 18}px, ${y - 14}px, 0)`;
            tip.dataset.visible = 'true';
          } else {
            tip.dataset.visible = 'false';
          }
        },
        onProgress: (ratio) => setProgress(ratio),
        onReady: () => setReady(true),
      });
    } catch (err) {
      // 理论上极难触达（WebGL 探测已前置），兜底避免整树崩溃
      console.error('[globe] 引擎初始化失败:', err);
      window.setTimeout(() => setGlFailed(true), 0);
      return;
    }

    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // glFailed 恒定后无需重建引擎
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 世界时钟 ────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockText(now.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }));
      setUtcText(now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visiblePlaces = useMemo(
    () => PLACES.filter((p) => activeCategories.includes(p.category)),
    [activeCategories]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return PLACES.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [search]);

  const flyTo = useCallback((place: Place) => {
    engineRef.current?.focusOn(place.lat, place.lng, 1.9);
    engineRef.current?.setSelected(place);
    setSearch('');
  }, []);

  const toggleCategory = (cat: Category) => {
    setActiveCategories((prev) => {
      const next = prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat];
      return next.length ? next : prev;
    });
  };

  // ── 状态同步到引擎 ──────────────────────────────────────
  useEffect(() => {
    engineRef.current?.setLayerVisible('satellite', layers.satellite);
    engineRef.current?.setLayerVisible('grid', layers.grid);
    engineRef.current?.setLayerVisible('markers', layers.markers);
    engineRef.current?.setLayerVisible('arcs', layers.arcs);
    engineRef.current?.setLayerVisible('atmosphere', layers.atmosphere);
    engineRef.current?.setLayerVisible('stars', layers.stars);
  }, [layers]);

  useEffect(() => {
    engineRef.current?.setCategoryFilter(activeCategories);
  }, [activeCategories]);

  useEffect(() => {
    engineRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  const handleReset = () => {
    engineRef.current?.setSelected(null);
    engineRef.current?.focusOn(25, 20, 3.1);
    setAutoRotate(true);
  };

  const handleScreenshot = () => {
    const data = engineRef.current?.captureScreenshot();
    if (!data) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = `earth-${Date.now()}.png`;
    a.click();
  };

  const distanceFromHub = selected
    ? greatCircleDistance(
        { lat: HUB_PLACE.lat, lng: HUB_PLACE.lng },
        { lat: selected.lat, lng: selected.lng }
      )
    : 0;

  const localTime = selected
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: selected.timezone,
      }).format(new Date())
    : null;

  return (
    <div className="globe-root">
      {/* ── 3D 画布 ─────────────────────────────────── */}
      <div ref={mountRef} className="globe-canvas" />

      {/* ── 氛围层 ──────────────────────────────────── */}
      <div className="globe-vignette" aria-hidden />
      <div className="globe-scanlines" aria-hidden />

      {/* ══ WebGL 不可用降级：整页接管，隐藏 HUD ═══════ */}
      {glFailed ? (
        <div className="globe-glfail">
          <div className="globe-glfail__card">
            <span className="globe-glfail__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3.5 9h17M3.5 15h17" />
                <path d="M4 4l16 16" stroke="#ff6b6b" />
              </svg>
            </span>
            <h2>当前环境不支持 WebGL</h2>
            <p>
              三维地球仪需要浏览器启用 WebGL 硬件加速。请更换最新版 Chrome / Edge / Firefox / Safari，
              或在浏览器设置中开启「硬件加速」后重新加载页面。
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── 悬停提示 ────────────────────────────── */}
          <div ref={tooltipRef} className="globe-tooltip" data-visible="false">
            {hovered && (
              <>
                <span
                  className="globe-tooltip__dot"
                  style={{ background: CATEGORY_META[hovered.category].color }}
                />
                <span className="globe-tooltip__name">{hovered.name}</span>
                <span className="globe-tooltip__coord">
                  {formatLatLng(hovered.lat, hovered.lng)}
                </span>
              </>
            )}
          </div>
        </>
      )}

      {/* ══ 顶栏 ═══════════════════════════════════════ */}
      {!glFailed && (
        <header className="globe-header">
          <div className="globe-brand">
            <span className="globe-brand__mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="12" cy="12" r="9.2" />
                <ellipse cx="12" cy="12" rx="4.2" ry="9.2" />
                <path d="M3 12h18M4.6 6.6h14.8M4.6 17.4h14.8" />
              </svg>
            </span>
            <div className="globe-brand__text">
              <h1>ORBIS · 全球观测仪</h1>
              <p>Interactive Terrestrial Globe · 拖拽旋转 · 滚轮缩放 · 点击标记</p>
            </div>
          </div>

          <div className="globe-clock">
            <div className="globe-clock__row">
              <span className="globe-clock__label">CST 北京时间</span>
              <span className="globe-clock__value">{clockText}</span>
            </div>
            <div className="globe-clock__row globe-clock__row--muted">
              <span className="globe-clock__label">UTC 协调世界时</span>
              <span className="globe-clock__value">{utcText}</span>
            </div>
          </div>
        </header>
      )}

      {/* ══ 控制台 HUD（仅在 WebGL 可用时渲染）═════════ */}
      {!glFailed && (
        <>
          {/* ══ 左侧控制台 ═════════════════════════════════ */}
          <aside className="globe-panel globe-panel--left">
        <section className="globe-card">
          <h2 className="globe-card__title">
            <span className="globe-card__index">01</span>观测站检索
          </h2>
          <div className="globe-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="城市 / 国家 / 英文名…"
              aria-label="检索观测站"
            />
          </div>

          {searchResults.length > 0 && (
            <ul className="globe-search__results">
              {searchResults.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => flyTo(p)}>
                    <span
                      className="globe-dot"
                      style={{ background: CATEGORY_META[p.category].color }}
                    />
                    <span className="globe-search__name">{p.name}</span>
                    <span className="globe-search__country">{p.country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="globe-chips">
            {CATEGORY_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat];
              const active = activeCategories.includes(cat);
              const count = PLACES.filter((p) => p.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  className={`globe-chip${active ? ' is-active' : ''}`}
                  style={{ '--chip': meta.color } as React.CSSProperties}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="globe-chip__glyph">{meta.glyph}</span>
                  {meta.label}
                  <span className="globe-chip__count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="globe-card">
          <h2 className="globe-card__title">
            <span className="globe-card__index">02</span>图层开关
          </h2>
          <ul className="globe-layers">
            {LAYER_LABELS.map(({ key, label, hint }) => (
              <li key={key}>
                <label className="globe-switch">
                  <span className="globe-switch__text">
                    <strong>{label}</strong>
                    <em>{hint}</em>
                  </span>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => setLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span className="globe-switch__track" aria-hidden>
                    <span className="globe-switch__thumb" />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="globe-card globe-card--compact">
          <h2 className="globe-card__title">
            <span className="globe-card__index">03</span>姿态控制
          </h2>
          <div className="globe-actions">
            <button
              type="button"
              className={`globe-btn${autoRotate ? ' is-primary' : ''}`}
              onClick={() => setAutoRotate((v) => !v)}
            >
              {autoRotate ? '❙❙ 暂停自转' : '▶ 开启自转'}
            </button>
            <button type="button" className="globe-btn" onClick={handleReset}>
              ⌖ 复位视角
            </button>
            <button type="button" className="globe-btn" onClick={handleScreenshot}>
              ⤓ 导出画面
            </button>
          </div>
          <p className="globe-actions__hint">
            按住拖动旋转 · 滚轮 / 双指捏合缩放 · 单击标记查看详情
          </p>
        </section>
      </aside>

      {/* ══ 右侧数据 ═══════════════════════════════════ */}
      <aside className="globe-panel globe-panel--right">
        <section className="globe-card">
          <h2 className="globe-card__title">
            <span className="globe-card__index">04</span>实时遥测
          </h2>
          <dl className="globe-telemetry">
            <div>
              <dt>视角中心纬度</dt>
              <dd>{formatLatLng(state.lat, state.lng).split(' / ')[0]}</dd>
            </div>
            <div>
              <dt>视角中心经度</dt>
              <dd>{formatLatLng(state.lat, state.lng).split(' / ')[1]}</dd>
            </div>
            <div>
              <dt>等效轨道高度</dt>
              <dd>{state.altitude.toFixed(0)} km</dd>
            </div>
            <div>
              <dt>缩放倍率</dt>
              <dd>{state.zoom.toFixed(2)}×</dd>
            </div>
            <div>
              <dt>可见标记</dt>
              <dd>
                {visiblePlaces.length} / {PLACES.length}
              </dd>
            </div>
            <div>
              <dt>自转状态</dt>
              <dd className={state.autoRotate ? 'is-live' : ''}>
                {state.autoRotate ? '旋转中' : '已暂停'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="globe-card globe-card--readout">
          {selected ? (
            <>
              <div className="globe-readout__head">
                <span
                  className="globe-readout__glyph"
                  style={{ color: CATEGORY_META[selected.category].color }}
                >
                  {CATEGORY_META[selected.category].glyph}
                </span>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.nameEn}</p>
                </div>
              </div>
              <div className="globe-readout__badges">
                <span className="globe-badge">{CATEGORY_META[selected.category].label}</span>
                <span className="globe-badge">{selected.country}</span>
              </div>
              <dl className="globe-telemetry globe-telemetry--compact">
                <div>
                  <dt>坐标</dt>
                  <dd>{formatLatLng(selected.lat, selected.lng)}</dd>
                </div>
                <div>
                  <dt>当地时间</dt>
                  <dd>{localTime}</dd>
                </div>
                <div>
                  <dt>距北京大圆距离</dt>
                  <dd>{formatDistance(distanceFromHub)}</dd>
                </div>
                {selected.altitude !== undefined && (
                  <div>
                    <dt>海拔</dt>
                    <dd>
                      {selected.altitude > 0 ? '+' : ''}
                      {selected.altitude} m
                    </dd>
                  </div>
                )}
              </dl>
              {selected.note && <p className="globe-readout__note">「{selected.note}」</p>}
              <button
                type="button"
                className="globe-btn globe-btn--ghost"
                onClick={() => engineRef.current?.setSelected(null)}
              >
                ✕ 取消锁定
              </button>
            </>
          ) : (
            <div className="globe-readout__empty">
              <span className="globe-readout__ring" aria-hidden />
              <h2>未锁定目标</h2>
              <p>在地球上单击任意发光标记，读取该观测站的坐标、当地时间与距离数据。</p>
            </div>
          )}
        </section>

        <section className="globe-card globe-card--compact">
          <h2 className="globe-card__title">
            <span className="globe-card__index">05</span>标记图例
          </h2>
          <ul className="globe-legend">
            {CATEGORY_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat];
              return (
                <li key={cat}>
                  <span style={{ color: meta.color }}>{meta.glyph}</span>
                  {meta.label}
                </li>
              );
            })}
          </ul>
        </section>
      </aside>

          {/* ══ 底部刻度尺 ═════════════════════════════════ */}
          <footer className="globe-footer">
            <span className="globe-footer__scale">
              {['180°W', '120°W', '60°W', '0°', '60°E', '120°E', '180°E'].map((t) => (
                <em key={t}>{t}</em>
              ))}
            </span>
          </footer>
        </>
      )}

      {/* ══ 加载遮罩 ═══════════════════════════════════ */}
      <div className={`globe-loader${ready || glFailed ? ' is-done' : ''}`}>
        <div className="globe-loader__inner">
          <div className="globe-loader__orb">
            <span />
            <span />
            <span />
          </div>
          <h2>正在装配地球</h2>
          <div className="globe-loader__bar">
            <span style={{ width: `${Math.round((progress || 0.05) * 100)}%` }} />
          </div>
          <p>{Math.round((progress || 0.05) * 100)}% · 加载地表影像与拓扑数据</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
