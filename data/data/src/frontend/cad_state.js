/**
 * GeoParametric3D State & Unit Invariance Subsystem (Laws 1, 2, 3, 4)
 */
export const CADState = {
  _isImperial: false,
  _currentAssembly: null,
  _selectedFace: null,
  _selectedSolid: null,
  _listeners: new Set(),

  isImperial() {
    return this._isImperial;
  },

  setImperial(enabled) {
    this._isImperial = !!enabled;
    this.notify('units_changed', { isImperial: this._isImperial });
  },

  toggleUnits() {
    this.setImperial(!this._isImperial);
    return this._isImperial;
  },

  /**
   * Law 3: UI-only display projection from canonical millimeters.
   */
  formatLinear(mmValue, decimals = 3) {
    if (mmValue === undefined || mmValue === null || isNaN(mmValue)) return '0.000 mm';
    if (this._isImperial) {
      const inches = mmValue / 25.4;
      return `${inches.toFixed(decimals)} in`;
    }
    return `${Number(mmValue).toFixed(decimals)} mm`;
  },

  formatDimensions(dimsMm, decimals = 3) {
    if (!Array.isArray(dimsMm) || dimsMm.length < 3) return '0.000 × 0.000 × 0.000 mm';
    const conv = this._isImperial ? (1.0 / 25.4) : 1.0;
    const unit = this._isImperial ? 'in' : 'mm';
    return dimsMm.map(d => (d * conv).toFixed(decimals)).join(' × ') + ` ${unit}`;
  },

  setAssembly(assemblyData) {
    this._currentAssembly = assemblyData;
    this._selectedFace = null;
    this._selectedSolid = null;
    this.notify('assembly_loaded', assemblyData);
  },

  getAssembly() {
    return this._currentAssembly;
  },

  selectFace(faceId, solidId = null) {
    this._selectedFace = faceId;
    this._selectedSolid = solidId;
    this.notify('selection_changed', { faceId, solidId });
  },

  selectSolid(solidId) {
    this._selectedSolid = solidId;
    if (this._currentAssembly && this._currentAssembly.solids) {
      const solid = this._currentAssembly.solids.find(s => s.solid_id === solidId);
      if (solid && solid.planar_polygons && solid.planar_polygons.length > 0) {
        this._selectedFace = solid.planar_polygons[0].face_id;
      } else {
        this._selectedFace = null;
      }
    }
    this.notify('selection_changed', { faceId: this._selectedFace, solidId });
  },

  getSelectedFace() {
    return this._selectedFace;
  },

  getSelectedSolid() {
    return this._selectedSolid;
  },

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  notify(event, payload) {
    for (const fn of this._listeners) {
      try { fn(event, payload); } catch (e) { console.error(e); }
    }
  }
};
