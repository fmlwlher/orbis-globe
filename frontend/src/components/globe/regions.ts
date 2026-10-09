/**
 * 大洲 / 大洋名称标注数据
 *
 * 坐标为各区域的「视觉重心」，而非严格的几何中心——目的是让文字落在
 * 陆地（或洋面）主体之上、避开边缘，使字看起来"压在这块区域上"。
 */

export type RegionKind = 'continent' | 'ocean';

export interface Region {
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  lat: number;
  lng: number;
  kind: RegionKind;
  /**
   * 字号系数：面积越大的区域字越大，形成视觉层级。
   * 1.0 为基准（约等于大洋的平均字号）。
   */
  scale: number;
}

export const REGIONS: Region[] = [
  // ── 大洲 ──────────────────────────────────────────────
  { id: 'asia', name: '亚洲', nameEn: 'ASIA', lat: 45, lng: 90, kind: 'continent', scale: 1.25 },
  { id: 'africa', name: '非洲', nameEn: 'AFRICA', lat: 3, lng: 21, kind: 'continent', scale: 1.15 },
  {
    id: 'north-america',
    name: '北美洲',
    nameEn: 'NORTH AMERICA',
    lat: 46,
    lng: -100,
    kind: 'continent',
    scale: 1.15,
  },
  {
    id: 'south-america',
    name: '南美洲',
    nameEn: 'SOUTH AMERICA',
    lat: -14,
    lng: -59,
    kind: 'continent',
    scale: 1.1,
  },
  { id: 'europe', name: '欧洲', nameEn: 'EUROPE', lat: 51, lng: 16, kind: 'continent', scale: 0.92 },
  { id: 'oceania', name: '大洋洲', nameEn: 'OCEANIA', lat: -25, lng: 134, kind: 'continent', scale: 0.92 },
  {
    id: 'antarctica',
    name: '南极洲',
    nameEn: 'ANTARCTICA',
    lat: -76,
    lng: 10,
    kind: 'continent',
    scale: 0.96,
  },

  // ── 大洋 ──────────────────────────────────────────────
  {
    id: 'pacific',
    name: '太平洋',
    nameEn: 'PACIFIC OCEAN',
    lat: -8,
    lng: -160,
    kind: 'ocean',
    scale: 1.28,
  },
  {
    id: 'atlantic',
    name: '大西洋',
    nameEn: 'ATLANTIC OCEAN',
    lat: 8,
    lng: -32,
    kind: 'ocean',
    scale: 1.18,
  },
  {
    id: 'indian',
    name: '印度洋',
    nameEn: 'INDIAN OCEAN',
    lat: -22,
    lng: 76,
    kind: 'ocean',
    scale: 1.15,
  },
  {
    id: 'arctic',
    name: '北冰洋',
    nameEn: 'ARCTIC OCEAN',
    // 贴近极点但略微偏向太平洋一侧：既保持"被各大洲环抱"的直观位置，
    // 又不与「欧洲」「北美洲」在低纬视角下挤在一起。
    lat: 86,
    lng: 170,
    kind: 'ocean',
    scale: 0.86,
  },
  {
    id: 'southern',
    name: '南冰洋',
    nameEn: 'SOUTHERN OCEAN',
    lat: -52,
    lng: 108,
    kind: 'ocean',
    scale: 0.86,
  },
];

/** 大洲 / 大洋的配色 */
export const REGION_STYLE: Record<RegionKind, { color: string; glow: string }> = {
  continent: {
    color: 'rgba(255, 232, 178, 0.96)', // 暖金：与陆地的暖色调呼应
    glow: 'rgba(120, 80, 20, 0.95)',
  },
  ocean: {
    color: 'rgba(150, 214, 255, 0.95)', // 冷蓝：与洋面的蓝调呼应
    glow: 'rgba(6, 40, 80, 0.95)',
  },
};
