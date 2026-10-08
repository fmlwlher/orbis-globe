/**
 * 全球主要城市 / 地标数据集
 * 用于地球仪上的标记点、观测站列表与航线演示
 */

export type Category = 'capital' | 'metropolis' | 'landmark' | 'observatory';

export interface Place {
  id: string;
  name: string;
  nameEn: string;
  country: string;
  lat: number;
  lng: number;
  category: Category;
  /** 相对人口规模，仅用于视觉权重 */
  weight: number;
  timezone: string;
  altitude?: number;
  note?: string;
}

export const CATEGORY_META: Record<
  Category,
  { label: string; color: string; glow: string; glyph: string }
> = {
  capital: {
    label: '首都',
    color: '#ffb020',
    glow: 'rgba(255,176,32,0.55)',
    glyph: '★',
  },
  metropolis: {
    label: '大都会',
    color: '#3fe0d0',
    glow: 'rgba(63,224,208,0.5)',
    glyph: '●',
  },
  landmark: {
    label: '地标',
    color: '#ff6b6b',
    glow: 'rgba(255,107,107,0.5)',
    glyph: '◆',
  },
  observatory: {
    label: '天文台',
    color: '#a78bfa',
    glow: 'rgba(167,139,250,0.5)',
    glyph: '✦',
  },
};

export const PLACES: Place[] = [
  // ── 首都 ────────────────────────────────────────────────
  { id: 'beijing', name: '北京', nameEn: 'Beijing', country: '中国', lat: 39.9042, lng: 116.4074, category: 'capital', weight: 1.0, timezone: 'Asia/Shanghai', note: '东亚政治与科技中枢' },
  { id: 'tokyo', name: '东京', nameEn: 'Tokyo', country: '日本', lat: 35.6762, lng: 139.6503, category: 'capital', weight: 0.95, timezone: 'Asia/Tokyo', note: '全球人口最多的都会区' },
  { id: 'london', name: '伦敦', nameEn: 'London', country: '英国', lat: 51.5074, lng: -0.1278, category: 'capital', weight: 0.9, timezone: 'Europe/London', note: '本初子午线起点' },
  { id: 'paris', name: '巴黎', nameEn: 'Paris', country: '法国', lat: 48.8566, lng: 2.3522, category: 'capital', weight: 0.85, timezone: 'Europe/Paris' },
  { id: 'washington', name: '华盛顿', nameEn: 'Washington D.C.', country: '美国', lat: 38.9072, lng: -77.0369, category: 'capital', weight: 0.82, timezone: 'America/New_York' },
  { id: 'moscow', name: '莫斯科', nameEn: 'Moscow', country: '俄罗斯', lat: 55.7558, lng: 37.6173, category: 'capital', weight: 0.8, timezone: 'Europe/Moscow' },
  { id: 'canberra', name: '堪培拉', nameEn: 'Canberra', country: '澳大利亚', lat: -35.2809, lng: 149.13, category: 'capital', weight: 0.6, timezone: 'Australia/Sydney' },
  { id: 'brasilia', name: '巴西利亚', nameEn: 'Brasília', country: '巴西', lat: -15.7975, lng: -47.8919, category: 'capital', weight: 0.6, timezone: 'America/Sao_Paulo' },
  { id: 'cairo', name: '开罗', nameEn: 'Cairo', country: '埃及', lat: 30.0444, lng: 31.2357, category: 'capital', weight: 0.7, timezone: 'Africa/Cairo' },
  { id: 'newdelhi', name: '新德里', nameEn: 'New Delhi', country: '印度', lat: 28.6139, lng: 77.209, category: 'capital', weight: 0.85, timezone: 'Asia/Kolkata' },
  { id: 'ottawa', name: '渥太华', nameEn: 'Ottawa', country: '加拿大', lat: 45.4215, lng: -75.6972, category: 'capital', weight: 0.55, timezone: 'America/Toronto' },
  { id: 'pretoria', name: '比勒陀利亚', nameEn: 'Pretoria', country: '南非', lat: -25.7479, lng: 28.2293, category: 'capital', weight: 0.5, timezone: 'Africa/Johannesburg' },

  // ── 大都会 ──────────────────────────────────────────────
  { id: 'shanghai', name: '上海', nameEn: 'Shanghai', country: '中国', lat: 31.2304, lng: 121.4737, category: 'metropolis', weight: 1.0, timezone: 'Asia/Shanghai', note: '世界最大集装箱港口' },
  { id: 'shenzhen', name: '深圳', nameEn: 'Shenzhen', country: '中国', lat: 22.5431, lng: 114.0579, category: 'metropolis', weight: 0.9, timezone: 'Asia/Shanghai' },
  { id: 'hongkong', name: '中国香港', nameEn: 'Hong Kong, China', country: '中国', lat: 22.3193, lng: 114.1694, category: 'metropolis', weight: 0.88, timezone: 'Asia/Hong_Kong', note: '国际金融与航运枢纽' },
  { id: 'singapore', name: '新加坡', nameEn: 'Singapore', country: '新加坡', lat: 1.3521, lng: 103.8198, category: 'metropolis', weight: 0.85, timezone: 'Asia/Singapore' },
  { id: 'newyork', name: '纽约', nameEn: 'New York', country: '美国', lat: 40.7128, lng: -74.006, category: 'metropolis', weight: 0.98, timezone: 'America/New_York' },
  { id: 'losangeles', name: '洛杉矶', nameEn: 'Los Angeles', country: '美国', lat: 34.0522, lng: -118.2437, category: 'metropolis', weight: 0.88, timezone: 'America/Los_Angeles' },
  { id: 'saopaulo', name: '圣保罗', nameEn: 'São Paulo', country: '巴西', lat: -23.5505, lng: -46.6333, category: 'metropolis', weight: 0.85, timezone: 'America/Sao_Paulo' },
  { id: 'dubai', name: '迪拜', nameEn: 'Dubai', country: '阿联酋', lat: 25.2048, lng: 55.2708, category: 'metropolis', weight: 0.8, timezone: 'Asia/Dubai' },
  { id: 'mumbai', name: '孟买', nameEn: 'Mumbai', country: '印度', lat: 19.076, lng: 72.8777, category: 'metropolis', weight: 0.85, timezone: 'Asia/Kolkata' },
  { id: 'berlin', name: '柏林', nameEn: 'Berlin', country: '德国', lat: 52.52, lng: 13.405, category: 'metropolis', weight: 0.75, timezone: 'Europe/Berlin' },
  { id: 'istanbul', name: '伊斯坦布尔', nameEn: 'Istanbul', country: '土耳其', lat: 41.0082, lng: 28.9784, category: 'metropolis', weight: 0.78, timezone: 'Europe/Istanbul' },
  { id: 'mexicocity', name: '墨西哥城', nameEn: 'Mexico City', country: '墨西哥', lat: 19.4326, lng: -99.1332, category: 'metropolis', weight: 0.78, timezone: 'America/Mexico_City', altitude: 2240 },

  // ── 自然 / 人文地标 ─────────────────────────────────────
  { id: 'everest', name: '珠穆朗玛峰', nameEn: 'Mount Everest', country: '中国 / 尼泊尔', lat: 27.9881, lng: 86.925, category: 'landmark', weight: 0.9, timezone: 'Asia/Kathmandu', altitude: 8848.86, note: '地球陆地最高点' },
  { id: 'mariana', name: '马里亚纳海沟', nameEn: 'Mariana Trench', country: '西太平洋', lat: 11.35, lng: 142.2, category: 'landmark', weight: 0.7, timezone: 'Pacific/Guam', altitude: -10994, note: '地球海洋最深处' },
  { id: 'sahara', name: '撒哈拉沙漠', nameEn: 'Sahara Desert', country: '北非', lat: 23.4162, lng: 25.6628, category: 'landmark', weight: 0.6, timezone: 'Africa/Algiers', note: '世界最大热沙漠' },
  { id: 'amazon', name: '亚马逊雨林', nameEn: 'Amazon Rainforest', country: '巴西', lat: -3.4653, lng: -62.2159, category: 'landmark', weight: 0.65, timezone: 'America/Manaus', note: '地球之肺' },
  { id: 'antarctica', name: '南极冰盖', nameEn: 'Antarctic Ice Sheet', country: '南极洲', lat: -82.8628, lng: 135.0, category: 'landmark', weight: 0.6, timezone: 'Antarctica/McMurdo', note: '全球 90% 的淡水资源' },
  { id: 'greenland', name: '格陵兰冰盖', nameEn: 'Greenland Ice Sheet', country: '格陵兰', lat: 72.0, lng: -40.0, category: 'landmark', weight: 0.5, timezone: 'America/Nuuk', note: '北半球最大冰体' },
  { id: 'greatbarrier', name: '大堡礁', nameEn: 'Great Barrier Reef', country: '澳大利亚', lat: -18.2871, lng: 147.6992, category: 'landmark', weight: 0.55, timezone: 'Australia/Brisbane', note: '世界最大珊瑚礁群' },
  { id: 'giza', name: '吉萨金字塔', nameEn: 'Giza Pyramids', country: '埃及', lat: 29.9792, lng: 31.1342, category: 'landmark', weight: 0.6, timezone: 'Africa/Cairo' },
  { id: 'machupicchu', name: '马丘比丘', nameEn: 'Machu Picchu', country: '秘鲁', lat: -13.1631, lng: -72.545, category: 'landmark', weight: 0.55, timezone: 'America/Lima', altitude: 2430 },

  // ── 天文台 ──────────────────────────────────────────────
  { id: 'maunakea', name: '莫纳克亚天文台', nameEn: 'Mauna Kea Observatory', country: '美国 · 夏威夷', lat: 19.8207, lng: -155.4681, category: 'observatory', weight: 0.62, timezone: 'Pacific/Honolulu', altitude: 4205 },
  { id: 'alma', name: 'ALMA 阵列', nameEn: 'ALMA Array', country: '智利', lat: -23.0193, lng: -67.7549, category: 'observatory', weight: 0.58, timezone: 'America/Santiago', altitude: 5058 },
  { id: 'southpole', name: '南极望远镜', nameEn: 'South Pole Telescope', country: '南极洲', lat: -89.99, lng: 0, category: 'observatory', weight: 0.55, timezone: 'Antarctica/South_Pole', altitude: 2835 },
  { id: 'fast', name: 'FAST 天眼', nameEn: 'FAST Radio Telescope', country: '中国 · 贵州', lat: 25.6529, lng: 106.8563, category: 'observatory', weight: 0.6, timezone: 'Asia/Shanghai', note: '世界最大单口径射电望远镜' },
  { id: 'paranal', name: '帕瑞纳天文台', nameEn: 'Paranal Observatory', country: '智利', lat: -24.6272, lng: -70.4042, category: 'observatory', weight: 0.55, timezone: 'America/Santiago', altitude: 2635 },
  { id: 'calaralto', name: '卡拉阿托天文台', nameEn: 'Calar Alto Observatory', country: '西班牙', lat: 37.2236, lng: -2.5461, category: 'observatory', weight: 0.45, timezone: 'Europe/Madrid', altitude: 2168 },
];

export const HUB_PLACE = PLACES.find((p) => p.id === 'beijing')!;
