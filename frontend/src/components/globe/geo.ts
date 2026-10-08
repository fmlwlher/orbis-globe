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
