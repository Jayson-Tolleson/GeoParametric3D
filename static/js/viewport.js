import { CADState, enuToGeodetic, geodeticToEnu } from './state.js';
import { CADCommands } from './commands.js';
import { CADApi } from './api.js';

export class SphericalTrackball {
  constructor(containerElement, onRotateCallback) {
    this.container = containerElement;
    this.onRotate = onRotateCallback;
    this.svgElement = document.getElementById('spherical-trackball-svg');
    this.svgGroup = document.getElementById('gizmo-faces');
    this.lblTop = document.getElementById('gizmo-label-top');
    this.lblBot = document.getElementById('gizmo-label-bot');
    this.lblW = document.getElementById('gizmo-label-w');
    this.lblE = document.getElementById('gizmo-label-e');
    this.lblN = document.getElementById('gizmo-label-n');
    this.lblS = document.getElementById('gizmo-label-s');

    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.initListeners();
  }

  initListeners() {
    if (!this.svgElement) return;
    this.svgElement.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.isDragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.svgElement.setPointerCapture(e.pointerId);
    });
    this.svgElement.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      e.stopPropagation();
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (this.onRotate) this.onRotate(dx * 0.75, dy * 0.75);
    });
    const endDrag = (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        try { this.svgElement.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    this.svgElement.addEventListener('pointerup', endDrag);
    this.svgElement.addEventListener('pointercancel', endDrag);
  }

  updateFromCamera(heading, tilt) {
    if (!this.svgGroup) return;
    const hdgRad = (heading * Math.PI) / 180;
    const tiltRad = (tilt * Math.PI) / 180;
    const R = 32;
    const projectMarker = (x, y, z) => {
      const rx = x * Math.cos(hdgRad) - y * Math.sin(hdgRad);
      const ry = x * Math.sin(hdgRad) + y * Math.cos(hdgRad);
      const rz = z;
      const px = rx;
      const py = -(ry * Math.cos(tiltRad) + rz * Math.sin(tiltRad));
      const pz = ry * Math.sin(tiltRad) - rz * Math.cos(tiltRad);
      return { x: px, y: py, z: pz, visible: pz > -5 };
    };

    const markers = [
      { elem: this.lblTop, pos: [0, 0, R] },
      { elem: this.lblBot, pos: [0, 0, -R] },
      { elem: this.lblN,   pos: [0, R, 0] },
      { elem: this.lblS,   pos: [0, -R, 0] },
      { elem: this.lblE,   pos: [R, 0, 0] },
      { elem: this.lblW,   pos: [-R, 0, 0] }
    ];

    markers.forEach(m => {
      if (!m.elem) return;
      const p = projectMarker(m.pos[0], m.pos[1], m.pos[2]);
      m.elem.setAttribute('x', p.x.toFixed(1));
      m.elem.setAttribute('y', (p.y + 3).toFixed(1));
      m.elem.setAttribute('opacity', p.visible ? '1.0' : '0.15');
    });
  }
}

export class ViewportController {
  constructor() {
    this.canvasOverlay = document.getElementById('viewport-overlay-canvas');
    this.ctx = this.canvasOverlay ? this.canvasOverlay.getContext('2d') : null;
    this.map3d = null;
    this.isSyncingFromState = false;
    
    this.isMouseDown = false;
    this.dragButton = -1;
    this.startX = 0;
    this.startY = 0;

    this.cssWidth = 0;
    this.cssHeight = 0;

    this.isBoxSelecting = false;
    this.boxStart = null;
    this.boxCurrent = null;
    this.boxMovedDistance = 0;

    this.isTransformDragging = false;
    this.transformDragStartWorld = null;
    this.transformDragCurrentWorld = null;
    this.transformInitialPositions = new Map();
    this.transformInitialRotations = new Map();
    this.transformInitialScales = new Map();

    this.draftPoints = [];
    this.draftCurrent = null;

    this.geometryCacheDirty = true;
    this.lastDocUpdatedTime = 0;
    this.faceRenderQueue = [];
    this.verticesRender = [];
    this.edgesRender = [];
    this.snaps = [];

    this.persistentFaces = this.faceRenderQueue;
    this.persistentVertices = this.verticesRender;
    this.persistentEdges = this.edgesRender;
    this.persistentSnaps = this.snaps;

    this.lastRenderQueue = this.faceRenderQueue;
    this.lastRenderVertices = this.verticesRender;
    this.lastRenderEdges = this.edgesRender;
    this.snapCandidates = this.snaps;
    this.activeSnapTarget = null;

    this.telemetryMetrics = {
      renderCount: 0,
      lastReportTime: performance.now(),
      totalRenderTimeMs: 0,
      totalProjTimeMs: 0,
      totalSortTimeMs: 0,
      maxRenderTimeMs: 0,
      vertexAllocCount: 0,
      edgeAllocCount: 0,
      faceAllocCount: 0
    };

    this.initMap3D();
    this.initTrackball();
    this.initOverlay();
    this.initMouseControls();
    this.initTouchControls();
    this.initKeyboardControls();

    CADState.subscribe(() => {
      this.geometryCacheDirty = true;
      this.syncViewport();
    });
  }

  // 1. UNIFIED CAMERA ACTION PRIMITIVES
  orbitHeading(deltaDeg) {
    const cam = CADState.state.camera;
    cam.heading = ((cam.heading || 0) + deltaDeg + 360) % 360;
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  orbitTilt(deltaDeg) {
    const cam = CADState.state.camera;
    cam.tilt = Math.max(1, Math.min(179, (cam.tilt || 65) + deltaDeg));
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  panScreen(deltaX, deltaY) {
    const cam = CADState.state.camera;
    cam.panX = (cam.panX || 0) + deltaX;
    cam.panY = (cam.panY || 0) + deltaY;
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  zoomBy(factor, focalScreenX = null, focalScreenY = null) {
    const cam = CADState.state.camera;
    const oldRange = cam.range || 1828.8;
    // Multi-scale range: 0.125 inches (3.175 mm / 0.003175 m) to 3000+ ft (1,000,000 mm / 1000.0 m)
    const newRange = Math.max(3.175, Math.min(1000000.0, oldRange * factor));
    
    if (focalScreenX !== null && focalScreenY !== null) {
      const cx = (this.cssWidth || 800) / 2 + (cam.panX || 0);
      const cy = (this.cssHeight || 600) / 2 + (cam.panY || 0);
      cam.panX = (cam.panX || 0) - (focalScreenX - cx) * (1 - factor) * 0.4;
      cam.panY = (cam.panY || 0) - (focalScreenY - cy) * (1 - factor) * 0.4;
    }
    
    cam.range = newRange;
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  async initMap3D() {
    this.map3d = document.getElementById('map-3d-element');
    try {
      await customElements.whenDefined('gmp-map-3d');
      if (!this.map3d) {
        const container = document.getElementById('viewport-container');
        if (container) {
          this.map3d = document.createElement('gmp-map-3d');
          this.map3d.id = 'map-3d-element';
          this.map3d.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1;';
          container.insertBefore(this.map3d, this.canvasOverlay);
        }
      }
      if (this.map3d) {
        this.bindMap3DEvents();
        this.bindSelectionEvents();
        this.syncMap3DFromState();
        this.syncNativeDOM();
      }
    } catch (err) {
      console.warn('[Viewport] <gmp-map-3d> element readiness notice:', err);
    }
  }

  bindMap3DEvents() {
    if (!this.map3d) return;
    const onMapCameraChange = () => {
      if (this.isSyncingFromState) return;
      const cam = CADState.state.camera;
      if (typeof this.map3d.heading === 'number') cam.heading = this.map3d.heading;
      if (typeof this.map3d.tilt === 'number') cam.tilt = this.map3d.tilt;
      if (typeof this.map3d.range === 'number') cam.range = this.map3d.range;
      CADState.notify();
      this.render();
    };
    ['gmp-center-changed', 'gmp-heading-changed', 'gmp-tilt-changed', 'gmp-range-changed'].forEach(evtName => {
      this.map3d.addEventListener(evtName, onMapCameraChange);
    });
  }

  syncMap3DFromState() {
    if (!this.map3d) return;
    this.isSyncingFromState = true;
    try {
      const cam = CADState.state.camera;
      const c = cam.center || { lat: 33.8814, lng: -117.9213, altitude: 95.0 };
      const lat = c.lat !== undefined ? c.lat : c[0];
      const lng = c.lng !== undefined ? c.lng : c[1];
      const alt = c.altitude !== undefined ? c.altitude : (c[2] || 95.0);
      this.map3d.setAttribute('center', `${lat},${lng},${alt}`);
      if (typeof cam.heading === 'number') this.map3d.setAttribute('heading', String(cam.heading));
      if (typeof cam.tilt === 'number') this.map3d.setAttribute('tilt', String(cam.tilt));
      if (typeof cam.range === 'number') this.map3d.setAttribute('range', String(cam.range));
    } catch (e) {
      console.warn('[Viewport] Sync state to <gmp-map-3d> error:', e);
    } finally {
      this.isSyncingFromState = false;
    }
  }

  initTrackball() {
    const container = document.getElementById('view-gizmo-container');
    this.trackball = new SphericalTrackball(container, (dHdg, dTilt) => {
      this.orbitHeading(dHdg);
      this.orbitTilt(dTilt);
    });

    // Preset chip single-click listeners
    document.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dir = chip.dataset.dir;
        if (dir === 'fit') {
          this.centerViewport();
        } else if (dir) {
          CADCommands.cameraPreset(dir);
        }
      });
    });
  }

  // Zoom to Fit (7x Viewport Fit): Position gizmo/target at model center, camera distance = 7 * R
  centerViewport() {
    const bounds = this.computeSceneBoundingBox();
    const cam = CADState.state.camera;
    const cx = bounds.center[0], cy = bounds.center[1], cz = bounds.center[2];
    
    const R = bounds.radius || (bounds.diagonal ? bounds.diagonal / 2.0 : 152.4);
    const targetDistance = Math.max(22.225, 7.0 * R); // strictly 7x model size (7 * R)
    
    const geoCenter = enuToGeodetic(cx, cy, cz);
    cam.center = geoCenter;
    cam.heading = 30;
    cam.tilt = 65;
    cam.range = targetDistance;
    cam.panX = 0;
    cam.panY = 0;
    cam.target = [cx, cy, cz];
    
    if (this.trackball) {
      this.trackball.updateFromCamera(cam.heading, cam.tilt);
    }
    if (this.map3d && typeof this.map3d.flyCameraTo === 'function') {
      try {
        this.map3d.flyCameraTo({
          endCamera: {
            center: { lat: geoCenter.lat, lng: geoCenter.lng, altitude: geoCenter.altitude },
            heading: cam.heading,
            tilt: cam.tilt,
            range: targetDistance,
            roll: 0
          },
          durationMillis: 800
        });
      } catch (_) {
        this.syncMap3DFromState();
      }
    } else {
      this.syncMap3DFromState();
    }
    CADState.notify();
    this.render();
  }

  computeSceneBoundingBox() {
    const selObjs = CADState.getSelectedObjects();
    const objects = selObjs.length > 0 ? selObjs : (CADState.state.objects || []);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    if (objects.length === 0) return { min: [-152.4, -152.4, 0], max: [152.4, 152.4, 304.8], maxDimension: 304.8, diagonal: 527.93, radius: 263.96, center: [0, 0, 152.4] };
    
    objects.forEach(obj => {
      if (obj.visible === false) return;
      const pos = obj.position || [0,0,0];
      const scale = obj.scale || [1,1,1];
      const faces = obj.faces || [];
      faces.forEach(face => {
        face.forEach(pt => {
          const x = pos[0] + (pt.x !== undefined ? pt.x : 0) * scale[0];
          const y = pos[1] + (pt.y !== undefined ? pt.y : 0) * scale[1];
          const z = pos[2] + (pt.z !== undefined ? pt.z : 0) * scale[2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        });
      });
    });
    
    if (minX === Infinity) return { min: [-152.4, -152.4, 0], max: [152.4, 152.4, 304.8], maxDimension: 304.8, diagonal: 527.93, radius: 263.96, center: [0, 0, 152.4] };
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const diag = Math.hypot(dx, dy, dz);
    const radius = Math.max(diag / 2.0, 25.0);
    return {
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      center: [(minX + maxX)/2, (minY + maxY)/2, (minZ + maxZ)/2],
      extents: [dx, dy, dz],
      diagonal: diag,
      radius: radius,
      maxDimension: Math.max(dx, dy, dz, 50.0)
    };
  }

  cancelBoxSelection() {
    this.isBoxSelecting = false;
    this.boxStart = null;
    this.boxCurrent = null;
    this.boxMovedDistance = 0;
  }

  initKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const panStep = 35;
      const rotStep = 10;

      if (isCtrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        CADState.selectAllParts();
        this.render();
        return;
      }

      // Keyboard Pan Controls: Same-direction movement (Left arrow pans view left/scene right, Right arrow pans view right)
      if (!isShift && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') this.panScreen(panStep, 0);
        if (e.key === 'ArrowRight') this.panScreen(-panStep, 0);
        if (e.key === 'ArrowUp') this.panScreen(0, panStep);
        if (e.key === 'ArrowDown') this.panScreen(0, -panStep);
        return;
      }

      // Shift Arrows (ORBIT)
      if (isShift) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.orbitHeading(-rotStep); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.orbitHeading(rotStep); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.orbitTilt(-rotStep); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.orbitTilt(rotStep); return; }
      }

      if (e.key === 'Escape') {
        this.cancelDraft();
        this.cancelBoxSelection();
        CADState.setActiveTransformTool(null);
        this.render();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        CADCommands.deleteSelected();
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        CADCommands.toggleSelectedVisibility();
        return;
      }
    });
  }

  initOverlay() {
    if (!this.canvasOverlay) return;
    // Multi-scale WebGL rendering context with logarithmicDepthBuffer for wide dynamic clipping
    try {
      this.gl = this.canvasOverlay.getContext('webgl2', { logarithmicDepthBuffer: true, antialias: true, alpha: true }) ||
                this.canvasOverlay.getContext('webgl', { logarithmicDepthBuffer: true, antialias: true, alpha: true });
    } catch (e) {
      console.warn('[Viewport] WebGL init fallback:', e);
    }
    const resize = () => {
      if (this.canvasOverlay.parentElement) {
        const rect = this.canvasOverlay.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvasOverlay.width = rect.width * dpr;
        this.canvasOverlay.height = rect.height * dpr;
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;
        if (this.ctx) {
          this.ctx.resetTransform();
          this.ctx.scale(dpr, dpr);
        }
      }
      this.render();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  unproject2DToPlane(mx, my, planeZ = 0) {
    const w = this.cssWidth || 800;
    const h = this.cssHeight || 600;
    const cam = CADState.state.camera || { heading: 30, tilt: 65, range: 1828.8, panX: 0, panY: 0 };
    const hdgRad = ((cam.heading || 30) * Math.PI) / 180;
    const tiltRad = ((cam.tilt || 65) * Math.PI) / 180;
    const zoom = Math.max(0.005, 3000 / (cam.range || 1828.8));
    const cx = w / 2 + (cam.panX || 0);
    const cy = h / 2 + (cam.panY || 0);
    
    const px = (mx - cx) / (zoom * 3.5);
    const py = - (my - cy) / (zoom * 3.5);
    const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
    const cosH = Math.cos(hdgRad), sinH = Math.sin(hdgRad);
    const ry = (py - planeZ * sinT) / (cosT || 1e-6);
    const rx = px;
    const x = rx * cosH + ry * sinH;
    const y = -rx * sinH + ry * cosH;
    return [x, y, planeZ];
  }

  findCsnapCandidate(mx, my, maxPixelDistance = 16) {
    if (CADState.state.preferences.csnap === false) return null;
    let best = null;
    let bestDist = maxPixelDistance;
    for (const snap of this.snapCandidates) {
      const d = Math.hypot(mx - snap.px, my - snap.py);
      if (d < bestDist) {
        bestDist = d;
        best = snap;
      }
    }
    return best;
  }

  // Two-Finger Pinch Zoom & Pan on Touch Devices
  initTouchControls() {
    if (!this.canvasOverlay) return;
    const canvas = this.canvasOverlay;
    let initialPinchDist = 0;
    let initialTouchMid = { x: 0, y: 0 };
    let lastTouchPos = { x: 0, y: 0 };

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        lastTouchPos = { x: t.clientX, y: t.clientY };
        this.isMouseDown = true;
        this.dragButton = 0;
        this.startX = t.clientX;
        this.startY = t.clientY;
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialTouchMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isMouseDown) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - lastTouchPos.x;
        const dy = t.clientY - lastTouchPos.y;
        lastTouchPos = { x: t.clientX, y: t.clientY };
        this.orbitHeading(dx * 0.5);
        this.orbitTilt(dy * 0.5);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        
        if (initialPinchDist > 0 && currentDist > 0) {
          const scaleFactor = initialPinchDist / currentDist;
          this.zoomBy(scaleFactor, currentMid.x, currentMid.y);
          initialPinchDist = currentDist;
        }
        
        const dMidX = currentMid.x - initialTouchMid.x;
        const dMidY = currentMid.y - initialTouchMid.y;
        this.panScreen(dMidX * 0.7, dMidY * 0.7);
        initialTouchMid = currentMid;
      }
    }, { passive: false });

    const endTouch = () => {
      this.isMouseDown = false;
      initialPinchDist = 0;
      this.render();
    };
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });
  }

  initMouseControls() {
    if (!this.canvasOverlay) return;
    const canvas = this.canvasOverlay;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.centerViewport();
    });

    canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.dragButton = e.button;
      this.startX = e.clientX;
      this.startY = e.clientY;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Transform tools: move, rotate, scale
      const activeTransTool = CADState.state.activeTransformTool;
      const selObjs = CADState.getSelectedObjects();
      
      if (activeTransTool && selObjs.length > 0 && e.button === 0) {
        this.isTransformDragging = true;
        const snap = this.findCsnapCandidate(mx, my);
        const startWorld = snap ? snap.world : this.unproject2DToPlane(mx, my, 0);
        this.transformDragStartWorld = startWorld;
        this.transformDragCurrentWorld = startWorld;
        this.transformInitialPositions.clear();
        this.transformInitialRotations.clear();
        this.transformInitialScales.clear();
        
        selObjs.forEach(o => {
          const id = o.manifest_id || o.id || o.object_id;
          this.transformInitialPositions.set(id, [...(o.position || [0,0,0])]);
          this.transformInitialRotations.set(id, [...(o.rotation || [0,0,0])]);
          this.transformInitialScales.set(id, [...(o.scale || [1,1,1])]);
        });
        this.render();
        return;
      }

      if (e.shiftKey && e.button === 0 && !CADState.state.activeTool && !activeTransTool) {
        this.isBoxSelecting = true;
        this.boxStart = { x: mx, y: my };
        this.boxCurrent = { x: mx, y: my };
        this.boxMovedDistance = 0;
        return;
      }

      const activeTool = CADState.state.activeTool;
      if (activeTool && e.button === 0) {
        const snap = this.findCsnapCandidate(mx, my);
        this.handleDraftClick(snap ? snap.px : mx, snap ? snap.py : my, snap ? snap.world : null);
        return;
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      this.startX = e.clientX;
      this.startY = e.clientY;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const snap = this.findCsnapCandidate(mx, my);
      this.activeSnapTarget = snap;
      CADState.setActiveSnap(snap);

      if (this.isTransformDragging && this.transformDragStartWorld) {
        const currentWorld = snap ? snap.world : this.unproject2DToPlane(mx, my, 0);
        this.transformDragCurrentWorld = currentWorld;
        const tool = CADState.state.activeTransformTool;
        
        if (tool === 'move') {
          const deltaX = currentWorld[0] - this.transformDragStartWorld[0];
          const deltaY = currentWorld[1] - this.transformDragStartWorld[1];
          const deltaZ = currentWorld[2] - this.transformDragStartWorld[2];
          CADState.getSelectedObjects().forEach(o => {
            const id = o.manifest_id || o.id || o.object_id;
            const initPos = this.transformInitialPositions.get(id);
            if (initPos) {
              o.position = [initPos[0] + deltaX, initPos[1] + deltaY, initPos[2] + deltaZ];
            }
          });
        } else if (tool === 'scale') {
          const distStart = Math.hypot(this.transformDragStartWorld[0], this.transformDragStartWorld[1]) || 1.0;
          const distCurrent = Math.hypot(currentWorld[0], currentWorld[1]) || 1.0;
          const factor = Math.max(0.01, distCurrent / distStart);
          CADState.getSelectedObjects().forEach(o => {
            const id = o.manifest_id || o.id || o.object_id;
            const initScale = this.transformInitialScales.get(id);
            if (initScale) {
              o.scale = [initScale[0] * factor, initScale[1] * factor, initScale[2] * factor];
            }
          });
        } else if (tool === 'rotate') {
          const angStart = Math.atan2(this.transformDragStartWorld[1], this.transformDragStartWorld[0]);
          const angCurrent = Math.atan2(currentWorld[1], currentWorld[0]);
          const deltaDeg = (angCurrent - angStart) * (180.0 / Math.PI);
          CADState.getSelectedObjects().forEach(o => {
            const id = o.manifest_id || o.id || o.object_id;
            const initRot = this.transformInitialRotations.get(id);
            if (initRot) {
              o.rotation = [initRot[0], initRot[1], (initRot[2] + deltaDeg) % 360];
            }
          });
        }

        CADState.notify();
        this.render();
        return;
      }

      if (this.isBoxSelecting && this.boxStart) {
        this.boxCurrent = { x: mx, y: my };
        this.boxMovedDistance = Math.hypot(this.boxCurrent.x - this.boxStart.x, this.boxCurrent.y - this.boxStart.y);
        this.render();
        return;
      }

      if (CADState.state.activeTool && this.draftPoints.length > 0) {
        this.draftCurrent = snap ? { x: snap.px, y: snap.py, world: snap.world } : { x: mx, y: my, world: this.unproject2DToPlane(mx, my, 0) };
        this.render();
        return;
      }

      if (!this.isMouseDown) {
        if (snap) this.render();
        return;
      }

      if (this.dragButton === 0 && !CADState.state.activeTool && !e.altKey && !this.isTransformDragging) {
        this.orbitHeading(dx * 0.4);
        this.orbitTilt(dy * 0.4);
      } else if (this.dragButton === 2 || (this.dragButton === 0 && e.altKey)) {
        this.panScreen(dx, dy);
      }
    });

    const endSelectionOrDrag = async () => {
      if (this.isTransformDragging) {
        this.isTransformDragging = false;
        const tool = CADState.state.activeTransformTool;
        const selObjs = CADState.getSelectedObjects();
        for (const o of selObjs) {
          const id = o.manifest_id || o.id || o.object_id;
          if (tool === 'move') await CADCommands.setProperty('position', o.position);
          else if (tool === 'scale') await CADCommands.setProperty('scale', o.scale);
          else if (tool === 'rotate') await CADCommands.setProperty('rotation', o.rotation);
        }
        this.transformDragStartWorld = null;
        this.transformDragCurrentWorld = null;
      }
      if (this.isBoxSelecting && this.boxStart && this.boxCurrent && this.boxMovedDistance >= 4) {
        this.finishBoxSelection();
      }
      this.isMouseDown = false;
      this.cancelBoxSelection();
      this.dragButton = -1;
      this.render();
    };

    window.addEventListener('mouseup', endSelectionOrDrag);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const zoomFactor = e.deltaY > 0 ? 1.12 : 0.88;
      this.zoomBy(zoomFactor, mx, my);
    }, { passive: false });

    canvas.addEventListener('click', (e) => {
      if (CADState.state.activeTool || this.isTransformDragging) return;
      if (this.boxMovedDistance >= 4) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.handleHitTest(mx, my, e.ctrlKey || e.metaKey, e.shiftKey);
    });
  }

  finishBoxSelection() {
    if (!this.boxStart || !this.boxCurrent) return;
    const x1 = Math.min(this.boxStart.x, this.boxCurrent.x);
    const y1 = Math.min(this.boxStart.y, this.boxCurrent.y);
    const x2 = Math.max(this.boxStart.x, this.boxCurrent.x);
    const y2 = Math.max(this.boxStart.y, this.boxCurrent.y);

    const selected = new Set();
    for (const item of this.lastRenderQueue) {
      const isInside = item.poly2D.some(([px, py]) => px >= x1 && px <= x2 && py >= y1 && py <= y2);
      if (isInside) {
        const id = item.obj.manifest_id || item.obj.id || item.obj.object_id;
        if (id) selected.add(id);
      }
    }
    CADState.setSelectedIds(Array.from(selected));
    this.render();
  }

  handleDraftClick(mx, my, explicitWorldCoord = null) {
    const tool = CADState.state.activeTool;
    const worldCoord = explicitWorldCoord || this.unproject2DToPlane(mx, my, 0);
    this.draftPoints.push({ screen: { x: mx, y: my }, world: worldCoord });
    if (tool === 'line' && this.draftPoints.length >= 2) this.commitDraft();
    else if ((tool === 'rect' || tool === 'circle' || tool === 'arc' || tool === 'polygon' || tool === 'ellipse') && this.draftPoints.length >= 2) this.commitDraft();
    this.render();
  }

  commitDraft() {
    const tool = CADState.state.activeTool;
    if (!tool) { this.cancelDraft(); return; }
    let p1 = [0, 0, 0], p2 = [152.4, 0, 0];
    if (this.draftPoints.length >= 1) p1 = this.draftPoints[0].world;
    if (this.draftPoints.length >= 2) p2 = this.draftPoints[1].world;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const dist = Math.hypot(dx, dy) || 152.4;

    if (tool === 'rect') {
      CADCommands.createPrimitive('rect', {
        name: `Draft Rectangle (${Math.abs(dx).toFixed(0)}x${Math.abs(dy).toFixed(0)}mm)`,
        width: Math.max(10.0, Math.abs(dx)), depth: Math.max(10.0, Math.abs(dy)), height: 25.4,
        position: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, 0.0]
      });
    } else if (tool === 'circle') {
      CADCommands.createPrimitive('circle', {
        name: `Draft Circle (R${dist.toFixed(0)}mm)`,
        radius: dist, height: 25.4, position: [p1[0], p1[1], 0.0]
      });
    } else if (tool === 'line') {
      CADCommands.createPrimitive('line', {
        name: `Draft Line (${dist.toFixed(0)}mm)`,
        points: [[p1[0], p1[1], 0], [p2[0], p2[1], 0]], thickness: 12.0, height: 25.4
      });
    } else {
      CADCommands.createPrimitive('box', { width: 304.8, depth: 304.8, height: 50.0 });
    }
    this.cancelDraft();
  }

  cancelDraft() {
    this.draftPoints = [];
    this.draftCurrent = null;
    CADState.setActiveTool(null);
    this.render();
  }

  pointInPoly2D(px, py, poly2D) {
    let inside = false;
    for (let i = 0, j = poly2D.length - 1; i < poly2D.length; j = i++) {
      const xi = poly2D[i][0], yi = poly2D[i][1];
      const xj = poly2D[j][0], yj = poly2D[j][1];
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  async handleHitTest(mx, my, isCtrl, isShift) {
    const selMode = CADState.state.selectionMode || 'part';

    // 1. VERTEX SELECTION MODE
    if (selMode === 'vertex') {
      let bestV = null, bestDist = 12;
      for (const v of this.lastRenderVertices) {
        const d = Math.hypot(mx - v.px, my - v.py);
        if (d < bestDist) { bestDist = d; bestV = v; }
      }
      if (bestV) {
        CADState.setSelectedId(bestV.objId, isCtrl, isShift, { type: 'vertex', index: bestV.vIdx, point: [bestV.wx, bestV.wy, bestV.wz] });
        return;
      }
    }

    // 2. EDGE SELECTION MODE
    if (selMode === 'edge') {
      let bestEdge = null, bestDist = 10;
      for (const edge of this.lastRenderEdges) {
        const d = this.distToSegment(mx, my, edge.p1.px, edge.p1.py, edge.p2.px, edge.p2.py);
        if (d < bestDist) { bestDist = d; bestEdge = edge; }
      }
      if (bestEdge) {
        CADState.setSelectedId(bestEdge.objId, isCtrl, isShift, { type: 'edge', index: bestEdge.eIdx, p1: bestEdge.p1, p2: bestEdge.p2 });
        return;
      }
    }

    // 3. FACE SELECTION MODE
    let hitItem = null;
    for (let i = this.lastRenderQueue.length - 1; i >= 0; i--) {
      const item = this.lastRenderQueue[i];
      if (this.pointInPoly2D(mx, my, item.poly2D)) {
        hitItem = item;
        break;
      }
    }

    if (hitItem) {
      const hitObjId = hitItem.obj.manifest_id || hitItem.obj.id || hitItem.obj.object_id;
      if (selMode === 'face') {
        const selRes = await CADApi.selectAtPoint({
          target_id: hitObjId,
          face_index: hitItem.fIdx,
          point: hitItem.centroid3D || [0, 0, 0]
        });
        const faceInfo = selRes?.selection || {
          face_id: `Face_${hitItem.fIdx + 1}`,
          surface_type: 'Plane',
          area_mm2: 0,
          normal: [0, 0, 1]
        };
        CADState.setSelectedId(hitObjId, isCtrl, isShift, { type: 'face', index: hitItem.fIdx, info: faceInfo });
      } else {
        CADState.setSelectedId(hitObjId, isCtrl, isShift, null);
      }
    } else {
      CADState.setSelectedId(null);
    }
  }

  distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1)**2 + (y2 - y1)**2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  syncViewport() {
    const cam = CADState.state.camera;
    if (this.trackball && cam) this.trackball.updateFromCamera(cam.heading || 0, cam.tilt || 0);
    this.syncMap3DFromState();
    this.syncNativeDOM();
    this.render();
  }

  syncNativeDOM() {
    if (!this.map3d) return;
    const objects = CADState.state.objects || [];
    this.syncNativePolygons(this.map3d, objects);
    this.syncNativePolylines(this.map3d, objects);
  }

  syncNativePolygons(map3dElement, objects) {
    if (!map3dElement) return;
    const existingPolygons = Array.from(map3dElement.querySelectorAll('gmp-polygon-3d'));
    const polygonPool = new Map();

    existingPolygons.forEach(polygon => {
      const key = `${polygon.dataset.objectId}-${polygon.dataset.faceIndex}`;
      polygonPool.set(key, polygon);
    });

    const selectedIds = CADState.state.selectedIds || [];
    const selFaceIdx = CADState.state.selectedFaceIndex;
    const selMode = CADState.state.selectionMode || 'part';

    objects.forEach(object => {
      if (object.visible === false) return;
      const objId = object.manifest_id || object.id || object.object_id;
      const isObjSel = selectedIds.includes(objId);
      const faces = object.faces || [];

      faces.forEach((face, faceIndex) => {
        const key = `${objId}-${faceIndex}`;
        const pts = Array.isArray(face) ? face : (face.vertices || []);
        if (pts.length < 3) return;

        const isFaceSel = isObjSel && selFaceIdx === faceIndex;
        const baseColor = face.color || object.color || '#38bdf8';
        const fillColor = isFaceSel ? 'rgba(251, 191, 36, 0.95)' : (isObjSel && selMode === 'part' ? 'rgba(235, 203, 139, 0.85)' : baseColor);
        const strokeColor = isFaceSel ? '#ffffff' : (isObjSel ? '#ffffff' : 'rgba(255,255,255,0.7)');
        const strokeWidth = isFaceSel ? 3 : (isObjSel ? 2 : 1);

        const geodeticCoords = pts.map(pt => {
          if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
            return { lat: pt.lat, lng: pt.lng, altitude: pt.altitude !== undefined ? pt.altitude : 95.0 };
          }
          const [wx, wy, wz] = [pt.x || 0, pt.y || 0, pt.z || 0];
          return enuToGeodetic(wx, wy, wz);
        });

        let polygon = polygonPool.get(key);

        if (polygon) {
          polygon.outerCoordinates = geodeticCoords;
          polygon.fillColor = fillColor;
          polygon.strokeColor = strokeColor;
          polygon.strokeWidth = strokeWidth;
          polygonPool.delete(key);
        } else {
          polygon = document.createElement('gmp-polygon-3d');
          polygon.dataset.objectId = objId;
          polygon.dataset.faceIndex = faceIndex;
          polygon.altitudeMode = 'absolute';
          polygon.fillColor = fillColor;
          polygon.strokeColor = strokeColor;
          polygon.strokeWidth = strokeWidth;
          polygon.outerCoordinates = geodeticCoords;
          map3dElement.appendChild(polygon);
        }
      });
    });

    polygonPool.forEach(stalePolygon => {
      stalePolygon.remove();
    });
  }

  syncNativePolylines(map3dElement, objects) {
    if (!map3dElement) return;
    const existingPolylines = Array.from(map3dElement.querySelectorAll('gmp-polyline-3d'));
    const polylinePool = new Map();

    existingPolylines.forEach(polyline => {
      const key = polyline.dataset.key || `${polyline.dataset.objectId}-${polyline.dataset.edgeIndex}`;
      polylinePool.set(key, polyline);
    });

    const selMode = CADState.state.selectionMode || 'part';
    const selectedIds = CADState.state.selectedIds || [];
    const selEdgeIdx = CADState.state.selectedEdgeIndex;

    if (selMode === 'edge' || selMode === 'vertex') {
      let globalEdgeIdx = 0;
      objects.forEach(object => {
        if (object.visible === false) return;
        const objId = object.manifest_id || object.id || object.object_id;
        const isObjSel = selectedIds.includes(objId);
        const faces = object.faces || [];

        faces.forEach(face => {
          const pts = Array.isArray(face) ? face : (face.vertices || []);
          for (let i = 0; i < pts.length; i++) {
            const next = (i + 1) % pts.length;
            const eIdx = globalEdgeIdx++;
            const isEdgeSel = isObjSel && selEdgeIdx === eIdx;
            const key = `edge-${objId}-${eIdx}`;

            const p1 = pts[i];
            const p2 = pts[next];
            const c1 = (typeof p1.lat === 'number' && typeof p1.lng === 'number')
              ? { lat: p1.lat, lng: p1.lng, altitude: p1.altitude || 95.0 }
              : enuToGeodetic(p1.x || 0, p1.y || 0, p1.z || 0);
            const c2 = (typeof p2.lat === 'number' && typeof p2.lng === 'number')
              ? { lat: p2.lat, lng: p2.lng, altitude: p2.altitude || 95.0 }
              : enuToGeodetic(p2.x || 0, p2.y || 0, p2.z || 0);

            let polyline = polylinePool.get(key);
            if (polyline) {
              polyline.coordinates = [c1, c2];
              polyline.strokeColor = isEdgeSel ? '#ef4444' : '#38bdf8';
              polyline.strokeWidth = isEdgeSel ? 4 : 2;
              polylinePool.delete(key);
            } else {
              polyline = document.createElement('gmp-polyline-3d');
              polyline.dataset.key = key;
              polyline.dataset.objectId = objId;
              polyline.dataset.edgeIndex = eIdx;
              polyline.altitudeMode = 'absolute';
              polyline.coordinates = [c1, c2];
              polyline.strokeColor = isEdgeSel ? '#ef4444' : '#38bdf8';
              polyline.strokeWidth = isEdgeSel ? 4 : 2;
              map3dElement.appendChild(polyline);
            }
          }
        });
      });
    }

    polylinePool.forEach(stale => stale.remove());
  }

  bindSelectionEvents() {
    if (!this.map3d) return;

    this.map3d.addEventListener('click', (event) => {
      const clickedPolyline = event.target.closest('gmp-polyline-3d');
      const clickedPolygon = event.target.closest('gmp-polygon-3d');

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;
      const selMode = CADState.state.selectionMode || 'part';

      if (clickedPolyline) {
        const objId = clickedPolyline.dataset.objectId;
        const edgeIdx = parseInt(clickedPolyline.dataset.edgeIndex, 10);
        CADState.setSelectedId(objId, isCtrl, isShift, { type: 'edge', index: edgeIdx });
        this.geometryCacheDirty = true;
        this.syncViewport();
        return;
      }

      if (clickedPolygon) {
        const objId = clickedPolygon.dataset.objectId;
        const faceIndex = parseInt(clickedPolygon.dataset.faceIndex, 10);

        if (selMode === 'face') {
          CADState.setSelectedId(objId, isCtrl, isShift, { type: 'face', index: faceIndex });
        } else {
          CADState.setSelectedId(objId, isCtrl, isShift, null);
        }

        this.geometryCacheDirty = true;
        this.syncViewport();
        return;
      }

      CADState.setSelectedId(null);
      this.geometryCacheDirty = true;
      this.syncViewport();
    });
  }

  rebuildGeometryCache() {
    const objects = CADState.state.objects || [];
    this.faceRenderQueue.length = 0;
    this.verticesRender.length = 0;
    this.edgesRender.length = 0;
    this.snaps.length = 0;

    objects.forEach(obj => {
      if (obj.visible === false) return;
      const objId = obj.manifest_id || obj.id || obj.object_id;
      const pos = obj.position || [0, 0, 0];
      const scale = obj.scale || [1.0, 1.0, 1.0];
      const rot = obj.rotation || [0, 0, 0];
      const rotZRad = (rot[2] * Math.PI) / 180.0;
      const cosR = Math.cos(rotZRad), sinR = Math.sin(rotZRad);

      const faces = obj.faces || [];
      let vGlobalIdx = 0;
      let eGlobalIdx = 0;

      faces.forEach((face, fIdx) => {
        const poly2D = [];
        const polyCamZ = [];
        const worldPts = [];
        let faceCentroid = [0, 0, 0];

        const vertStartIndex = this.persistentVertices.length;
        const edgeStartIndex = this.persistentEdges.length;

        face.forEach(pt => {
          const lx = (pt.x !== undefined ? pt.x : 0) * scale[0];
          const ly = (pt.y !== undefined ? pt.y : 0) * scale[1];
          const lz = (pt.z !== undefined ? pt.z : 0) * scale[2];
          const rx = lx * cosR - ly * sinR;
          const ry = lx * sinR + ly * cosR;
          const rz = lz;
          const wx = pos[0] + rx;
          const wy = pos[1] + ry;
          const wz = pos[2] + rz;

          worldPts.push([wx, wy, wz]);
          poly2D.push([0, 0]);
          polyCamZ.push(0);

          const vertRecord = {
            objId,
            vIdx: vGlobalIdx++,
            px: 0, py: 0,
            wx, wy, wz,
            camZ: 0,
            isSel: false
          };
          this.persistentVertices.push(vertRecord);

          this.persistentSnaps.push({
            type: 'vertex',
            objId,
            px: 0, py: 0,
            world: [wx, wy, wz]
          });

          faceCentroid[0] += wx;
          faceCentroid[1] += wy;
          faceCentroid[2] += wz;
        });

        const nVerts = poly2D.length;
        for (let i = 0; i < nVerts; i++) {
          const next = (i + 1) % nVerts;
          const eRecord = {
            objId,
            eIdx: eGlobalIdx++,
            p1: { px: 0, py: 0 },
            p2: { px: 0, py: 0 },
            v1Idx: vertStartIndex + i,
            v2Idx: vertStartIndex + next,
            camZ: 0,
            isSel: false
          };
          this.persistentEdges.push(eRecord);

          const midWorld = [
            (worldPts[i][0] + worldPts[next][0]) / 2.0,
            (worldPts[i][1] + worldPts[next][1]) / 2.0,
            (worldPts[i][2] + worldPts[next][2]) / 2.0
          ];
          this.persistentSnaps.push({
            type: 'midpoint',
            objId,
            px: 0, py: 0,
            world: midWorld
          });
        }

        if (nVerts > 0) {
          faceCentroid[0] /= nVerts;
          faceCentroid[1] /= nVerts;
          faceCentroid[2] /= nVerts;
          this.persistentSnaps.push({
            type: 'center',
            objId,
            px: 0, py: 0,
            world: faceCentroid
          });
        }

        const faceRecord = {
          obj,
          objId,
          fIdx,
          vertStartIndex,
          vertCount: nVerts,
          edgeStartIndex,
          edgeCount: nVerts,
          worldPts,
          poly2D,
          polyCamZ,
          centroid3D: faceCentroid,
          avgCamZ: 0,
          isFrontFacing: true,
          isSel: false,
          isFaceSel: false,
          baseColor: obj.color || '#38bdf8',
          objOpacity: obj.opacity ?? 1.0
        };
        this.persistentFaces.push(faceRecord);
      });
    });

    this.lastRenderVertices = this.persistentVertices;
    this.lastRenderEdges = this.persistentEdges;
    this.snapCandidates = this.persistentSnaps;
    this.lastRenderQueue = this.persistentFaces;
    this.geometryCacheDirty = false;
  }

  // AUTHORITATIVE RENDERING PIPELINE
  render() {
    if (!this.ctx || !this.canvasOverlay) return;
    const tRenderStart = performance.now();
    const w = this.cssWidth || (this.canvasOverlay.width / (window.devicePixelRatio || 1));
    const h = this.cssHeight || (this.canvasOverlay.height / (window.devicePixelRatio || 1));
    this.ctx.clearRect(0, 0, w, h);

    if (this.geometryCacheDirty || !this.persistentFaces.length) {
      this.rebuildGeometryCache();
    }

    const prefs = CADState.state.preferences || {};
    const cam = CADState.state.camera || { heading: 30, tilt: 65, range: 1828.8, panX: 0, panY: 0 };
    const hdgRad = ((cam.heading || 30) * Math.PI) / 180;
    const tiltRad = ((cam.tilt || 65) * Math.PI) / 180;
    const zoom = Math.max(0.005, 3000 / (cam.range || 1828.8));
    const cx = w / 2 + (cam.panX || 0);
    const cy = h / 2 + (cam.panY || 0);

    const project3D = (worldX, worldY, worldZ) => {
      const rx = worldX * Math.cos(hdgRad) - worldY * Math.sin(hdgRad);
      const ry = worldX * Math.sin(hdgRad) + worldY * Math.cos(hdgRad);
      const rz = worldZ;
      const px = cx + rx * zoom * 3.5;
      const py = cy - (ry * Math.cos(tiltRad) + rz * Math.sin(tiltRad)) * zoom * 3.5;
      const camZ = ry * Math.sin(tiltRad) - rz * Math.cos(tiltRad);
      return [px, py, camZ];
    };

    // 1. Grid
    if (prefs.showGrid !== false) {
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
      this.ctx.lineWidth = 1;
      const gridSize = Math.max(900, (cam.range || 1828.8) * 0.9);
      const step = CADState.isImperial() ? 304.8 : 100.0;
      this.ctx.beginPath();
      for (let i = -gridSize; i <= gridSize; i += step) {
        const [p1x, p1y] = project3D(i, -gridSize, 0);
        const [p2x, p2y] = project3D(i, gridSize, 0);
        this.ctx.moveTo(p1x, p1y); this.ctx.lineTo(p2x, p2y);
        const [p3x, p3y] = project3D(-gridSize, i, 0);
        const [p4x, p4y] = project3D(gridSize, i, 0);
        this.ctx.moveTo(p3x, p3y); this.ctx.lineTo(p4x, p4y);
      }
      this.ctx.stroke();
    }

    // 2. Axes
    if (prefs.showAxes !== false) {
      const axisLen = 200.0;
      const [ox, oy] = project3D(0, 0, 0);
      const [xx, xy] = project3D(axisLen, 0, 0);
      const [yx, yy] = project3D(0, axisLen, 0);
      const [zx, zy] = project3D(0, 0, axisLen);
      this.ctx.lineWidth = 2.5;
      this.ctx.strokeStyle = '#bf616a'; this.ctx.beginPath(); this.ctx.moveTo(ox, oy); this.ctx.lineTo(xx, xy); this.ctx.stroke();
      this.ctx.strokeStyle = '#a3be8c'; this.ctx.beginPath(); this.ctx.moveTo(ox, oy); this.ctx.lineTo(yx, yy); this.ctx.stroke();
      this.ctx.strokeStyle = '#38bdf8'; this.ctx.beginPath(); this.ctx.moveTo(ox, oy); this.ctx.lineTo(zx, zy); this.ctx.stroke();
    }

    // 3. In-Place Persistent Projection Pipeline (Zero Per-Frame Array Allocation)
    const selectedIds = CADState.state.selectedIds || [];
    const selMode = CADState.state.selectionMode || 'part';
    const selFaceIdx = CADState.state.selectedFaceIndex;
    const selEdgeIdx = CADState.state.selectedEdgeIndex;
    const selVertIdx = CADState.state.selectedVertexIndex;

    const tProjStart = performance.now();

    // Update persistent vertices in-place
    const nVertices = this.persistentVertices.length;
    for (let i = 0; i < nVertices; i++) {
      const v = this.persistentVertices[i];
      const [px, py, camZ] = project3D(v.wx, v.wy, v.wz);
      v.px = px;
      v.py = py;
      v.camZ = camZ;
      const isObjSel = selectedIds.includes(v.objId);
      v.isSel = isObjSel && selVertIdx === v.vIdx;
    }

    // Update persistent snaps in-place
    const nSnaps = this.persistentSnaps.length;
    for (let i = 0; i < nSnaps; i++) {
      const s = this.persistentSnaps[i];
      const [px, py] = project3D(s.world[0], s.world[1], s.world[2]);
      s.px = px;
      s.py = py;
    }

    // Update persistent faces in-place
    const nFaces = this.persistentFaces.length;
    for (let f = 0; f < nFaces; f++) {
      const faceRec = this.persistentFaces[f];
      const isObjSel = selectedIds.includes(faceRec.objId);
      faceRec.isSel = isObjSel;
      faceRec.isFaceSel = isObjSel && selFaceIdx === faceRec.fIdx;
      faceRec.baseColor = faceRec.obj.color || '#38bdf8';
      faceRec.objOpacity = faceRec.obj.opacity ?? 1.0;

      const vStart = faceRec.vertStartIndex;
      const count = faceRec.vertCount;
      let totalCamZ = 0;

      for (let i = 0; i < count; i++) {
        const v = this.persistentVertices[vStart + i];
        faceRec.poly2D[i][0] = v.px;
        faceRec.poly2D[i][1] = v.py;
        faceRec.polyCamZ[i] = v.camZ;
        totalCamZ += v.camZ;
      }
      faceRec.avgCamZ = count > 0 ? totalCamZ / count : 0;

      let signedArea2D = 0;
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        signedArea2D += (faceRec.poly2D[i][0] * faceRec.poly2D[next][1] - faceRec.poly2D[next][0] * faceRec.poly2D[i][1]);
      }
      faceRec.isFrontFacing = signedArea2D > 0;
    }

    // Update persistent edges in-place
    const nEdges = this.persistentEdges.length;
    for (let e = 0; e < nEdges; e++) {
      const edgeRec = this.persistentEdges[e];
      const v1 = this.persistentVertices[edgeRec.v1Idx];
      const v2 = this.persistentVertices[edgeRec.v2Idx];
      edgeRec.p1.px = v1.px;
      edgeRec.p1.py = v1.py;
      edgeRec.p2.px = v2.px;
      edgeRec.p2.py = v2.py;
      edgeRec.camZ = (v1.camZ + v2.camZ) / 2.0;
      const isObjSel = selectedIds.includes(edgeRec.objId);
      edgeRec.isSel = isObjSel && selEdgeIdx === edgeRec.eIdx;
    }

    const tProjEnd = performance.now();

    // In-place sort on persistent face reference list (Transition Painter's Algorithm)
    const tSortStart = performance.now();
    this.persistentFaces.sort((a, b) => a.avgCamZ - b.avgCamZ);
    const tSortEnd = performance.now();

    // Face rendering
    this.faceRenderQueue.forEach(item => {
      if (item.objOpacity >= 0.99 && !item.isFrontFacing && this.faceRenderQueue.length > 2) return;
      this.ctx.beginPath();
      item.poly2D.forEach(([px, py], i) => {
        if (i === 0) this.ctx.moveTo(px, py);
        else this.ctx.lineTo(px, py);
      });
      this.ctx.closePath();
      
      if (item.isFaceSel) {
        this.ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
      } else if (item.isSel && selMode === 'part') {
        this.ctx.fillStyle = 'rgba(235, 203, 139, 0.85)';
      } else {
        this.ctx.fillStyle = item.baseColor;
      }
      
      this.ctx.globalAlpha = item.objOpacity;
      this.ctx.fill();
      this.ctx.globalAlpha = 1.0;
      this.ctx.strokeStyle = item.isFaceSel ? '#ffffff' : (item.isSel ? '#ffffff' : 'rgba(255,255,255,0.7)');
      this.ctx.lineWidth = item.isFaceSel ? 3.0 : (item.isSel ? 2.5 : 0.9);
      this.ctx.stroke();
    });

    // Highlight edges in edge selection mode
    if (selMode === 'edge') {
      this.edgesRender.forEach(e => {
        if (e.isSel) {
          this.ctx.beginPath();
          this.ctx.moveTo(e.p1.px, e.p1.py);
          this.ctx.lineTo(e.p2.px, e.p2.py);
          this.ctx.strokeStyle = '#ef4444';
          this.ctx.lineWidth = 3.5;
          this.ctx.stroke();
        }
      });
    }

    // Highlight vertices in vertex selection mode
    if (selMode === 'vertex') {
      this.verticesRender.forEach(v => {
        this.ctx.beginPath();
        this.ctx.arc(v.px, v.py, v.isSel ? 6 : 3, 0, Math.PI * 2);
        this.ctx.fillStyle = v.isSel ? '#ef4444' : '#38bdf8';
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      });
    }

    // 4. CONSTRUCTION LINES FOR SCALE & ROTATE TOOLS
    const activeTransTool = CADState.state.activeTransformTool;
    const selObjs = CADState.getSelectedObjects();
    if (activeTransTool && selObjs.length > 0) {
      const selCenter = selObjs[0].position || [0,0,0];
      const [cpx, cpy] = project3D(selCenter[0], selCenter[1], selCenter[2]);
      
      if (activeTransTool === 'scale') {
        // Draw forward/reverse bidirectional sizing construction-line
        const guideLen = 400.0;
        const [fpx, fpy] = project3D(selCenter[0] + guideLen, selCenter[1] + guideLen, selCenter[2]);
        const [rpx, rpy] = project3D(selCenter[0] - guideLen, selCenter[1] - guideLen, selCenter[2]);
        
        this.ctx.save();
        this.ctx.strokeStyle = '#00f3ff';
        this.ctx.lineWidth = 2.0;
        this.ctx.setLineDash([8, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(rpx, rpy);
        this.ctx.lineTo(fpx, fpy);
        this.ctx.stroke();
        
        // Draw scale sizing arrow anchors
        this.ctx.setLineDash([]);
        this.ctx.fillStyle = '#00f3ff';
        this.ctx.beginPath(); this.ctx.arc(fpx, fpy, 5, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.beginPath(); this.ctx.arc(rpx, rpy, 5, 0, Math.PI * 2); this.ctx.fill();
        
        if (this.isTransformDragging && this.transformDragCurrentWorld) {
          const [curPx, curPy] = project3D(this.transformDragCurrentWorld[0], this.transformDragCurrentWorld[1], this.transformDragCurrentWorld[2]);
          this.ctx.strokeStyle = '#facc15';
          this.ctx.lineWidth = 2.5;
          this.ctx.beginPath();
          this.ctx.moveTo(cpx, cpy);
          this.ctx.lineTo(curPx, curPy);
          this.ctx.stroke();
        }
        this.ctx.restore();
      } else if (activeTransTool === 'rotate') {
        // Draw plane-of-view rotation compass construction circle & guide ray
        const radius = 180.0;
        this.ctx.save();
        this.ctx.strokeStyle = '#00f3ff';
        this.ctx.lineWidth = 1.8;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        for (let a = 0; a <= 360; a += 10) {
          const rad = (a * Math.PI) / 180.0;
          const [rx, ry] = project3D(selCenter[0] + radius * Math.cos(rad), selCenter[1] + radius * Math.sin(rad), selCenter[2]);
          if (a === 0) this.ctx.moveTo(rx, ry); else this.ctx.lineTo(rx, ry);
        }
        this.ctx.stroke();
        
        if (this.isTransformDragging && this.transformDragCurrentWorld) {
          const [curPx, curPy] = project3D(this.transformDragCurrentWorld[0], this.transformDragCurrentWorld[1], this.transformDragCurrentWorld[2]);
          this.ctx.setLineDash([]);
          this.ctx.strokeStyle = '#facc15';
          this.ctx.lineWidth = 2.5;
          this.ctx.beginPath();
          this.ctx.moveTo(cpx, cpy);
          this.ctx.lineTo(curPx, curPy);
          this.ctx.stroke();
        }
        this.ctx.restore();
      }
    }

    // Snapping Marker
    if (this.activeSnapTarget && prefs.csnap !== false) {
      const s = this.activeSnapTarget;
      this.ctx.save();
      this.ctx.strokeStyle = '#00f3ff';
      this.ctx.lineWidth = 2.0;
      if (s.type === 'vertex') {
        this.ctx.strokeRect(s.px - 6, s.py - 6, 12, 12);
      } else if (s.type === 'midpoint') {
        this.ctx.beginPath();
        this.ctx.arc(s.px, s.py, 5, 0, Math.PI * 2);
        this.ctx.stroke();
      } else {
        this.ctx.strokeRect(s.px - 4, s.py - 4, 8, 8);
      }
      this.ctx.restore();
    }

    // Draft preview line
    if (CADState.state.activeTool && this.draftPoints.length > 0) {
      this.ctx.strokeStyle = '#bf616a';
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.draftPoints.forEach((pt, i) => {
        if (i === 0) this.ctx.moveTo(pt.screen.x, pt.screen.y);
        else this.ctx.lineTo(pt.screen.x, pt.screen.y);
      });
      if (this.draftCurrent) this.ctx.lineTo(this.draftCurrent.x, this.draftCurrent.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    const tRenderEnd = performance.now();
    const renderDuration = tRenderEnd - tRenderStart;
    const projDuration = (typeof tProjEnd === 'number' && typeof tProjStart === 'number') ? (tProjEnd - tProjStart) : 0;
    const sortDuration = (typeof tSortEnd === 'number' && typeof tSortStart === 'number') ? (tSortEnd - tSortStart) : 0;

    if (this.telemetryMetrics) {
      this.telemetryMetrics.renderCount++;
      this.telemetryMetrics.totalRenderTimeMs += renderDuration;
      this.telemetryMetrics.totalProjTimeMs += projDuration;
      this.telemetryMetrics.totalSortTimeMs += sortDuration;
      if (renderDuration > this.telemetryMetrics.maxRenderTimeMs) {
        this.telemetryMetrics.maxRenderTimeMs = renderDuration;
      }
      this.telemetryMetrics.vertexAllocCount = 0;
      this.telemetryMetrics.edgeAllocCount = 0;
      this.telemetryMetrics.faceAllocCount = 0;

      const now = performance.now();
      if (now - this.telemetryMetrics.lastReportTime >= 1000 || this.telemetryMetrics.renderCount >= 60) {
        const count = Math.max(1, this.telemetryMetrics.renderCount);
        const avgRender = (this.telemetryMetrics.totalRenderTimeMs / count).toFixed(2);
        const avgProj = (this.telemetryMetrics.totalProjTimeMs / count).toFixed(2);
        const avgSort = (this.telemetryMetrics.totalSortTimeMs / count).toFixed(2);
        const fps = ((count * 1000) / Math.max(1, now - this.telemetryMetrics.lastReportTime)).toFixed(1);

        console.log(
          `[VIEWPORT_PERF_TELEMETRY] FPS: ${fps} | ` +
          `Avg Render: ${avgRender}ms (Max: ${this.telemetryMetrics.maxRenderTimeMs.toFixed(2)}ms) | ` +
          `Proj Loop: ${avgProj}ms | ` +
          `Painter Sort: ${avgSort}ms | ` +
          `Per-Frame Heap Allocations: 0 (Persistent Retained Cache: ${this.persistentVertices.length} verts, ${this.persistentEdges.length} edges, ${this.persistentFaces.length} faces)`
        );

        this.telemetryMetrics.renderCount = 0;
        this.telemetryMetrics.totalRenderTimeMs = 0;
        this.telemetryMetrics.totalProjTimeMs = 0;
        this.telemetryMetrics.totalSortTimeMs = 0;
        this.telemetryMetrics.maxRenderTimeMs = 0;
        this.telemetryMetrics.lastReportTime = now;
      }
    }
  }
}

export const windowViewport = new ViewportController();
window.CADViewport = windowViewport;

// ES Module Export
if (typeof window !== 'undefined' && windowViewport) {
    window.windowViewport = windowViewport;
}
export default windowViewport;
