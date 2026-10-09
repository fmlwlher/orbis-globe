/**
 * 经纬度 <-> 三维向量 的换算工具
 * 采用与 THREE.SphereGeometry 默认 UV 展开一致的对齐方式：
 *   phi   = (90 - lat) * (PI / 180)
 *   theta = (lng + 180) * (PI / 180)
 * 这样标记点可以精确落在贴图的对应海岸线上。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const DEG2RAD = Math.PI / 180;

/** 标记/弧线贴附半径：略大于地球半径，避免与地表 z-fighting */
export const PLACE_RADIUS = 1.012;

export function latLngToVector3(lat: number, lng: number, radius = 1) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;

  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export function latLngToVector3Array(lat: number, lng: number, radius = 1): [number, number, number] {
  const v = latLngToVector3(lat, lng, radius);
  return [v.x, v.y, v.z];
}

/** 大圆距离（单位：公里） */
export function greatCircleDistance(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 生成两点之间的弧线采样点（带抬升高度，形成"飞行航线"效果） */
export function buildArcPoints(
  a: LatLng,
  b: LatLng,
  radius = 1,
  segments = 64,
  lift = 0.32
): [number, number, number][] {
  const start = latLngToVector3(a.lat, a.lng, radius);
  const end = latLngToVector3(b.lat, b.lng, radius);
  const points: [number, number, number][] = [];

  const distance = greatCircleDistance(a, b);
  // 距离越远，弧线抬得越高（最远约 20000km）
  const height = radius * (1 + lift * Math.min(1, distance / 12000));

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // 球面线性插值（slerp）
    const x = lerp(start.x, end.x, t);
    const y = lerp(start.y, end.y, t);
    const z = lerp(start.z, end.z, t);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    // 正弦抬升曲线
    const r = radius + (height - radius) * Math.sin(Math.PI * t);
    points.push([(x / len) * r, (y / len) * r, (z / len) * r]);
  }

  return points;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** 由相机位置反推地球正对点的经纬度（用于读取当前视野中心） */
export function vector3ToLatLng(x: number, y: number, z: number): LatLng {
  const radius = Math.sqrt(x * x + y * y + z * z) || 1;
  const nx = x / radius;
  const ny = y / radius;
  const nz = z / radius;

  const lat = 90 - (Math.acos(ny) * 180) / Math.PI;
  let lng = ((Math.atan2(nz, -nx) * 180) / Math.PI) - 180;
  // 归一化到 [-180, 180]
  while (lng < -180) lng += 360;
  while (lng > 180) lng -= 360;

  return { lat, lng };
}

export function formatLatLng(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${latDir} / ${Math.abs(lng).toFixed(2)}° ${lngDir}`;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} km`;
}

/** 经纬度数值的紧凑标签，用于网格度数标注（12°N / 105°E） */
export function formatDegree(value: number, kind: 'lat' | 'lng'): string {
  if (value === 0) return '0°';
  const dir = kind === 'lat' ? (value > 0 ? 'N' : 'S') : value > 0 ? 'E' : 'W';
  return `${Math.abs(Math.round(value))}°${dir}`;
}

/** 坐标解析结果 */
export interface ParsedCoord {
  value?: number;
  error?: string;
}

/**
 * 输入容错：把用户随手写的坐标补全为规范格式「数字°方向字母」。
 *
 * 主要处理「忘记输入度符号」这一最常见的情况：
 *   30N  → 30°N      30s  → 30°S
 *   45e  → 45°E      45W  → 45°W
 *   30 N → 30°N      30   → 30°（缺方向字母时只补度符号，不擅自假设方向）
 *
 * 方向字母即使与当前类别不符也照常补度符号（30E 在纬度框 → 30°E），
 * 让随后 parseAxis 报出的是「方向字母应为 N 或 S」这个真正的错误。
 * 已在正确格式（含 °）时仅做去空格与字母大写的规整；无法识别的输入原样返回。
 */
export function normalizeCoordInput(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // 数字 + 可选度符号 + 可选方向字母（允许各段之间有空格）
  // 注意：方向字母不限 NSEW，以便错用字母时也能先把度符号补上
  const m = text.match(/^(\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?$/);
  if (!m) return text;

  const [, digits, letter] = m;
  const suffix = letter ? letter.toUpperCase() : '';
  return `${digits}°${suffix}`;
}

/**
 * 解析纬度输入。
 * 格式为「数字 + 度符号° + 方向字母」（字母不区分大小写，度符号必填）：
 *   30°N / 30°n → 北纬 30    30°S / 30°s → 南纬 30
 * 度符号与方向字母之间的空格可有可无（30° N 亦可）。
 * 同时宽容接受省略度符号的写法（30N），便于用户快速输入。
 */
export function parseLatitude(raw: string): ParsedCoord {
  const text = normalizeCoordInput(raw);
  if (!text) return { error: '请输入纬度' };
  return parseAxis(text, 'lat');
}

/**
 * 解析经度输入。
 * 格式为「数字 + 度符号° + 方向字母」：
 *   45°E → 东经 45    45°W → 西经 45
 * 同样宽容接受省略度符号的写法（45E）。
 */
export function parseLongitude(raw: string): ParsedCoord {
  const text = normalizeCoordInput(raw);
  if (!text) return { error: '请输入经度' };
  return parseAxis(text, 'lng');
}

function parseAxis(text: string, kind: 'lat' | 'lng'): ParsedCoord {
  const posDir = kind === 'lat' ? 'N' : 'E';
  const negDir = kind === 'lat' ? 'S' : 'W';
  const label = kind === 'lat' ? '纬度' : '经度';
  const limit = kind === 'lat' ? 90 : 180;

  // 匹配：数字(可含小数) + 必填度符号 + 方向字母；方向字母与度符号间允许空白
  const m = text.match(/^(\d+(?:\.\d+)?)\s*°\s*([NSEWnsew])$/);
  if (!m) {
    const sample = kind === 'lat' ? '30' : '45';
    return { error: `${label}格式应为「数字°${posDir}/${negDir}」，例如 ${sample}°${posDir}` };
  }

  const [, digits, letter] = m;
  const magnitude = Number.parseFloat(digits);
  if (!Number.isFinite(magnitude)) return { error: `${label}数值无效` };

  // 方向字母与经纬度种类必须匹配（纬度用 N/S，经度用 E/W）
  const upper = letter.toUpperCase();
  if (upper !== posDir && upper !== negDir) {
    return { error: `${label}方向字母应为 ${posDir} 或 ${negDir}` };
  }
  const value = upper === negDir ? -magnitude : magnitude;

  if (value < -limit || value > limit) {
    return { error: `${label}需在 ${limit}°${negDir} ~ ${limit}°${posDir} 之间` };
  }

  return { value };
}

/**
 * 失焦时的即时校验结果，供输入框做轻量提示 / 标红。
 *
 * 与 parseAxis 的区别：
 * - 不依赖用户是否点击「定位」，随时可用
 * - 缺方向字母时归为 kind='missing-dir'，配合 hint 给出提示文案
 * - 缺度符号时归为 kind='missing-degree'，只有数字则归为 'incomplete'
 * - 超范围归为 'range'，并给出正确的范围区间
 */
export type CoordCheckKind =
  | 'ok'
  | 'empty'
  | 'missing-dir'
  | 'missing-degree'
  | 'incomplete'
  | 'wrong-dir'
  | 'range'
  | 'invalid';

export interface CoordCheck {
  kind: CoordCheckKind;
  /** 提示文案（ok 时为 undefined） */
  hint?: string;
  /** 解析出的数值（仅 kind==='ok' 时存在） */
  value?: number;
}

/**
 * 对单个输入框做即时校验，返回适合放在输入框下方的轻提示文案。
 *
 * 设计原则：**只提示、不擅自补全方向**——缺方向字母时告诉用户该填什么，
 * 而不是替用户猜一个 N/S/E/W。
 */
export function checkAxisInput(raw: string, kind: 'lat' | 'lng'): CoordCheck {
  const text = normalizeCoordInput(raw);
  if (!text) return { kind: 'empty' };

  const posDir = kind === 'lat' ? 'N' : 'E';
  const negDir = kind === 'lat' ? 'S' : 'W';
  const limit = kind === 'lat' ? 90 : 180;
  const label = kind === 'lat' ? '纬度' : '经度';

  // 只有数字、没有方向字母：给出补方向字母的提示
  const digitsOnly = text.match(/^(\d+(?:\.\d+)?)°$/);
  if (digitsOnly) {
    const magnitude = Number.parseFloat(digitsOnly[1]);
    if (magnitude > limit) {
      return { kind: 'range', hint: `${label}需在 0°-${limit}° 之间` };
    }
    return {
      kind: 'missing-dir',
      hint: `请输入方向字母，例如 ${posDir} 或 ${negDir}`,
    };
  }

  // 完整格式：数字 + 度符号 + 方向字母
  const m = text.match(/^(\d+(?:\.\d+)?)\s*°\s*([NSEWnsew])$/);
  if (!m) {
    return { kind: 'incomplete', hint: `${label}格式如 30°${posDir}` };
  }

  const magnitude = Number.parseFloat(m[1]);
  if (!Number.isFinite(magnitude)) return { kind: 'invalid', hint: `${label}数值无效` };

  const upper = m[2].toUpperCase();
  if (upper !== posDir && upper !== negDir) {
    return { kind: 'wrong-dir', hint: `${label}的方向字母应为 ${posDir} 或 ${negDir}` };
  }

  if (magnitude > limit) {
    return { kind: 'range', hint: `${label}需在 0°-${limit}° 之间` };
  }

  return { kind: 'ok', value: upper === negDir ? -magnitude : magnitude };
}

/** 把经纬度格式化为带度符号与方向字母的输入格式（30°N / 45°W） */
export function toCoordInput(lat: number, lng: number): { lat: string; lng: string } {
  const fmt = (v: number, pos: string, neg: string) => {
    if (v === 0) return '0°';
    const abs = Math.abs(v);
    const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/\.?0+$/, '');
    return `${num}°${v > 0 ? pos : neg}`;
  };
  return { lat: fmt(lat, 'N', 'S'), lng: fmt(lng, 'E', 'W') };
}
