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

    this.lastRenderQueue = [];
    this.lastRenderVertices = [];
    this.lastRenderEdges = [];
    this.snapCandidates = [];
    this.activeSnapTarget = null;

    this.initMap3D();
    this.initTrackball();
    this.initOverlay();
    this.initMouseControls();
    this.initTouchControls();
    this.initKeyboardControls();

    CADState.subscribe(() => {
      this.syncViewport();
    });
  }

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
    const newRange = Math.max(0.1, oldRange * factor);
    
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
        this.syncMap3DFromState();
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

  centerViewport() {
    const bounds = this.computeSceneBoundingBox();
    const cam = CADState.state.camera;
    const marginMm = 25.0 * 25.4; // 25 inches = 635.0 mm margin
    const targetDim = bounds.maxDimension + marginMm;
    
    cam.heading = 30;
    cam.tilt = 65;
    cam.range = Math.max(635.0, targetDim * 2.1);
    cam.panX = 0;
    cam.panY = 0;
    
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  computeSceneBoundingBox() {
    const selObjs = CADState.getSelectedObjects();
    const objects = selObjs.length > 0 ? selObjs : (CADState.state.objects || []);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    if (objects.length === 0) return { min: [-152.4, -152.4, 0], max: [152.4, 152.4, 304.8], maxDimension: 304.8, center: [0, 0, 152.4] };
    
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
    
    if (minX === Infinity) return { min: [-152.4, -152.4, 0], max: [152.4, 152.4, 304.8], maxDimension: 304.8, center: [0, 0, 152.4] };
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    return {
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      center: [(minX + maxX)/2, (minY + maxY)/2, (minZ + maxZ)/2],
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

      if (!isShift && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') this.panScreen(panStep, 0);
        if (e.key === 'ArrowRight') this.panScreen(-panStep, 0);
        if (e.key === 'ArrowUp') this.panScreen(0, panStep);
        if (e.key === 'ArrowDown') this.panScreen(0, -panStep);
        return;
      }

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
    const ndcX = (mx / w) * 2 - 1;
    const ndcY = -(my / h) * 2 + 1;
    return {
      x: (cam.panX || 0) + ndcX * (cam.range || 1000) * 0.5 * Math.cos(hdgRad),
      y: (cam.panY || 0) + ndcY * (cam.range || 1000) * 0.5 * Math.sin(hdgRad),
      z: planeZ
    };
  }
}
