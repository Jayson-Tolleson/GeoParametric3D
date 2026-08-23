import { CADState } from './cad_state.js';

/**
 * Native <gmp-map-3d> Planar Face & True N-Gon Viewport Controller
 */
export class Map3DViewportRenderer {
  constructor(map3dElement) {
    this.map3d = map3dElement;
    this.activePolygons = new Map();
    this.selectedFaceId = null;

    this.initMapDefaults();
    CADState.subscribe((event, data) => this.handleStateEvent(event, data));
  }

  initMapDefaults() {
    if (!this.map3d) return;
    this.map3d.center = { lat: 33.881400, lng: -117.921300, altitude: 95.0 };
    this.map3d.heading = 25;
    this.map3d.tilt = 60;
    this.map3d.range = 80;
  }

  handleStateEvent(event, data) {
    if (event === 'assembly_loaded') {
      this.mountAssembly(data);
    } else if (event === 'selection_changed') {
      this.highlightFace(data.faceId);
    }
  }

  /**
   * Mounts extracted planar N-Gon polygons into the native Google Maps 3D viewport.
   * Preserves exact face boundaries with zero internal diagonals.
   */
  mountAssembly(assemblyData) {
    if (!this.map3d || !assemblyData || !assemblyData.solids) return;

    const staleKeys = new Set(this.activePolygons.keys());

    for (const solid of assemblyData.solids) {
      const planarFaces = solid.planar_polygons || [];
      
      for (const face of planarFaces) {
        staleKeys.delete(face.face_id);
        let poly = this.activePolygons.get(face.face_id);
        
        if (!poly) {
          poly = document.createElement('gmp-polygon-3d');
          poly.dataset.cadFace = face.face_id;
          poly.dataset.solidId = face.solid_id || solid.solid_id;
          poly.dataset.solidName = face.solid_name || solid.name;
          poly.altitudeMode = 'absolute';
          poly.drawsUndefinedAltitudeAsGround = false;
          
          // Selection event listener
          poly.addEventListener('click', (e) => {
            e.stopPropagation();
            CADState.selectFace(face.face_id, solid.solid_id);
          });
          
          this.map3d.appendChild(poly);
          this.activePolygons.set(face.face_id, poly);
        }

        // Store face base color
        poly._baseColor = face.color || '#38bdf8';

        // Bind exact boundary coordinates
        poly.outerCoordinates = face.outer_coordinates || [];
        if (face.inner_coordinates && face.inner_coordinates.length > 0) {
          poly.innerCoordinates = face.inner_coordinates;
        }

        // Style defaults
        const isSel = this.selectedFaceId === face.face_id;
        poly.fillColor = isSel ? '#f59e0b' : poly._baseColor;
        poly.strokeColor = isSel ? '#ffffff' : '#e0f2fe';
        poly.strokeWidth = isSel ? 3.0 : 1.2;
      }
    }

    // Remove stale unreferenced polygons
    for (const key of staleKeys) {
      const stalePoly = this.activePolygons.get(key);
      if (stalePoly) {
        stalePoly.remove();
        this.activePolygons.delete(key);
      }
    }
  }

  highlightFace(faceId) {
    this.selectedFaceId = faceId;
    for (const [id, poly] of this.activePolygons) {
      const isSel = id === faceId;
      poly.fillColor = isSel ? '#f59e0b' : (poly._baseColor || '#38bdf8');
      poly.strokeColor = isSel ? '#ffffff' : '#e0f2fe';
      poly.strokeWidth = isSel ? 3.0 : 1.2;
    }
  }

  flyToAssembly() {
    if (!this.map3d) return;
    this.map3d.flyCameraTo({
      endCamera: {
        center: { lat: 33.881400, lng: -117.921300, altitude: 95.0 },
        tilt: 55,
        heading: 30,
        range: 65
      },
      durationMillis: 1200
    });
  }
}
