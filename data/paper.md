# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 9.0.0-PROD-CONSOLIDATED  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM Kernel, Native Google Maps 3D Viewport & True N-Gon Opaque Rendering Engine  

---

## 1. Executive Summary & Forensic System Architecture

GeoParametric3D is an engineering-grade Computer-Aided Design and Computer-Aided Manufacturing (CAD/CAM) solid modeling workstation operating natively within modern web execution environments. The platform addresses fundamental flaws in traditional browser CAD engines by establishing strict architectural boundaries between:
1. **Authoritative Boundary Representation (B-Rep) Solid Modeling Truth:** Exact mathematical surfaces (planes, cylinders, cones, spheres, tori, B-splines), topological boundary loops, oriented edges, and 3D vertices managed by OpenCASCADE (OCCT / OCP) on the backend and WebAssembly (WASM) modules on the client.
2. **Direct Hardware-Accelerated Geospatial Viewport (`<gmp-map-3d>`):** Complete elimination of intermediate 3D graphics libraries (Three.js, Babylon.js) in favor of direct, native Web Components (`<gmp-polygon-3d>`, `<gmp-polyline-3d>`, `<gmp-marker-3d>`) rendering directly into the Google Maps 3D photorealistic Earth ecosystem.
3. **True Opaque N-Gon Boundary Visualization:** Planar CAD faces are extracted as clean, non-triangulated N-gon perimeter wires and inner cutout loops, rendered with **100% solid opacity (no transparency)**, eliminating distracting internal triangulation diagonals and visual artifacts.
4. **Canonical Geodetic Tangent Anchor:** Anchored exclusively at Null Island geodetic origin (`[0.0, 0.0, 0.0]`), guaranteeing mathematical isometry, zero longitudinal convergence distortion, and strict millimetric CAD coordinate preservation.
5. **Domain-Specific AI Engineering Assistant:** Integrated with Google Cloud Vertex AI (Project: `broadcasterfishmap`, Location: `global`), providing topological reasoning, B-Rep feature tree automation, and CAM/G-code generation.

---

## 2. Complete Elimination of Three.js & Adoption of Native `<gmp-map-3d>`

### 2.1 Architectural Rationale
Legacy web CAD applications construct a secondary scene graph using Three.js or WebGL frameworks. In a geospatial CAD workstation, this dual-engine approach creates critical failure points:
- **Dual Memory Redundancy:** Vertices and triangle indices are replicated across the CAD kernel heap, JavaScript memory, Three.js scene graphs, and GPU buffer caches.
- **Depth Buffer Z-Fighting:** Overlaying a software or WebGL canvas over photorealistic 3D map tiles prevents shared hardware Z-buffering, resulting in severe visual clipping over multi-kilometer viewing ranges.
- **Triangulation Diagonals on Planar Slabs:** Traditional tessellators force planar surfaces into triangle meshes. When rendered with wireframe or edge visualizers, internal diagonals clutter mechanical inspection.

### 2.2 Native Viewport Architecture
All Three.js abstractions are removed. The 3D viewport is driven exclusively by native Web Components:
- **`<gmp-map-3d>`:** Global Earth camera controller, photorealistic terrain, atmospheric lighting, and continuous Level-of-Detail (LOD) streaming.
- **`<gmp-polygon-3d>`:** Direct GPU-accelerated rendering of planar N-gon faces with explicit outer perimeter loops and inner cutout holes. Faces are rendered fully opaque with crisp surface materials.
- **`<gmp-polyline-3d>`:** Direct rendering of construction lines, CAD curve boundaries, toolpaths, and dimension callouts.
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
|   |    <gmp-polygon-3d> (Planar N-Gon) |      |     <gmp-polyline-3d> (Curves & Outlines)     |   |
|   |    - 100% Opaque Solid Shading     |      |     - coordinates: LatLngAlt[]                |   |
|   |    - outerCoordinates: LatLngAlt[] |      |     - strokeColor / strokeWidth               |   |
|   |    - innerCoordinates: LatLngAlt[][]|     |     - altitudeMode: 'absolute'                |   |
|   |    - Zero Internal Diagonals       |      |     - Crisp Boundary Definition               |   |
|   +------------------------------------+      +-----------------------------------------------+   |
|                                                                                                   |
|   +------------------------------------+      +-----------------------------------------------+   |
|   |    <gmp-marker-3d> (Datums)        |      |     Interactive HUD Overlay (CSnap & Selection)|  |
|   |    - position: {lat, lng, alt}     |      |     - Screen-space Selection Marquee          |   |
|   |    - altitudeMode: 'absolute'      |      |     - Bearing Edge Snap Highlight Gizmos      |   |
|   +------------------------------------+      +-----------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Dual-Route B-Rep Rendering Pipeline & True Opaque N-Gon Extraction

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
| - 100% Opaque Solid Shading                   |   | - 100% Opaque Solid Shading                   |   
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
|  - 100% Opaque Solid Fill (Alpha = 1.0)       |   |  - Crisp Solid Shading (Alpha = 1.0)          |   
|  - Unbroken Face Provenance UUIDs             |   |  - Precise Face Provenance UUIDs              |   
+-----------------------------------------------+   +-----------------------------------------------+   
```

### 3.1 Route A: Planar Faces (`GeomAbs_Plane`)
1. **Analytical Surface Identification:** Every `TopoDS_Face` is inspected using `BRepAdaptor_Surface.GetType()`. Faces classified as `GeomAbs_Plane` bypass triangulation meshers completely.
2. **Topological Wire Traversal:** `BRepTools_WireExplorer` traverses the face boundary wires in oriented sequence, capturing the primary outer boundary loop and all internal cutout loops (e.g., bolt holes, pockets).
3. **Curvilinear Edge Discretization:** Straight edges preserve their exact 2-point endpoints; curved edges (arcs, splines) are sampled under chordal deflection tolerances (`GCPnts_QuasiUniformDeflection`).
4. **100% Opaque Solid Presentation:** Polygons are rendered with solid opacity (`fillColor: rgba(r, g, b, 1.0)` or hex) without transparency, matching industry CAD standards (FreeCAD, SolidWorks).

### 3.2 Route B: Curved & Freeform Analytical Surfaces
1. **Adaptive Deflection Calculation:** For non-planar surfaces (cylinders, spheres, cones, NURBS), linear deflection $\delta_{\text{linear}}$ and angular deflection $\theta_{\text{angular}}$ are calculated dynamically from the bounding diagonal extent $D_{\text{diag}}$:
   $$\delta_{\text{linear}} = \max\left(0.2, D_{\text{diag}} \times 0.002\right) \quad [\text{mm}], \quad \theta_{\text{angular}} = 0.45 \quad [\text{rad}]$$
2. **Numerical Compaction & Healing:** `validate_and_compact_mesh` eliminates non-finite coordinates, removes degenerate zero-area facets, and remaps vertex indices.
3. **Watertight Facet Projection:** Triangles are mapped into geodetic coordinate sets with 100% opaque solid shading, preserving color metadata extracted from STEP product definition contexts.

---

## 4. Geodetic Tangent Datum: Null Island `[0.0, 0.0, 0.0]`

### 4.1 Geodetic Anchoring Principle
Local CAD modeling takes place in flat Euclidean space $\mathbb{R}^3$ measured in linear millimeters (mm). The Google Maps 3D runtime operates in the ellipsoidal WGS-84 reference frame. A geodetic anchor $\mathbf{A} = (\phi_0, \lambda_0, h_0)$ transforms local Cartesian coordinates to the Earth's surface.

### 4.2 Standard Anchor: Null Island `[0.0, 0.0, 0.0]`
GeoParametric3D standardizes on **Null Island** (Latitude $\phi_0 = 0.0^\circ$, Longitude $\lambda_0 = 0.0^\circ$, Altitude $h_0 = 0.0\text{ m}$) as the master origin datum:
1. **Zero Longitudinal Convergence:** At the equator ($\phi_0 = 0.0^\circ$), $\cos(\phi_0) = 1.0$. Longitudinal meridians are parallel, eliminating latitude-dependent shearing.
2. **Isotropic Metric Scale:** Millimeter displacements along local $X$ (East) and $Y$ (North) maintain orthogonal metric symmetry across all scales.
3. **Condition Number Minimization:** Forward and inverse Jacobian matrices achieve optimal numerical stability, preventing rounding drift during transformation roundtrips.

### 4.3 Mathematical Transformation Formulation
For local CAD point $\mathbf{P} = [x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}]^T$ and rotation angle $\theta_z$:

$$\begin{bmatrix} x' \\ y' \\ z' \end{bmatrix} = \begin{bmatrix} \cos\theta_z & -\sin\theta_z & 0 \\ \sin\theta_z & \cos\theta_z & 0 \\ 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} x_{\text{mm}} \times 10^{-3} \\ y_{\text{mm}} \times 10^{-3} \\ z_{\text{mm}} \times 10^{-3} \end{bmatrix}$$

$$\phi = \phi_0 + \left(\frac{y'}{M(\phi_0) + h_0}\right) \times \left(\frac{180}{\pi}\right)$$
$$\lambda = \lambda_0 + \left(\frac{x'}{(N(\phi_0) + h_0) \cos(\phi_0)}\right) \times \left(\frac{180}{\pi}\right)$$
$$h = h_0 + z'$$

Where ellipsoidal radii of curvature are defined as:
$$N(\phi) = \frac{a}{\sqrt{1 - e^2 \sin^2(\phi)}}, \quad M(\phi) = \frac{a(1 - e^2)}{\left(1 - e^2 \sin^2(\phi)\right)^{3/2}}$$
Using WGS-84 parameters $a = 6,378,137.0\text{ m}$ and $e^2 \approx 0.00669437999014$.

---

## 5. Universal Byte Import Normalizer & Format Support

The universal ingestion engine (`universal_byte_parser.py`) processes all standard CAD exchange and mesh formats through automated signature detection and linear scale factor resolution:

```
FOREIGN BYTES (Binary / Text)
     |
     v
[FORMAT DETECTION & MAGIC INSPECTION]
     |-- STEP (AP203 / AP214 / AP242) -> Native OCCT B-Rep TopoDS_Shape Transfer
     |-- FreeCAD (.FCStd)             -> Zip Container / Document.xml & B-Rep Recovery
     |-- STL (Binary & ASCII)         -> Vectorized C-Level Decoding & Manifold Vertex Welding
     |-- Wavefront OBJ                -> Polyhedron Reconstruction & Planar Dissolving
     |-- 3MF (3D Manufacturing)       -> Model XML Ingestion & Material Mapping
     |-- GLTF / GLB                   -> Direct Binary Accessor Extraction & Meter-to-mm Normalization
     |-- Stanford PLY / DAE / WRL     -> Structured Mesh Extraction & Scale Adaptation
     |-- XBF (Native Binary Format)   -> Zero-Copy Binary B-Rep Payload Unpacking
```

### 5.1 Authoritative Single-Conversion Unit Policy
- **Canonical Internal Linear Unit:** Linear millimeter (`mm`).
- **Unit Detection:** Automatic inspection of STEP headers (`SI_UNIT(.MILLI., .METRE.)`, `CONVERSION_BASED_UNIT('INCH', ...)`), GLTF/DAE meter units, and STL unitless bounds.
- **Presentation Boundary Isolation:** Imperial (`in`, `ft`) and metric conversions occur strictly at the UI display layer; internal state remains mathematically immutable in canonical millimeters.

---

## 6. Coordinate Snapping (CSnap) Bearing Edge Engine

CSnap provides precise object snapping without ray-casting ambiguity:
1. **Screen-Space Proximity:** Evaluates cursor distance to projected 2D edges ($d_{\text{2D}} \le 16\text{ px}$).
2. **View Normal Weighting:** Back-facing edges are culled via surface normal dot product with view direction ($\mathbf{N} \cdot \mathbf{V} > 0.05$).
3. **Bearing Edge Optimization:** The candidate edge with maximum weighting metric $W = (1 / d_{\text{2D}}) \times (|\mathbf{N} \cdot \mathbf{V}| + 0.1)$ is selected.
4. **Dynamic Visual Gizmos:** Highlights midpoints (square) and vertices (circle) with high-contrast styling.

---

## 7. AI Engineering Assistant Integration

- **Vertex AI Gateway:** Directly communicates with Google Cloud Vertex AI REST endpoints under Project `broadcasterfishmap` and Location `global`.
- **CAD Context Awareness:** Automatically serializes active assembly structure, B-Rep solid volume, mass properties, and selected face/edge/vertex metadata into the engineering prompt context.
- **Executable Command Intent:** Translates natural language engineering requests into executable CadQuery scripts, parametric feature mutations, or G-code toolpaths.

---

## 8. Verification & Architectural Compliance Matrix

| Verification Target | Test Suite | Standard Section | Metric / Acceptance Criteria | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_geometry.py` | Sec. 1\u201310 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Unit Conversion Invariance** | `test_cad_architecture.py` | Sec. 11\u201320 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_cad_architecture.py` | Sec. 21\u201330 | `MANIFOLD_SOLID_BREP` entity hierarchy and finite coordinates | **PASS** |
| **Mesh Compaction & Culling** | `test_cad_architecture.py` | Sec. 31\u201340 | Removal of NaNs, Infs, degenerate triangles, index remapping | **PASS** |
| **Scale Dimensionless Invariance** | `test_workstation_repair.py` | Sec. 41\u201350 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scaling mutations | **PASS** |
| **SDF Golden Equivalence** | `test_kernel_math.py` | Sec. 51\u201360 | $G(\mathbf{x}) = 0$ on boundary, volume $W \times D \times H$ exact | **PASS** |
| **True N-Gon Opaque Rendering** | Viewport Pipeline | Sec. 61\u201370 | 100% Opaque Solid Shading, zero triangulation diagonals | **PASS** |

---

## 9. Conclusion

GeoParametric3D establishes a unified solid modeling architecture where exact mathematical B-Rep topology remains authoritative, planar surfaces render as clean 100% opaque N-gon polygons without meshing diagonals, and all viewport rendering routes directly through native Google Maps 3D Web Components without intermediate WebGL libraries.

---  
*End of Master Architectural Specification.*
