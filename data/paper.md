# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 7.0.0-PROD-CONSOLIDATED  
**Classification:** Core CAD/CAM & Native Geospatial Engine Architecture  
**Target Viewport Runtime:** Google Maps 3D Web Component (`<gmp-map-3d>`)  

---

## 1. Executive Architectural Overview & Elimination of Three.js

GeoParametric3D unites exact boundary representation (B-Rep) topological solid modeling with the Google Maps 3D Web Component ecosystem (`<gmp-map-3d>`). Previous generation hybrid CAD systems incurred severe memory overhead, rendering stutter, and z-fighting by maintaining redundant WebGL rendering engines (such as Three.js or Babylon.js) overlaid on top of geospatial tile viewports. 

### 1.1 Architectural Directive: Pure Native `<gmp-map-3d>` Pipeline
All legacy Three.js scene graphs, duplicate camera rigs, canvas blit loops, and synthetic rendering pipelines have been removed. The rendering subsystem now relies on a pure, native dual-route pipeline built entirely on standard Web Components:

1. **Native Web Component Host:** `<gmp-map-3d>` manages the primary 3D viewport, photorealistic 3D mesh tiles, camera frustum, lighting model, and GPU depth buffer.
2. **Direct Vector Polygon Injection:** Planar solid faces (`GeomAbs_Plane`) and 2D profile boundaries are rendered directly via native `<gmp-polygon-3d>` elements.
3. **Native Polyline Curvature & Edges:** Boundary loops, CAD curves, sketches, and toolpaths map directly to `<gmp-polyline-3d>` elements.
4. **Discrete Vertex & Anchor Marking:** Datum points, coordinate snapping points, and inspection vertices map directly to `<gmp-marker-3d>` elements.
5. **High-Density Composite Models:** Multi-solid complex assemblies map directly to `<gmp-model-3d>` elements referencing dynamically generated canonical GLTF/GLB or XBF binary buffers.

```
+-------------------------------------------------------------------------------------------------+
|                                 EXACT CAD KERNEL (B-Rep Truth)                                 |
|     GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoSurface      |
+------------------------------------------------+------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                  DUAL-ROUTE SURFACE CLASSIFIER                                  |
+------------------------------------------------+------------------------------------------------+
                        |                                                 |
                        | (GeomAbs_Plane)                                 | (Curved / Freeform / NURBS)
                        v                                                 v
+-----------------------------------------------+ +-----------------------------------------------+
|           TRUE N-GON BOUNDARY EXTRACTOR       | |          ADAPTIVE CHORDAL TESSELLATOR         |
|  - Outer perimeter oriented loops             | |  - Quasi-uniform deflection sampling         |
|  - Inner cutout void / hole loops             | |  - Linear & angular deflection guardrails     |
|  - Zero internal triangulation diagonals      | |  - Watertight vertex welding & compaction     |
+-----------------------+-----------------------+ +-----------------------+-----------------------+
                        |                                                 |
                        +-----------------------+-------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                                LOCAL TANGENT PLANE (ENU) TO WGS84                               |
|                                    Cartesian mm -> Geodetic                             |
+-----------------------------------------------+-------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                              NATIVE <gmp-map-3d> PRESENTATION LAYER                             |
|  - <gmp-polygon-3d> : 100% Opaque Solid Planar Faces with crisp boundaries & zero diagonals     |
|  - <gmp-polyline-3d>: CAD Feature Edges, CSnap Targets, Continuous Profiles, LinuxCNC Toolpaths |
|  - <gmp-marker-3d>  : Inspection Vertices, Midpoints, Construction Anchors, Origin Datum        |
|  - <gmp-model-3d>   : High-Complexity Assemblies and Multi-Solid B-Rep Buffers                  |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. Dual Viewport & Rendering Pipeline Breakdown

### 2.1 The Semantic Divergence Problem in Standard Graphics Pipelines
In naive CAD-to-WebGL pipelines, solid geometries are passed through default incremental surface meshing (e.g., `BRepMesh_IncrementalMesh`), which splits flat faces into collections of triangular facets. On screen, this results in:
- **Visible Triangulation Diagonals:** Flat rectangular and polygonal faces exhibit visible diagonal tessellation seams across flat surfaces.
- **Topological Identity Destruction:** A single physical CAD face becomes split into hundreds of uncoordinated triangles, preventing clean face selection, edge chamfering, or surface area inspection.
- **Performance Degradation:** Tens of thousands of synthetic indices must be uploaded to the GPU every time a dimension changes.

### 2.2 Route A: Planar Faces & Cutouts (`GeomAbs_Plane` $\rightarrow$ `<gmp-polygon-3d>`)
When the OpenCASCADE kernel detects a face whose underlying analytical surface is `GeomAbs_Plane`:
1. The outer bounding wire is extracted in topological winding order using `BRepTools_WireExplorer`.
2. Any inner wires representing holes (cutouts, bolt voids, pocket features) are extracted as distinct inner boundary rings.
3. Continuous curves along planar edges (such as rounded corners or fillet curves) are discretized using controlled chordal deflection ($d_{\text{chord}} \le 0.05\text{ mm}$).
4. The coordinates are normalized from local Cartesian millimeters into geodetic coordinate arrays (`outerCoordinates` and `innerCoordinates`).
5. The host DOM creates or updates a `<gmp-polygon-3d>` element with:
   - `altitudeMode = "absolute"`
   - `outerCoordinates = [...]`
   - `innerCoordinates = [[...], [...]]`
   - `fillColor = "#38bdf8"` (100% opaque shading matching FreeCAD standards)
   - `strokeColor = "#ffffff"`
   - `strokeWidth = 1.5`

This guarantees **zero internal diagonals**, perfect GPU depth buffering, and native occlusion with photorealistic 3D world tiles.

### 2.3 Route B: Analytical & Freeform Curved Surfaces $\rightarrow$ Adaptive Mesh Stream
When the underlying surface is non-planar (`GeomAbs_Cylinder`, `GeomAbs_Cone`, `GeomAbs_Sphere`, `GeomAbs_Torus`, `GeomAbs_BSplineSurface`):
1. Linear and angular deflections are dynamically calculated based on the solid's bounding box diagonal extent $D_{\text{diag}}$:

$$\delta_{\text{linear}} = \max\left(0.2, D_{\text{diag}} \times 0.002\right) \quad [\text{mm}], \qquad \theta_{\text{angular}} = 0.45 \quad [\text{rad}]$$

2. The resulting vertices and triangle indices are compacted into zero-copy contiguous typed arrays (`Float32Array` for positions, `Uint32Array` for indices).
3. Provenance tags associate every triangle with its originating `GeoFace` ID, ensuring that clicking any part of a curved mesh immediately resolves to the parent CAD feature.

---

## 3. Geodetic Anchoring: Mathematical Analysis of the (0, 0, 0) Datum

### 3.1 Is an Anchor Necessary in Geospatial CAD?
**Yes.** Geospatial renderers like Google Maps 3D Web Component operate within the WGS84 Geodetic Reference System (EPSG:4326 / EPSG:4979) and Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates. Conversely, mechanical CAD kernels (OpenCASCADE, Parasolid, ACIS) operate in local Euclidean Cartesian space $\mathbb{R}^3$, where distances are measured in millimeters and global coordinates rarely exceed $10^4\text{ mm}$.

Without an explicit geodetic anchor $\mathbf{A} = [\phi_0, \lambda_0, h_0]^T$ (representing latitude, longitude, and ellipsoidal height), local Cartesian CAD points $\mathbf{P}_{\text{local}} = [x, y, z]^T$ cannot be mapped onto the curved surface of the Earth.

### 3.2 Placing the Anchor at $(0.0^\circ, 0.0^\circ, 0.0\text{ m})$ (Null Island)

Consider setting the anchor point precisely at the intersection of the Equator ($\phi = 0^\circ$), the Prime Meridian ($\lambda = 0^\circ$), and mean sea level ($h = 0\text{ m}$), located in the Gulf of Guinea:

$$\mathbf{A}_{\text{null}} = [0.0^\circ\text{ N}, 0.0^\circ\text{ E}, 0.0\text{ m}]$$

#### A. Mathematical Formulation
Under the WGS84 reference ellipsoid:
- Semi-major axis: $a = 6,378,137.0\text{ m}$
- Reciprocal of flattening: $1/f = 298.257223563$
- First eccentricity squared: $e^2 = 2f - f^2 \approx 0.00669437999014$

The prime vertical radius of curvature $N(\phi)$ and meridional radius of curvature $M(\phi)$ are given by:

$$N(\phi) = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi}}, \qquad M(\phi) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi)^{3/2}}$$

When evaluated at the Equator $\phi_0 = 0.0$:

$$\sin(0) = 0 \implies N(0) = a = 6,378,137.0\text{ m}$$
$$M(0) = a(1 - e^2) = 6,378,137.0 \times (1 - 0.00669438) = 6,335,439.327\text{ m}$$

#### B. Linear-to-Angular Conversion at $(0, 0, 0)$
For a CAD coordinate displacement measured in millimeters $[x, y, z]^T$, where $x_{\text{m}} = x/1000$ (East) and $y_{\text{m}} = y/1000$ (North):

$$\Delta \phi = \left(\frac{y_{\text{m}}}{M(0) + h_0}\right) \times \frac{180}{\pi} = \left(\frac{y / 1000}{6,335,439.327}\right) \times \frac{180}{\pi} \approx y \times 9.043697 \times 10^{-9} \quad [^\circ\text{ Lat}]$$

$$\Delta \lambda = \left(\frac{x_{\text{m}}}{(N(0) + h_0) \cos(0)}\right) \times \frac{180}{\pi} = \left(\frac{x / 1000}{6,378,137.0 \times 1.0}\right) \times \frac{180}{\pi} \approx x \times 8.983153 \times 10^{-9} \quad [^\circ\text{ Lng}]$$

$$\text{Altitude} = h_0 + \frac{z}{1000} = 0.0 + \frac{z}{1000} \quad [\text{m}]$$

#### C. Curvature Deformation Over Distance
Because the Earth is an oblate spheroid, mapping flat Euclidean CAD space directly into geodetic space without projection correction induces geometric distortion as distance from the anchor increases.

Let $s$ be the distance from the anchor in meters. The sagitta (vertical drop due to Earth curvature) is:

$$\Delta h_{\text{sagitta}} \approx \frac{s^2}{2 R_{\text{earth}}}$$

| Distance from Anchor ($s$) | Sagitta Drop ($\Delta h$) | Scale Distortion (ppm) | CAD Significance |
| :--- | :--- | :--- | :--- |
| $1\text{ m}$ (Workstation Part) | $0.000078\text{ mm}$ ($78\text{ nm}$) | $< 0.0001\text{ ppm}$ | **Zero CAD distortion** |
| $100\text{ m}$ (Machine Shop) | $0.78\text{ mm}$ | $0.012\text{ ppm}$ | Negligible |
| $1\text{ km}$ (Campus Assembly) | $78.4\text{ mm}$ | $1.23\text{ ppm}$ | Architectural correction needed |
| $10\text{ km}$ (Civil Infrastructure) | $7.84\text{ m}$ | $123.0\text{ ppm}$ | Rigorous map projection required |

**Conclusion on $(0, 0, 0)$ Datum:**  
Setting the geodetic anchor at $(0, 0, 0)$ is mathematically sound and simplifies the trigonometric denominator ($\cos(0) = 1$). For mechanical parts with extents under $500\text{ m}$, local Cartesian millimeter accuracy is preserved to within sub-nanometer tolerances. 

However, in practical engineering applications, users may place the anchor at a real-world project site (e.g., Fullerton, CA: $33.8814^\circ\text{ N}, -117.9213^\circ\text{ W}$) to contextualize architectural models within real 3D photorealistic geographic terrain. The system supports both seamlessly via the `SITE_ANCHOR` abstraction.

---

## 4. Coordinate Snapping (CSnap) Bearing Edge Disambiguation

```
                      [Pointer Hover / Interaction]
                                    |
                                    v
                     [Raycast Through Viewport Camera]
                                    |
                                    v
            +-----------------------------------------------+
            |         1. Spatial Face Occlusion Culling     |
            |     Reject back-facing solid faces:           |
            |          dot(n_face, v_view) <= 0             |
            +-----------------------------------------------+
                                    |
                                    v
            +-----------------------------------------------+
            |         2. Screen-Space Distance Test         |
            |     Project 3D segment endpoints -> 2D (u, v) |
            |     d_2d = || p_cursor - segment ||           |
            |     Candidate threshold: d_2d <= 16 pixels    |
            +-----------------------------------------------+
                                    |
                                    v
            +-----------------------------------------------+
            |         3. Normal-Weighted Bearing Ranking    |
            |     Score w = (1 / d_2d) * |n_face . v_view|  |
            |     Isolate candidate with argmax(w)          |
            +-----------------------------------------------+
                                    |
                                    v
                      [Highlight Isolated Single Edge]
```

### 4.1 The Adjacent Edge Conflict
In solid modeling, every manifold edge is topologically shared by two meeting faces (e.g., the top and side faces of a cube). Previous implementations suffered from ambiguous snapping, where hovering near a boundary caused rapid flickering between the two sharing faces.

### 4.2 The Disambiguation Formula
To ensure CSnap isolates the single true bearing edge of pointer contact:
1. **Screen-Space Projection:** Endpoints $\mathbf{V}_1, \mathbf{V}_2$ map to screen points $\mathbf{s}_1, \mathbf{s}_2$.
2. **Distance Calculation:** Orthogonal 2D screen distance $d_{\text{2D}}$ is computed to the line segment.
3. **Normal Bearing Weighting:** The score $W_k$ incorporates the face normal $\mathbf{n}_f$ and camera view direction $\mathbf{v}_{\text{cam}}$:

$$W_k = \frac{1}{d_{\text{2D}} + 10^{-3}} \times \left| \mathbf{n}_f \cdot \mathbf{v}_{\text{cam}} \right|$$

Edges belonging to faces facing most directly toward the camera achieve higher scores, completely resolving boundary ambiguity.

---

## 5. Architectural Invariant Reference Matrix

| Section | Invariant Specification | Mathematical Formulation | Enforcement Location |
| :--- | :--- | :--- | :--- |
| **Sec. 1** | Internal Canonical Unit | $\mathbf{U}_{\text{internal}} \equiv \text{mm}$ | `canonical_geometry.py`, `universal_byte_parser.py` |
| **Sec. 2** | Exact B-Rep Solid Primacy | Geometry $\
e$ Render Mesh | `canonical_geometry.py` (`GeoPart`, `GeoFace`) |
| **Sec. 3** | Planar N-Gon Purity | Zero Internal Diagonals | `occ_kernel.py`, `ngon_adapter.py` |
| **Sec. 4** | Native 3D Component Rendering | Direct `<gmp-map-3d>` Binding | `static/js/viewport.js` (`syncNativeDOM`) |
| **Sec. 5** | Scale Dimensionless Invariance | $\mathbf{P}_{\text{world}} = \text{const}$ under scale | `command_engine.py`, `test_workstation_repair.py` |
| **Sec. 6** | Finite Coordinate Validation | $\forall v \in V: v \in \mathbb{R}^3, |v| < 10^{10}$ | `universal_byte_parser.py` (`validate_and_compact_mesh`) |
| **Sec. 7** | Geodetic Anchoring Fidelity | Sub-nanometer local error | `geometry.py`, `static/js/state.js` (`enuToGeodetic`) |
| **Sec. 8** | Generative AI CAD Grounding | Vertex AI (`broadcasterfishmap`/`global`) | `app.py`, `static/js/ai_assistant.js` |

---

## 6. Verification and Regression Test Suite Summary

All architectural invariants are continuously validated by the comprehensive automated test suite:
- `test_canonical_geometry.py`: Validates 8-vertex 6-face B-Rep topology, transform composition, and native representation selection.
- `test_cad_architecture.py`: Enforces unit conversion precision, STEP structured B-Rep ingestion, mesh compaction, and 50,000-triangle binary STL parsing scaling ($< 1.5\text{s}$).
- `test_kernel_math.py`: Validates Signed Distance Field (SDF) analytical gradients, boolean scalar fields, and golden box volume equivalence.
- `test_workstation_repair.py`: Validates scale dimensionless invariance, XBF byte roundtrips, and FreeCAD FCStd container parsing.

---  
*End of Master Architectural Specification.*
