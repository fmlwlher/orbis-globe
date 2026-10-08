/**
 * 全球主要城市 / 地标数据集
 * 用于地球仪上的标记点、观测站列表与航线演示
 */

export type Category =
  | 'capital'
  | 'metropolis'
  | 'landmark'
  | 'observatory'
  | 'chnCapital';

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
  chnCapital: {
    label: '中国省会',
    color: '#ff4d7d',
    glow: 'rgba(255,77,125,0.55)',
    glyph: '⬟',
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

  // ── 中国省会 / 直辖市 / 特别行政区 ────────────────────────
  // 华北
  { id: 'shijiazhuang', name: '石家庄', nameEn: 'Shijiazhuang', country: '中国 · 河北', lat: 38.0428, lng: 114.5149, category: 'chnCapital', weight: 0.62, timezone: 'Asia/Shanghai', note: '河北省会' },
  { id: 'taiyuan', name: '太原', nameEn: 'Taiyuan', country: '中国 · 山西', lat: 37.8706, lng: 112.5489, category: 'chnCapital', weight: 0.6, timezone: 'Asia/Shanghai', note: '山西省会' },
  { id: 'hohhot', name: '呼和浩特', nameEn: 'Hohhot', country: '中国 · 内蒙古', lat: 40.8426, lng: 111.7492, category: 'chnCapital', weight: 0.55, timezone: 'Asia/Shanghai', note: '内蒙古自治区首府' },
  { id: 'tianjin', name: '天津', nameEn: 'Tianjin', country: '中国 · 直辖市', lat: 39.0842, lng: 117.2009, category: 'chnCapital', weight: 0.78, timezone: 'Asia/Shanghai', note: '直辖市 · 北方重要港口' },

  // 东北
  { id: 'shenyang', name: '沈阳', nameEn: 'Shenyang', country: '中国 · 辽宁', lat: 41.8057, lng: 123.4315, category: 'chnCapital', weight: 0.65, timezone: 'Asia/Shanghai', note: '辽宁省会' },
  { id: 'changchun', name: '长春', nameEn: 'Changchun', country: '中国 · 吉林', lat: 43.8171, lng: 125.3235, category: 'chnCapital', weight: 0.6, timezone: 'Asia/Shanghai', note: '吉林省会' },
  { id: 'harbin', name: '哈尔滨', nameEn: 'Harbin', country: '中国 · 黑龙江', lat: 45.8038, lng: 126.534, category: 'chnCapital', weight: 0.63, timezone: 'Asia/Shanghai', note: '黑龙江省会 · 冰城' },

  // 华东
  { id: 'nanjing', name: '南京', nameEn: 'Nanjing', country: '中国 · 江苏', lat: 32.0603, lng: 118.7969, category: 'chnCapital', weight: 0.72, timezone: 'Asia/Shanghai', note: '江苏省会 · 六朝古都' },
  { id: 'hangzhou', name: '杭州', nameEn: 'Hangzhou', country: '中国 · 浙江', lat: 30.2741, lng: 120.1551, category: 'chnCapital', weight: 0.74, timezone: 'Asia/Shanghai', note: '浙江省会' },
  { id: 'hefei', name: '合肥', nameEn: 'Hefei', country: '中国 · 安徽', lat: 31.8206, lng: 117.2272, category: 'chnCapital', weight: 0.6, timezone: 'Asia/Shanghai', note: '安徽省会' },
  { id: 'fuzhou', name: '福州', nameEn: 'Fuzhou', country: '中国 · 福建', lat: 26.0745, lng: 119.2965, category: 'chnCapital', weight: 0.58, timezone: 'Asia/Shanghai', note: '福建省会' },
  { id: 'nanchang', name: '南昌', nameEn: 'Nanchang', country: '中国 · 江西', lat: 28.682, lng: 115.8579, category: 'chnCapital', weight: 0.57, timezone: 'Asia/Shanghai', note: '江西省会' },
  { id: 'jinan', name: '济南', nameEn: 'Jinan', country: '中国 · 山东', lat: 36.6512, lng: 117.1201, category: 'chnCapital', weight: 0.63, timezone: 'Asia/Shanghai', note: '山东省会 · 泉城' },
  { id: 'taipei', name: '中国台北', nameEn: 'Taipei, China', country: '中国 · 台湾', lat: 25.033, lng: 121.5654, category: 'chnCapital', weight: 0.66, timezone: 'Asia/Taipei', note: '台湾地区行政中心' },

  // 华中
  { id: 'zhengzhou', name: '郑州', nameEn: 'Zhengzhou', country: '中国 · 河南', lat: 34.7466, lng: 113.6254, category: 'chnCapital', weight: 0.65, timezone: 'Asia/Shanghai', note: '河南省会 · 中原枢纽' },
  { id: 'wuhan', name: '武汉', nameEn: 'Wuhan', country: '中国 · 湖北', lat: 30.5928, lng: 114.3055, category: 'chnCapital', weight: 0.7, timezone: 'Asia/Shanghai', note: '湖北省会 · 九省通衢' },
  { id: 'changsha', name: '长沙', nameEn: 'Changsha', country: '中国 · 湖南', lat: 28.2282, lng: 112.9388, category: 'chnCapital', weight: 0.62, timezone: 'Asia/Shanghai', note: '湖南省会' },

  // 华南
  { id: 'guangzhou', name: '广州', nameEn: 'Guangzhou', country: '中国 · 广东', lat: 23.1291, lng: 113.2644, category: 'chnCapital', weight: 0.85, timezone: 'Asia/Shanghai', note: '广东省会 · 千年商都' },
  { id: 'nanning', name: '南宁', nameEn: 'Nanning', country: '中国 · 广西', lat: 22.817, lng: 108.3665, category: 'chnCapital', weight: 0.55, timezone: 'Asia/Shanghai', note: '广西壮族自治区首府' },
  { id: 'haikou', name: '海口', nameEn: 'Haikou', country: '中国 · 海南', lat: 20.0444, lng: 110.1999, category: 'chnCapital', weight: 0.5, timezone: 'Asia/Shanghai', note: '海南省会' },
  { id: 'macao', name: '中国澳门', nameEn: 'Macao, China', country: '中国 · 特别行政区', lat: 22.1987, lng: 113.5439, category: 'chnCapital', weight: 0.52, timezone: 'Asia/Macau', note: '特别行政区' },

  // 西南
  { id: 'chengdu', name: '成都', nameEn: 'Chengdu', country: '中国 · 四川', lat: 30.5728, lng: 104.0668, category: 'chnCapital', weight: 0.72, timezone: 'Asia/Shanghai', note: '四川省会 · 天府之国' },
  { id: 'chongqing', name: '重庆', nameEn: 'Chongqing', country: '中国 · 直辖市', lat: 29.563, lng: 106.5516, category: 'chnCapital', weight: 0.76, timezone: 'Asia/Shanghai', note: '直辖市 · 山城' },
  { id: 'guiyang', name: '贵阳', nameEn: 'Guiyang', country: '中国 · 贵州', lat: 26.647, lng: 106.6302, category: 'chnCapital', weight: 0.55, timezone: 'Asia/Shanghai', note: '贵州省会 · 大数据之都' },
  { id: 'kunming', name: '昆明', nameEn: 'Kunming', country: '中国 · 云南', lat: 25.0389, lng: 102.7183, category: 'chnCapital', weight: 0.58, timezone: 'Asia/Shanghai', note: '云南省会 · 春城' },
  { id: 'lhasa', name: '拉萨', nameEn: 'Lhasa', country: '中国 · 西藏', lat: 29.652, lng: 91.1721, category: 'chnCapital', weight: 0.5, timezone: 'Asia/Shanghai', altitude: 3650, note: '西藏自治区首府 · 世界海拔最高首府之一' },

  // 西北
  { id: 'xian', name: '西安', nameEn: "Xi'an", country: '中国 · 陕西', lat: 34.3416, lng: 108.9398, category: 'chnCapital', weight: 0.68, timezone: 'Asia/Shanghai', note: '陕西省会 · 十三朝古都' },
  { id: 'lanzhou', name: '兰州', nameEn: 'Lanzhou', country: '中国 · 甘肃', lat: 36.0611, lng: 103.8343, category: 'chnCapital', weight: 0.53, timezone: 'Asia/Shanghai', note: '甘肃省会 · 黄河穿城而过' },
  { id: 'xining', name: '西宁', nameEn: 'Xining', country: '中国 · 青海', lat: 36.6171, lng: 101.7782, category: 'chnCapital', weight: 0.48, timezone: 'Asia/Shanghai', altitude: 2261, note: '青海省会 · 青藏门户' },
  { id: 'yinchuan', name: '银川', nameEn: 'Yinchuan', country: '中国 · 宁夏', lat: 38.4872, lng: 106.2309, category: 'chnCapital', weight: 0.47, timezone: 'Asia/Shanghai', note: '宁夏回族自治区首府' },
  { id: 'urumqi', name: '乌鲁木齐', nameEn: 'Ürümqi', country: '中国 · 新疆', lat: 43.8256, lng: 87.6168, category: 'chnCapital', weight: 0.55, timezone: 'Asia/Shanghai', note: '新疆维吾尔自治区首府 · 距海最远的城市' },
];

export const HUB_PLACE = PLACES.find((p) => p.id === 'beijing')!;
