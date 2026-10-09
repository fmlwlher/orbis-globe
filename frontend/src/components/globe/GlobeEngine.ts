/**
 * 地球仪三维引擎
 * 基于 Three.js 的自定义渲染层：拖拽旋转、惯性阻尼、滚轮/双指缩放、
 * 标记拾取、航线弧光、星空、大气辉光。
 */

import * as THREE from 'three';
import {
  DEG2RAD,
  PLACE_RADIUS,
  buildArcPoints,
  formatDegree,
  latLngToVector3,
  vector3ToLatLng,
} from './geo';
import {
  CATEGORY_META,
  PLACES,
  type Category,
  type Place,
} from './places';
import { REGIONS, REGION_STYLE, type Region } from './regions';

export interface GlobeState {
  lat: number;
  lng: number;
  altitude: number;
  autoRotate: boolean;
  zoom: number;
}

export interface GlobeOptions {
  onStateChange?: (state: GlobeState) => void;
  onHover?: (place: Place | null, screen: { x: number; y: number }) => void;
  onSelect?: (place: Place | null) => void;
  onReady?: () => void;
  onProgress?: (ratio: number) => void;
}

export type LayerKey =
  | 'satellite'
  | 'grid'
  | 'meridians'
  | 'meridianLabels'
  | 'parallels'
  | 'parallelLabels'
  | 'axis'
  | 'regions'
  | 'markers'
  | 'arcs'
  | 'atmosphere'
  | 'stars'
  | 'zoneTint'
  | 'hemisphereTint'
  | 'ewTint';

export interface LayerVisibility {
  satellite: boolean;
  grid: boolean;
  meridians: boolean;
  meridianLabels: boolean;
  parallels: boolean;
  parallelLabels: boolean;
  axis: boolean;
  /** 大洲 / 大洋名称标注 */
  regions: boolean;
  markers: boolean;
  arcs: boolean;
  atmosphere: boolean;
  stars: boolean;
  /** 低 / 中 / 高纬度分带着色（默认关闭） */
  zoneTint: boolean;
  /** 南 / 北半球着色（默认关闭） */
  hemisphereTint: boolean;
  /** 东 / 西半球着色（默认关闭） */
  ewTint: boolean;
}

const EARTH_RADIUS = 1;
const MIN_DISTANCE = 1.28;
const MAX_DISTANCE = 7.0;

/** 全部分类（用于过滤默认值） */
const CATEGORY_ALL: Category[] = [
  'capital',
  'chnCapital',
  'metropolis',
  'landmark',
  'observatory',
];

/** 探测当前环境是否支持 WebGL */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

/** 标记点 sprite 画布尺寸 */
const MARKER_CANVAS = 128;

function makeMarkerTexture(category: Category): THREE.Texture {
  const meta = CATEGORY_META[category];
  const canvas = document.createElement('canvas');
  canvas.width = MARKER_CANVAS;
  canvas.height = MARKER_CANVAS;
  const ctx = canvas.getContext('2d')!;
  const c = MARKER_CANVAS / 2;

  // 外发光
  const grad = ctx.createRadialGradient(c, c, 4, c, c, c);
  grad.addColorStop(0, meta.glow);
  grad.addColorStop(0.42, meta.glow.replace('0.5', '0.16'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // 环
  ctx.strokeStyle = meta.color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // 实心核
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(c, c, c * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = meta.color;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.12, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GlobeEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private options: GlobeOptions;

  private earthGroup: THREE.Group;
  private earthMesh!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  private atmosphereMesh!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private gridGroup!: THREE.Group;
  private meridianGroup!: THREE.Group;
  private meridianLabelGroup!: THREE.Group;
  private parallelGroup!: THREE.Group;
  private parallelLabelGroup!: THREE.Group;
  private axisGroup!: THREE.Group;
  private regionGroup!: THREE.Group;
  private regionSprites: THREE.Sprite[] = [];
  /** 东西半球分界线（20°W / 160°E）的共享材质 */
  private hemisphereDividerMat!: THREE.MeshBasicMaterial;
  private markerGroup!: THREE.Group;
  private arcGroup!: THREE.Group;
  private starField!: THREE.Points;
  private selectionRing!: THREE.Sprite;
  private coordPoint!: THREE.Sprite;

  private labelTextures = new Map<string, THREE.Texture>();

  private markerSprites: THREE.Sprite[] = [];
  private markerTextureCache = new Map<Category, THREE.Texture>();
  private arcMaterials: THREE.LineBasicMaterial[] = [];
  private loadingManager: THREE.LoadingManager;
  private textures: Record<string, THREE.Texture> = {};
  private categoryFilter: Category[] = [...CATEGORY_ALL];

  // —— 相机球坐标 ——
  private targetLat = 25;
  private targetLng = 20;
  private currentLat = 25;
  private currentLng = 20;
  private distance = 3.1;
  private targetDistance = 3.1;

  /**
   * 地轴倾角模式：地轴（y 轴）投影到屏幕后与水平线的夹角（度）。
   * 90 = 地轴竖直（常规球坐标视图）；复位视角设置为真实地轴倾角 66.5°。
   */
  private axisTiltDeg = 90;
  private targetAxisTiltDeg = 90;

  // —— 交互 ——
  private isDragging = false;
  private hasDragged = false;
  private pointerDownAt = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private velocity = { lat: 0, lng: 0 };
  private activePointerId: number | null = null;
  private pinchStartDistance = 0;
  private pinchStartCamDistance = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private autoRotate = true;
  private autoRotateSpeed = 0.045;
  private userIdleTimer = 0;
  /**
   * 定位保持标记：focusOn 聚焦到某个坐标后置 true，用户在界面上开启自转
   * 或手动拖拽/缩放后才清除。作用是让被定位的点稳定停在画面正中——
   * 否则自转会在聚焦结束约 2.4 秒后恢复，把刚定位的点转走。
   */
  private focusHold = false;
  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();
  private hovered: Place | null = null;
  private selected: Place | null = null;
  private frameId = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private stateReportTimer = 0;
  private layers: LayerVisibility = {
    satellite: true,
    grid: true,
    meridians: true,
    meridianLabels: true,
    parallels: true,
    parallelLabels: true,
    axis: true,
    regions: true,
    markers: true,
    arcs: true,
    atmosphere: true,
    stars: true,
    // 三个地理分区着色开关：默认全部关闭
    zoneTint: false,
    hemisphereTint: false,
    ewTint: false,
  };

  constructor(container: HTMLElement, options: GlobeOptions = {}) {
    this.container = container;
    this.options = options;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    if (!isWebGLAvailable()) {
      throw new Error('WEBGL_UNAVAILABLE');
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03040a);

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 200);
    this.scene.add(this.camera);

    this.earthGroup = new THREE.Group();
    // 注意：不做额外旋转 —— 球体 UV 展开已与经纬度换算对齐，
    // 相机、标记、网格共用同一套 lat/lng → world 坐标系。
    this.scene.add(this.earthGroup);

    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onProgress = (_url, loaded, total) => {
      this.options.onProgress?.(total ? loaded / total : 0);
    };
    this.loadingManager.onLoad = () => {
      this.options.onProgress?.(1);
      this.options.onReady?.();
    };
    this.loadingManager.onError = (url) => {
      console.warn('[globe] 纹理加载失败:', url);
    };

    this.buildLights();
    this.buildStars();
    this.buildEarth();
    this.buildGrid();
    this.buildRegions();
    this.buildMarkers();
    this.buildArcs();
    this.buildSelectionRing();

    this.bindEvents();
    this.applyCameras(true);
    this.autoRotateActive = this.autoRotate;
    this.animate();
  }

  // ── 场景构建 ────────────────────────────────────────────

  private buildLights() {
    const ambient = new THREE.AmbientLight(0x8899bb, 0.55);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2e0, 2.1);
    sun.position.set(-4.2, 2.6, 3.4);
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4a7fd4, 0.9);
    rim.position.set(3.5, -1.2, -3.5);
    this.scene.add(rim);

    // 半球光让夜面不至于全黑
    const hemi = new THREE.HemisphereLight(0x3355aa, 0x0a0a12, 0.6);
    this.scene.add(hemi);
  }

  private buildStars() {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // 球壳随机分布
      const r = 24 + Math.random() * 34;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const t = Math.random();
      color.setHSL(t < 0.7 ? 0.58 : 0.09, 0.25 + Math.random() * 0.4, 0.72 + Math.random() * 0.28);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);
  }

  private buildEarth() {
    const loader = new THREE.TextureLoader(this.loadingManager);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // 使用 BASE_URL 拼接，兼容 GitHub Pages 的子路径部署（如 /orbis-globe/）
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;

    const load = (file: string, srgb = true) => {
      const tex = loader.load(`${base}textures/${file}`);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      return tex;
    };

    this.textures.day = load('earth-blue-marble.jpg');
    this.textures.night = load('earth-night.jpg');
    this.textures.topology = load('earth-topology.png', false);
    this.textures.water = load('earth-water.png', false);

    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 96);

    const material = new THREE.MeshPhongMaterial({
      map: this.textures.day,
      bumpMap: this.textures.topology,
      bumpScale: 0.02,
      // 镜面高光必须关闭：场景有两个方向光源（太阳 + rim 边缘光），开启 specular
      // 会在海洋上各打出一个巨大的 Blinn-Phong 光斑（shininess 42 时半能量半径约
      // 19°），经水陆比例校正放大后表现为两个刺眼的青色光球
      specular: new THREE.Color(0x000000),
      shininess: 1,
    });

    // 注入水陆分离着色：
    // 1) 用 water 遮罩（白=海洋 / 黑=陆地，已实测确认）分别计算目标色
    // 2) 以「目标色 / 原色」比例作用于 Phong 光照结果 —— 既完成海陆调色分离，
    //    又保留地形起伏明暗与边缘光
    // 3) 夜面城市灯光叠加
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNightMap = { value: this.textures.night };
      shader.uniforms.uWaterMap = { value: this.textures.water };
      shader.uniforms.uNightStrength = { value: 1.0 };
      shader.uniforms.uOceanTint = { value: new THREE.Color(0x1a6ed8) };
      shader.uniforms.uOceanDeep = { value: new THREE.Color(0x031a3d) };
      shader.uniforms.uLandBoost = { value: 1.34 };
      // ── 三个地理分区着色开关（默认全部关闭）──
      // 若用户在着色器首次编译之前就打开了开关，这里读取暂存值
      shader.uniforms.uZoneEnable = { value: this.pendingToggles.uZoneEnable ?? 0 };
      shader.uniforms.uHemisphereEnable = { value: this.pendingToggles.uHemisphereEnable ?? 0 };
      shader.uniforms.uEwEnable = { value: this.pendingToggles.uEwEnable ?? 0 };
      // 把 vMapUv(0..1) 还原为「经度+180 / 纬度+90」所需的仿射参数。
      // Three.js 贴图默认 flipY=true，但 sphere 的 UV 原点在左下，
      // 两者相抵后 v 自下而上递增，与纬度单调一致，故为恒等映射。
      shader.uniforms.uUvScale = { value: new THREE.Vector2(360, 180) };
      shader.uniforms.uUvOffset = { value: new THREE.Vector2(0, 0) };

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uNightMap;
           uniform sampler2D uWaterMap;
           uniform float uNightStrength;
           uniform vec3 uOceanTint;
           uniform vec3 uOceanDeep;
           uniform float uLandBoost;
           uniform float uZoneEnable;
           uniform float uHemisphereEnable;
           uniform float uEwEnable;
           uniform vec2 uUvOffset;
           uniform vec2 uUvScale;

           float globeLuma(vec3 c) {
             return dot(c, vec3(0.2126, 0.7152, 0.0722));
           }`
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>

           #ifdef USE_MAP
             vec3 baseCol = texture2D(map, vMapUv).rgb;
             // water 遮罩：白色 = 海洋，黑色 = 陆地（已实测确认）
             float waterRaw = texture2D(uWaterMap, vMapUv).r;
             vec3 nightCol = texture2D(uNightMap, vMapUv).rgb;
           #else
             vec3 baseCol = vec3(0.14, 0.20, 0.30);
             float waterRaw = 0.0;
             vec3 nightCol = vec3(0.0);
           #endif

           // 反相得到陆地遮罩；海岸线处遮罩有锯齿，用窄区间平滑过渡
           float landMask = 1.0 - smoothstep(0.34, 0.62, waterRaw);

           float lum = globeLuma(baseCol);

           // ── 目标海色：统一蓝色基调 ──
           // 贴图的大洋中部带卫星合成图的太阳耀斑（亮白镜面反光区）。若从 baseCol
           // 出发调色，耀斑区会保留大量灰白原色，看上去像"海洋上新增了大陆"。
           // 因此海洋色不再继承贴图色相：在深海色与主题蓝之间按贴图亮度插值，
           // 全程保持在蓝色域内，仅保留轻微的深浅起伏作为海面层次。
           float oceanShade = 0.45 + 0.55 * smoothstep(0.0, 0.5, lum);
           vec3 oceanCol = mix(uOceanDeep, uOceanTint, oceanShade);

           // ── 目标陆色：提亮并轻微增强暖调与对比 ──
           vec3 landCol = baseCol * uLandBoost;
           landCol = mix(vec3(globeLuma(landCol)), landCol, 1.20);
           landCol += vec3(0.045, 0.032, 0.014) * lum;

           // ── 比例校正：作用于已光照颜色，保留高光 / 地形 / 大气光 ──
           vec3 ratio = mix(oceanCol, landCol, landMask) / max(baseCol, vec3(0.03));
           gl_FragColor.rgb *= clamp(ratio, vec3(0.0), vec3(2.6));

           // ══ 地理分区着色（三个独立开关，可同时开启）══
           // 反推当前片元的经纬度：球体 UV 展开为
           //   u = (lng + 180) / 360   v = (lat + 90) / 180
           // 乘回 uUvScale/uUvOffset 后即可得到真实的 lng / lat。
           vec2 ll = vMapUv * uUvScale + uUvOffset;   // x: 0..360(经度+180), y: 0..180
           float fLat = ll.y - 90.0;                  // -90 .. 90
           float fLngRaw = ll.x - 180.0;              // -180 .. 180

           vec3 regionTint = vec3(0.0);
           float regionAmt = 0.0;

           // ── 1) 低 / 中 / 高纬度带（0-30 / 30-60 / 60-90）──
           if (uZoneEnable > 0.5) {
             float absLat = abs(fLat);
             vec3 zc;
             if (absLat < 30.0) {
               zc = vec3(0.98, 0.72, 0.25);   // 低纬度：暖橙
             } else if (absLat < 60.0) {
               zc = vec3(0.36, 0.90, 0.62);   // 中纬度：青绿
             } else {
               zc = vec3(0.55, 0.66, 0.98);   // 高纬度：淡蓝紫
             }
             // 分界线处做 1.5° 的平滑过渡，避免硬边
             float e1 = smoothstep(28.5, 31.5, absLat);
             float e2 = smoothstep(58.5, 61.5, absLat);
             vec3 blend = mix(mix(vec3(0.98, 0.72, 0.25), vec3(0.36, 0.90, 0.62), e1),
                              vec3(0.55, 0.66, 0.98), e2);
             regionTint += blend * 0.42;
             regionAmt += 0.42;
           }

           // ── 2) 南 / 北半球 ──
           if (uHemisphereEnable > 0.5) {
             float northMix = smoothstep(-2.0, 2.0, fLat);  // 赤道处平滑过渡
             vec3 hc = mix(vec3(0.42, 0.78, 1.0),          // 南半球：冷蓝
                           vec3(1.0, 0.62, 0.48),          // 北半球：暖珊瑚
                           northMix);
             regionTint += hc * 0.40;
             regionAmt += 0.40;
           }

           // ── 3) 东 / 西半球（20°W 向东 → 160°E 为东半球）──
           if (uEwEnable > 0.5) {
             // 把经度映射到以 20°W 为起点的 [0,360) 区间：
             // t < 180 表示向东 180°（即到 160°E）→ 东半球
             float t = mod(fLngRaw + 20.0 + 360.0, 360.0);
             // 在两条分界线（0 与 180）附近做平滑过渡
             float eastW = smoothstep(0.0, 4.0, t) * (1.0 - smoothstep(176.0, 180.0, t));
             vec3 ew = mix(vec3(0.98, 0.52, 0.72),   // 西半球：品红
                           vec3(0.40, 0.92, 0.88),   // 东半球：青
                           eastW);
             regionTint += ew * 0.40;
             regionAmt += 0.40;
           }

           if (regionAmt > 0.0) {
             // 分区色以"染色"方式叠加：保留原有明暗与地形，只偏移色相
             vec3 tint = regionTint / max(regionAmt, 0.001);
             float strength = clamp(regionAmt, 0.0, 0.85);
             // 与已有颜色做柔和混合，避免盖掉海陆与昼夜层次
             gl_FragColor.rgb = mix(gl_FragColor.rgb,
                                    gl_FragColor.rgb * 0.35 + tint * (0.45 + 0.55 * globeLuma(gl_FragColor.rgb)),
                                    strength);
           }

           // ── 夜面城市灯光与冷色氛围 ──
           vec3 sunDir = normalize(vec3(-4.2, 2.6, 3.4));
           vec3 nrm = normalize(vNormal);
           float dayAmount = clamp(dot(nrm, sunDir), 0.0, 1.0);
           float nightMask = smoothstep(0.28, -0.05, dot(nrm, sunDir));
           float cityLum = dot(nightCol, vec3(0.299, 0.587, 0.114));
           float cityGlow = pow(cityLum, 1.35) * nightMask * uNightStrength;
           gl_FragColor.rgb += nightCol * cityGlow * 1.75 + vec3(0.16, 0.20, 0.34) * (1.0 - dayAmount) * 0.16;
          `
        );

      material.userData.shader = shader;
    };

    this.earthMesh = new THREE.Mesh(geometry, material);
    this.earthGroup.add(this.earthMesh);

    // 注：此前这里有一层用 topology 高度图充当颜色贴图的"云层"。
    // 高度图里陆地亮、海洋黑，加法混合后等于把一张发光的陆地地图叠在球面，
    // 且随时间缓慢自转——漂到海洋上空就被看成"海洋上新增的大陆"。
    // 已整体移除；topology 仍作为 bumpMap 保留地形浮雕。

    // 大气辉光
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uIntensity: { value: 1.0 },
        uColorA: { value: new THREE.Color(0x6fb4ff) },
        uColorB: { value: new THREE.Color(0x1c3fb0) },
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uIntensity;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          // 以真实视线方向计算菲涅尔边缘强度（相机绕行时保持对称）
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = 1.0 - abs(dot(vNormalW, viewDir));
          // 指数调高 + 强度降低：光晕更贴合边缘，避免糊住地表细节
          float strength = pow(rim, 3.6);
          vec3 col = mix(uColorB, uColorA, strength);
          gl_FragColor = vec4(col, strength * 0.62 * uIntensity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });

    this.atmosphereMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.16, 64, 48), atmoMat);
    this.earthGroup.add(this.atmosphereMesh);
  }

  /** 生成一条贴地圆的点集（固定纬度 = 等纬圈；固定经度 = 半大圆） */
  private buildCirclePoints(kind: 'parallel' | 'meridian', value: number, r: number, step = 2) {
    const pts: THREE.Vector3[] = [];
    if (kind === 'parallel') {
      for (let lng = -180; lng <= 180; lng += step) {
        const v = latLngToVector3(value, lng, r);
        pts.push(new THREE.Vector3(v.x, v.y, v.z));
      }
    } else {
      for (let lat = -90; lat <= 90; lat += step) {
        const v = latLngToVector3(lat, value, r);
        pts.push(new THREE.Vector3(v.x, v.y, v.z));
      }
    }
    return pts;
  }

  /**
   * 生成一条「有宽度」的经线带（用于东西半球分界线）。
   *
   * WebGL 的 LineBasicMaterial.linewidth 在 Windows / ANGLE 上会被强制为 1px，
   * 无法做出"比普通经线更粗"的效果；因此改用贴地窄带网格来表现粗细。
   * 带宽以"经度差"表示，在赤道最宽、向两极自然收敛（与真实经纬网一致）。
   *
   * @param lng    经线经度
   * @param radius 贴附半径
   * @param width  经方向半宽（单位：度）。0.0065° ≈ 赤道处 0.72km，视觉上约 3-4px
   */
  private buildMeridianBand(lng: number, radius: number, width: number) {
    const positions: number[] = [];
    const indices: number[] = [];
    const rows = 90;

    for (let i = 0; i <= rows; i++) {
      const lat = -90 + (180 * i) / rows;
      // 两极附近的带宽会趋于 0，做一个下限避免退化
      const cap = Math.max(Math.cos((lat * Math.PI) / 180), 0.06);
      const w = width / cap;

      const left = latLngToVector3(lat, lng - w, radius);
      const right = latLngToVector3(lat, lng + w, radius);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      if (i < rows) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);

    const mesh = new THREE.Mesh(geo, this.hemisphereDividerMat);
    mesh.renderOrder = 3;
    return mesh;
  }

  private buildGrid() {
    // gridGroup 保留为总容器，子分组各自独立控制显隐
    this.gridGroup = new THREE.Group();
    this.gridGroup.renderOrder = 2;

    const mat = new THREE.LineBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const accent = new THREE.LineBasicMaterial({
      color: 0xffc861,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // 回归线 / 极圈：琥珀色虚线，区别于普通纬线
    const specialMat = new THREE.LineDashedMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.6,
      dashSize: 0.052,
      gapSize: 0.036,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // 东西半球分界线的材质：亮青色实心窄带
    this.hemisphereDividerMat = new THREE.MeshBasicMaterial({
      color: 0x7ef0ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const r = EARTH_RADIUS * 1.002;

    // ── 经线（360° 全经圈）──
    this.meridianGroup = new THREE.Group();
    for (let lng = -180; lng < 180; lng += 15) {
      const pts = this.buildCirclePoints('meridian', lng, r);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.meridianGroup.add(new THREE.Line(geo, lng === 0 ? accent : mat));
    }

    // ── 东西半球分界线：20°W 与 160°E ──
    // 这两条经线是国际通用的东西半球划分基准（20°W 向东至 160°E 为东半球）。
    // 用更亮的青色 + 明显更粗的线，与每 15° 一条的普通经线区分开。
    // 线粗通过在球面上生成一段"细窄带网格"实现——WebGL 的 linewidth 在多数平台
    // （含 Chrome/ANGLE）会被忽略，只有 Mesh 带宽才能可靠地呈现粗细。
    for (const lng of [-20, 160]) {
      this.meridianGroup.add(this.buildMeridianBand(lng, r * 1.003, 0.0065));
    }
    this.gridGroup.add(this.meridianGroup);

    // ── 经度数值标注 ──
    this.meridianLabelGroup = new THREE.Group();
    for (let lng = -180; lng < 180; lng += 30) {
      this.meridianLabelGroup.add(
        this.makeLabelSprite(formatDegree(lng, 'lng'), latLngToVector3(-2, lng, r * 1.012))
      );
      this.meridianLabelGroup.add(
        this.makeLabelSprite(formatDegree(lng, 'lng'), latLngToVector3(2, lng, r * 1.012))
      );
    }
    this.gridGroup.add(this.meridianLabelGroup);

    // ── 纬线（含赤道）──
    this.parallelGroup = new THREE.Group();
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts = this.buildCirclePoints('parallel', lat, r);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.parallelGroup.add(new THREE.Line(geo, lat === 0 ? accent : mat));
    }
    // ── 回归线（±23.44°）与极圈（±66.56°）：虚线 ──
    for (const lat of [23.44, -23.44, 66.56, -66.56]) {
      const pts = this.buildCirclePoints('parallel', lat, r);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, specialMat);
      line.computeLineDistances(); // 虚线必需
      this.parallelGroup.add(line);
    }
    this.gridGroup.add(this.parallelGroup);

    // ── 纬度数值标注 ──
    this.parallelLabelGroup = new THREE.Group();
    for (let lat = -75; lat <= 75; lat += 30) {
      if (lat === 0) continue;
      this.parallelLabelGroup.add(
        this.makeLabelSprite(formatDegree(lat, 'lat'), latLngToVector3(lat, -14, r * 1.012))
      );
      this.parallelLabelGroup.add(
        this.makeLabelSprite(formatDegree(lat, 'lat'), latLngToVector3(lat, 14, r * 1.012))
      );
    }
    this.gridGroup.add(this.parallelLabelGroup);

    // ── 地轴线（穿过南北极并向外延伸）──
    this.axisGroup = new THREE.Group();
    const axisMat = new THREE.LineBasicMaterial({
      color: 0xffd591,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const axisR = EARTH_RADIUS * 1.3;
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -axisR, 0),
      new THREE.Vector3(0, axisR, 0),
    ]);
    this.axisGroup.add(new THREE.Line(axisGeo, axisMat));
    this.gridGroup.add(this.axisGroup);

    this.atmosphereMesh.parent?.add(this.gridGroup);

    this.buildCoordPoint();
  }

  /** 生成一个文字标签精灵（用于经纬度数值） */
  private makeLabelSprite(text: string, v: { x: number; y: number; z: number }) {
    let tex = this.labelTextures.get(text);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 48;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '600 26px "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(180,235,255,0.95)';
      ctx.fillText(text, 48, 25);

      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.labelTextures.set(text, tex);
    }

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      })
    );
    sprite.scale.set(0.115, 0.058, 1);
    sprite.position.set(v.x, v.y, v.z);
    return sprite;
  }

  /**
   * 生成一个「大洲 / 大洋」名称精灵。
   * 与 makeLabelSprite 的区别：画布更大、字号更大、带描边加深，
   * 并且主名（中文）与副名（英文）分两行绘制，保证贴上球面后仍然清晰可读。
   *
   * @param region 区域数据（决定文字、配色与字号系数）
   * @param v      世界坐标位置
   */
  private makeRegionSprite(region: Region, v: { x: number; y: number; z: number }) {
    const style = REGION_STYLE[region.kind];

    // 以「中文名 + 英文名」为缓存键，两者不同则纹理不同
    const cacheKey = `${region.kind}:${region.name}:${region.nameEn}`;
    let tex = this.labelTextures.get(cacheKey);
    if (!tex) {
      // 画布宽高：给英文长名（如 NORTH AMERICA）留足横向空间
      const W = 512;
      const H = 160;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 英文副名（较小、较淡，位于下方）
      ctx.font = '600 34px "SF Mono", Menlo, Consolas, monospace';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 6;
      ctx.strokeStyle = style.glow;
      ctx.strokeText(region.nameEn, W / 2, 112);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = style.color;
      ctx.fillText(region.nameEn, W / 2, 112);
      ctx.globalAlpha = 1;

      // 中文主名（较大、较亮，位于上方）
      ctx.font = '700 62px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 8;
      ctx.strokeStyle = style.glow;
      ctx.strokeText(region.name, W / 2, 54);
      ctx.fillStyle = style.color;
      ctx.fillText(region.name, W / 2, 54);

      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.labelTextures.set(cacheKey, tex);
    }

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false, // 名称是"标签"语义，允许压在球面之上，避免被地形吞掉
        opacity: 1,
      })
    );
    // 基础尺寸 0.42 × 0.131（与 512×160 画布同比例），再乘区域字号系数。
    // 取值偏保守：Sprite 永远正对相机，靠近球体边缘时不会像贴地文字那样自然压扁，
    // 所以基准尺寸要比"想当然的字号"小一档，避免多个标签在屏幕上互相压住。
    const baseW = 0.42 * region.scale;
    sprite.scale.set(baseW, baseW * (160 / 512), 1);
    sprite.position.set(v.x, v.y, v.z);
    sprite.userData.region = region;
    sprite.userData.baseScale = baseW;
    return sprite;
  }

  /** 构建大洲 / 大洋名称标注层 */
  private buildRegions() {
    this.regionGroup = new THREE.Group();
    this.regionGroup.renderOrder = 3;
    // 名称贴在球面外侧一点点，避免与地表 z-fighting
    const r = EARTH_RADIUS * 1.03;

    this.regionSprites = [];
    for (const region of REGIONS) {
      const v = latLngToVector3(region.lat, region.lng, r);
      const sprite = this.makeRegionSprite(region, v);
      this.regionSprites.push(sprite);
      this.regionGroup.add(sprite);
    }

    this.earthGroup.add(this.regionGroup);
  }

  /** 用户输入定位后显示的蓝点 */
  private buildCoordPoint() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const c = 64;

    // 外发光
    const grad = ctx.createRadialGradient(c, c, 3, c, c, c);
    grad.addColorStop(0, 'rgba(74,158,255,0.95)');
    grad.addColorStop(0.4, 'rgba(74,158,255,0.30)');
    grad.addColorStop(1, 'rgba(74,158,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();

    // 定位环
    ctx.strokeStyle = 'rgba(140,205,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, 30, 0, Math.PI * 2);
    ctx.stroke();

    // 实心蓝点
    ctx.fillStyle = '#2f86ff';
    ctx.beginPath();
    ctx.arc(c, c, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cfe6ff';
    ctx.beginPath();
    ctx.arc(c, c, 7, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.coordPoint = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 1,
      })
    );
    this.coordPoint.scale.setScalar(0.13);
    this.coordPoint.visible = false;
    this.earthGroup.add(this.coordPoint);
  }

  /** 在指定经纬度放置蓝点并飞过去 */
  placeCoordPoint(lat: number, lng: number) {
    const v = latLngToVector3(lat, lng, PLACE_RADIUS * 1.01);
    this.coordPoint.position.set(v.x, v.y, v.z);
    this.coordPoint.visible = true;
    this.focusOn(lat, lng);
  }

  clearCoordPoint() {
    this.coordPoint.visible = false;
  }

  private buildMarkers() {
    this.markerGroup = new THREE.Group();
    this.earthGroup.add(this.markerGroup);

    for (const place of PLACES) {
      let tex = this.markerTextureCache.get(place.category);
      if (!tex) {
        tex = makeMarkerTexture(place.category);
        this.markerTextureCache.set(place.category, tex);
      }

      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);

      const base = place.category === 'landmark' || place.category === 'observatory' ? 0.062 : 0.05;
      const scale = base * (0.8 + place.weight * 0.45);
      sprite.scale.setScalar(scale);

      const pos = latLngToVector3(place.lat, place.lng, PLACE_RADIUS);
      sprite.position.set(pos.x, pos.y, pos.z);

      sprite.userData.place = place;
      sprite.userData.baseScale = scale;
      sprite.userData.phase = Math.random() * Math.PI * 2;
      sprite.userData.categoryOk = this.categoryFilter.includes(place.category);

      this.markerSprites.push(sprite);
      this.markerGroup.add(sprite);
    }
  }

  /** 设置可见的分类过滤（空数组等价于全部隐藏） */
  setCategoryFilter(cats: Category[]) {
    this.categoryFilter = cats.length ? [...cats] : [];
    for (const sprite of this.markerSprites) {
      const place = sprite.userData.place as Place;
      sprite.userData.categoryOk = this.categoryFilter.includes(place.category);
    }
    // 若当前选中的目标被过滤掉，取消选中环
    if (this.selected && !this.categoryFilter.includes(this.selected.category)) {
      this.selectionRing.visible = false;
      this.selected = null;
      this.options.onSelect?.(null);
    }
  }

  private buildArcs() {
    this.arcGroup = new THREE.Group();
    this.earthGroup.add(this.arcGroup);

    const hub = PLACES.find((p) => p.id === 'beijing')!;
    const targets = PLACES.filter((p) => p.id !== hub.id).slice(0, 18);

    for (const target of targets) {
      const points = buildArcPoints(
        { lat: hub.lat, lng: hub.lng },
        { lat: target.lat, lng: target.lng },
        EARTH_RADIUS * 1.006,
        72,
        0.2 // 抬升上限 1.206，低于最近相机距离 1.28，避免穿镜
      ).map(([x, y, z]) => new THREE.Vector3(x, y, z));

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: 0x54e6ff,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geo, mat);
      line.userData.offset = Math.random();
      this.arcMaterials.push(mat);
      this.arcGroup.add(line);
    }
  }

  private buildSelectionRing() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const c = 128;

    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, 88, 0, Math.PI * 1.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, 88, Math.PI * 1.55, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120,230,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, 66, 0, Math.PI * 2);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
    });

    this.selectionRing = new THREE.Sprite(mat);
    this.selectionRing.scale.setScalar(0.17);
    this.selectionRing.visible = false;
    this.earthGroup.add(this.selectionRing);
  }

  // ── 交互 ────────────────────────────────────────────────

  private bindEvents() {
    const el = this.renderer.domElement;

    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.onResize);

    const ro = new ResizeObserver(this.onResize);
    ro.observe(this.container);
    this.resizeObserver = ro;
  }

  private resizeObserver?: ResizeObserver;

  private onResize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private onPointerDown = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.activePointerId = e.pointerId;
    this.isDragging = true;
    this.hasDragged = false;
    this.velocity.lat = 0;
    this.velocity.lng = 0;
    this.pointerDownAt = { x: e.clientX, y: e.clientY };
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.userIdleTimer = 0;
    // 用户开始拖拽即视为主动调整视角，解除定位保持
    this.focusHold = false;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartCamDistance = this.targetDistance;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 双指缩放
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartDistance > 0) {
        const ratio = this.pinchStartDistance / Math.max(dist, 1);
        this.setDistance(this.pinchStartCamDistance * ratio);
      }
      this.hasDragged = true;
      return;
    }

    if (!this.isDragging || e.pointerId !== this.activePointerId) {
      this.updateHover(e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    if (Math.hypot(e.clientX - this.pointerDownAt.x, e.clientY - this.pointerDownAt.y) > 4) {
      this.hasDragged = true;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const scale = 220 / Math.max(rect.height, 1);
    const k = (this.distance / 3.1) * scale;

    const dLng = -dx * k * 0.55;
    const dLat = dy * k * 0.55;

    this.targetLng += dLng;
    this.targetLat = clamp(this.targetLat + dLat, -88, 88);
    this.currentLng += dLng;
    this.currentLat = clamp(this.currentLat + dLat, -88, 88);

    this.velocity.lng = dLng;
    this.velocity.lat = dLat;

    this.autoRotateActive = false;
    this.userIdleTimer = 0;
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStartDistance = 0;

    if (this.pointers.size === 0) {
      this.isDragging = false;
      this.activePointerId = null;

      // 判定为点击 -> 拾取
      if (!this.hasDragged) {
        const hit = this.pick(e.clientX, e.clientY);
        this.setSelected(hit);
      }
    }
  };

  private onPointerLeave = () => {
    if (!this.isDragging) {
      this.updateHover(-1, -1);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    this.setDistance(this.targetDistance * factor);
    // 用户滚轮缩放视为主动操作视角，解除定位保持
    this.focusHold = false;
  };

  private setDistance(d: number) {
    this.targetDistance = clamp(d, MIN_DISTANCE, MAX_DISTANCE);
  }

  private pick(clientX: number, clientY: number): Place | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const visible = this.markerSprites.filter((s) => s.visible && s.userData.categoryOk !== false);
    const hits = this.raycaster.intersectObjects(visible, false);

    for (const hit of hits) {
      const place = hit.object.userData.place as Place | undefined;
      if (place) return place;
    }
    return null;
  }

  private updateHover(clientX: number, clientY: number) {
    if (!this.layers.markers) return;
    const place = clientX < 0 ? null : this.pick(clientX, clientY);

    if (place !== this.hovered) {
      this.hovered = place;
      this.renderer.domElement.style.cursor = place ? 'pointer' : 'grab';
      this.options.onHover?.(place, { x: clientX, y: clientY });
    } else if (place) {
      this.options.onHover?.(place, { x: clientX, y: clientY });
    }
  }

  // ── 公开 API ────────────────────────────────────────────

  focusOn(lat: number, lng: number, distance?: number, axisTiltDeg?: number) {
    this.targetLat = clamp(lat, -88, 88);
    // 选择最短路径旋转
    const current = this.targetLng;
    const delta = ((lng - current + 540) % 360) - 180;
    this.targetLng = current + delta;

    if (distance !== undefined) this.setDistance(distance);
    if (axisTiltDeg !== undefined) this.targetAxisTiltDeg = axisTiltDeg;
    // 聚焦期间及其后都保持自转关闭，让目标点稳定停在画面正中。
    // 见 focusHold 的说明：仅把 userIdleTimer 设为负值不够，自转仍会恢复。
    this.focusHold = true;
    this.autoRotateActive = false;
    this.userIdleTimer = 0;
  }

  /** 解除定位保持（用户主动开启自转或手动操作视角时调用） */
  releaseFocusHold() {
    this.focusHold = false;
  }

  /**
   * 复位到默认观测姿态：地轴与水平线成 66.5°，且向右倾斜（北端偏右）。
   * 113.5° = 180° - 66.5°，与 66.5° 是镜像关系，夹角相同但倾斜方向相反。
   */
  resetView() {
    this.velocity.lat = 0;
    this.velocity.lng = 0;
    this.focusOn(25, 20, 3.1, 113.5);
  }

  setSelected(place: Place | null) {
    this.selected = place;
    if (place) {
      const pos = latLngToVector3(place.lat, place.lng, PLACE_RADIUS * 1.005);
      this.selectionRing.position.set(pos.x, pos.y, pos.z);
      this.selectionRing.visible = true;
      this.focusOn(place.lat, place.lng);
    } else {
      this.selectionRing.visible = false;
    }
    this.options.onSelect?.(place);
  }

  getSelected() {
    return this.selected;
  }

  setAutoRotate(enabled: boolean) {
    this.autoRotate = enabled;
    this.userIdleTimer = 0;
    // 只有「显式开启自转」才解除定位保持；关闭自转时保留保持标记，
    // 否则 UI 在定位过程中调用 setAutoRotate(false) 会把刚设好的保持清掉。
    if (enabled) this.focusHold = false;
    else this.autoRotateActive = false;
  }

  setLayerVisible(key: LayerKey, visible: boolean) {
    this.layers[key] = visible;
    switch (key) {
      case 'grid':
        this.gridGroup.visible = visible;
        break;
      case 'meridians':
        this.meridianGroup.visible = visible;
        break;
      case 'meridianLabels':
        this.meridianLabelGroup.visible = visible;
        break;
      case 'parallels':
        this.parallelGroup.visible = visible;
        break;
      case 'parallelLabels':
        this.parallelLabelGroup.visible = visible;
        break;
      case 'axis':
        this.axisGroup.visible = visible;
        break;
      case 'regions':
        this.regionGroup.visible = visible;
        break;
      case 'markers':
        this.markerGroup.visible = visible;
        break;
      case 'arcs':
        this.arcGroup.visible = visible;
        break;
      case 'atmosphere':
        this.atmosphereMesh.visible = visible;
        break;
      case 'stars':
        this.starField.visible = visible;
        break;
      case 'zoneTint':
        this.setShaderToggle('uZoneEnable', visible);
        break;
      case 'hemisphereTint':
        this.setShaderToggle('uHemisphereEnable', visible);
        break;
      case 'ewTint':
        this.setShaderToggle('uEwEnable', visible);
        break;
      case 'satellite':
        this.earthMesh.material.map = visible ? this.textures.day : null;
        this.earthMesh.material.bumpMap = visible ? this.textures.topology : null;
        this.earthMesh.material.needsUpdate = true;
        if (!visible) {
          this.earthMesh.material.color.setHex(0x1b2a4a);
        } else {
          this.earthMesh.material.color.setHex(0xffffff);
        }
        break;
    }
  }

  captureScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * 切换地表着色器里的某个地理分区开关。
   *
   * 材质是 MeshPhongMaterial + onBeforeCompile 注入，着色器对象保存在
   * material.userData.shader；若材质已编译过即可直接改 uniform，
   * 否则（首次在编译前调用）先记在 pendingToggles，等编译完成时补上。
   */
  private setShaderToggle(name: 'uZoneEnable' | 'uHemisphereEnable' | 'uEwEnable', on: boolean) {
    const shader = this.earthMesh?.userData?.shader as
      | { uniforms: Record<string, { value: number }> }
      | undefined;
    if (shader?.uniforms?.[name]) {
      shader.uniforms[name].value = on ? 1 : 0;
      return;
    }
    // 尚未编译：暂存，onBeforeCompile 里会读取并初始化
    this.pendingToggles[name] = on ? 1 : 0;
  }

  /** 着色器编译完成前调用的开关值暂存区 */
  private pendingToggles: Record<string, number> = {};

  private autoRotateActive = true;

  /** 供 UI 读取「自动旋转是否正在生效」 */
  isAutoRotating() {
    return this.autoRotateActive;
  }

  private applyCameras(immediate = false) {
    const lat = immediate ? this.targetLat : this.currentLat;
    const lng = immediate ? this.targetLng : this.currentLng;
    const tilt = immediate ? this.targetAxisTiltDeg : this.axisTiltDeg;

    // ── 相机方向必须与 latLngToVector3 完全同约定 ──
    // geo.ts 的经纬度→三维换算采用「-x」约定（与 SphereGeometry UV 展开对齐，
    // 所有标记/网格/弧线都用它）。相机若用别的推导（如 +x），就会飞到镜像
    // 位置——表现为"定位后标记点不在画面正中"。因此这里直接复用同一函数，
    // 保证相机指向的永远是该经纬度在贴图上的真实位置。
    const dir = latLngToVector3(lat, lng, 1);
    const px = dir.x;
    const py = dir.y;
    const pz = dir.z;

    this.camera.position.set(this.distance * px, this.distance * py, this.distance * pz);

    // ── 显式构造相机基向量，使「地轴投影」与屏幕水平线成 tilt 夹角 ──
    // 不用 lookAt 的自动正交化：那样会把 up 重新投影，导致倾角无法精确控制。
    // fwd  = 视线方向（指向球心）
    const fx = -px;
    const fy = -py;
    const fz = -pz;

    // 屏幕竖直基准 = 世界 y 轴（地轴）在垂直视线平面上的投影
    const d = fy; // worldY · fwd
    let ux = -fx * d;
    let uy = 1 - fy * d;
    let uz = -fz * d;
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (ul < 1e-6) {
      // 视线与地轴平行时的退化保护（正对极点）
      ux = 0;
      uy = 0;
      uz = 1;
      ul = 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;

    // 屏幕水平基准 = fwd × up
    let rx = fy * uz - fz * uy;
    let ry = fz * ux - fx * uz;
    let rz = fx * uy - fy * ux;
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;

    // 绕视线轴旋转 (90° - tilt)：使地轴与屏幕水平线夹角恰为 tilt
    const roll = (90 - tilt) * DEG2RAD;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);

    const upx = ux * cr + rx * sr;
    const upy = uy * cr + ry * sr;
    const upz = uz * cr + rz * sr;

    this.camera.up.set(upx, upy, upz);
    this.camera.lookAt(0, 0, 0);
  }

  private reportState(force = false) {
    const center = vector3ToLatLng(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z
    );
    const t = performance.now();
    if (!force && t - this.stateReportTimer < 120) return;
    this.stateReportTimer = t;

    this.options.onStateChange?.({
      lat: center.lat,
      lng: center.lng,
      altitude: 35786 * Math.max(0, (this.distance - 1) / (MAX_DISTANCE - 1)),
      autoRotate: this.autoRotate && this.autoRotateActive,
      zoom: clamp(1 + (3.1 - this.distance) * 0.42, 0.4, 4),
    });
  }

  private animate = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    // —— 惯性阻尼 / 自动旋转 ——
    if (!this.isDragging) {
      // 惯性
      if (Math.abs(this.velocity.lng) > 0.0005 || Math.abs(this.velocity.lat) > 0.0005) {
        this.targetLng += this.velocity.lng;
        this.currentLng += this.velocity.lng;
        this.targetLat = clamp(this.targetLat + this.velocity.lat, -88, 88);
        this.currentLat = clamp(this.currentLat + this.velocity.lat, -88, 88);
        this.velocity.lng *= 0.93;
        this.velocity.lat *= 0.93;
      }

      this.userIdleTimer += dt;
      // focusHold 期间不自转：定位/选中某个点后，该点需要稳定停在画面正中
      if (this.autoRotate && !this.focusHold && this.userIdleTimer > 1.6) {
        this.autoRotateActive = true;
        const speed = this.autoRotateSpeed * (this.distance / 3.1);
        this.targetLng += speed;
        this.currentLng += speed;
      } else if (this.autoRotate) {
        this.autoRotateActive = false;
      }
    }

    // —— 平滑插值 ——
    const smooth = 1 - Math.pow(0.0016, dt);
    this.currentLat += (this.targetLat - this.currentLat) * smooth;
    this.currentLng += (this.targetLng - this.currentLng) * smooth;
    this.axisTiltDeg += (this.targetAxisTiltDeg - this.axisTiltDeg) * smooth;
    this.distance += (this.targetDistance - this.distance) * (1 - Math.pow(0.0025, dt));

    this.applyCameras();

    // —— 标记呼吸 ——
    if (this.layers.markers) {
      for (const sprite of this.markerSprites) {
        const phase = sprite.userData.phase as number;
        const pulse = 1 + Math.sin(elapsed * 1.7 + phase) * 0.13;
        sprite.scale.setScalar((sprite.userData.baseScale as number) * pulse);

        const categoryOk = sprite.userData.categoryOk !== false;

        // 背面标记淡出，减少视觉噪声
        const wp = new THREE.Vector3();
        sprite.getWorldPosition(wp);
        const normal = wp.clone().normalize();
        const camDir = this.camera.position.clone().normalize();
        const facing = normal.dot(camDir);
        const mat = sprite.material as THREE.SpriteMaterial;
        const isSelected = this.selected?.id === (sprite.userData.place as Place).id;
        const opacity = clamp((facing - 0.06) * 2.6, 0, isSelected ? 1 : 0.82);
        mat.opacity = categoryOk ? opacity : 0;
        sprite.visible = categoryOk && (facing > 0.02 || isSelected);
      }
    }

    // —— 大洲 / 大洋名称：背面淡出 + 边缘收缩 ——
    // 名称贴在球面上，转到背面时若不淡出会透过地球看到（depthTest 已关闭），
    // 观感很乱。这里按法线与相机方向的夹角做平滑淡出。
    // 同时让标签在接近球体边缘（视线越斜）时逐渐缩小，模拟"贴在球面上被压扁"的效果，
    // 否则 Sprite 始终正对相机、在边缘处会显得过大并压住相邻标签。
    if (this.layers.regions) {
      const camDir = this.camera.position.clone().normalize();
      for (const sprite of this.regionSprites) {
        const wp = new THREE.Vector3();
        sprite.getWorldPosition(wp);
        const facing = wp.clone().normalize().dot(camDir);
        // facing > 0.02 才可见；用 smoothstep 让边缘过渡自然
        const t = clamp((facing - 0.02) / 0.34, 0, 1);
        const ease = t * t * (3 - 2 * t);
        // 收缩系数：正视时 1.0，接近轮廓时收到 0.62
        // 边缘收得比较狠，是因为 Sprite 在轮廓附近会与球面切线几乎垂直，
        // 若不缩小就会"浮"在球体外面，视觉上像是飘在前景、压住其他标签。
        const shrink = 0.62 + 0.38 * ease;
        const base = sprite.userData.baseScale as number;
        const w = base * shrink;
        sprite.scale.set(w, w * (160 / 512), 1);
        (sprite.material as THREE.SpriteMaterial).opacity = ease;
        sprite.visible = ease > 0.01;
      }
    }

    // —— 选中环呼吸 + 朝向相机 ——
    if (this.selectionRing.visible) {
      const pulse = 1 + Math.sin(elapsed * 2.4) * 0.09;
      this.selectionRing.scale.setScalar(0.17 * pulse);
    }

    // —— 航线流动 ——
    if (this.layers.arcs) {
      this.arcMaterials.forEach((mat, i) => {
        mat.opacity = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(elapsed * 1.3 + i * 0.7));
      });
    }

    // —— 星空缓慢自转 ——
    this.starField.rotation.y += dt * 0.005;
    this.starField.rotation.x += dt * 0.0012;

    this.reportState();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);

    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();

    this.scene.traverse((obj) => {
      const anyObj = obj as THREE.Mesh;
      if (anyObj.geometry) anyObj.geometry.dispose();
      const mat = (anyObj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });

    Object.values(this.textures).forEach((t) => t.dispose());
    this.markerTextureCache.forEach((t) => t.dispose());
    this.renderer.dispose();
    if (el.parentElement) el.parentElement.removeChild(el);
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
