"use strict";

export const WGS84_SEMI_MAJOR_AXIS = 6378137.0;
export const WGS84_FLATTENING = 1.0 / 298.257223563;
export const WGS84_ECCENTRICITY_SQ = 0.00669437999014;

export function enuToGeodetic(x_mm = 0, y_mm = 0, z_mm = 0, anchorLat = 0.0, anchorLng = 0.0, anchorAlt = 0.0) {
  const x_m = (x_mm || 0) / 1000.0;
  const y_m = (y_mm || 0) / 1000.0;
  const z_m = (z_mm || 0) / 1000.0;

  const latRad = (anchorLat * Math.PI) / 180.0;
  const sinLat = Math.sin(latRad);
  const sinLatSq = sinLat * sinLat;

  const N = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1.0 - WGS84_ECCENTRICITY_SQ * sinLatSq);
  const M = (WGS84_SEMI_MAJOR_AXIS * (1.0 - WGS84_ECCENTRICITY_SQ)) / Math.pow(1.0 - WGS84_ECCENTRICITY_SQ * sinLatSq, 1.5);

  const dLatRad = y_m / (M + anchorAlt);
  const dLngRad = x_m / ((N + anchorAlt) * Math.cos(latRad));

  const lat = anchorLat + (dLatRad * 180.0) / Math.PI;
  const lng = anchorLng + (dLngRad * 180.0) / Math.PI;
  const altitude = anchorAlt + z_m;

  return { lat, lng, altitude };
}

export function geodeticToEnu(lat, lng, altitude, anchorLat = 0.0, anchorLng = 0.0, anchorAlt = 0.0) {
  const latRad = (anchorLat * Math.PI) / 180.0;
  const sinLat = Math.sin(latRad);
  const sinLatSq = sinLat * sinLat;

  const N = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1.0 - WGS84_ECCENTRICITY_SQ * sinLatSq);
  const M = (WGS84_SEMI_MAJOR_AXIS * (1.0 - WGS84_ECCENTRICITY_SQ)) / Math.pow(1.0 - WGS84_ECCENTRICITY_SQ * sinLatSq, 1.5);

  const dLatRad = ((lat - anchorLat) * Math.PI) / 180.0;
  const dLngRad = ((lng - anchorLng) * Math.PI) / 180.0;

  const y_m = dLatRad * (M + anchorAlt);
  const x_m = dLngRad * (N + anchorAlt) * Math.cos(latRad);
  const z_m = (altitude || anchorAlt) - anchorAlt;

  return [x_m * 1000.0, y_m * 1000.0, z_m * 1000.0];
}

class StateStore {
  constructor() {
    const savedUuid = localStorage.getItem('cascadecad-active-uuid') || null;
    const savedTheme = localStorage.getItem('cascadecad-theme') || 'night';
    const savedUnits = localStorage.getItem('cascadecad-units') || 'in';
    const savedGrid = localStorage.getItem('cascadecad-show-grid') !== 'false';
    const savedAxes = localStorage.getItem('cascadecad-show-axes') !== 'false';
    const savedCsnap = localStorage.getItem('cascadecad-csnap') !== 'false';

    this.arrayBufferCache = new Map();

    this.state = {
      projectId: savedUuid,
      projectName: 'CascadeCAD Document',
      canonical_unit: 'mm',
      objects: [],
      assemblyTree: [],
      selectedIds: [],
      lastSelectedId: null,
      selectionMode: 'part',
      selectedFaceIndex: null,
      selectedEdgeIndex: null,
      selectedVertexIndex: null,
      selectedFaceInfo: null,
      activeTool: null,
      activeTransformTool: null,
      activeAction: null,
      activeSnap: null,
      preferences: {
        units: savedUnits,
        theme: savedTheme,
        showGrid: savedGrid,
        showAxes: savedAxes,
        csnap: savedCsnap
      },
      camera: {
        heading: 30,
        tilt: 65,
        range: 1828.8,
        panX: 0,
        panY: 0,
        center: { lat: 0.0, lng: 0.0, altitude: 0.0 }
      },
      telemetry: {
        objects: 0,
        vertices: 0,
        fps: 60,
        projectionError: 0.0,
        geospatialSyncStatus: 'SYNCHRONIZED'
      }
    };
    this.listeners = [];
  }

  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.push(listener);
    }
  }

  notify() {
    this.listeners.forEach(fn => fn(this.state));
  }

  isImperial() {
    const { units } = this.state.preferences;
    return units === 'in' || units === 'imperial';
  }

  toUserLength(mmVal) {
    if (typeof mmVal !== 'number' || Number.isNaN(mmVal)) return 0;
    return this.isImperial() ? mmVal / 25.4 : mmVal;
  }

  fromUserLength(userVal) {
    if (typeof userVal !== 'number' || Number.isNaN(userVal)) return 0;
    return this.isImperial() ? userVal * 25.4 : userVal;
  }

  setDocument(doc) {
    if (!doc) return;
    this.clearBuffer();
    if (doc.project_id) {
      this.state.projectId = doc.project_id;
      localStorage.setItem('cascadecad-active-uuid', doc.project_id);
    }
    const camCenter = this.state.camera.center || { lat: 0.0, lng: 0.0, altitude: 0.0 };
    const anchorLat = camCenter.lat !== undefined ? camCenter.lat : camCenter[0];
    const anchorLng = camCenter.lng !== undefined ? camCenter.lng : camCenter[1];
    const anchorAlt = camCenter.altitude !== undefined ? camCenter.altitude : (camCenter[2] || 0.0);

    if (doc.objects) {
      this.state.objects = doc.objects.map(obj => {
        const pos = obj.position || [0.0, 0.0, 0.0];
        const geo = enuToGeodetic(pos[0], pos[1], pos[2], anchorLat, anchorLng, anchorAlt);
        return {
          ...obj,
          manifest_id: obj.manifest_id ?? obj.id ?? obj.object_id,
          opacity: obj.opacity !== undefined ? Number(obj.opacity) : 1.0,
          color: obj.color || '#38bdf8',
          material: obj.material || 'Steel',
          geodetic: geo
        };
      });
      this.state.telemetry.objects = doc.objects.length;
      this.state.telemetry.vertices = doc.objects.reduce((acc, obj) => acc + (obj.faces ? obj.faces.length * 4 : 24), 0);
    }
    if (doc.assemblyTree) {
      this.state.assemblyTree = doc.assemblyTree;
    } else if (doc.objects) {
      this.state.assemblyTree = doc.objects.map(obj => ({
        id: obj.manifest_id ?? obj.id ?? obj.object_id,
        manifest_id: obj.manifest_id ?? obj.id ?? obj.object_id,
        name: obj.name,
        objectId: obj.manifest_id ?? obj.id ?? obj.object_id,
        type: 'PartInstance',
        children: []
      }));
    }
    if (doc.name) {
      this.state.projectName = doc.name;
    }
    this.notify();
  }

  setSelectionMode(mode) {
    this.state.selectionMode = mode;
    this.notify();
  }

  getVisibleSelectableSequence() {
    const seq = [];
    const visited = new Set();

    const traverse = (node) => {
      if (!node) return;
      const objId = node.manifest_id || node.objectId || node.id;
      const isLeafOrPart = !node.children || node.children.length === 0 || node.type === 'PartInstance' || node.structure_type === 'SOURCE_BODY' || node.structure_type === 'RECOVERED_ASSEMBLY';
      
      if (objId && isLeafOrPart && !visited.has(objId)) {
        const objExists = this.state.objects.some(o => (o.manifest_id === objId || o.id === objId || o.object_id === objId));
        if (objExists) {
          seq.push(objId);
          visited.add(objId);
        }
      }
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(traverse);
      }
    };

    if (Array.isArray(this.state.assemblyTree) && this.state.assemblyTree.length > 0) {
      this.state.assemblyTree.forEach(traverse);
    }

    this.state.objects.forEach(o => {
      const id = o.manifest_id || o.id || o.object_id;
      if (id && !visited.has(id)) {
        seq.push(id);
        visited.add(id);
      }
    });

    return seq;
  }

  selectAllParts() {
    const seq = this.getVisibleSelectableSequence();
    this.setSelectedIds(seq);
  }

  removeObject(objectId) {
    if (!objectId) return;
    this.state.objects = this.state.objects.filter(o => (o.manifest_id !== objectId && o.id !== objectId && o.object_id !== objectId));
    this.state.selectedIds = this.state.selectedIds.filter(id => id !== objectId);
    if (this.state.lastSelectedId === objectId) {
      this.state.lastSelectedId = this.state.selectedIds[this.state.selectedIds.length - 1] || null;
    }
    const filterTree = (nodes) => {
      const res = [];
      for (const n of nodes) {
        const nid = n.manifest_id || n.objectId || n.id;
        if (nid === objectId) continue;
        const copyNode = { ...n };
        if (copyNode.children && Array.isArray(copyNode.children)) {
          copyNode.children = filterTree(copyNode.children);
        }
        res.push(copyNode);
      }
      return res;
    };
    if (this.state.assemblyTree) {
      this.state.assemblyTree = filterTree(this.state.assemblyTree);
    }
    this.clearBuffer(objectId);
    this.notify();
  }

  setSelectedIds(ids) {
    this.state.selectedIds = Array.isArray(ids) ? ids : [];
    this.state.lastSelectedId = this.state.selectedIds.length > 0 ? this.state.selectedIds[this.state.selectedIds.length - 1] : null;
    this.notify();
  }

  setSelectedId(id, isCtrl = false, isShift = false, subElem = null) {
    if (subElem) {
      if (subElem.type === 'vertex') this.state.selectedVertexIndex = subElem.index;
      else if (subElem.type === 'edge') this.state.selectedEdgeIndex = subElem.index;
      else if (subElem.type === 'face') {
        this.state.selectedFaceIndex = subElem.index;
        this.state.selectedFaceInfo = subElem.info;
      }
    } else {
      this.state.selectedFaceIndex = null;
      this.state.selectedEdgeIndex = null;
      this.state.selectedVertexIndex = null;
      this.state.selectedFaceInfo = null;
    }

    if (!id) {
      this.state.selectedIds = [];
      this.state.lastSelectedId = null;
      this.notify();
      return;
    }

    if (isShift && this.state.lastSelectedId) {
      const seq = this.getVisibleSelectableSequence();
      const idx1 = seq.indexOf(this.state.lastSelectedId);
      const idx2 = seq.indexOf(id);
      
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const rangeSlice = seq.slice(start, end + 1);
        this.state.selectedIds = Array.from(new Set([...this.state.selectedIds, ...rangeSlice]));
      } else {
        this.state.selectedIds = [id];
      }
    } else if (isCtrl) {
      if (this.state.selectedIds.includes(id)) {
        this.state.selectedIds = this.state.selectedIds.filter(x => x !== id);
      } else {
        this.state.selectedIds = [...this.state.selectedIds, id];
      }
    } else {
      this.state.selectedIds = [id];
    }

    this.state.lastSelectedId = id;
    this.notify();
  }

  getSelectedObject() {
    if (this.state.selectedIds.length === 0) return null;
    const targetId = this.state.lastSelectedId || this.state.selectedIds[this.state.selectedIds.length - 1];
    return this.state.objects.find(o => (o.manifest_id === targetId || o.id === targetId || o.object_id === targetId)) || null;
  }

  getSelectedObjects() {
    if (this.state.selectedIds.length === 0) return [];
    const set = new Set(this.state.selectedIds);
    return this.state.objects.filter(o => set.has(o.manifest_id || o.id || o.object_id));
  }

  setActiveTool(tool) {
    this.state.activeTool = tool;
    this.notify();
  }

  setActiveTransformTool(tool) {
    this.state.activeTransformTool = tool;
    this.notify();
  }

  setActiveAction(actionConfig) {
    this.state.activeAction = actionConfig;
    this.notify();
  }

  setActiveSnap(snap) {
    this.state.activeSnap = snap;
  }

  toggleCsnap() {
    const current = this.state.preferences.csnap !== false;
    this.setPreferences({ csnap: !current });
  }

  setCamera(cam) {
    Object.assign(this.state.camera, cam);
    this.notify();
  }

  setPreferences(prefs) {
    Object.assign(this.state.preferences, prefs);
    if (prefs.theme) localStorage.setItem('cascadecad-theme', prefs.theme);
    if (prefs.units) localStorage.setItem('cascadecad-units', prefs.units);
    if (prefs.showGrid !== undefined) localStorage.setItem('cascadecad-show-grid', prefs.showGrid.toString());
    if (prefs.showAxes !== undefined) localStorage.setItem('cascadecad-show-axes', prefs.showAxes.toString());
    if (prefs.csnap !== undefined) localStorage.setItem('cascadecad-csnap', prefs.csnap.toString());
    this.notify();
  }

  getBuffer(objectId = null) {
    const key = objectId || '__default__';
    return this.arrayBufferCache.get(key) || null;
  }

  setBuffer(objectId = null, arrayBufferData = null) {
    const key = objectId || '__default__';
    if (arrayBufferData) {
      this.arrayBufferCache.set(key, arrayBufferData);
    }
  }

  getPersistentPositionsBuffer(objectId = null) {
    const key = `pos_${objectId || '__default__'}`;
    return this.arrayBufferCache.get(key) || null;
  }

  setPersistentPositionsBuffer(objectId = null, float32Positions = null) {
    const key = `pos_${objectId || '__default__'}`;
    if (float32Positions) {
      this.arrayBufferCache.set(key, float32Positions);
    }
  }

  clearBuffer(objectId = null) {
    if (objectId) {
      this.arrayBufferCache.delete(objectId);
      this.arrayBufferCache.delete(`pos_${objectId}`);
    } else {
      this.arrayBufferCache.clear();
    }
  }
}

export const CADState = new StateStore();
window.CADState = CADState;