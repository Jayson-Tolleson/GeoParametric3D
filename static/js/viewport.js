"use strict";

/**
 * GeoParametric3D Viewport Controller (V5.1.0 Production Architecture)
 * Full B-Rep Solid Rendering & Dual-Route Maps 3D Integration:
 *  - Planar Faces (GeomAbs_Plane): Rendered as clean N-Gon boundaries (<gmp-polygon-3d>) with ZERO internal diagonals.
 *  - 100% Opaque Solid Shading (FreeCAD parity): solids default to full opacity with hardware depth buffer occlusion.
 *  - Multi-solid color assignment preserved directly from STEP header metadata.
 *  - Bidirectional property panel reaction.
 *  - Full 2D Canvas & WebGL hybrid overlay for selection, vertex/edge manipulation, drafting, and Csnap.
 */

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
      maxRenderTimeMs: 0
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
    this.map3d = document.getElementById('boatscreen') || document.getElementById('map-3d-element') || document.querySelector('gmp-map-3d');
    try {
      await customElements.whenDefined('gmp-map-3d');
      if (!this.map3d) {
        const container = document.getElementById('viewport-container');
        if (container) {
          this.map3d = document.createElement('gmp-map-3d');
          this.map3d.id = 'boatscreen';
          this.map3d.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1;';
          container.insertBefore(this.map3d, this.canvasOverlay);
        }
      }
      if (this.map3d) {
        this.bindMap3DEvents();
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

  fitView(options = {}) {
    const bounds = this.computeSceneBoundingBox();
    const cam = CADState.state.camera;
    const cx = bounds.center[0], cy = bounds.center[1], cz = bounds.center[2];
    
    const R = bounds.radius || (bounds.diagonal ? bounds.diagonal / 2.0 : 152.4);
    const targetDistance = Math.max(152.4, 60.0 * R);
    
    const geoCenter = enuToGeodetic(cx, cy, cz);
    cam.center = geoCenter;
    cam.heading = typeof options.heading === 'number' ? options.heading : (cam.heading || 30);
    cam.tilt = typeof options.tilt === 'number' ? options.tilt : (cam.tilt || 65);
    cam.range = targetDistance;
    cam.panX = 0;
    cam.panY = 0;
    cam.target = [cx, cy, cz];
    
    if (this.trackball) {
      this.trackball.updateFromCamera(cam.heading, cam.tilt);
    }
    this.syncMap3DFromState();
    CADState.notify();
    this.render();
  }

  centerViewport() {
    this.fitView();
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

  project3DTo2D(x, y, z) {
    const w = this.cssWidth || 800;
    const h = this.cssHeight || 600;
    const cam = CADState.state.camera || { heading: 30, tilt: 65, range: 1828.8, panX: 0, panY: 0 };
    const hdgRad = ((cam.heading || 30) * Math.PI) / 180;
    const tiltRad = ((cam.tilt || 65) * Math.PI) / 180;
    const zoom = Math.max(0.005, 3000 / (cam.range || 1828.8));
    
    const rx = x * Math.cos(hdgRad) - y * Math.sin(hdgRad);
    const ry = x * Math.sin(hdgRad) + y * Math.cos(hdgRad);
    const rz = z;
    
    const px = rx;
    const py = -(ry * Math.cos(tiltRad) + rz * Math.sin(tiltRad));
    const depth = ry * Math.sin(tiltRad) - rz * Math.cos(tiltRad);
    
    const cx = w / 2 + (cam.panX || 0);
    const cy = h / 2 + (cam.panY || 0);
    const scale = zoom * 3.5;
    
    return {
      px: cx + px * scale,
      py: cy + py * scale,
      depth: depth,
      visible: true
    };
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
  }

  syncNativePolygons(map3dElement, objects) {
    if (!map3dElement) return;
    const existingPolygons = Array.from(map3dElement.querySelectorAll('gmp-polygon-3d'));
    const polygonPool = new Map();

    existingPolygons.forEach(polygon => {
      const key = polygon.dataset.key || `${polygon.dataset.objectId}-${polygon.dataset.faceIndex}`;
      polygonPool.set(key, polygon);
    });

    const selectedIds = CADState.state.selectedIds || [];
    const selFaceIdx = CADState.state.selectedFaceIndex;
    const selMode = CADState.state.selectionMode || 'part';

    objects.forEach(object => {
      if (object.visible === false) return;
      const objId = object.manifest_id || object.id || object.object_id;
      const isObjSel = selectedIds.includes(objId);
      
      const planarPolys = object.planar_polygons || object.ngon_loops || object.planar_loops || [];
      if (planarPolys.length > 0) {
        planarPolys.forEach((poly, polyIndex) => {
          const key = `ngon-${objId}-${poly.face_id || polyIndex}`;
          const isFaceSel = isObjSel && (selFaceIdx === polyIndex || (CADState.state.selectedFaceInfo && CADState.state.selectedFaceInfo.face_id === poly.face_id));
          const baseColor = poly.color || object.color || '#38bdf8';
          const fillColor = isFaceSel ? 'rgba(251, 191, 36, 1.0)' : (isObjSel && selMode === 'part' ? 'rgba(235, 203, 139, 1.0)' : baseColor);
          const strokeColor = isFaceSel ? '#ffffff' : (isObjSel ? '#ffffff' : 'rgba(255,255,255,0.7)');
          const strokeWidth = isFaceSel ? 3 : (isObjSel ? 2 : 1);

          let polygon = polygonPool.get(key);
          if (polygon) {
            polygon.outerCoordinates = poly.outer_coordinates || poly.outer;
            if ((poly.inner_coordinates && poly.inner_coordinates.length > 0) || (poly.inner && poly.inner.length > 0)) {
              polygon.innerCoordinates = poly.inner_coordinates || poly.inner;
            }
            polygon.fillColor = fillColor;
            polygon.strokeColor = strokeColor;
            polygon.strokeWidth = strokeWidth;
            polygonPool.delete(key);
          } else {
            polygon = document.createElement('gmp-polygon-3d');
            polygon.dataset.key = key;
            polygon.dataset.objectId = objId;
            polygon.dataset.faceIndex = String(polyIndex);
            polygon.dataset.faceId = poly.face_id || `Face_${polyIndex + 1}`;
            polygon.setAttribute('altitude-mode', 'absolute');
            polygon.altitudeMode = 'absolute';
            polygon.fillColor = fillColor;
            polygon.strokeColor = strokeColor;
            polygon.strokeWidth = strokeWidth;
            polygon.outerCoordinates = poly.outer_coordinates || poly.outer;
            if ((poly.inner_coordinates && poly.inner_coordinates.length > 0) || (poly.inner && poly.inner.length > 0)) {
              polygon.innerCoordinates = poly.inner_coordinates || poly.inner;
            }
            map3dElement.appendChild(polygon);
          }
        });
        return;
      }

      const faces = object.faces || [];
      faces.forEach((face, faceIndex) => {
        const key = `face-${objId}-${faceIndex}`;
        const pts = Array.isArray(face) ? face : (face.vertices || []);
        if (pts.length < 3) return;

        const isFaceSel = isObjSel && selFaceIdx === faceIndex;
        const baseColor = face.color || object.color || '#38bdf8';
        const fillColor = isFaceSel ? 'rgba(251, 191, 36, 1.0)' : (isObjSel && selMode === 'part' ? 'rgba(235, 203, 139, 1.0)' : baseColor);
        const strokeColor = isFaceSel ? '#ffffff' : (isObjSel ? '#ffffff' : 'rgba(255,255,255,0.7)');
        const strokeWidth = isFaceSel ? 3 : (isObjSel ? 2 : 1);

        const geodeticCoords = pts.map(pt => {
          if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
            return { lat: pt.lat, lng: pt.lng, altitude: pt.altitude !== undefined ? pt.altitude : 95.0 };
          }
          const wx = (object.position?.[0] || 0) + (pt.x || 0) * (object.scale?.[0] || 1);
          const wy = (object.position?.[1] || 0) + (pt.y || 0) * (object.scale?.[1] || 1);
          const wz = (object.position?.[2] || 0) + (pt.z || 0) * (object.scale?.[2] || 1);
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
          polygon.dataset.key = key;
          polygon.dataset.objectId = objId;
          polygon.dataset.faceIndex = String(faceIndex);
          polygon.setAttribute('altitude-mode', 'absolute');
          polygon.altitudeMode = 'absolute';
          polygon.fillColor = fillColor;
          polygon.strokeColor = strokeColor;
          polygon.strokeWidth = strokeWidth;
          polygon.outerCoordinates = geodeticCoords;
          map3dElement.appendChild(polygon);
        }
      });
    });

    polygonPool.forEach(polygon => polygon.remove());
  }

  render() {
    if (!this.ctx || !this.canvasOverlay) return;
    const tStart = performance.now();
    const ctx = this.ctx;
    const w = this.cssWidth || 800;
    const h = this.cssHeight || 600;
    ctx.clearRect(0, 0, w, h);

    const prefs = CADState.state.preferences;
    const isImp = CADState.isImperial();
    const gridStep = isImp ? 304.8 : 300.0;
    
    // 1. Draw Grid & Axes
    if (prefs.showGrid !== false) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      const gridExtent = gridStep * 10;
      for (let x = -gridExtent; x <= gridExtent; x += gridStep) {
        const p1 = this.project3DTo2D(x, -gridExtent, 0);
        const p2 = this.project3DTo2D(x, gridExtent, 0);
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();
      }
      for (let y = -gridExtent; y <= gridExtent; y += gridStep) {
        const p1 = this.project3DTo2D(-gridExtent, y, 0);
        const p2 = this.project3DTo2D(gridExtent, y, 0);
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();
      }
    }

    if (prefs.showAxes !== false) {
      const pOrigin = this.project3DTo2D(0, 0, 0);
      const pX = this.project3DTo2D(gridStep, 0, 0);
      const pY = this.project3DTo2D(0, gridStep, 0);
      const pZ = this.project3DTo2D(0, 0, gridStep);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ef4444';
      ctx.beginPath(); ctx.moveTo(pOrigin.px, pOrigin.py); ctx.lineTo(pX.px, pX.py); ctx.stroke();
      ctx.strokeStyle = '#10b981';
      ctx.beginPath(); ctx.moveTo(pOrigin.px, pOrigin.py); ctx.lineTo(pY.px, pY.py); ctx.stroke();
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath(); ctx.moveTo(pOrigin.px, pOrigin.py); ctx.lineTo(pZ.px, pZ.py); ctx.stroke();
    }

    // 2. Build Render Queues
    const queue = [];
    const vertices = [];
    const edges = [];
    const snaps = [];

    const selectedIds = CADState.state.selectedIds || [];
    const objects = CADState.state.objects || [];
    const selMode = CADState.state.selectionMode || 'part';

    objects.forEach(obj => {
      if (obj.visible === false) return;
      const objId = obj.manifest_id || obj.id || obj.object_id;
      const isObjSel = selectedIds.includes(objId);
      const pos = obj.position || [0, 0, 0];
      const scale = obj.scale || [1, 1, 1];
      const faces = obj.faces || [];

      faces.forEach((face, fIdx) => {
        const pts = Array.isArray(face) ? face : (face.vertices || []);
        if (pts.length < 3) return;

        const poly2D = [];
        let sumDepth = 0;
        let sumX = 0, sumY = 0, sumZ = 0;

        const worldPts = pts.map((pt, vIdx) => {
          const wx = pos[0] + (pt.x !== undefined ? pt.x : 0) * scale[0];
          const wy = pos[1] + (pt.y !== undefined ? pt.y : 0) * scale[1];
          const wz = pos[2] + (pt.z !== undefined ? pt.z : 0) * scale[2];
          const p2d = this.project3DTo2D(wx, wy, wz);
          poly2D.push([p2d.px, p2d.py]);
          sumDepth += p2d.depth;
          sumX += wx; sumY += wy; sumZ += wz;

          vertices.push({ objId, fIdx, vIdx, wx, wy, wz, px: p2d.px, py: p2d.py, depth: p2d.depth });
          snaps.push({ type: 'vertex', world: [wx, wy, wz], px: p2d.px, py: p2d.py });
          return { wx, wy, wz, px: p2d.px, py: p2d.py, depth: p2d.depth };
        });

        for (let i = 0; i < worldPts.length; i++) {
          const p1 = worldPts[i];
          const p2 = worldPts[(i + 1) % worldPts.length];
          edges.push({ objId, fIdx, eIdx: i, p1, p2, depth: (p1.depth + p2.depth) / 2 });
          const midW = [(p1.wx + p2.wx)/2, (p1.wy + p2.wy)/2, (p1.wz + p2.wz)/2];
          const mid2D = this.project3DTo2D(midW[0], midW[1], midW[2]);
          snaps.push({ type: 'midpoint', world: midW, px: mid2D.px, py: mid2D.py });
        }

        const avgDepth = sumDepth / pts.length;
        const centroid3D = [sumX / pts.length, sumY / pts.length, sumZ / pts.length];
        queue.push({
          obj,
          fIdx,
          poly2D,
          depth: avgDepth,
          centroid3D,
          isObjSel
        });
      });
    });

    queue.sort((a, b) => b.depth - a.depth);
    this.lastRenderQueue = queue;
    this.lastRenderVertices = vertices;
    this.lastRenderEdges = edges;
    this.snapCandidates = snaps;

    // 3. Render Sub-element and Selection Highlighting
    if (selMode === 'edge') {
      ctx.lineWidth = 3;
      edges.forEach(e => {
        const isSel = selectedIds.includes(e.objId) && CADState.state.selectedEdgeIndex === e.eIdx;
        ctx.strokeStyle = isSel ? '#fbbf24' : 'rgba(56, 189, 248, 0.4)';
        ctx.beginPath();
        ctx.moveTo(e.p1.px, e.p1.py);
        ctx.lineTo(e.p2.px, e.p2.py);
        ctx.stroke();
      });
    } else if (selMode === 'vertex') {
      vertices.forEach(v => {
        const isSel = selectedIds.includes(v.objId) && CADState.state.selectedVertexIndex === v.vIdx;
        ctx.fillStyle = isSel ? '#fbbf24' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(v.px, v.py, isSel ? 6 : 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    // 4. Render Active Csnap Target
    if (this.activeSnapTarget) {
      const snap = this.activeSnapTarget;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (snap.type === 'vertex') {
        ctx.arc(snap.px, snap.py, 8, 0, 2 * Math.PI);
      } else {
        ctx.rect(snap.px - 6, snap.py - 6, 12, 12);
      }
      ctx.stroke();
    }

    // 5. Render Active Draft Feedback
    if (CADState.state.activeTool && this.draftPoints.length > 0 && this.draftCurrent) {
      const p1 = this.draftPoints[0];
      const p2 = this.draftCurrent;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.screen.x, p1.screen.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 6. Render Box Selection Marquee
    if (this.isBoxSelecting && this.boxStart && this.boxCurrent) {
      const x = Math.min(this.boxStart.x, this.boxCurrent.x);
      const y = Math.min(this.boxStart.y, this.boxCurrent.y);
      const bw = Math.abs(this.boxCurrent.x - this.boxStart.x);
      const bh = Math.abs(this.boxCurrent.y - this.boxStart.y);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
    }
  }
}

export const windowViewport = new ViewportController();
window.CADViewport = windowViewport;
