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
  latLngToVector3,
  vector3ToLatLng,
} from './geo';
import {
  CATEGORY_META,
  PLACES,
  type Category,
  type Place,
} from './places';

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

export type LayerKey = 'satellite' | 'grid' | 'markers' | 'arcs' | 'atmosphere' | 'stars';

export interface LayerVisibility {
  satellite: boolean;
  grid: boolean;
  markers: boolean;
  arcs: boolean;
  atmosphere: boolean;
  stars: boolean;
}

const EARTH_RADIUS = 1;
const MIN_DISTANCE = 1.28;
const MAX_DISTANCE = 7.0;

/** 全部分类（用于过滤默认值） */
const CATEGORY_ALL: Category[] = ['capital', 'metropolis', 'landmark', 'observatory'];

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
  private cloudMesh!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  private atmosphereMesh!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private gridGroup!: THREE.Group;
  private markerGroup!: THREE.Group;
  private arcGroup!: THREE.Group;
  private starField!: THREE.Points;
  private selectionRing!: THREE.Sprite;

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
    markers: true,
    arcs: true,
    atmosphere: true,
    stars: true,
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
      bumpScale: 0.014,
      specularMap: this.textures.water,
      specular: new THREE.Color(0x224466),
      shininess: 16,
    });

    // 注入夜景灯光：白昼由 map 决定，背光面叠加城市灯光
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNightMap = { value: this.textures.night };
      shader.uniforms.uNightStrength = { value: 1.0 };

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uNightMap;
           uniform float uNightStrength;`
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           // 夜面城市灯光：白昼贴图存在时才采样（关掉卫星影像后仅剩基础球体）
           #ifdef USE_MAP
             vec3 nightCol = texture2D(uNightMap, vMapUv).rgb;
           #else
             vec3 nightCol = vec3(0.0);
           #endif
           float lum = dot(nightCol, vec3(0.299, 0.587, 0.114));
           vec3 sunDir = normalize(vec3(-4.2, 2.6, 3.4));
           vec3 nrm = normalize(vNormal);
           float dayAmount = clamp(dot(nrm, sunDir), 0.0, 1.0);
           float nightMask = smoothstep(0.28, -0.05, dot(nrm, sunDir));
           float cityGlow = pow(lum, 1.35) * nightMask * uNightStrength;
           gl_FragColor.rgb += nightCol * cityGlow * 1.75 + vec3(0.16, 0.20, 0.34) * (1.0 - dayAmount) * 0.16;
           gl_FragColor.rgb *= mix(0.34, 1.0, dayAmount * 0.85 + 0.15);
          `
        );

      material.userData.shader = shader;
    };

    this.earthMesh = new THREE.Mesh(geometry, material);
    this.earthGroup.add(this.earthMesh);

    // 云层（复用拓扑贴图做轻微的浮雕感，避免额外资源依赖）
    const cloudMat = new THREE.MeshPhongMaterial({
      map: this.textures.topology,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.004, 96, 64), cloudMat);
    this.earthGroup.add(this.cloudMesh);

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
          float strength = pow(rim, 2.6);
          vec3 col = mix(uColorB, uColorA, strength);
          gl_FragColor = vec4(col, strength * 0.85 * uIntensity);
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

  private buildGrid() {
    this.gridGroup = new THREE.Group();
    this.gridGroup.renderOrder = 2;

    const mat = new THREE.LineBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const accent = new THREE.LineBasicMaterial({
      color: 0xffc861,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const r = EARTH_RADIUS * 1.002;

    // 纬线
    for (let lat = -75; lat <= 75; lat += 15) {
      const isEquator = lat === 0;
      const pts: THREE.Vector3[] = [];
      for (let lng = -180; lng <= 180; lng += 3) {
        const v = latLngToVector3(lat, lng, r);
        pts.push(new THREE.Vector3(v.x, v.y, v.z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.gridGroup.add(new THREE.Line(geo, isEquator ? accent : mat));
    }

    // 经线
    for (let lng = -180; lng < 180; lng += 15) {
      const isPrime = lng === 0;
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 3) {
        const v = latLngToVector3(lat, lng, r);
        pts.push(new THREE.Vector3(v.x, v.y, v.z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.gridGroup.add(new THREE.Line(geo, isPrime ? accent : mat));
    }

    this.atmosphereMesh.parent?.add(this.gridGroup);
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

  focusOn(lat: number, lng: number, distance?: number) {
    this.targetLat = clamp(lat, -88, 88);
    // 选择最短路径旋转
    const current = this.targetLng;
    const delta = ((lng - current + 540) % 360) - 180;
    this.targetLng = current + delta;

    if (distance !== undefined) this.setDistance(distance);
    this.autoRotateActive = false;
    this.userIdleTimer = -2.4; // 聚焦后延迟更久再自动旋转
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
    this.userIdleTimer = enabled ? 0 : -9999;
  }

  setLayerVisible(key: LayerKey, visible: boolean) {
    this.layers[key] = visible;
    switch (key) {
      case 'grid':
        this.gridGroup.visible = visible;
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
      case 'satellite':
        this.earthMesh.material.map = visible ? this.textures.day : null;
        this.earthMesh.material.bumpMap = visible ? this.textures.topology : null;
        this.earthMesh.material.needsUpdate = true;
        if (!visible) {
          this.earthMesh.material.color.setHex(0x1b2a4a);
        } else {
          this.earthMesh.material.color.setHex(0xffffff);
        }
        this.cloudMesh.visible = visible;
        break;
    }
  }

  captureScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private autoRotateActive = true;

  /** 供 UI 读取「自动旋转是否正在生效」 */
  isAutoRotating() {
    return this.autoRotateActive;
  }

  private applyCameras(immediate = false) {
    const lat = immediate ? this.targetLat : this.currentLat;
    const lng = immediate ? this.targetLng : this.currentLng;

    const phi = (90 - lat) * DEG2RAD;
    const theta = (lng + 180) * DEG2RAD;

    this.camera.position.set(
      this.distance * Math.sin(phi) * Math.cos(theta),
      this.distance * Math.cos(phi),
      this.distance * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);
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
      if (this.autoRotate && this.userIdleTimer > 1.6) {
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
    this.distance += (this.targetDistance - this.distance) * (1 - Math.pow(0.0025, dt));

    this.applyCameras();

    // —— 云层缓慢漂移 ——
    this.cloudMesh.rotation.y += dt * 0.004;

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
