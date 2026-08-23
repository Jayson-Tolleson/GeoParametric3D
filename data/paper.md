# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 12.0.0-PROD-CONSOLIDATED  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Native Google Maps 3D & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic System Overview

GeoParametric3D is an engineering-grade Computer-Aided Design and Manufacturing (CAD/CAM) workstation operating natively in modern web browsers without intermediate WebGL wrappers. It establishes an unbroken, high-speed mathematical pipeline between an authoritative Boundary Representation (B-Rep) solid modeling kernel and the native Google Maps 3D Web Component (`<gmp-map-3d>`).

### Primary Architectural Tenets

1. **Dual-Route B-Rep Pipeline with True N-Gon Boundary Extraction:**  
   Planar solid faces (`GeomAbs_Plane`) are never degraded by internal meshing diagonals or arbitrary triangulation. Boundary loops (outer perimeters and inner multiply-connected genus holes) are extracted directly from authoritative B-Rep topological wires as clean $N$-sided polygonal manifolds (`<gmp-polygon-3d>`).

2. **100% Opaque Solid Shading (FreeCAD Parity):**  
   All imported and primitive solids render with 100% opaque surface fills (`opacity: 1.0`, full alpha channel occlusion, `fillColor: rgb/hex`, alpha = 1.0). Ghosted semi-transparency, wireframe-only visuals, and unrendered face voids are strictly eliminated from default solid representations.

3. **Infinite 1' $\times$ 1' ($304.8\text{ mm}$) Ground Grid Plane:**  
   The ground datum is projected across the Local Tangent Plane (ENU) to visual horizon extents, rendering crisp 1-foot grid cells centered at the geodetic anchor.

4. **Exclusive Null Island Geodetic Origin Anchor ($[0.0, 0.0, 0.0]$):**  
   Local Cartesian millimeter CAD coordinates map isometrically into WGS-84 ellipsoidal coordinates at the Prime Meridian/Equator intersection, guaranteeing zero longitudinal convergence distortion ($\cos(0^\circ) = 1.0$).

5. **Authoritative B-Rep Primacy vs. Derived Render Mesh:**  
   Exact mathematical surfaces, boundary edges, and topology are the immutable source of truth; render representations are transient, derived projections.

6. **Vertex AI Engineering Assistant:**  
   Integrated with Google Cloud Vertex AI under project `broadcasterfishmap` (location: `global`), providing real-time mechanical engineering derivations, parametric script synthesis, and topological B-Rep inspection.

---

## 2. Elimination of Three.js & Adoption of Native `<gmp-map-3d>`

### 2.1 The Architectural Flaw of Intermediate WebGL Scene Graphs
Traditional web CAD systems construct a Three.js scene graph atop WebGL canvases. When integrated with geospatial photorealistic 3D map tiles, this dual-stack design introduces critical failure points:
- **Logarithmic Z-Buffer Incompatibility:** Three.js cannot natively share depth buffers with Google Maps 3D photorealistic tiles over multi-kilometer view frustums, causing severe Z-fighting and geometry tearing.
- **Unwanted Triangulation Diagonals:** Standard Three.js meshes require planar polygons to be subdivided into triangles, creating visual diagonal seams across flat faces.
- **Heap Duplication:** Geometry definitions reside in duplicate buffers across the kernel heap, Three.js memory, and GPU VRAM.

### 2.2 Native Viewport Architecture
All Three.js dependencies are eliminated. Viewport presentation is handled by native Web Components:
- **`<gmp-map-3d>`:** Master 3D camera controller, photorealistic Earth surface, and continuous LOD streaming.
- **`<gmp-polygon-3d>`:** Direct GPU-accelerated rendering of planar solid faces with zero internal diagonals and 100% opaque shading.
- **`<gmp-polyline-3d>`:** Direct vector rendering of CAD boundary wires, construction lines, and CNC toolpaths.
- **`<gmp-marker-3d>`:** Hardware-anchored construction datum points and CSnap vertices.

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
|   |    - strokeColor: Boundary Outlines|      +-----------------------------------------------+   |
|   +------------------------------------+                                                          |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-marker-3d> (Datums)        |      |     3D Overlay Canvas (Selection & CSnap)     |   |
|   |    - position: {lat, lng, alt}     |      |     - Screen-space HUD & Rubber-band Box      |   |
|   |    - altitudeMode: 'absolute'      |      |     - Active Snap Indicator Gizmos            |   |
|   +------------------------------------+      |     - Infinite 1' x 1' (304.8mm) Ground Grid  |   |
|                                               +-----------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Dual-Route B-Rep Solid Rendering Pipeline

```
                                  [OPEN CASCADE TopoDS_Shape]
                                                |
                                                v
                            [STEP 1: TOPOLOGICAL FACE CLASSIFICATION]
                            Adaptor = BRepAdaptor_Surface(TopoDS_Face)
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v (GeomAbs_Plane)                               v (Non-Planar / Freeform)
+-----------------------------------------------+   +-----------------------------------------------+   
|           ROUTE A: PLANAR N-GON LOOP          |   |          ROUTE B: ADAPTIVE DEFLECTION         |   
| - Extract Outer Wires & Inner Cutout Loops    |   | - Dynamic Linear & Angular Deflection         |   
| - Quasi-Uniform Deflection on Curved Edges    |   | - Poly_Triangulation Extraction               |   
| - ZERO Internal Triangulation Diagonals       |   | - Hardware-Compact Float32/Uint32 Buffers     |   
| - 100% Opaque Solid Shading (FreeCAD Parity)  |   | - 100% Opaque Solid Shading                   |   
+-----------------------------------------------+   +-----------------------------------------------+   
                        |                                               |                           
                        v                                               v                           
+-----------------------------------------------+   +-----------------------------------------------+   
|      LOCAL ENU CARTESIAN COORDINATES (mm)     |   |      LOCAL ENU CARTESIAN COORDINATES (mm)     |   
|            [x_mm, y_mm, z_mm]                 |   |            [x_mm, y_mm, z_mm]                 |   
+-----------------------------------------------+   +-----------------------------------------------+   
                        |                                               |                           
                        +-----------------------+-----------------------+                           
                                                |                                                   
                                                v                                                   
+---------------------------------------------------------------------------------------------------+
|                             STEP 2: WGS-84 GEODETIC PROJECTION ENGINE                             |
|             Transforms Local Tangent Plane (ENU mm) -> WGS-84 (Lat, Lng, Altitude)               |
+---------------------------------------------------------------------------------------------------+
                                                |                                                   
                        +-----------------------+-----------------------+                           
                        |                                               |                           
                        v                                               v                           
+-----------------------------------------------+   +-----------------------------------------------+   
|               <gmp-polygon-3d>                |   |          ADAPTIVE RENDER MESH BUFFERS         |   
|  - outerCoordinates: [{lat, lng, alt}, ...]   |   |  - Contiguous Polygons / Compact Arrays       |   
|  - innerCoordinates: [[{lat, lng, alt}], ...] |   |  - Direct GPU Hardware Rasterization          |   
|  - Crisp Solid Opaque Fill (Alpha = 1.0)      |   |  - Crisp Solid Opaque Fill (Alpha = 1.0)      |   
|  - Exact Face-Provenance IDs                  |   |  - Exact Face-Provenance IDs                  |   
+-----------------------------------------------+   +-----------------------------------------------+   
```

### 3.1 Route A: Planar Faces (`GeomAbs_Plane`)
1. **Analytical Plane Detection:** The face surface is queried via `BRepAdaptor_Surface.GetType()`. If `GeomAbs_Plane`, the face is routed directly to boundary wire extraction.
2. **Topological Wire Traversal:** `TopExp_Explorer(TopAbs_WIRE)` and `BRepTools_WireExplorer` extract the outer boundary loop and all internal cutout loops (e.g. holes, slots).
3. **Edge Discretization:** Linear edges remain clean 2-point vectors; circular and spline edges are adaptively discretized via `GCPnts_QuasiUniformDeflection` under controlled chordal deflection.
4. **Direct Vector Binding:** Boundary loops are mapped to WGS-84 geodetic coordinates and passed directly into `<gmp-polygon-3d>` as `outerCoordinates` and `innerCoordinates` with full opacity.

### 3.2 Route B: Curved & Analytical Surfaces
1. **Dynamic Deflection Scaling:** For cylinders, cones, spheres, tori, and B-Splines, deflection parameters scale dynamically with the solid bounding diagonal extent $D_{\text{diag}}$:
   $$\delta_{\text{linear}} = \max\left(0.2, D_{\text{diag}} \times 0.002\right) \quad [\text{mm}], \quad \theta_{\text{angular}} = 0.45 \quad [\text{rad}]$$
2. **Compacted Mesh Extraction:** `BRepMesh_IncrementalMesh` generates node positions and facet indices. Non-finite values and degenerate triangles are culled by `validate_and_compact_mesh`.
3. **Opaque Hardware Shading:** Rendered as contiguous solid polygons with hardware depth buffering and exact face provenance.

---

## 4. Opaque Solid Shading & Infinite 1' $\times$ 1' Grid Standards

### 4.1 Opaque Solid Shading (FreeCAD Parity)
- All solid faces are shaded with **100% opacity** (`fillColor: hex_color`, alpha = 1.0).
- Multi-solid compounds retain native STEP header presentation colors (`COLOUR_RGB`) or distinct high-contrast palette assignments.
- Sub-element highlighting (face, edge, vertex) overlays crisp high-contrast outlines (`#fbbf24` gold selection borders) without rendering the underlying body transparent.

### 4.2 Infinite 1' $\times$ 1' ($304.8\text{ mm}$) Ground Grid Plane
- The ground grid is projected across the entire viewport extent from the local origin out to the visual horizon.
- Grid cell spacing is calibrated to exactly **1 foot ($304.8\text{ mm}$)** in imperial mode and **$300\text{ mm}$** in metric mode.
- Grid lines are rendered via hardware-accelerated overlay canvas with adaptive line antialiasing, providing an expansive drafting floor.

---

## 5. Exclusive Geodetic Datum: Null Island `[0.0, 0.0, 0.0]`

### 5.1 Mathematical Rationale for Null Island Datum
CAD solid modeling kernels operate in Euclidean $\mathbb{R}^3$ space (Local Cartesian ENU millimeters), whereas `<gmp-map-3d>` operates in ellipsoidal WGS-84 geocentric coordinates. Standardizing on **Null Island** (Latitude $\phi_0 = 0.0^\circ$, Longitude $\lambda_0 = 0.0^\circ$, Altitude $h_0 = 0.0\text{ m}$) provides unique mathematical advantages:

1. **Zero Longitudinal Convergence Distortion:** At the equator, $\cos(\phi_0) = \cos(0^\circ) \equiv 1.0$. Longitudinal scale is perfectly isometric with latitudinal scale, eliminating shearing artifacts across CAD models.
2. **Maximum Curvature Radius:** $N(0) = a = 6,378,137.0\text{ m}$, providing optimal numerical conditioning for Jacobian transforms.
3. **Orthogonal Coordinate Preservation:** The ENU tangent plane at $(0^\circ, 0^\circ)$ maintains direct parity with standard CAD XYZ coordinate conventions.

### 5.2 Mathematical Transformation Equations (ENU to WGS-84)

For any local point $\mathbf{P} = [x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}]^T$ with vertical rotation $\theta_z$:

$$\begin{bmatrix} x' \\ y' \\ z' \end{bmatrix} = \begin{bmatrix} \cos\theta_z & -\sin\theta_z & 0 \\ \sin\theta_z & \cos\theta_z & 0 \\ 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} x_{\text{mm}} \times 10^{-3} \\ y_{\text{mm}} \times 10^{-3} \\ z_{\text{mm}} \times 10^{-3} \end{bmatrix}$$

$$\phi = \phi_0 + \left(\frac{y'}{M(\phi_0) + h_0}\right) \times \left(\frac{180^\circ}{\pi}\right)$$
$$\lambda = \lambda_0 + \left(\frac{x'}{(N(\phi_0) + h_0) \cos(\phi_0)}\right) \times \left(\frac{180^\circ}{\pi}\right)$$
$$h = h_0 + z'$$

Where:
$$N(\phi) = \frac{a}{\sqrt{1 - e^2 \sin^2(\phi)}}, \quad M(\phi) = \frac{a(1 - e^2)}{\left(1 - e^2 \sin^2(\phi)\right)^{3/2}}$$
$$a = 6,378,137.0\text{ m}, \quad e^2 \approx 0.00669437999014$$

---

## 6. Coordinate Snapping (CSnap) Bearing Edge Engine

```
                        [Cursor Hover / Pointer Move]
                                      |
                                      v
                         [Screen-Space Ray Casting]
                                      |
                                      v
                 +------------------------------------------+
                 |     1. Candidate Edge Proximity Test     |
                 |     d_2d = || p_cursor - Segment_2D ||   |
                 |     Filter: d_2d <= 16 pixels            |
                 +------------------------------------------+
                                      |
                                      v
                 +------------------------------------------+
                 |     2. Normal & View-Direction Dot Test  |
                 |     cos_alpha = Normal_Face . View_Dir   |
                 |     Cull: Back-facing edges (cos > 0.05) |
                 +------------------------------------------+
                                      |
                                      v
                 +------------------------------------------+
                 |     3. Bearing Edge Weight Maximization  |
                 |     Weight = (1 / d_2d) * (|cos| + 0.1)  |
                 |     Best Edge = argmax(Weight)           |
                 +------------------------------------------+
                                      |
                                      v
                 +------------------------------------------+
                 |     4. Draw Dynamic Highlight Gizmo      |
                 |     Vertex: Circle (R=8px, #fbbf24)      |
                 |     Midpoint: Square (12x12px, #fbbf24)  |
                 +------------------------------------------+
```

CSnap provides sub-pixel snapping precision across complex assemblies by weighting geometric proximity against surface normal visibility.

---

## 7. Verification Test Matrix & Quality Gates

| Verification Target | Test Suite | Scope | Expected Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_geometry.py` | Topology Invariants | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Unit Conversion Invariance** | `test_cad_architecture.py` | Unit Normalization | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP Structured B-Rep** | `test_cad_architecture.py` | STEP Import | `MANIFOLD_SOLID_BREP` entity hierarchy and finite coordinates | **PASS** |
| **Mesh Compaction & Culling** | `test_cad_architecture.py` | Numerical Integrity | Removal of NaNs, Infs, degenerate triangles, index remapping | **PASS** |
| **Scale Dimensionless Invariance** | `test_workstation_repair.py` | Transform Math | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scaling | **PASS** |
| **SDF Golden Equivalence** | `test_kernel_math.py` | Kernel Math | $G(\mathbf{x}) = 0$ on boundary, volume $W \times D \times H$ exact | **PASS** |
| **Native `<gmp-map-3d>` Sync** | Full Workstation Pipeline | Rendering Integration | Direct DOM synchronization without Three.js overhead | **PASS** |

---

## 8. Architectural Conclusions & Production Directives

1. **Zero Intermediate Graphics Libraries:** Direct binding to `<gmp-map-3d>` Web Components exclusively.
2. **True N-Gon Solid Rendering:** All planar CAD faces render as clean boundary loops with zero internal diagonals.
3. **100% Opaque Solid Shading:** Solid geometry defaults to full opacity with hardware depth occlusion.
4. **Canonical Linear Millimeters:** All internal geometry is maintained in linear millimeters (`mm`), with unit conversion occurring strictly at the user interface boundary.
5. **Infinite 1-Foot Grid:** Continuous 1' $\times$ 1' ($304.8\text{ mm}$) drafting grid provides spatial reference to the visual horizon.
6. **Exclusive Null Island Geodetic Origin:** Local CAD coordinates map isometrically into WGS-84 space at $(0.0^\circ, 0.0^\circ, 0.0\text{ m})$.

---  
*End of Master Architectural Specification.*
