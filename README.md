# ORBIS · 交互式三维地球仪

一个可**拖拽旋转、滚轮缩放、点击标记**的三维地球仪网页。基于 Three.js 自研渲染引擎，配套完整的观测台风格数据 HUD。

![Tech](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Tech](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Tech](https://img.shields.io/badge/Three.js-0.186-000000?logo=three.js&logoColor=white)
![Tech](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)

---

## 核心功能

### 三维交互
- **拖拽旋转** —— 按住拖动，松手后带惯性阻尼滑行
- **滚轮 / 双指捏合缩放** —— 视角范围从近地轨道到全景
- **点击标记** —— 镜头自动飞行聚焦，并锁定该观测站
- **闲置 1.6 秒自动恢复自转**

### 视觉表现
- NASA Blue Marble 真实卫星贴图 + 地形凹凸 + 海面高光
- **夜半球城市灯光** —— 自定义着色器注入，随昼夜界线自然渐显
- 大气菲涅尔边缘辉光
- 2600 颗恒星的深空星场（缓慢自转）
- 15° 间隔经纬网格（赤道与本初子午线高亮）
- 以北京为枢纽的 18 条呼吸流动航线弧光

### 数据 HUD
- **38 个观测站**，分四类：首都 / 大都会 / 自然地标 / 天文台
  （含中国 FAST 天眼、珠穆朗玛峰、马里亚纳海沟、南极望远镜等）
- 检索任意城市即镜头飞行
- 分类芯片实时过滤标记
- 实时遥测：视角中心经纬度、等效轨道高度、缩放倍率
- 点击标记读取：坐标、**当地时间**、距北京大圆距离、海拔
- CST / UTC 双时钟，一键导出 PNG 截图
- 响应式布局（桌面 / 平板 / 移动端）

---

## 两种打开方式

### 方式一：单文件版（推荐，零配置）

直接用浏览器打开根目录的 **`globe.html`** 即可。

该文件已将 Three.js 库与全部地球贴图**以 base64 内嵌**，总计约 1.3MB，**完全离线可用**，不需要 Node.js、不需要联网、不需要任何服务器。

> 建议使用 Chrome / Edge / Firefox / Safari 最新版，并确保浏览器开启了硬件加速（WebGL）。

### 方式二：完整工程（开发用）

```bash
# 前端
cd frontend
pnpm install
pnpm dev          # 开发服务器 → http://localhost:5173

# 后端（可选，本项目三维功能不依赖后端）
cd backend
pnpm install
pnpm dev          # → http://localhost:3000/api
```

生产构建：

```bash
cd frontend && pnpm build
```

---

## 操作说明

| 操作 | 效果 |
| --- | --- |
| 按住拖动 | 旋转地球（带惯性） |
| 滚轮 / 双指捏合 | 缩放视角 |
| 单击发光标记 | 聚焦并锁定该观测站 |
| 左上检索框 | 输入城市名回车，镜头飞行 |
| 分类芯片 | 按类别过滤可见标记 |
| 图层开关 | 独立控制卫星影像 / 网格 / 标记 / 航线 / 大气 / 星空 |
| 姿态按钮 | 暂停自转、复位视角、导出 PNG |

---

## 项目结构

```
.
├── globe.html                    # ★ 单文件完整版（离线可用，双击即开）
├── frontend/
│   ├── public/textures/          # 地球贴图资源
│   │   ├── earth-blue-marble.jpg # 白昼地表（4096×2048）
│   │   ├── earth-night.jpg       # 夜间灯光（4096×2048）
│   │   ├── earth-topology.png    # 地形高度图
│   │   └── earth-water.png       # 水体遮罩（高光用）
│   └── src/
│       ├── components/globe/
│       │   ├── GlobeEngine.ts    # Three.js 渲染引擎（交互 / 着色器 / 拾取）
│       │   ├── geo.ts            # 经纬度 ↔ 三维向量换算、大圆距离、弧线插值
│       │   └── places.ts         # 观测站数据集与分类元信息
│       └── pages/
│           ├── Index.tsx         # 页面与 HUD 状态管理
│           └── globe.css         # 观测台控制台风格样式
├── backend/                      # 后端服务（模板自带，三维功能不依赖）
└── docs/                         # 工程配置
```

---

## 技术要点

**相机球坐标** —— 拖拽改变的是相机的经纬度（而非旋转地球网格），因此标记、网格、弧线可以共用同一套 `lat/lng → world` 坐标映射：

```ts
phi   = (90 - lat) * π / 180
theta = (lng + 180) * π / 180
```

**夜面灯光着色器** —— 通过 `onBeforeCompile` 注入片元着色器，在 `MeshPhongMaterial` 基础上叠加城市灯光，并用 `#ifdef USE_MAP` 保证关闭卫星贴图时不会编译失败：

```glsl
float nightMask = smoothstep(0.28, -0.05, dot(nrm, sunDir));
float cityGlow  = pow(luminance(nightCol), 1.35) * nightMask;
gl_FragColor.rgb += nightCol * cityGlow * 1.75;
```

**大气辉光** —— 使用视线方向（`cameraPosition - worldPos`）而非固定轴计算菲涅尔边缘强度，保证相机绕行时辉光始终对称。

**性能** —— 背面标记自动淡出、按需渲染、纹理各向异性过滤、像素比上限 2。

**容错** —— WebGL 不可用时显示引导卡片而非白屏；单文件版内嵌库失败时自动回退三个 CDN 源。

---

## 许可

地球贴图来自 NASA Visible Earth（公有领域）。代码部分可自由使用。
