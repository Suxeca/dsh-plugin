import { readFileSync, writeFileSync } from 'node:fs';

const crops = JSON.parse(readFileSync('/tmp/crops_b64.json', 'utf8'));

const u1 = JSON.parse(readFileSync('/home/suxeca/Workspace/Z3model/derivation_units/unit_01_z3_symmetry.json', 'utf8'));
const u2 = JSON.parse(readFileSync('/home/suxeca/Workspace/Z3model/derivation_units/unit_02_dirichlet_kernel.json', 'utf8'));
const u3 = JSON.parse(readFileSync('/home/suxeca/Workspace/Z3model/derivation_units/unit_03_c_symmetry_energy.json', 'utf8'));

const units = {
  unit1: u1,
  unit2: u2,
  unit3: u3
};

const jsonStr = JSON.stringify({ units, crops }).replace(/</g, '\\u003c');

export function generateArchifyStyleDerivationMap() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Z₃ 理论推导微单元地图 (Science Derivation Units Map)</title>
  <!-- KaTeX Local High-Performance Math Engine -->
  <link rel="stylesheet" href="./katex/katex.min.css">
  <script src="./katex/katex.min.js"></script>

  <style>
    :root {
      --bg: #090d16;
      --bg-panel: #0f172a;
      --bg-card: #162035;
      --border: #22324e;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.4);
      --gold: #fbbf24;
      --rose: #f43f5e;
      --emerald: #10b981;
      --purple: #c084fc;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-panel: #ffffff;
      --bg-card: #f1f5f9;
      --border: #cbd5e1;
      --text: #0f172a;
      --text-muted: #64748b;
      --accent: #0284c7;
      --accent-glow: rgba(2, 132, 199, 0.25);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    }

    /* Header */
    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge-map {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .map-title {
      font-size: 1.12rem;
      font-weight: 700;
      color: var(--text);
    }
    .map-subtitle {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Unit Switcher Tabs */
    .unit-nav {
      display: flex;
      background: var(--bg-card);
      border-radius: 8px;
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .unit-tab {
      padding: 6px 14px;
      font-size: 0.8rem;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--text-muted);
      transition: all 0.2s;
    }
    .unit-tab.active {
      background: var(--accent);
      color: #fff;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-tool {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: background 0.2s;
    }
    .btn-tool:hover { background: var(--border); }

    /* Canvas Viewport */
    .canvas-container {
      flex: 1;
      position: relative;
      overflow: hidden;
      cursor: grab;
    }
    .canvas-container:active { cursor: grabbing; }
    svg#diagramSvg {
      width: 100%;
      height: 100%;
    }

    /* SVG Elements */
    .edge-path {
      fill: none;
      stroke: #475569;
      stroke-width: 2;
      transition: stroke 0.3s, stroke-width 0.3s, filter 0.3s;
    }
    .edge-path.main-flow {
      stroke: var(--accent);
      stroke-width: 3.2;
      filter: drop-shadow(0 0 6px var(--accent-glow));
    }
    .edge-path.variant-dashed { stroke-dasharray: 5 4; stroke: #94a3b8; }
    .edge-path.variant-security { stroke: var(--rose); stroke-width: 2.5; stroke-dasharray: 4 3; }
    .edge-path.variant-emphasis { stroke: var(--emerald); stroke-width: 2.8; }

    /* Edge Foreign Badge (KaTeX Inside) */
    .edge-foreign-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      pointer-events: none;
    }
    .edge-foreign-badge {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      pointer-events: none;
    }

    /* Nodes */
    .node-group {
      cursor: pointer;
      transition: transform 0.2s, opacity 0.3s;
    }
    .node-group:hover {
      transform: translateY(-3px);
    }
    .node-rect {
      fill: var(--bg-card);
      stroke: var(--border);
      stroke-width: 1.8;
      transition: stroke 0.3s, filter 0.3s, fill 0.3s;
    }
    .node-group.is-main .node-rect {
      stroke: var(--accent);
      filter: drop-shadow(0 4px 12px rgba(56, 189, 248, 0.18));
    }
    .node-group.selected .node-rect {
      stroke: var(--gold) !important;
      stroke-width: 2.8;
      filter: drop-shadow(0 0 16px rgba(251, 191, 36, 0.45));
    }

    /* Node Foreign Object Content (True KaTeX Typography) */
    .node-foreign-wrap {
      width: 100%;
      height: 100%;
      padding: 8px 14px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
      pointer-events: none;
      overflow: hidden;
    }
    .node-badge {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .node-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-sublabel {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 3px;
    }

    /* Category colors */
    .cat-definition .node-badge { color: #34d399; }
    .cat-strategy .node-badge { color: #38bdf8; }
    .cat-doubt .node-badge { color: #fb7185; }
    .cat-doubt .node-rect { stroke: rgba(244, 63, 94, 0.5); stroke-dasharray: 4 4; fill: rgba(244, 63, 94, 0.04); }
    .cat-breakthrough .node-badge { color: #fbbf24; }
    .cat-breakthrough .node-rect { stroke: #fbbf24; fill: rgba(251, 191, 36, 0.05); }
    .cat-algebra .node-badge { color: #c084fc; }
    .cat-parity .node-badge { color: #818cf8; }
    .cat-conclusion .node-badge { color: #38bdf8; }
    .cat-takeaway .node-badge { color: #10b981; }
    .cat-takeaway .node-rect {
      stroke: #10b981;
      stroke-width: 2.6;
      fill: rgba(16, 185, 129, 0.08);
      filter: drop-shadow(0 0 16px rgba(16, 185, 129, 0.35));
    }
    .cat-takeaway .node-title {
      color: #34d399;
      font-weight: 700;
    }

    /* Dimmed state */
    .dimmed { opacity: 0.12 !important; }

    /* Slide-out Archify Science Drawer */
    .drawer {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 500px;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      box-shadow: -8px 0 28px rgba(0,0,0,0.35);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      z-index: 200;
    }
    .drawer.open { transform: translateX(0); }

    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .drawer-header h2 { font-size: 1.02rem; font-weight: 700; margin-bottom: 4px; word-break: break-word; line-height: 1.35; }
    .drawer-header p { font-size: 0.8rem; color: var(--text-muted); }
    .btn-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.2rem;
      cursor: pointer;
    }
    .btn-close:hover { color: var(--text); }

    .drawer-tabs {
      display: flex;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
    }
    .dtab {
      flex: 1;
      text-align: center;
      padding: 10px 0;
      font-size: 0.8rem;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .dtab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .info-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .info-card h4 {
      font-size: 0.82rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }

    .takeaway-card {
      border: 1.5px solid var(--emerald) !important;
      background: rgba(16, 185, 129, 0.05) !important;
    }
    .takeaway-box-glow {
      border-left: 4px solid var(--emerald) !important;
      background: rgba(16, 185, 129, 0.08) !important;
      font-size: 0.96rem !important;
      overflow-x: auto;
      padding: 16px 14px;
      box-shadow: 0 0 16px rgba(16, 185, 129, 0.15);
    }

    .handwritten-preview {
      text-align: center;
      margin-top: 4px;
      position: relative;
    }
    .handwritten-preview img {
      max-width: 100%;
      background: #ffffff;
      padding: 6px;
      border-radius: 6px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      cursor: zoom-in;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .handwritten-preview img:hover {
      transform: scale(1.02);
      box-shadow: 0 6px 20px rgba(56, 189, 248, 0.3);
    }
    .blackboard-hint {
      font-size: 0.72rem;
      color: var(--accent);
      margin-top: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
    }

    /* Fullscreen Blackboard Modal with Laser Pointer */
    .blackboard-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(4, 7, 13, 0.95);
      backdrop-filter: blur(12px);
      z-index: 1000;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .blackboard-modal.active { display: flex; }

    .blackboard-toolbar {
      padding: 12px 24px;
      background: rgba(15, 23, 42, 0.85);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 10;
    }
    .blackboard-tools {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .laser-toggle {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .laser-toggle.on {
      background: rgba(244, 63, 94, 0.2);
      border-color: var(--rose);
      color: #fda4af;
      box-shadow: 0 0 12px rgba(244, 63, 94, 0.4);
    }
    .laser-dot-preview {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--rose);
      box-shadow: 0 0 8px #f43f5e, 0 0 14px #fb7185;
    }

    .blackboard-canvas-wrap {
      flex: 1;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
    }
    .blackboard-canvas-wrap:active { cursor: grabbing; }
    .blackboard-canvas-wrap.laser-mode { cursor: none !important; }
    .blackboard-canvas-wrap.laser-mode * { cursor: none !important; }

    .blackboard-img {
      max-width: 90%;
      max-height: 88vh;
      object-fit: contain;
      background: #ffffff;
      padding: 14px;
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.8);
      transition: transform 0.15s ease-out;
      pointer-events: none;
    }

    /* Fixed Viewport Laser Pointer Dot */
    .laser-dot {
      position: fixed;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ff0055;
      box-shadow: 0 0 8px #ff0055, 0 0 18px #ff0055, 0 0 32px #ff2266, inset 0 0 3px #ffffff;
      pointer-events: none;
      transform: translate(-50%, -50%);
      display: none;
      z-index: 2000;
    }
    .laser-dot.trail {
      animation: laserPulse 1.2s infinite alternate;
    }
    @keyframes laserPulse {
      from { transform: translate(-50%, -50%) scale(1); opacity: 0.9; }
      to { transform: translate(-50%, -50%) scale(1.35); opacity: 1; filter: drop-shadow(0 0 8px #ff0055); }
    }

    .formula-display {
      background: rgba(0,0,0,0.3);
      border-left: 3px solid var(--accent);
      padding: 12px;
      border-radius: 0 6px 6px 0;
      font-size: 0.95rem;
      overflow-x: auto;
      margin: 8px 0;
    }

    .code-chip {
      font-family: monospace;
      font-size: 0.78rem;
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 8px;
      border-radius: 4px;
      display: inline-block;
    }

    /* Bottom Conclusions Banner */
    .bottom-bar {
      background: var(--bg-panel);
      border-top: 1px solid var(--border);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 0.82rem;
    }
    .conclusion-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.cyan { background: var(--accent); }
    .dot.amber { background: var(--gold); }
    .dot.rose { background: var(--rose); }
    .dot.emerald { background: var(--emerald); }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <span class="badge-map">Science Map · Derivation Unit</span>
      <h1 class="map-title" id="pageTitle">Z₃ 理论推导微地图</h1>
      <span class="map-subtitle" id="pageSubtitle">手稿单元收纳</span>
    </div>

    <!-- Unit Switcher (3 Modular Units) -->
    <div class="unit-nav">
      <button class="unit-tab active" id="tabUnit1" onclick="switchUnit('unit1')">Unit 01 · Z₃ 对称性检查</button>
      <button class="unit-tab" id="tabUnit2" onclick="switchUnit('unit2')">Unit 02 · 狄利克雷核色散解</button>
      <button class="unit-tab" id="tabUnit3" onclick="switchUnit('unit3')">Unit 03 · C 扇区能量解释</button>
    </div>

    <div class="header-actions">
      <button class="btn-tool" onclick="resetZoom()" title="复位画布 (0)">⟲ 0</button>
      <button class="btn-tool" onclick="toggleTheme()" title="切换主题 (T)">🌓 T</button>
      <button class="btn-tool" onclick="prevStep()" title="上一步 ([)">← [</button>
      <button class="btn-tool" onclick="nextStep()" title="下一步 (])">] →</button>
    </div>
  </header>

  <div class="canvas-container" id="canvasContainer">
    <svg id="diagramSvg" viewBox="0 0 1600 480">
      <defs>
        <marker id="arrow-main" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M 0 1 L 8 4.5 L 0 8 Z" fill="#38bdf8" />
        </marker>
        <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 Z" fill="#64748b" />
        </marker>
        <marker id="arrow-security" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 Z" fill="#f43f5e" />
        </marker>
        <marker id="arrow-emphasis" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 Z" fill="#10b981" />
        </marker>
      </defs>

      <g id="transformGroup">
        <g id="edgesLayer"></g>
        <g id="nodesLayer"></g>
      </g>
    </svg>

    <!-- Slide-out Archify Science Drawer -->
    <div class="drawer" id="detailDrawer">
      <div class="drawer-header">
        <div>
          <h2 id="drawerTitle">Node Details</h2>
          <p id="drawerBadge">Step Badge</p>
        </div>
        <button class="btn-close" onclick="closeDrawer()">✕</button>
      </div>

      <div class="drawer-tabs">
        <div class="dtab active" id="tabCropBtn" onclick="switchDrawerTab('crop')">手稿笔迹证据</div>
        <div class="dtab" id="tabFormulaBtn" onclick="switchDrawerTab('formula')">代数推演 (LaTeX)</div>
        <div class="dtab" id="tabSecretaryBtn" onclick="switchDrawerTab('secretary')">秘书研判与代码</div>
      </div>

      <div class="drawer-body" id="drawerBody">
        <!-- Content dynamically injected -->
      </div>
    </div>
  </div>

  <div class="bottom-bar" id="bottomBar">
    <!-- Key takeaways rendered by JS -->
  </div>

  <!-- Fullscreen Blackboard Modal with Zoom and Laser Pointer -->
  <div class="blackboard-modal" id="blackboardModal">
    <div class="blackboard-toolbar">
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="badge-map" style="background:rgba(244,63,94,0.15); color:#fda4af; border-color:var(--rose);">黑板推演模式</span>
        <strong id="blackboardTitle" style="font-size:0.95rem; color:var(--text);">推导手稿切片精读</strong>
      </div>

      <div class="blackboard-tools">
        <button class="laser-toggle" id="laserToggleBtn" onclick="toggleLaserMode()">
          <span class="laser-dot-preview"></span>
          <span id="laserText">激光笔模式 (L)</span>
        </button>
        <button class="btn-tool" onclick="resetBlackboardZoom()" title="复位缩放 (0)">⟲ 0</button>
        <button class="btn-tool" onclick="closeBlackboard()" title="退出黑板 (ESC)">✕ 退出黑板 (ESC)</button>
      </div>
    </div>

    <div class="blackboard-canvas-wrap" id="blackboardWrap">
      <img src="" id="blackboardImg" class="blackboard-img" alt="手写笔迹放大" />
      <div class="laser-dot" id="laserDot"></div>
    </div>
  </div>

  <script>
    const DATA = ${jsonStr};
    let currentUnitKey = "unit1";
    let selectedNodeId = null;
    let currentDrawerTab = "crop";
    let activeStepIndex = 0;

    // Pan & Zoom
    let scale = 1;
    let panX = 40;
    let panY = 50;
    let isDragging = false;
    let startX, startY;

    const container = document.getElementById('canvasContainer');
    const transformGroup = document.getElementById('transformGroup');

    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node-group')) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      scale = Math.min(Math.max(0.5, scale * zoomFactor), 2.5);
      applyTransform();
    });

    function applyTransform() {
      transformGroup.setAttribute('transform', 'translate(' + panX + ', ' + panY + ') scale(' + scale + ')');
    }

    function resetZoom() {
      scale = 1;
      panX = 40;
      panY = 50;
      applyTransform();
    }

    function toggleTheme() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
    }

    // High-performance KaTeX String Renderer
    function renderLatex(str) {
      if (!str || typeof str !== 'string') return '';
      if (!window.katex) return escapeHtml(str);
      return str.replace(/\$([^\$]+)\$/g, (match, expr) => {
        try {
          return katex.renderToString(expr, { displayMode: false, throwOnError: false });
        } catch (e) {
          return match;
        }
      });
    }

    // Switch between Unit 1, 2, 3
    function switchUnit(unitKey) {
      currentUnitKey = unitKey;
      document.querySelectorAll('.unit-tab').forEach(t => t.classList.remove('active'));
      const activeTab = document.getElementById(unitKey === 'unit1' ? 'tabUnit1' : unitKey === 'unit2' ? 'tabUnit2' : 'tabUnit3');
      if (activeTab) activeTab.classList.add('active');

      const u = DATA.units[unitKey];
      document.getElementById('pageTitle').innerHTML = renderLatex(u.title);
      document.getElementById('pageSubtitle').innerHTML = renderLatex(u.subtitle);

      closeDrawer();
      renderDiagram();
      renderBottomBar();
      resetZoom();
      activeStepIndex = 0;
    }

    // Render SVG Nodes & Edges using ForeignObject with KaTeX
    function renderDiagram() {
      const u = DATA.units[currentUnitKey];
      const nodesLayer = document.getElementById('nodesLayer');
      const edgesLayer = document.getElementById('edgesLayer');
      nodesLayer.innerHTML = '';
      edgesLayer.innerHTML = '';

      const numCols = Math.max(...u.nodes.map(n => n.col)) + 1;
      const COL_W = numCols >= 6 ? 245 : numCols <= 4 ? 280 : 260;
      const COL_GAP = numCols >= 6 ? 68 : numCols <= 4 ? 96 : 82;
      const ROW_H = 82;
      const ROW_GAP = 75;
      const ORIGIN_X = 40;
      const ORIGIN_Y = 50;

      const totalW = ORIGIN_X * 2 + numCols * COL_W + (numCols - 1) * COL_GAP + 40;
      const totalH = 480;
      document.getElementById('diagramSvg').setAttribute('viewBox', '0 0 ' + Math.max(1600, totalW) + ' ' + totalH);

      const nodeGeom = new Map();

      // Place nodes
      u.nodes.forEach(n => {
        const x = ORIGIN_X + n.col * (COL_W + COL_GAP);
        const y = ORIGIN_Y + n.row * (ROW_H + ROW_GAP);
        const w = COL_W;
        const h = ROW_H;
        nodeGeom.set(n.id, {
          x: x, y: y, w: w, h: h,
          left: [x, y + h / 2],
          right: [x + w, y + h / 2],
          top: [x + w / 2, y],
          bottom: [x + w / 2, y + h]
        });

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node-group cat-' + n.category + (n.is_main ? ' is-main' : ''));
        g.setAttribute('id', 'node-' + n.id);
        g.setAttribute('data-id', n.id);
        g.onclick = () => selectNode(n.id);

        g.innerHTML = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" class="node-rect" />' +
          '<foreignObject x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" class="node-foreign-wrap">' +
              '<div class="node-badge">' + renderLatex(n.badge) + '</div>' +
              '<div class="node-title">' + renderLatex(n.label) + '</div>' +
              '<div class="node-sublabel">' + renderLatex(n.sublabel) + '</div>' +
            '</div>' +
          '</foreignObject>';
        nodesLayer.appendChild(g);
      });

      // Place edges
      u.edges.forEach(e => {
        const src = nodeGeom.get(e.from);
        const tgt = nodeGeom.get(e.to);
        if (!src || !tgt) return;

        let x1, y1, x2, y2, pathD;
        const fromNode = u.nodes.find(n => n.id === e.from);
        const toNode = u.nodes.find(n => n.id === e.to);

        const isHorizontal = (toNode.col !== fromNode.col) && (toNode.row === fromNode.row);
        const isVertical = (toNode.col === fromNode.col);

        if (isHorizontal) {
          x1 = src.right[0]; y1 = src.right[1];
          x2 = tgt.left[0]; y2 = tgt.left[1];
          pathD = 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
        } else if (isVertical) {
          if (toNode.row > fromNode.row) {
            x1 = src.bottom[0]; y1 = src.bottom[1];
            x2 = tgt.top[0]; y2 = tgt.top[1];
          } else {
            x1 = src.top[0]; y1 = src.top[1];
            x2 = tgt.bottom[0]; y2 = tgt.bottom[1];
          }
          pathD = 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
        } else {
          // Curved / diagonal edge
          if (toNode.col > fromNode.col && toNode.row > fromNode.row) {
            x1 = src.bottom[0]; y1 = src.bottom[1];
            x2 = tgt.left[0]; y2 = tgt.left[1];
            pathD = 'M ' + x1 + ' ' + y1 + ' Q ' + x1 + ' ' + y2 + ', ' + x2 + ' ' + y2;
          } else if (toNode.col > fromNode.col && toNode.row < fromNode.row) {
            x1 = src.right[0]; y1 = src.right[1];
            x2 = tgt.left[0]; y2 = tgt.left[1];
            const midX = (x1 + x2) / 2;
            pathD = 'M ' + x1 + ' ' + y1 + ' C ' + midX + ' ' + y1 + ', ' + midX + ' ' + y2 + ', ' + x2 + ' ' + y2;
          } else {
            x1 = src.right[0]; y1 = src.right[1];
            x2 = tgt.left[0]; y2 = tgt.left[1];
            pathD = 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
          }
        }

        const markerId = e.variant === 'security'
          ? 'arrow-security'
          : e.variant === 'emphasis'
          ? 'arrow-emphasis'
          : e.is_main
          ? 'arrow-main'
          : 'arrow-default';

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'edge-group ' + (e.is_main ? 'main-flow ' : '') + 'variant-' + (e.variant || 'default'));
        g.setAttribute('id', 'edge-' + e.id);
        g.setAttribute('data-from', e.from);
        g.setAttribute('data-to', e.to);

        let midLx, midLy, textAnchor = 'center';
        if (isHorizontal) {
          midLx = (x1 + x2) / 2;
          midLy = y1 - 13;
          textAnchor = 'center';
        } else if (isVertical) {
          midLx = x1 + 14;
          midLy = (y1 + y2) / 2;
          textAnchor = 'flex-start';
        } else {
          midLx = (x1 + x2) / 2 + 10;
          midLy = (y1 + y2) / 2 - 8;
          textAnchor = 'center';
        }

        let labelHtml = '';
        if (e.label) {
          labelHtml = '<foreignObject x="' + (midLx - 90) + '" y="' + (midLy - 13) + '" width="180" height="28" style="overflow:visible; pointer-events:none;">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" class="edge-foreign-container" style="justify-content: ' + textAnchor + ';">' +
              '<div class="edge-foreign-badge">' + renderLatex(e.label) + '</div>' +
            '</div>' +
          '</foreignObject>';
        }

        g.innerHTML = '<path d="' + pathD + '" class="edge-path ' + (e.is_main ? 'main-flow ' : '') + 'variant-' + (e.variant || 'default') + '" marker-end="url(#' + markerId + ')" />' + labelHtml;
        edgesLayer.appendChild(g);
      });
    }

    function renderBottomBar() {
      const u = DATA.units[currentUnitKey];
      const bar = document.getElementById('bottomBar');
      bar.innerHTML = '<strong style="color:var(--accent);">推导破局点：</strong>' +
        u.conclusions.map(function(c) {
          return '<div class="conclusion-item">' +
            '<span class="dot ' + c.dot + '"></span>' +
            '<span><strong>' + renderLatex(c.title) + ':</strong> ' + renderLatex(c.text) + '</span>' +
          '</div>';
        }).join('');
    }

    // Node Selection & Highlight Flow
    function selectNode(id) {
      selectedNodeId = id;
      const u = DATA.units[currentUnitKey];
      const node = u.nodes.find(n => n.id === id);
      if (!node) return;

      activeStepIndex = u.nodes.findIndex(n => n.id === id);

      // Highlight selected
      document.querySelectorAll('.node-group').forEach(el => el.classList.remove('selected'));
      const selEl = document.getElementById('node-' + id);
      if (selEl) selEl.classList.add('selected');

      // Trace ancestors and descendants
      const related = new Set([id]);
      u.edges.forEach(e => {
        if (e.from === id) related.add(e.to);
        if (e.to === id) related.add(e.from);
      });

      document.querySelectorAll('.node-group').forEach(el => {
        const nid = el.getAttribute('data-id');
        if (related.has(nid)) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      });

      document.querySelectorAll('.edge-group').forEach(el => {
        const from = el.getAttribute('data-from');
        const to = el.getAttribute('data-to');
        if (related.has(from) && related.has(to)) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      });

      // Update drawer
      document.getElementById('drawerTitle').innerHTML = renderLatex(node.label);
      document.getElementById('drawerBadge').innerHTML = renderLatex(node.badge);
      document.getElementById('detailDrawer').classList.add('open');

      if (node.category === 'takeaway') {
        switchDrawerTab('formula');
      } else {
        switchDrawerTab(currentDrawerTab || 'crop');
      }
    }

    function closeDrawer() {
      document.getElementById('detailDrawer').classList.remove('open');
      document.querySelectorAll('.node-group, .edge-group').forEach(el => {
        el.classList.remove('dimmed');
        el.classList.remove('selected');
      });
      selectedNodeId = null;
    }

    function switchDrawerTab(tab) {
      currentDrawerTab = tab;
      document.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
      const activeTab = document.getElementById('tab' + capitalize(tab) + 'Btn');
      if (activeTab) activeTab.classList.add('active');

      const u = DATA.units[currentUnitKey];
      const node = u.nodes.find(n => n.id === selectedNodeId);
      if (node) renderDrawerBody(node);
    }

    function capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function renderDrawerBody(node) {
      const body = document.getElementById('drawerBody');
      const cropUri = DATA.crops[node.crop_key] || '';

      if (currentDrawerTab === 'crop') {
        body.innerHTML = `
          <div class="info-card">
            <h4>手稿真实笔迹切片 (点击切片进入全屏黑板推演)</h4>
            <div class="handwritten-preview" onclick="openCurrentNodeBlackboard()">
              <img src="${cropUri}" alt="手写笔迹证据" />
              <div class="blackboard-hint">🔍 点击进入全屏黑板推演模式 (支持放大 + 激光笔 L)</div>
            </div>
            <p style="font-size:0.75rem; color:var(--text-muted); margin-top:8px;">
              来自原始笔记 .qnote 矢量笔迹，精准复核思考现场。
            </p>
          </div>
        `;
      } else if (currentDrawerTab === 'formula') {
        const isTakeaway = node.category === 'takeaway';
        body.innerHTML = `
          <div class="info-card ${isTakeaway ? 'takeaway-card' : ''}">
            <h4 style="${isTakeaway ? 'color:var(--emerald); font-weight:700;' : ''}">
              ${isTakeaway ? '★ 核心速查定理框 (Takeaway Formula)' : '该步骤严格代数推导'}
            </h4>
            <div class="formula-display ${isTakeaway ? 'takeaway-box-glow' : ''}">
              $$${node.formula}$$
            </div>
          </div>
          <div class="info-card">
            <h4>物理与代数说明</h4>
            <p style="font-size:0.83rem; line-height:1.6; color:var(--text);">
              ${renderLatex(node.sublabel)}
            </p>
          </div>
        `;
        if (window.katex) {
          const fBox = body.querySelector('.formula-display');
          if (fBox) {
            try {
              fBox.innerHTML = katex.renderToString(node.formula, { displayMode: true, throwOnError: false });
            } catch(e) {}
          }
        }
      } else if (currentDrawerTab === 'secretary') {
        body.innerHTML = `
          <div class="info-card">
            <h4>秘书研判与物理洞察</h4>
            <p style="font-size:0.84rem; line-height:1.6; color:var(--text);">
              ${renderLatex(node.secretary_note)}
            </p>
          </div>
          <div class="info-card">
            <h4>关联代码实现</h4>
            <div style="margin-top:4px;">
              <span class="code-chip">${escapeHtml(node.code_path)}</span>
            </div>
          </div>
        `;
      }
    }

    // Step navigation
    function nextStep() {
      const u = DATA.units[currentUnitKey];
      activeStepIndex = (activeStepIndex + 1) % u.nodes.length;
      selectNode(u.nodes[activeStepIndex].id);
    }

    function prevStep() {
      const u = DATA.units[currentUnitKey];
      activeStepIndex = (activeStepIndex - 1 + u.nodes.length) % u.nodes.length;
      selectNode(u.nodes[activeStepIndex].id);
    }

    // Blackboard Modal & Laser Pointer Logic
    let bbScale = 1;
    let bbPanX = 0;
    let bbPanY = 0;
    let bbIsDragging = false;
    let bbStartX, bbStartY;
    let isLaserMode = false;

    const bbModal = document.getElementById('blackboardModal');
    const bbWrap = document.getElementById('blackboardWrap');
    const bbImg = document.getElementById('blackboardImg');
    const laserDot = document.getElementById('laserDot');
    const laserBtn = document.getElementById('laserToggleBtn');

    function openCurrentNodeBlackboard() {
      const u = DATA.units[currentUnitKey];
      const node = u.nodes.find(n => n.id === selectedNodeId);
      if (!node) return;
      openBlackboard(node.crop_key, node.label);
    }

    function openBlackboard(cropKeyOrUri, title) {
      document.getElementById('blackboardTitle').innerHTML = renderLatex(title || '推导手稿切片精读');
      const uri = DATA.crops[cropKeyOrUri] || cropKeyOrUri;
      bbImg.src = uri;
      bbModal.classList.add('active');
      resetBlackboardZoom();
    }

    function closeBlackboard() {
      bbModal.classList.remove('active');
      setLaserMode(false);
    }

    function toggleLaserMode() {
      setLaserMode(!isLaserMode);
    }

    function setLaserMode(on) {
      isLaserMode = on;
      if (isLaserMode) {
        laserBtn.classList.add('on');
        bbWrap.classList.add('laser-mode');
        document.getElementById('laserText').innerText = '激光笔: 开启中 (L)';
      } else {
        laserBtn.classList.remove('on');
        bbWrap.classList.remove('laser-mode');
        laserDot.style.display = 'none';
        document.getElementById('laserText').innerText = '激光笔模式 (L)';
      }
    }

    bbWrap.addEventListener('mousemove', (e) => {
      if (isLaserMode) {
        laserDot.style.display = 'block';
        laserDot.style.left = e.clientX + 'px';
        laserDot.style.top = e.clientY + 'px';
      }
      if (bbIsDragging && !isLaserMode) {
        bbPanX = e.clientX - bbStartX;
        bbPanY = e.clientY - bbStartY;
        applyBlackboardTransform();
      }
    });

    bbWrap.addEventListener('mouseleave', () => {
      laserDot.style.display = 'none';
    });

    bbWrap.addEventListener('mousedown', (e) => {
      if (isLaserMode) {
        laserDot.classList.add('trail');
        return;
      }
      bbIsDragging = true;
      bbStartX = e.clientX - bbPanX;
      bbStartY = e.clientY - bbPanY;
    });

    window.addEventListener('mouseup', () => {
      bbIsDragging = false;
      laserDot.classList.remove('trail');
    });

    bbWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      bbScale = Math.min(Math.max(0.6, bbScale * factor), 5.0);
      applyBlackboardTransform();
    });

    function applyBlackboardTransform() {
      bbImg.style.transform = 'translate(' + bbPanX + 'px, ' + bbPanY + 'px) scale(' + bbScale + ')';
    }

    function resetBlackboardZoom() {
      bbScale = 1;
      bbPanX = 0;
      bbPanY = 0;
      applyBlackboardTransform();
    }

    // Keyboard bindings
    window.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        if (bbModal.classList.contains('active')) {
          toggleLaserMode();
          return;
        }
      }
      if (e.key === 'Escape') {
        if (bbModal.classList.contains('active')) {
          closeBlackboard();
          return;
        }
        closeDrawer();
        return;
      }
      if (e.key === '0') resetZoom();
      if (e.key === 't' || e.key === 'T') toggleTheme();
      if (e.key === '1') switchUnit('unit1');
      if (e.key === '2') switchUnit('unit2');
      if (e.key === '3') switchUnit('unit3');
      if (e.key === ']' || e.key === 'ArrowRight') nextStep();
      if (e.key === '[' || e.key === 'ArrowLeft') prevStep();
    });

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      }[m]));
    }

    // Init
    switchUnit('unit1');
  </script>
</body>
</html>`;
}

const html = generateArchifyStyleDerivationMap();
const targetPath = '/home/suxeca/Workspace/Z3model/z3_derivation_units_map.html';
writeFileSync(targetPath, html, 'utf8');
console.log('Successfully written full LaTeX-enabled derivation map to:', targetPath, 'Size:', (Buffer.byteLength(html) / 1024).toFixed(1), 'KB');
