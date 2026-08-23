"use strict";

import { CADApi } from './api.js';
import { CADState } from './state.js';

const DEFAULT_12_INCH_MM = 304.8;

class CommandDispatcher {
  async execute(commandName, parameters = {}) {
    if (commandName === 'import') {
      const fileInput = document.getElementById('import-file-input');
      fileInput?.click();
      return;
    }

    if (commandName === 'export') {
      return CADApi.exportModel(parameters.format || 'xbf');
    }

    const result = await CADApi.sendCommand(commandName, parameters);

    if (result && (result.ok || result.success)) {
      if (result.document) {
        CADState.setDocument(result.document);
      }
      const obj = result.cad_obj ?? result.object;
      if (obj) {
        CADState.setSelectedId(obj.manifest_id ?? obj.id ?? obj.object_id);
      }
      if (result.deleted_ids) {
        CADState.setSelectedId(null);
      }
      if (result.camera) {
        CADState.setCamera(result.camera);
      }
      if (window.CADViewport) {
        window.CADViewport.geometryCacheDirty = true;
        window.CADViewport.syncNativeDOM();
        window.CADViewport.render();
      }
      return result;
    }

    const err = result?.error ?? 'Network error';
    console.error(`[Command Error] ${commandName}:`, err);
    window.uiController?.logServerEvent(`[CMD ERROR] ${commandName}: ${err}`);
    return result;
  }

  async createPrimitive(type, params = {}) {
    const defaultParams = {
      box: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM },
      cylinder: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, segments: 32 },
      sphere: { radius: DEFAULT_12_INCH_MM / 2, segments: 24 },
      cone: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, segments: 32 },
      torus: { major_radius: DEFAULT_12_INCH_MM / 2, minor_radius: DEFAULT_12_INCH_MM / 6, segments: 24 },
      prism: { radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM, sides: 12 },
      polygon: { sides: 5, radius: DEFAULT_12_INCH_MM / 2, height: DEFAULT_12_INCH_MM * 0.5 },
      ellipse: { radius_x: DEFAULT_12_INCH_MM / 2, radius_y: DEFAULT_12_INCH_MM / 3, height: DEFAULT_12_INCH_MM * 0.5 },
      wedge: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM * 0.8 },
      pyramid: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM },
      ellipsoid: { radius_x: DEFAULT_12_INCH_MM / 2, radius_y: DEFAULT_12_INCH_MM / 3, radius_z: DEFAULT_12_INCH_MM / 4 },
      tube: { radius: DEFAULT_12_INCH_MM / 2, inner_radius: DEFAULT_12_INCH_MM / 3, height: DEFAULT_12_INCH_MM },
      plane: { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, plane: 'xy' }
    };

    const shapeParams = { ...(defaultParams[type] ?? { width: DEFAULT_12_INCH_MM, depth: DEFAULT_12_INCH_MM, height: DEFAULT_12_INCH_MM }), ...params };

    let position = [0.0, 0.0, 0.0];
    if (params.cx !== undefined || params.cy !== undefined || params.cz !== undefined) {
      position = [
        params.cx ?? 0.0,
        params.cy ?? 0.0,
        params.cz ?? 0.0
      ];
      delete shapeParams.cx;
      delete shapeParams.cy;
      delete shapeParams.cz;
    } else if (params.position) {
      position = params.position;
    }

    return this.execute('create_primitive', {
      primitive: type,
      parameters: shapeParams,
      position,
      color: params.color || '#38bdf8',
      opacity: params.opacity !== undefined ? params.opacity : 1.0
    });
  }

  async deleteSelected() {
    const { selectedIds } = CADState.state;
    if (!selectedIds || !selectedIds.length) return;
    const idsToDelete = [...selectedIds];
    idsToDelete.forEach(id => {
      CADState.removeObject(id);
      CADState.clearBuffer(id);
    });
    CADState.setSelectedId(null);
    if (window.uiController) {
      window.uiController.renderAssemblyTree();
      window.uiController.renderInspector();
      window.uiController.renderTelemetry();
    }
    if (window.CADViewport) {
      window.CADViewport.geometryCacheDirty = true;
      window.CADViewport.syncNativeDOM();
      window.CADViewport.render();
    }
    return this.execute('delete_object', { ids: idsToDelete });
  }

  async toggleSelectedVisibility() {
    const { selectedIds } = CADState.state;
    if (!selectedIds.length) return;
    return this.execute('toggle_visibility', { ids: selectedIds });
  }

  async undo() {
    return this.execute('undo');
  }

  async redo() {
    return this.execute('redo');
  }

  async setProperty(prop, value) {
    const sel = CADState.getSelectedObject();
    if (!sel) return;
    const id = sel.manifest_id ?? sel.id ?? sel.object_id;
    CADState.clearBuffer(id