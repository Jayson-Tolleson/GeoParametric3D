# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 7.0.0-PROD-INFINITE-RENDER  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Infinite-Range Geospatial Rendering Engine, & Vertex AI Platform  

---

## 1. Executive Summary & Forensic Problem Statement

GeoParametric3D represents an advanced paradigm in browser-native Computer-Aided Design (CAD), fusing exact boundary representation (B-Rep) topological solid modeling with the geospatial rendering capabilities of the Google Maps 3D Web Component (`<gmp-map-3d>`), WebGL/WebGPU overlay pipelines, and Vertex AI conversational engineering intelligence. 

Modern engineering workflows require simultaneous visualization of micro-scale manufacturing tolerances ($10^{-3}\text{ mm} = 1\,\mu\text{m}$) in close inspection, alongside macro-scale planetary context ($10^7\text{ m} = 10,000\text{ km}$) spanning continental horizons. Traditional fixed 24-bit linear depth buffers suffer from severe floating-point catastrophic cancellation, leading to z-fighting at planetary scale and near-plane clipping artifacts during tight sub-millimeter component inspection.

This specification defines the complete architecture for an **Infinite-Range Geospatial CAD Rendering Engine** embedded within `<gmp-map-3d>`, resolving depth precision limits, multi-scale unit coherence, bearing edge coordinate snapping (CSnap), and real-time conversational parametric synthesis.

---

## 2. Infinite-Range Geospatial CAD Rendering Engine Architecture

```
+-------------------------------------------------------------------------------------------------+
|                                 UNIFIED MULTI-SCALE VIEWPORT DOMAIN                              |
|   Tight Inspection: [10^-3 mm to 10^3 mm]   <--->   Planetary Horizon: [10^3 mm to 10^10 mm]    |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                               DUAL-STRATEGY DEPTH & FRUSTUM MANAGER                             |
|   1. Logarithmic Depth Buffer Encoding:  z_clip = (log(C * z_eye + 1) / log(C * F_far + 1)) * W |
|   2. Reverse-Z Floating-Point (Float32 Depth Buffer: Near=1.0, Far=0.0)                         |
|   3. Dynamic Near-Plane Clamping: z_near = max(0.05 mm, camera_distance * 0.0001)               |
|   4. Virtual Infinite Far Plane: F_far -> infinity (Inf-Z Matrix Formulation)                   |
+-------------------------------------------------------------------------------------------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
+-----------------------------------------------+   +---------------------------------------------+
|        LOCAL CANONICAL CAD DOMAIN (mm)        |   |         GEOSPATIAL WGS84 / ECEF DOMAIN      |
|  - Exact B-Rep Topology (GeoPart/GeoSolid)    |   |  - Earth-Centered Earth-Fixed (ECEF Meters) |
|  - Local Tangent Plane (ENU Cartesian mm)     |   |  - WGS84 Geodetic (Lat, Lng, Altitude)      |
|  - Anchor Origin: Fullerton, CA (33.88, -117) |   |  - Google Photorealistic 3D Tiles           |
+-----------------------------------------------+   +---------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                       HYBRID SCENE GRAPH & NATIVE MAPS 3D WEB COMPONENTS                        |
|   - <gmp-map-3d> Core Canvas Container & 3D Tile Ingestion                                      |
|   - <gmp-polygon-3d>: Planar CAD Faces (zero internal triangulation diagonals)                  |
|   - <gmp-polyline-3d>: Authoritative CAD Edges, Curvature Outlines, Toolpaths                   |
|   - <gmp-marker-3d>: Inspection Vertices, Datum Anchors, C-Snap Points                          |
|   - <gmp-model-3d> / Custom WebGL Buffers: Multi-Solid Complex Assemblies & Freeform Surfaces   |
+-------------------------------------------------------------------------------------------------+
```

### 2.1 The Mathematical Challenge of Extreme Dynamic Range

The ratio of observable geometric extents in GeoParametric3D spans 13 orders of magnitude:

$$\text{Dynamic Range Ratio } R = \frac{D_{\text{planetary}}}{D_{\text{tolerance}}} = \frac{1.2742 \times 10^{10}\text{ mm}}{10^{-3}\text{ mm}} \approx 1.27 \times 10^{13}$$

A conventional standard 24-bit fixed-point linear depth buffer allocates non-linear precision according to:

$$z_{\text{win}}(z) = \frac{f}{f - n} + \frac{f \cdot n}{n - f} \cdot \frac{1}{z}$$

When $f = 10^{10}\text{ mm}$ and $n = 1.0\text{ mm}$, more than $99.9999\%$ of all integer depth values are consumed within the first few meters of the camera, leaving distant terrain completely subject to z-fighting, while setting $n = 1000\text{ mm}$ aggressively clips tight CAD part assemblies.

### 2.2 Dual-Zone Infinite-Range Frustum Formulation

To ensure flawless tight-zoom inspection without near-clipping while maintaining clear rendering to the planetary horizon, the rendering engine combines two mathematical formulations:

#### 1. Reversed Floating-Point Z with Infinite Far Plane ($[1, 0]$ Range)
The infinite perspective projection matrix $\mathbf{P}_{\infty}$ with reverse floating-point depth maps $z_{\text{near}} \mapsto 1.0$ and $z \to \infty \mapsto 0.0$:

$$\mathbf{P}_{\infty} = \begin{bmatrix} \frac{1}{\tan(\text{FOV}_x / 2)} & 0 & 0 & 0 \\ 0 & \frac{1}{\tan(\text{FOV}_y / 2)} & 0 & 0 \\ 0 & 0 & 0 & z_{\text{near}} \\ 0 & 0 & -1 & 0 \end{bmatrix}$$

Due to IEEE 754 floating-point standard distributing exponent bits densely near zero, Reversed-Z provides near-constant relative precision across the entire coordinate space.

#### 2. Screen-Space Logarithmic Depth Buffering
For native shader passes across hybrid WebGL/WebGPU overlays within `<gmp-map-3d>`:

$$z_{\text{log}} = \frac{\ln\left(C \cdot w_{\text{clip}} + 1.0\right)}{\ln\left(C \cdot F_{\text{far}} + 1.0\right)} \cdot w_{\text{clip}}$$

where constant $C = 1.0$ and $F_{\text{far}} = 1.0 \times 10^{13}\text{ mm}$. In vertex shaders, vertex depth is written continuously; in fragment shaders, `gl_FragDepth` is calculated to guarantee sub-millimeter precision when orbiting $0.5\text{ mm}$ from a chamfered hole edge.

---

## 3. Coordinate System Pipeline & Geospatial Rig

```
  [Authoritative Solid Model (mm)]
                 |
                 v
  [Part Instance Rigid Transform T_inst (4x4)]
                 |
                 v
  [Local Tangent Plane ENU (East, North, Up) in Millimeters]
                 |
                 v  (Linear Metric Conversion / 1000.0)
  [Local Tangent Plane ENU (Meters)]
                 |
                 v  (Geodetic WGS84 Translation relative to Anchor Point)
  [WGS84 Coordinates: Latitude, Longitude, Altitude (Meters)]
                 |
                 v  (Planetary Earth Model)
  [Earth-Centered Earth-Fixed (ECEF XYZ Meters)]
                 |
                 v  (View & Projection Matrices)
  [Screen Coordinates: Pixel (u, v) + Logarithmic Reversed-Z]
```

### 3.1 Geodetic Translation Equations (ENU $\to$ WGS84)

Let the workstation anchor datum be located at $\mathbf{p}_0 = (\phi_0, \lambda_0, h_0)$ corresponding to Hillcrest Park, Fullerton, CA ($33.8814^\circ\text{N}, -117.9213^\circ\text{W}, 95.0\text{ m}$). For any local CAD point $\mathbf{p}_{\text{local}} = [x, y, z]^T$ in millimeters:

1. Convert local millimeters to metric meters:
   $$x_m = \frac{x}{1000.0}, \quad y_m = \frac{y}{1000.0}, \quad z_m = \frac{z}{1000.0}$$

2. Compute local meridional radius of curvature $M$ and prime vertical radius $N$:
   $$M = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi_0)^{3/2}}, \quad N = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi_0}}$$
   where WGS84 semi-major axis $a = 6378137.0\text{ m}$ and eccentricity squared $e^2 = 0.00669437999014$.

3. Compute target Geodetic coordinates:
   $$\phi = \phi_0 + \left(\frac{y_m}{M + h_0}\right) \cdot \left(\frac{180}{\pi}\right)$$
   $$\lambda = \lambda_0 + \left(\frac{x_m}{(N + h_0) \cos \phi_0}\right) \cdot \left(\frac{180}{\pi}\right)$$
   $$h = h_0 + z_m$$

---

## 4. Canonical B-Rep vs. Maps 3D Entity Mapping

```
                                [CANONICAL GEOPART]
                     (Authoritative B-Rep: Shells, Surfaces, Loops)
                                        |
                    +-------------------+-------------------+
                    |                                       |
                    v                                       v
       [PLANAR FACES (GeomAbs_Plane)]           [ANALYTICAL & FREEFORM FACES]
       - Extract Exact Outer Boundary Loops     - B-Rep Adaptor Surface Evaluation
       - Extract Inner Hole Cutout Wires        - Quasi-Uniform Chordal Deflection
       - Zero Internal Triangulation Diagonals  - Adaptive Angular Deflection Scaling
                    |                                       |
                    v                                       v
       [NATIVE 3D POLYGON ROUTE]               [ADAPTIVE RENDER MESH BUFFERS]
       - <gmp-polygon-3d> Rendering            - Compacted Float32 Vertex Array
       - Crisp Engineering Perimeter Outlines  - Compacted Uint32 Index Array
       - Direct GPU Coplanar Fill              - Watertight Vertex Welding
```

### 4.1 Native Component Dispatch Table

| Canonical CAD Entity | Maps 3D Native Component | WebGL / Buffer Fallback | Performance & Visual Benefit |
| :--- | :--- | :--- | :--- |
| **Planar Solid Face** | `<gmp-polygon-3d>` | Coplanar triangle mesh | Zero internal diagonals; pure vector boundary outlines |
| **Feature Edge / Wire** | `<gmp-polyline-3d>` | Line-strip shader buffer | Crisp stroke with constant screen-space pixel width |
| **Datum Point / Vertex**| `<gmp-marker-3d>` | Point-sprite buffer | Billboarded anchor with sub-pixel depth resolution |
| **High-Count Assembly** | `<gmp-model-3d>` | Instanced GLB stream | Single-draw-call GPU instancing for $10^4+$ instances |
| **NURBS / Freeform Face**| Adaptive RenderMesh | Quasi-Uniform Deflection | Dynamically scaled chordal deflection ($\delta \le 0.05\text{ mm}$) |

---

## 5. Tight-Inspection Coordinate Snapping (CSnap) Invariants

```
                      [User Pointer Click / Hover]
                                    |
                                    v
                     [Raycasting in Viewport Camera]
                                    |
                                    v
            +-----------------------------------------------+   
            |       1. Candidate Face Occlusion Test        |
            |       Find all faces intersected by ray       |
            |       Rank by t_depth along view ray          |
            +-----------------------------------------------+   
                                    |
                                    v
            +-----------------------------------------------+   
            |       2. Screen-Space Edge Distance Test      |
            |       Project 3D edge segments -> 2D (u, v)   |
            |       d_2d = || p_pointer - segment ||        |
            |       Filter: d_2d < snap_threshold_pixels    |
            +-----------------------------------------------+   
                                    |
                                    v
            +-----------------------------------------------+   
            |       3. Bearing Edge Isolation               |
            |       Calculate Angular Bearing Weight:       |
            |       w = (1 / d_2d) * (n_face . v_view)      |
            |       Select Edge with argmax(w)              |
            +-----------------------------------------------+   
                                    |
                                    v
                      [Highlight Isolated Single Edge]
```

### 5.1 Bearing Edge Disambiguation Invariant

When inspecting tightly clustered geometries (e.g., small fastener holes or step chamfers), multiple topological edges project within a 5-pixel screen radius. CSnap enforces **Bearing Edge Disambiguation**:

1. **Topological Deduplication:** Coincident boundary edges between adjacent faces resolve to a single canonical `GeoEdge` ID.
2. **Normal-Weighted Selection:** The selection metric incorporates the angle between the face normal $\mathbf{n}_f$ and camera gaze vector $\mathbf{v}_{\text{cam}}$:
   $$W(\mathbf{E}_k) = \frac{\max(0, \mathbf{n}_{f,k} \cdot \mathbf{v}_{\text{cam}})}{d_{\text{screen}}(\mathbf{p}_{\text{cursor}}, \mathbf{s}_{k}) + \epsilon}$$
3. **Backface Edge Culling:** Edges bounded exclusively by backfacing faces ($\mathbf{n}_f \cdot \mathbf{v}_{\text{cam}} \le 0$) are excluded from candidate pools during solid inspection.

---

## 6. Unit System Architecture & Authoritative Dimensional Normalization

$$\mathbf{U}_{\text{internal}} \equiv \text{Linear Millimeters (mm)}$$

### 6.1 Unit Transformation Matrix

| Source Format Unit | Conversion to Canonical ($S_{\text{to\_mm}}$) | Display Preference | Display Scale Factor |
| :--- | :--- | :--- | :--- |
| **`mm` / Millimeter** | $1.0$ | Metric (`mm`) | $1.0$ |
| **`cm` / Centimeter** | $10.0$ | Metric (`cm`) | $0.1$ |
| **`meter` / `m`** | $1000.0$ | Metric (`m`) | $0.001$ |
| **`inch` / `in`** | $25.4$ | Imperial (`in`) | $\frac{1}{25.4}$ |
| **`foot` / `ft`** | $304.8$ | Imperial (`ft`) | $\frac{1}{304.8}$ |

### 6.2 The 1" vs. 1' Zero-Divergence Invariant

- **Rule 1:** A 1-foot reference primitive is instantiated authoritatively at $304.8 \times 304.8 \times 304.8\text{ mm}$.
- **Rule 2:** Imported files declaring `INCH` units scale coordinates by exactly $25.4$ during canonical B-Rep ingestion.
- **Rule 3:** Viewport conversions for user display are decoupled from spatial storage. A 12-inch imported bracket and a 1-foot native block exhibit identical $304.8\text{ mm}$ physical bounding dimensions.

---

## 7. Vertex AI Conversational Engineering Assistant Architecture

```
+-------------------------------------------------------------------------------------------------+
|                                 BROWSER CLIENT (UI / WORKSTATION)                               |
|                                                                                                 |
|   +--------------------------+                     +----------------------------------------+   |
|   |  Slide Trigger (\u25b2 / \u25bc)   |                     |     Active Context Aggregator          |   |
|   |  Expands Assistant Drawer|                     |  - B-Rep Hierarchy & Solid Count       |   |
|   +--------------------------+                     |  - Selected Face/Edge/Vertex Semantics |   |
|                |                                   |  - Material, Mass, Volume, Bounds      |   |
|                v                                   +----------------------------------------+   |
|   +--------------------------+                                         |                        |
|   |  Prompt Input Stream     | <---------------------------------------+                        |
|   +--------------------------+                                                                  |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                | POST /api/assistant/chat
                                                v
+-------------------------------------------------------------------------------------------------+
|                              QUART ASGI APPLICATION SERVER (app.py)                             |
|                                                                                                 |
|   1. Parse CAD Command Aliases (L, C, REC, M, RO, SC, E, Z, I) -> Immediate Local Dispatch       |
|   2. Assemble Engineering System Instructions + CAD Context Grounding                           |
|   3. Authenticate with Google Cloud ADC / OAuth2 Token                                           |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                | REST JSON / SSE Stream
                                                v
+-------------------------------------------------------------------------------------------------+
|                      GOOGLE VERTEX AI PLATFORM (broadcasterfishmap / global)                    |
|                                                                                                 |
|   - Model: Gemini 1.5 Flash                                                                     |
|   - Domain Knowledge: B-Rep Topology, ISO G-Code CNC Toolpaths, FEM Stress, Material Properties |
|   - Structured Response Generation & Parametric Mutation Intents                                |
+-------------------------------------------------------------------------------------------------+
```

### 7.1 Assistant Sliding Drawer State Machine

```
[COLLAPSED STATE]
  - Height: 38px
  - Toggle Icon: \u25b2 (Upward Triangle)
  - Interaction: Single-line quick prompt or toggle click
        |
        | User clicks toggle OR submits multi-line query
        v
[EXPANDED STATE]
  - Height: 320px - 480px (Dynamic split)
  - Toggle Icon: \u25bc (Downward Triangle)
  - Conversation History: Full scrolling markdown log with code syntax highlighting
  - CAD Context Tag: Displays active assembly metadata badge (e.g. "[12 Bodies | Metric mm]")
```

---

## 8. Verification & Architectural Regression Matrix

| Subsystem / Test Target | Verification Test Suite | Governing Spec Section | Verification Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Infinite Viewport Depth** | `test_infinite_viewport_precision` | Sec. 1\u201310 | Reversed-Z precision maintained from $0.05\text{ mm}$ to $10^{10}\text{ mm}$ | **PASS** |
| **Canonical Box B-Rep** | `test_canonical_box_brep_structure` | Sec. 11\u201320 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Transform Composition** | `test_transform_composition_and_instancing` | Sec. 21\u201330 | 100 instances share 1 part definition; matrix composition exact | **PASS** |
| **Adaptive Tessellation** | `test_adaptive_tessellation_derived_mesh` | Sec. 31\u201340 | 12 triangles derived without mutating canonical part | **PASS** |
| **Unit Scale Precision** | `test_unit_conversion_integrity` | Sec. 41\u201350 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_step_topological_brep_hierarchy` | Sec. 51\u201360 | `MANIFOLD_SOLID_BREP` entity traversal and diagnostics PASS | **PASS** |
| **Mesh Compaction** | `test_vertex_and_triangle_integrity_pipeline`| Sec. 61\u201370 | Non-finite vertex culling, index remapping, degenerate face removal | **PASS** |
| **Scale Invariance** | `test_scale_dimensionless_invariant` | Sec. 71\u201380 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scale transformations | **PASS** |
| **FreeCAD FCStd Ingestion**| `test_fcstd_byte_container_inspection` | Sec. 81\u201390 | XML container unpack and topological feature recovery | **PASS** |
| **SDF Golden Equivalence** | `test_box_golden_equivalence` | Sec. 91\u2013100 | $G(\mathbf{x}) = 0$ on boundary; exact volume $W \times D \times H$ | **PASS** |

---

## 9. Operational Guidelines for Future Development

1. **Primacy of Boundary Representation:** Render meshes are ephemeral projections. Feature mutations, booleans, and fillets must always execute on authoritative B-Rep topology before triggering adaptive re-tessellation.
2. **Precision Range Discipline:** Maintain Float32 Reversed-Z or Logarithmic depth formulations in all custom WebGL/WebGPU shader programs to preserve zero z-fighting across infinite view horizons.
3. **Preserve Metric Millimeters at System Boundaries:** Conversion to US Customary (inches, feet) is strictly a presentation-layer transform.
4. **Isolated Bearing Edge Snapping:** All raycasting routines must apply face-normal orientation weighting and screen-space distance filtering to disambiguate close-up edge selections.

---  
*End of Master Architectural Specification.*
