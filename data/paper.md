# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 9.0.0-PROD-CONSOLIDATED  
**Classification:** Core CAD/CAM, Native Google Maps 3D & Geospatial Engine Architecture  
**Author:** Principal CAD Systems Architect & Geometric Kernel Governor  

---

## 1. Executive Summary & Core Architectural Tenets

GeoParametric3D is an engineering-grade Computer-Aided Design and Manufacturing (CAD/CAM) workstation engineered to execute within standard modern web browsers. It reconciles high-precision boundary representation (B-Rep) solid modeling with hardware-accelerated, photorealistic planetary rendering (`<gmp-map-3d>`).

The workstation is governed by six immutable architectural tenets:

1. **Dual-Route B-Rep Pipeline with True N-Gon Boundary Extraction:** Planar solid faces (`GeomAbs_Plane`) are never degraded by internal meshing diagonals or arbitrary triangulation. Boundary loops (outer perimeters and inner multiply-connected genus holes) are extracted directly as clean $N$-sided polygonal manifolds (`<gmp-polygon-3d>`).
2. **100% Opaque Solid Shading (FreeCAD Parity):** All imported and primitive solids render with 100% opaque surface fills (`opacity: 1.0`, full alpha channel occlusion). Ghosted semi-transparency and wireframe-only artifacts are strictly eliminated from default solid representations.
3. **Infinite 1' \u00d7 1' (304.8 mm) Ground Grid Plane:** The ground datum is projected across the Local Tangent Plane (ENU) to visual horizon extents, rendering crisp 1-foot grid cells centered at the geodetic anchor.
4. **Exclusive Null Island Geodetic Origin Anchor (`[0.0, 0.0, 0.0]`):** Local Cartesian millimeter CAD coordinates map isometrically into WGS-84 ellipsoidal coordinates at the Prime Meridian/Equator intersection, guaranteeing zero longitudinal convergence distortion ($\cos(0^\circ) = 1.0$).
5. **Authoritative B-Rep Primacy vs. Derived Render Mesh:** Exact mathematical surfaces, edges, and topology (`GeoAssembly`, `GeoPart`, `GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`) constitute the immutable geometric truth; render representations are transient, derived projections.
6. **Vertex AI Engineering Assistant:** Deeply integrated with Google Cloud Vertex AI (Project: `broadcasterfishmap`, Location: `global`), providing real-time mechanical engineering calculations, parametric script synthesis (CadQuery/OpenCASCADE), and B-Rep inspection.

---

## 2. Complete Elimination of Legacy Intermediate Graphics Engines (Three.js Elimination)

### 2.1 Architectural Justification
Legacy WebGL CAD implementations wrap solid geometry in external scene graph libraries such as Three.js or Babylon.js. When merged into a geospatial context, this dual-engine approach incurs fatal structural flaws:
- **Dual Memory Overhead:** Triangulated copies of solid geometry reside simultaneously in the CAD kernel heap, the Three.js scene graph, the WebGL buffer cache, and the geospatial map canvas.
- **Depth Buffer Incompatibilities & Z-Fighting:** Intermediate overlay canvases cannot natively interleave depth buffers with Google Maps 3D photorealistic tiles without severe precision loss (logarithmic depth buffer artifacts across multi-kilometer viewing ranges).
- **Triangulation Diagonals on Planar Slabs:** Forcing planar faces into triangle meshes introduces visual meshing diagonals that degrade mechanical inspection.

### 2.2 Native Viewport Architecture
All Three.js dependencies have been excised. Viewport presentation is handled by native Web Components:
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
|   |    - fillColor: 100% Opaque        |      |     - altitudeMode: 'absolute'                |   |
|   +------------------------------------+      +-----------------------------------------------+   |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-marker-3d> (Datums)        |      |     2D/WebGL Overlay (Selection & CSnap)      |   |
|   |    - position: {lat, lng, alt
