# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 8.0.0-PROD-CONSOLIDATED  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Native Google Maps 3D & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic System Overview

GeoParametric3D is an engineering-grade Computer-Aided Design and Manufacturing (CAD/CAM) workstation operating in standard modern web browsers. It unifies two historically divergent computational domains:
1. **Authoritative Boundary Representation (B-Rep) Solid Modeling:** Exact mathematical surfaces, analytical boundary curves, topological orientation, and non-manifold healing powered by OpenCASCADE (OCCT / OCP) on the backend and WebAssembly clients on the frontend.
2. **Native Geospatial Photorealistic Viewport Engine (`<gmp-map-3d>`):** Complete elimination of all legacy Three.js WebGL canvas wrappers in favor of direct hardware-accelerated 3D geospatial primitives (`<gmp-polygon-3d>`, `<gmp-polyline-3d>`, `<gmp-marker-3d>`, and 3D Tiles) within the Google Maps 3D ecosystem.

This specification formally addresses the architectural mandate to eliminate legacy intermediate mesh layers (Three.js), details the mathematical mechanics of the Dual-Route B-Rep rendering pipeline, and establishes exclusive geodetic anchoring at Null Island `[0.0, 0.0, 0.0]` for zero-distortion Cartesian coordinate projection.

---

## 2. Complete Elimination of Three.js & Adoption of Native `<gmp-map-3d>`

### 2.1 Architectural Rationale
Traditional web CAD implementations wrap WebGL or Three.js scene graphs around CAD geometry. In a geospatial CAD system, this creates severe architectural friction:
- **Dual Memory Overhead:** Triangulated copies of solid geometry reside simultaneously in the CAD kernel heap, the Three.js scene graph, the WebGL buffer cache, and the geospatial map canvas.
- **Depth Buffer & Z-Fighting Incompatibilities:** Three.js overlay canvases cannot natively interleave depth buffers with Google Maps 3D photorealistic tiles without severe precision loss (logarithmic depth buffer artifacts over multi-kilometer viewing ranges).
- **Triangulation Diagonals on Planar Slabs:** Forcing planar faces into triangle meshes introduces visual meshing diagonals that degrade mechanical inspection.

### 2.2 Native Viewport Architecture
All Three.js dependencies are eliminated. Viewport presentation is handled exclusively by native Web Components:
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
|   |    - fillColor / strokeColor       |      |     - altitudeMode: 'absolute'                |   |
|   +------------------------------------+      +-----------------------------------------------+   |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-marker-3d> (Datums)        |      |     3D Overlay Canvas (Selection & CSnap)     |   |
|   |    - position: {lat, lng, alt}     |      |     - Screen-space HUD & Rubber-band Box      |   |
|   |    - altitudeMode: 'absolute'      |      |     - Active Snap Indicator Gizmos            |   |
|   +------------------------------------+      +-----------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Dual-Route B-Rep Rendering Pipeline & True N-Gon Extraction

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
| - Zero Internal Triangulation Diagonals       |   | - Hardware-Compact Float32/Uint32 Buffers     |   
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
|  - outerCoordinates: [{lat, lng, alt}, ...]   |   |  - Triangulated Facet Array                   |   
|  - innerCoordinates: [[{lat, lng, alt}], ...] |   |  - Direct GPU Coplanar Shader Rasterization   |   
|  - Crisp Solid Shading (100% Opacity)         |   |  - Precise Face Provenance IDs                |   
+-----------------------------------------------+   +-----------------------------------------------+   
```

### 3.1 Route A: Planar Faces (`GeomAbs_Plane`)
1. **Analytical Plane Detection:** For every `TopoDS_Face`, the underlying analytical geometry is queried via `BRepAdaptor_Surface.GetType()`. If `GeomAbs_Plane`, the face is routed directly to the N-Gon extraction pipeline.
2. **Topological Wire Traversal:** `TopExp_Explorer(TopAbs_WIRE)` and `BRepTools_WireExplorer` extract the outer bounding wire and all internal cutout wires (genus holes).
3. **Curved Edge Discretization:** Linear edges remain clean 2-point vectors; circular or spline edges are adaptively discretized using chordal deflection sampling (`GCPnts_QuasiUniformDeflection`).
4. **Direct Vector Binding:** Outer and inner loops are transformed to WGS-84 coordinates and passed directly into `<gmp-polygon-3d>` as `outerCoordinates` and `innerCoordinates`.

### 3.2 Route B: Curved & Freeform Analytical Surfaces
1. **Adaptive Deflection Calculation:** For cylinders, cones, spheres, tori, and B-Splines, deflection bounds are computed dynamically from the shape bounding diagonal extent $D_{\text{diag}}$:
   $$\delta_{\text{linear}} = \max\left(0.2, D_{\text{diag}} \times 0.002\right) \quad [\text{mm}], \quad \theta_{\text{angular}} = 0.45 \quad [\text{rad}]$$
2. **Mesh Generation & Compaction:** `BRepMesh_IncrementalMesh` generates node positions and triangle indices. Degenerate facets and non-finite numbers are culled via `validate_and_compact_mesh`.
3. **Hardware Mesh Projection:** Faces are rendered as contiguous polygon sets or compact binary buffers with exact face-provenance metadata.

---

## 4. Exclusive Geodetic Anchoring at Null Island `[0.0, 0.0, 0.0]`

### 4.1 Geodetic Anchoring Principle
Web CAD solid kernels operate in flat Euclidean $\mathbb{R}^3$ space (Local Cartesian ENU coordinates in millimeters), whereas `<gmp-map-3d>` operates in an ellipsoidal WGS-84 reference frame (Earth-Centered, Earth-Fixed / ECEF coordinates).

To map local CAD coordinates $[x, y, z]^T$ to the planetary surface, the system mandates exclusive anchoring at Null Island:
$$\mathbf{A} = (\phi_0, \lambda_0, h_0) = (0.0^\circ, 0.0^\circ, 0.0\text{ m})$$

### 4.2 Mathematical Superiority of Null Island Anchoring
Let $\phi_0 = 0.0^\circ$ (Equator), $\lambda_0 = 0.0^\circ$ (Prime Meridian), and $h_0 = 0.0\text{ m}$ (WGS-84 Ellipsoid Sea Level).

Under the Local Tangent Plane (East-North-Up / ENU) projection:
$$\phi = \phi_0 + \frac{y_{\text{m}}}{M(\phi_0) + h_0} \times \left(\frac{180^\circ}{\pi}\right)$$
$$\lambda = \lambda_0 + \frac{x_{\text{m}}}{(N(\phi_0) + h_0) \cos(\phi_0)} \times \left(\frac{180^\circ}{\pi}\right)$$
$$h = h_0 + z_{\text{m}}$$

At $\phi_0 = 0.0^\circ$:
- The prime vertical radius of curvature is maximized: $N(0) = a = 6,378,137.0\text{ m}$.
- The meridional radius of curvature is minimized: $M(0) = a(1 - e^2) \approx 6,335,439.327\text{ m}$.
- The longitudinal scaling term $\cos(\phi_0) = \cos(0) = 1.0$, completely eliminating latitude-dependent longitudinal convergence distortion.

### 4.3 Architectural Mandate
All project instances, geometry instantiations, and coordinate transforms are anchored exclusively to Null Island `[0.0, 0.0, 0.0]`. This guarantees maximum numerical stability, removes trigonometric distortion across horizontal axes, and ensures deterministic IEEE 754 precision.

---

## 5. Mathematical Formulations of the WGS-84 ENU Pipeline

### 5.1 Ellipsoidal Parameters (WGS-84)
- Semi-major axis: $a = 6,378,137.0\text{ m}$
- Reciprocal flattening: $1/f = 298.257223563$
- First eccentricity squared: $e^2 = 2f - f^2 \approx 0.00669437999014$

### 5.2 Curvature Radii
$$N(\phi) = \frac{a}{\sqrt{1 - e^2 \sin^2(\phi)}}$$
$$M(\phi) = \frac{a(1 - e^2)}{\left(1 - e^2 \sin^2(\phi)\right)^{3/2}}$$

### 5.3 Local Cartesian (mm) to Geodetic Conversion
For any local point $\mathbf{P} = [x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}]^T$ and rotation angle $\theta_z$:

$$\begin{bmatrix} x' \\ y' \\ z' \end{bmatrix} = \begin{bmatrix} \cos\theta_z & -\sin\theta_z & 0 \\ \sin\theta_z & \cos\theta_z & 0 \\ 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} x_{\text{mm}} \times 10^{-3} \\ y_{\text{mm}} \times 10^{-3} \\ z_{\text{mm}} \times 10^{-3} \end{bmatrix}$$

$$\phi = \phi_0 + \left(\frac{y'}{M(\phi_0) + h_0}\right) \times \left(\frac{180}{\pi}\right)$$
$$\lambda = \lambda_0 + \left(\frac{x'}{(N(\phi_0) + h_0) \cos(\phi_0)}\right) \times \left(\frac{180}{\pi}\right)$$
$$h = h_0 + z'$$

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

CSnap resolves edge selection ambiguity by computing a combined distance-normal score, preventing background edge misallocation.

---

## 7. Verification Test Matrix

| Verification Target | Test Suite | Governing Spec Section | Verification Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_geometry.py` | Sec. 1–10 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Unit Conversion Invariance** | `test_cad_architecture.py` | Sec. 11–20 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_cad_architecture.py` | Sec. 21–30 | `MANIFOLD_SOLID_BREP` entity hierarchy and finite coordinates | **PASS** |
| **Mesh Compaction & Culling** | `test_cad_architecture.py` | Sec. 31–40 | Removal of NaNs, Infs, degenerate triangles, index remapping | **PASS** |
| **Scale Dimensionless Invariance** | `test_workstation_repair.py` | Sec. 41–50 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scaling | **PASS** |
| **SDF Golden Equivalence** | `test_kernel_math.py` | Sec. 51–60 | $G(\mathbf{x}) = 0$ on boundary, volume $W \times D \times H$ exact | **PASS** |
| **Native `<gmp-map-3d>` Sync** | Client Viewport Pipeline | Sec. 61–70 | Direct DOM synchronization without Three.js overhead | **PASS** |

---

## 8. Conclusion & Production Guidelines

1. **Zero External Render Engines:** `<gmp-map-3d>` is the sole viewport provider. No Three.js or Babylon.js layers exist in the runtime stack.
2. **B-Rep Authoritative Primacy:** Visual polygons are strictly derived presentations; all edits mutate the B-Rep topology.
3. **Universal Internal Millimeters:** All geometry is stored in canonical linear millimeters (`mm`). Display unit conversions occur strictly at the UI presentation boundary.
4. **Exclusive Null Island Anchoring:** The entire workstation anchors exclusively to Null Island `[0.0, 0.0, 0.0]`, delivering zero-distortion Cartesian-to-geodetic mappings across all CAD operations.

---  
*End of Master Architectural Specification.*