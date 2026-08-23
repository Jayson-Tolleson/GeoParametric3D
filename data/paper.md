# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 9.0.0-PROD-CONSOLIDATED  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Native Google Maps 3D & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic System Overview

GeoParametric3D is an engineering-grade Computer-Aided Design and Manufacturing (CAD/CAM) workstation operating in standard modern web browsers. It unifies two historically divergent computational domains:
1. **Authoritative Boundary Representation (B-Rep) Solid Modeling:** Exact mathematical surfaces, analytical boundary curves, topological orientation, and non-manifold healing powered by OpenCASCADE (OCCT / OCP) on the backend and WebAssembly clients on the frontend.
2. **Native Geospatial Photorealistic Viewport Engine (`<gmp-map-3d>`):** Complete elimination of all legacy Three.js WebGL canvas wrappers in favor of direct hardware-accelerated 3D geospatial primitives (`<gmp-polygon-3d>`, `<gmp-polyline-3d>`, `<gmp-marker-3d>`, and 3D Tiles) within the Google Maps 3D ecosystem.

### 1.1 Core Architectural Tenets

* **Dual-Route B-Rep Pipeline with True N-Gon Boundary Extraction:** Planar solid faces (`GeomAbs_Plane`) are never degraded by internal meshing diagonals or arbitrary triangulation. Boundary loops (outer perimeters and inner multiply-connected genus holes) are extracted as clean $N$-sided polygonal manifolds (`<gmp-polygon-3d>`).
* **100% Opaque Solid Shading (FreeCAD Parity):** All imported and primitive solids render with 100% opaque surface fills (`opacity: 1.0`, full alpha channel occlusion). Ghosted semi-transparency and wireframe-only artifacts are strictly eliminated from default solid representations.
* **Infinite 1' \u00d7 1' (304.8 mm) Ground Grid Plane:** The ground datum is projected across the Local Tangent Plane (ENU) to visual horizon extents, rendering crisp 1-foot grid cells centered at the geodetic anchor.
* **Exclusive Null Island Geodetic Origin Anchor (`[0.0, 0.0, 0.0]`):** Local Cartesian millimeter CAD coordinates map isometrically into WGS-84 ellipsoidal coordinates at the Prime Meridian/Equator intersection, guaranteeing zero longitudinal convergence distortion ($\cos(0^\circ) = 1.0$).
* **Authoritative B-Rep Primacy vs. Derived Render Mesh:** Exact mathematical surfaces, edges, and topology are the immutable source of truth; render representations are transient, derived projections.
* **Vertex AI Engineering Assistant:** Integrated with project `broadcasterfishmap` (location: `global`), providing real-time mechanical engineering calculations, parametric script synthesis, and B-Rep inspection.

---

## 2. Complete Elimination of Three.js & Adoption of Native `<gmp-map-3d>`

### 2.1 Architectural Rationale
Traditional web CAD implementations wrap WebGL or Three.js scene graphs around CAD geometry. In a geospatial CAD system, this creates severe architectural friction:
- **Dual Memory Overhead:** Triangulated copies of solid geometry reside simultaneously in the CAD kernel heap, the Three.js scene graph, the WebGL buffer cache, and the geospatial map canvas.
- **Depth Buffer & Z-Fighting Incompatibilities:** Three.js overlay canvases cannot natively interleave depth buffers with Google Maps 3D photorealistic tiles without severe precision loss (logarithmic depth buffer artifacts over multi-kilometer viewing ranges).
- **Triangulation Diagonals on Planar Slabs:** Forcing planar faces into triangle meshes introduces visual meshing diagonals that degrade mechanical inspection.

### 2.2 Native Viewport Architecture
All Three.js dependencies are eliminated. Viewport presentation is handled by native Web Components:
- **`<gmp-map-3d>`:** Authoritative 3D camera controller, photorealistic Earth surface, real-world atmospheric lighting, and continuous level-of-detail (LOD) streaming.
- **`<gmp-polygon-3d>`:** Direct rendering of exact planar polygons (`outerCoordinates`, `innerCoordinates`) with GPU-driven rasterization, zero meshing diagonals, and hardware depth testing against 3D buildings and terrain.
- **`<gmp-polyline-3d>`:** Direct rendering of drafting lines, toolpaths, and boundary wire edges.
- **`<gmp-marker-3d>`:** Hardware-anchored construction datum points, center-of-mass indicators, and CSnap vertices.

```
+---------------------------------------------------------------------------------------------------+
|                                 GEOPARAMETRIC3D CLIENT APPLICATION                                |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                       NATIVE GOOGLE MAPS 3D VIEWPORT CONTAINER (<gmp-map-3d>)                     |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-polygon-3d> (Planar)       |      |     <gmp-polyline-3d> (Curves & Outlines)     |   |
|   |    - outerCoordinates: LatLngAlt[] |      |     - coordinates: LatLngAlt[]                |   |
|   |    - innerCoordinates: LatLngAlt[][]|     |     - strokeColor / strokeWidth               |   |
|   |    - fillColor: 100% Opaque Solid  |      |     - altitudeMode: 'absolute'                |   |
|   +------------------------------------+      +-----------------------------------------------+   |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-marker-3d> (Datums)        |      |     Infinite 1'x1' Ground Grid Overlay Canvas |   |
|   |    - position: {lat, lng, alt
