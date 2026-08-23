# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 6.1.0-PROD-AUDIT  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM, Spatial Geometry & Vertex AI Architecture  

---

## 1. Executive Summary & Root Cause Investigation

GeoParametric3D is a browser-native Computer-Aided Design (CAD) workstation engineered upon authoritative Boundary Representation (B-Rep) solid modeling, high-precision scalar field mathematics, adaptive GPU tessellation, geospatial projection on Google Maps 3D (`<gmp-map-3d>`), and Google Cloud Vertex AI generative engineering intelligence (`broadcasterfishmap` / `global`).

Recent integration tests and user workspace evaluations highlighted three critical architectural domains requiring exhaustive mathematical and topological consolidation:

1. **Units Architecture & 1" vs 1' Import Discrepancy:**
   - *Symptom:* Native CAD primitives instantiate predictably as 1-foot reference blocks ($304.8\text{ mm} = 12.0\text{ in}$). However, imported geometries (STEP, STL, FCStd, OBJ, 3MF, DXF) frequently display scale distortions where a part modeled in inches appears at $1/12$ scale relative to the 1-foot reference block or collapses under duplicate conversion factors ($25.4$ vs. $304.8\text{ mm}$).
   - *Root Cause:* Conflation between three distinct layers: (a) Source File Units (e.g., STEP SI vs Conversion-based units), (b) Canonical Internal Units (immutable linear millimeters `mm`), and (c) Viewport Presentation Preferences (Imperial `in`/`ft` vs. Metric `mm`/`m`). Furthermore, heuristic bounding box normalization was triggering aggressive scale alterations on genuine inch-denominated parts.

2. **Coordinate Snapping (CSnap) Bearing Edge Misallocation:**
   - *Symptom:* In CSnap mode, cursor raycasting fails to isolate the primary bearing edge directly contacted by the user pointer, erratically selecting adjacent edges, background edges, or all edges of a face simultaneously.
   - *Root Cause:* Viewport raycasting calculated 2D Euclidean distance without taking into account: (a) camera view-ray depth sorting ($t_{\text{depth}}$), (b) face-normal visibility and occlusion culling, and (c) topological winged-edge deduplication across adjacent coplanar and non-coplanar face boundaries.

3. **Conversational Engineering Assistant Drawer & Event Lifecycle:**
   - *Symptom:* The upward-sliding triangle button for the Engineering Assistant drawer failed to smoothly trigger conversational workflows and maintain bidirectional state sync with active CAD telemetry.
   - *Root Cause:* Decoupled DOM state classes between the drawer container and viewport layout, missing event bubbling inhibitors, and insufficient grounding payload formatting for Google Cloud Vertex AI endpoint communication.

---

## 2. Unit System Architecture & Authoritative Invariants

```
+-------------------------------------------------------------------------------------------------+
|                                    CAD IMPORT / CREATION LAYER                                  |
|   STEP (AP203/214/242) / STL / FCStd / OBJ / 3MF / Primitives (1' = 12" = 304.8 mm)              |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 1: SOURCE UNIT PARSING & DETECTION                               |
|   - Inspect Header Tokens:                                                                      |
|       SI_UNIT(.MILLI., .METRE.)            -> Scale = 1.0 (Source: mm)                          |
|       SI_UNIT($, .METRE.)                   -> Scale = 1000.0 (Source: meter)                   |
|       CONVERSION_BASED_UNIT('INCH', 25.4)   -> Scale = 25.4 (Source: inch)                      |
|       CONVERSION_BASED_UNIT('FOOT', 304.8)  -> Scale = 304.8 (Source: foot)                     |
|   - Unitless Fallback (STL/OBJ): User preference override (Default: mm)                         |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 2: CANONICAL NORMALIZATION (IMMUTABLE)                           |
|                      Authoritative Linear Internal Standard: Linear Millimeters                 |
|                                    X_canonical = X_source * Scale_to_mm                         |
+-------------------------------------------------------------------------------------------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
+-----------------------------------------------+   +---------------------------------------------+
|         GEOSPATIAL PROJECTION ENGINE          |   |          VIEWPORT PRESENTATION LAYER        |
|  - Local Tangent Plane (ENU Cartesian mm)     |   |  - Preference: US / Imperial (in, ft, yd)   |
|  - Geodetic WGS84 (Lat, Lng, Altitude)        |   |  - Preference: Metric (mm, cm, m)           |
|  - Anchor: Fullerton, CA (33.8814, -117.9213) |   |  - Presentation = X_canonical / Disp_Factor |
|  - Altitude Offset: 95.0 m MSL                |   |  - Dynamic Input & Inspector Conversion     |
+-----------------------------------------------+   +---------------------------------------------+
```

### 2.1 Canonical Internal Standard Invariant

To ensure mathematical consistency across OpenCASCADE kernels, implicit scalar fields, CNC toolpath generators, and finite-element analysis, the entire backend enforces the Canonical Internal Standard:

$$\mathbf{U}_{\text{internal}} \equiv \text{Linear Millimeters (mm)}$$

No vertex coordinates, transformation offsets, or boundary representations may be stored internally in inches, feet, or meters. All unit conversion occurs strictly at the system boundaries:
1. **Ingestion Boundary:** Multiplies source unit dimensions by $S_{\text{to\_mm}}$ to store pure millimeters.
2. **Presentation Boundary:** Divides canonical millimeters by $S_{\text{display}}$ to display human-readable values in the UI.

### 2.2 Scale Conversion Constants

$$\begin{aligned}
1\text{ inch (in)} &= 25.4\text{ mm} \\
1\text{ foot (ft)} &= 12\text{ in} = 304.8\text{ mm} \\
1\text{ yard (yd)} &= 36\text{ in} = 914.4\text{ mm} \\
1\text{ centimeter (cm)} &= 10.0\text{ mm} \\
1\text{ meter (m)} &= 1000.0\text{ mm}
\end{aligned}$$

For volumetric and mass properties, scaling factors exponentiate consistently:

$$\begin{aligned}
V_{\text{canonical}}(\text{mm}^3) &= V_{\text{source}} \cdot (S_{\text{to\_mm}})^3 \\
\text{Mass}(\text{grams}) &= V_{\text{canonical}}(\text{cm}^3) \times \rho\left(\frac{\text{g}}{\text{cm}^3}\right) = \frac{V_{\text{canonical}}(\text{mm}^3)}{1000.0} \times \rho
\end{aligned}$$

### 2.3 Detailed Diagnosis of the 1" vs 1' Import Anomaly

#### The Mechanical Failure Mechanism
1. **Standard Reference Part:** The native primitive generator instantiates a 1-foot box with parameters $W=304.8, D=304.8, H=304.8\text{ mm}$. When the UI is switched to Imperial mode, the inspector displays `12.0 in` by dividing $304.8$ by $25.4$.
2. **External Model Ingestion:** An external CAD file designed in inches with a nominal width of $12.0\text{ in}$ was ingested.
   - In STEP files declaring `SI_UNIT($, .METRE.)` without the `CONVERSION_BASED_UNIT` parameter, coordinates were parsed as unitless numbers ($12.0$) and treated as millimeters ($12.0\text{ mm}$ instead of $304.8\text{ mm}$). This caused the part to appear at $\frac{1}{25.4}$ of its intended scale.
   - In STL files (which possess no unit metadata headers), an input geometry of $12.0\text{ units}$ was assumed to be $12.0\text{ mm}$. Compared to the 1-foot ($304.8\text{ mm}$) datum block, it appeared to be $1\text{ inch}$ ($25.4\text{ mm}$) or smaller, creating the optical illusion that $1\text{ in} \equiv 1\text{ ft}$.
3. **Heuristic Sanity Override:** Previous versions implemented an automatic bounding box resizing heuristic that magnified any mesh with diagonal $< 0.15$ by $1000\times$. When small inch-mode precision components (e.g., $0.1\text{ in} = 2.54\text{ mm}$) were ingested, false heuristic triggering inflated the models by $1000\times$, compounding scale confusion.

#### The Resolution Mandate
- **Explicit Unit Metadata Tagging:** Every imported body stores `original_unit` and `scale_to_canonical` in its metadata manifest.
- **Universal Ingestion Pipeline:** STL and unitless formats prompt or default to the user's active viewport setting while strictly converting to linear millimeters internally.
- **Removal of Ambiguous Heuristics:** Heuristic auto-scaling is superseded by explicit bounding-box diagnostics reported directly to the user.

---

## 3. Coordinate Snapping (CSnap) & Bearing Edge Selection Invariants

```
                      [User Pointer Click / Move Event (u_ptr, v_ptr)]
                                            |
                                            v
                            [Camera View-Ray Projection]
                                            |
                                            v
            +---------------------------------------------------------------+
            | 1. RAY-FACE INTERSECTION & DEPTH-BUFFER SORTING               |
            | - Cast ray R(t) = O_cam + t * D_ray                           |
            | - Compute intersection t_hit for all candidate B-Rep faces    |
            | - Discard occluded back-faces (n_face . D_ray >= 0)           |
            +---------------------------------------------------------------+
                                            |
                                            v
            +---------------------------------------------------------------+
            | 2. 2D SCREEN-SPACE DISTANCE FILTER                            |
            | - Project 3D edge endpoints -> screen coords (s_start, s_end) |
            | - Calculate shortest Euclidean distance d_screen to segment   |
            | - Threshold: d_screen <= R_snap (default: 12 pixels)          |
            +---------------------------------------------------------------+
                                            |
                                            v
            +---------------------------------------------------------------+
            | 3. BEARING EDGE ISOLATION & DISAMBIGUATION                    |
            | - Score candidate edges by composite weight W_edge:           |
            |     W_edge = (1.0 / (d_screen + epsilon))                     |
            |              * (1.0 / (t_depth + 1.0))                        |
            |              * max(0.0, -n_face . D_ray)                      |
            | - Select edge with maximum W_edge                             |
            +---------------------------------------------------------------+
                                            |
                                            v
                     [Isolate & Highlight Single Bearing Edge]
```

### 3.1 Mathematical Formulation of Screen-Space Edge Projection

Let a candidate 3D CAD edge $\mathbf{E}_i$ be defined by vertices $\mathbf{V}_1, \mathbf{V}_2 \in \mathbb{R}^3$. Under viewport transformation $\mathbf{M} = \mathbf{P} \cdot \mathbf{V}$, the 3D coordinates map to Normalized Device Coordinates (NDC) and subsequently to screen pixels $\mathbf{s}_1, \mathbf{s}_2 \in \mathbb{R}^2$:

$$\mathbf{p}_{\text{ndc}} = \frac{\mathbf{M} \cdot [x, y, z, 1]^T}{w}, \quad \mathbf{s} = \left[ \frac{w_{\text{screen}}}{2}(p_x + 1), \frac{h_{\text{screen}}}{2}(1 - p_y) \right]$$

For a pointer cursor coordinate $\mathbf{p}_{\text{ptr}} = [u, v]^T$, the projection parameter $t^*$ on the 2D segment is:

$$t^* = \operatorname{clamp}\left( \frac{(\mathbf{p}_{\text{ptr}} - \mathbf{s}_1) \cdot (\mathbf{s}_2 - \mathbf{s}_1)}{\|\mathbf{s}_2 - \mathbf{s}_1\|^2}, 0.0, 1.0 \right)$$

The shortest screen-space distance is:

$$d_{\text{screen}} = \| \mathbf{p}_{\text{ptr}} - (\mathbf{s}_1 + t^*(\mathbf{s}_2 - \mathbf{s}_1)) \|$$

### 3.2 Root Causes of Bearing Edge Misallocation

1. **Lack of Depth Sorting:** When clicking an edge on a foreground face, edges belonging to the rear face aligned closely in 2D screen space. Without depth culling, the backend frequently returned the rear edge or an arbitrary edge in the topological array.
2. **Tessellation Diagonal Bleed:** In imported or non-B-Rep triangulations, internal triangulation diagonals were treated as candidate snapping edges, resulting in the cursor snapping to internal triangle hypotenuses across flat planar faces.
3. **Multi-Face Boundary Collision:** In manifold solids, each boundary edge is shared between two adjacent faces $\mathbf{F}_A$ and $\mathbf{F}_B$. Iterating over face lists caused the edge to be evaluated twice with conflicting face-normal weights.

### 3.3 The Bearing Edge Selection Invariants

- **Invariant CSNAP-1 (Topological Singularity):** Candidate snapping pools must derive from unique topological edge entities (`GeoEdge` / `TopoDS_Edge`), never raw triangle wireframe buffers.
- **Invariant CSNAP-2 (Occlusion Culling):** Edges belonging strictly to faces whose surface normal points away from the camera ($\mathbf{n}_f \cdot \mathbf{D}_{\text{ray}} \ge 0$) are rejected from hit-testing.
- **Invariant CSNAP-3 (Bearing Weight Maximization):** When multiple edges lie within the snapping radius $R_{\text{snap}}$, the edge that maximizes the composite score $W_{\text{edge}}$ (prioritizing proximity to cursor, front-most depth, and direct surface orientation) is selected exclusively.

---

## 4. Engineering Assistant Architecture & Slide Drawer Lifecycle

```
+-------------------------------------------------------------------------------------------------+
|                                 BROWSER CLIENT (UI / WORKSTATION)                               |
|                                                                                                 |
|   +--------------------------+                     +----------------------------------------+   |
|   | Slide Drawer Trigger (\u25b2/\u25bc)|                     | Active CAD Context Collector           |   |
|   | Expands Assistant UI     |                     | - Assembly & Part Hierarchy            |   |
|   +--------------------------+                     | - Selected Face / Edge / Vertex Data   |   |
|                |                                   | - Volume, Mass, Material, Bounding Box |   |
|                v                                   +----------------------------------------+   |
|   +--------------------------+                                         |                        |
|   | User Chat Prompt Input   | <---------------------------------------+                        |
|   +--------------------------+                                                                  |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                | POST /api/assistant/chat
                                                v
+-------------------------------------------------------------------------------------------------+
|                              QUART ASGI APPLICATION SERVER (app.py)                             |
|                                                                                                 |
|   1. Fast CAD Alias Interceptor (l, c, rec, pl, a, el, m, ro, sc, e, z, i)                      |
|   2. System Instruction Grounding with B-Rep Invariants & Geospatial Reference                 |
|   3. Google Cloud ADC / OAuth2 Token Retrieval                                                  |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                | REST JSON / SSE Stream
                                                v
+-------------------------------------------------------------------------------------------------+
|                     GOOGLE CLOUD VERTEX AI (broadcasterfishmap / global)                       |
|                                                                                                 |
|   - Model Endpoint: gemini-1.5-flash                                                            |
|   - Grounded Spatial Reasoning: B-Rep topology, ISO G-code, CNC tooling, materials              |
|   - Structured Action Intent Generation (JSON command triggers)                                 |
+-------------------------------------------------------------------------------------------------+
```

### 4.1 Drawer State Machine

```
+-------------------------------------------------------------------------+
|                           COLLAPSED STATE                               |
| - Height: 38px                                                          |
| - Toggle Glyph: \u25b2 (Upward Triangle)                                     |
| - Viewport Impact: Zero occlusion of main Canvas/<gmp-map-3d> viewport  |
| - Ready for quick keyboard shortcut or activator click                   |
+-------------------------------------------------------------------------+
                                    |
                  User clicks \u25b2 OR submits chat query
                                    v
+-------------------------------------------------------------------------+
|                            EXPANDED STATE                               |
| - Height: 360px - 480px (CSS responsive)                                |
| - Toggle Glyph: \u25bc (Downward Triangle)                                   |
| - Active Conversation Scroll Stream with Markdown & G-Code rendering    |
| - Live CAD Telemetry Indicator: "[1 Part | Steel | Metric mm]"         |
+-------------------------------------------------------------------------+
```

### 4.2 Vertex AI Engineering Prompts & Context Ingestion

Every payload dispatched to the Vertex AI endpoint includes structured CAD telemetry:

```json
{
  "contents": [{
    "parts": [{
      "text": "System: You are the dedicated Engineering Assistant for GeoParametric3D (Project: broadcasterfishmap, Location: global)...\
\
Active Context: 1 bodies, canonical unit: mm; Base Solid (ID: obj_box_1, Material: Steel, Faces: 6, Volume: 28316.85 cm³)\
\
User Query: Calculate principal stresses and generate LinuxCNC pocketing routine."
    }]
  }]
}
```

---

## 5. Dual-Route B-Rep vs Derived Mesh Representation Pipeline

```
                                [CANONICAL GEOPART]
                      (Authoritative Mathematical B-Rep Body)
                                        |
                    +-------------------+-------------------+
                    |                                       |
                    v                                       v
       [PLANAR FACES (GeomAbs_Plane)]           [CURVED / ANALYTICAL FACES]
       - Extract Exact Outer Boundary Loops     - B-Rep Surface Adaptor Evaluation
       - Extract Inner Hole Cutout Wires        - Quasi-Uniform Chordal Deflection
       - Zero Internal Triangulation Diagonals  - Adaptive Angular Deflection Limits
                    |                                       |
                    v                                       v
       [NATIVE 3D POLYGON ROUTE]               [ADAPTIVE RENDER MESH BUFFERS]
       - <gmp-polygon-3d> Rendering            - Compacted Float32 Vertices
       - Zero Visual Faceting                  - Compacted Uint32 Indices
       - Direct GPU Coplanar Fill              - Watertight Shared Vertex Welding
```

### 5.1 The Seven-Level Topological Hierarchy

1. **`GeoAssembly`:** Hierarchical root holding component parts, transforms $\mathbf{T} \in \mathbb{SE}(3)$, and lightweight instances.
2. **`GeoInstance`:** Memory-efficient reference linking a unique transform matrix to a canonical part definition without data duplication.
3. **`GeoPart`:** Standalone manifold part container maintaining authoritative topological dictionaries.
4. **`GeoSolid`:** Closed, orientable 3-manifold bounded by an outer shell and optional internal void shells.
5. **`GeoShell`:** 2-manifold orientation of connected `GeoFace` entities.
6. **`GeoFace`:** 2D parametric surface patch bounded by exactly one outer `GeoLoop` and zero or more inner cutout `GeoLoop`s.
7. **`GeoLoop` / `GeoEdge` / `GeoVertex`:** Boundary loops composed of directed edges referencing underlying curves and finite 3D coordinates.

---

## 6. Verification Test Matrix & Production Gates

| Verification Target | Test Suite Identifier | Governing Specification | Success Criteria | Production Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_box_brep_structure` | Sec. 1\u201310 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Transform & Instancing** | `test_transform_composition_and_instancing` | Sec. 11\u201320 | 100 instances share 1 part definition; matrix compose valid | **PASS** |
| **Adaptive Tessellation** | `test_adaptive_tessellation_derived_mesh` | Sec. 21\u201330 | 12 triangles derived without mutating canonical part | **PASS** |
| **Unit Conversion Invariant**| `test_unit_conversion_integrity` | Sec. 31\u201340 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_step_topological_brep_hierarchy` | Sec. 41\u201350 | `MANIFOLD_SOLID_BREP` entity traversal and diagnostics PASS | **PASS** |
| **Mesh Compaction** | `test_vertex_and_triangle_integrity_pipeline`| Sec. 51\u201360 | Non-finite vertex culling, index remapping, degenerate face removal | **PASS** |
| **Scale Invariance** | `test_scale_dimensionless_invariant` | Sec. 61\u201370 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scale transformations | **PASS** |
| **FreeCAD Container** | `test_fcstd_byte_container_inspection` | Sec. 71\u201380 | XML container unpack and topological feature recovery | **PASS** |
| **SDF Golden Equivalence** | `test_box_golden_equivalence` | Sec. 81\u201390 | $G(\mathbf{x}) = 0$ on boundary; exact volume $W \times D \times H$ | **PASS** |
| **Curvature Deflection** | `parallel_process_step_solids` | Sec. 91\u2013100 | Dynamic deflection prevents polygon explosion on cylinders | **PASS** |

---

## 7. Operational Guidelines for Future Development

1. **Primacy of Canonical Geometry:** Under no circumstances should render meshes be manipulated directly to execute CAD operations. All parametric edits must modify the canonical B-Rep graph and re-derive render representations adaptively.
2. **Strict Millimeter Internal Standard:** All file importers must immediately convert dimensional data to linear millimeters upon parsing. Imperial units exist solely in the presentation layer.
3. **Bearing Edge Snapping Disambiguation:** Snapping logic must always compute view-ray depth sorting and normal orientation to ensure that only the front-most, directly visible bearing edge is highlighted.
4. **Vertex AI Grounding Context:** All requests to the Engineering Assistant must inject full assembly metrics (body count, volumes, materials, bounding extents) to ground generative reasoning.

---
*End of Master Architectural Specification.*
