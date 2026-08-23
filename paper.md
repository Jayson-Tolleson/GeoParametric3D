# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 6.0.0-PROD-AUDIT  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM & Geospatial Engine Architecture  

---

## 1. Executive Summary & Forensic Problem Statement

GeoParametric3D represents an advanced paradigm in browser-native Computer-Aided Design (CAD), fusing exact boundary representation (B-Rep) topological solid modeling with the geospatial rendering engine of the Google Maps 3D Web Component (`<gmp-map-3d>`) and Vertex AI conversational engineering intelligence. 

Recent integration audits and forensic user interaction analyses identified three critical architectural challenges across the subsystem boundaries:

1. **Unit Inconsistency & Import Dimensional Discrepancy (1" vs. 1' Anomaly):**
   - *Observation:* Native primitive creation operates reliably on a 1-foot (12-inch / 304.8 mm) canonical datum. However, imported CAD models (STEP, STL, FCStd, OBJ, 3MF) frequently display scale distortions where a part modeled in inches (e.g., 12.0 inches) appears at $1/12$ scale relative to the 1-foot reference block or exhibits a 25.4-to-304.8 scale mismatch.
   - *Root Cause:* Inconsistent handling between source file units, canonical internal units (linear millimeters `mm`), and active viewport preference display units (`in` vs `mm`), compounded by heuristic bounding-box adaptation that misinterprets inch-denominated parts as sub-millimeter geometry.

2. **Coordinate Snapping (CSnap) Bearing Edge Misallocation:**
   - *Observation:* When interacting with edges under CSnap mode, cursor raycasting fails to isolate the primary bearing edge directly under the pointer contact normal, erroneously highlighting or capturing adjacent or coincident topological edges across multi-face boundaries.
   - *Root Cause:* Screen-space projection ambiguity in the nearest-segment selection algorithm, lack of sub-element ray-depth sorting, and missing face-normal occlusion culling in edge-hit candidate filtering.

3. **Conversational Engineering Assistant Drawer & Interaction Lifecycle:**
   - *Observation:* The upward slide triangle activator for the conversational assistant panel required robust state synchronization between drawer DOM expand/collapse transitions, active CAD state context injection, and Google Cloud Vertex AI endpoint communication (`broadcasterfishmap` / `global`).
   - *Root Cause:* CSS transition detachment on slide drawer elements and uncoordinated action-intent event pipelines between user prompt triggers and the Quart command server.

This paper consolidates the complete architectural specification, diagnostic analysis, and mathematical formulations required to enforce total fidelity across all subsystems.

---

## 2. Unit System Architecture & Authoritative Dimensional Normalization

```
+-------------------------------------------------------------------------------------------------+
|                                    CAD IMPORT / CREATION                                        |
|   STEP / STL / FCStd / OBJ / 3MF / DXF                  Parametric Primitives (1' = 304.8mm)    |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 1: SOURCE UNIT PARSING & DETECTION                              |
|   - Inspect Header: SI_UNIT(.MILLI., .METRE.) -> 1.0                                           |
|   - Inspect Header: CONVERSION_BASED_UNIT('INCH', 25.4) -> 25.4                                 |
|   - Unitless Fallback: User configurable source assumption (default: mm)                        |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 2: CANONICAL NORMALIZATION (IMMUTABLE)                           |
|                           All spatial coordinates converted to Linear mm                        |
|                                    X_can = X_src * Scale_to_mm                                  |
+-------------------------------------------------------------------------------------------------+
                                                |
                        +-----------------------+-----------------------+
                        |                                               |
                        v                                               v
+-----------------------------------------------+   +---------------------------------------------+
|         GEOSPATIAL PROJECTION PIPELINE        |   |           VIEWPORT PRESENTATION LAYER       |
|  - Local Tangent Plane (ENU Cartesian mm)     |   |  - User Preference: US / Imperial (in, ft)  |
|  - Geodetic WGS84 (Lat, Lng, Altitude)        |   |  - User Preference: Metric (mm, cm, m)      |
|  - Anchor: Fullerton, CA (33.8814, -117.9213) |   |  - Display = X_can / Unit_Display_Scale     |
+-----------------------------------------------+   +---------------------------------------------+
```

### 2.1 The Canonical Internal Unit Invariant
To eliminate unit drift and catastrophic multi-body scale divergence, GeoParametric3D establishes a non-negotiable architectural invariant:

$$\mathbf{U}_{\text{internal}} \equiv \text{Linear Millimeters (mm)}$$

Every vertex coordinate $\mathbf{p} = [x, y, z]^T$, curve parameterization $\mathbf{C}(t)$, surface boundary loop $\mathbf{L}(u, v)$, and transformation matrix $\mathbf{T} \in \mathbb{SE}(3)$ is stored authoritatively in millimeters.

### 2.2 Scale Conversion Factors

| Unit Key | Formal Unit Name | Canonical Scale Factor ($S_{\text{to\_mm}}$) | Reverse Display Scale ($S_{\text{from\_mm}}$) |
| :--- | :--- | :--- | :--- |
| `mm` | Millimeter | $1.0$ | $1.0$ |
| `cm` | Centimeter | $10.0$ | $0.1$ |
| `meter` / `m` | Meter | $1000.0$ | $0.001$ |
| `inch` / `in` | International Inch | $25.4$ | $\frac{1}{25.4} \approx 0.0393700787$ |
| `foot` / `ft` | International Foot (12 in) | $304.8$ | $\frac{1}{304.8} \approx 0.0032808399$ |
| `yard` / `yd` | Yard (36 in) | $914.4$ | $\frac{1}{914.4} \approx 0.0010936133$ |

### 2.3 Diagnosis of the 1" vs. 1' Import Anomaly

#### The Symptom
An engineer creates a standard 1-foot reference block ($304.8 \times 304.8 \times 304.8\text{ mm}$). When importing an external STEP or STL part defined in inches (e.g., a bracket with nominal size 12.0 inches), the imported part frequently appeared at either:
1. $12\text{ mm}$ (a $1/25.4$ scale error when the unit was assumed to be unitless mm),
2. $25.4\text{ mm}$ (a 1-inch box when a 1-foot box was intended), or
3. $304.8\text{ mm}$ physically, but when displayed under an Imperial viewport toggle, was erroneously converted twice ($304.8 / 25.4 / 12$).

#### The Resolution
1. **STEP Schema Inspection:** The parser extracts ISO 10303-21 header tokens (`SI_UNIT` and `CONVERSION_BASED_UNIT`). If `'INCH'` is parsed, the linear multiplier $25.4$ is applied once during canonical ingestion.
2. **Heuristic Sanity Guardrails:** The automatic out-of-scale adapter `adapt_out_of_scale_geometry` was recalibrated. Previously, bounding diameters below $0.15$ triggered an automatic $1000\times$ meter-to-mm scaling. When an inch model of small components (e.g., $0.1\text{ in} = 2.54\text{ mm}$) was loaded, false triggering caused radical scale corruption. The threshold is now strictly guarded by unit metadata.
3. **Viewport Conversion Decoupling:** The UI layer converts from canonical mm to display units dynamically in labels, input fields, and rulers, while geometry sent to WebGL/Canvas shaders and `<gmp-map-3d>` remains in canonical coordinates.

---

## 3. Coordinate Snapping (CSnap) Engine & Bearing Edge Selection Invariants

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

### 3.1 Mathematical Formulation of CSnap

Let a 3D CAD edge $\mathbf{E}_k$ be defined by its boundary endpoints $\mathbf{V}_1, \mathbf{V}_2 \in \mathbb{R}^3$. Under viewport camera projection matrix $\mathbf{M}_{\text{proj}} \mathbf{M}_{\text{view}}$, the endpoints map to screen coordinates $\mathbf{s}_1, \mathbf{s}_2 \in \mathbb{R}^2$.

For a pointer cursor coordinate $\mathbf{p} = [u, v]^T$, the shortest Euclidean screen-space distance to the edge segment is:

$$\mathbf{d}(\mathbf{p}, \mathbf{s}_1, \mathbf{s}_2) = \| \mathbf{p} - (\mathbf{s}_1 + t^* (\mathbf{s}_2 - \mathbf{s}_1)) \|$$

where the clamped parameter $t^*$ is:

$$t^* = \operatorname{clip}\left(\frac{(\mathbf{p} - \mathbf{s}_1) \cdot (\mathbf{s}_2 - \mathbf{s}_1)}{\|\mathbf{s}_2 - \mathbf{s}_1\|^2}, 0.0, 1.0\right)$$

### 3.2 Root Cause of Multi-Edge and Adjacent Edge Misallocation

Prior implementations exhibited two defects during edge selection:
1. **Shared Topological Edge Doubling:** In a closed solid B-Rep, an edge is shared between two adjacent faces $\mathbf{F}_A$ and $\mathbf{F}_B$. When hovering near the boundary, both faces registered separate edge hits, resulting in visual stuttering and dual selection.
2. **Coplanar Triangle Internal Diagonal Leakage:** Tessellated meshes without topological edge boundary graphs exposed internal triangulation diagonals as candidate edges, allowing the cursor to snap to synthetic rendering artifacts rather than physical CAD perimeters.

### 3.3 The Bearing Edge Disambiguation Protocol

To ensure CSnap isolates the exact physical edge of pointer contact:
1. **Topological Winged-Edge Deduping:** Edges are identified by authoritative unique IDs (`e_1`, `e_2`, ...). Coincident topological half-edges are resolved to a single canonical `GeoEdge` reference.
2. **View-Angle Weighting:** When two edges have similar 2D screen distance $d_{\text{2D}} < \epsilon_{\text{snap}}$, the edge whose adjacent face has a normal $\mathbf{n}_f$ most directly facing the camera (maximizing $\mathbf{n}_f \cdot \mathbf{v}_{\text{cam}}$) is given priority.
3. **Occlusion Rejection:** Any edge belonging entirely to back-facing faces ($\mathbf{n}_f \cdot \mathbf{v}_{\text{cam}} \le 0$) is culled from snapping candidate lists unless wireframe mode is explicitly engaged.

---

## 4. Engineering Assistant Architecture & Sliding Panel Lifecycle

```
+-------------------------------------------------------------------------------------------------+
|                                 BROWSER CLIENT (UI / WORKSTATION)                               |
|                                                                                                 |
|   +--------------------------+                     +----------------------------------------+   |
|   |  Slide Trigger (▲ / ▼)   |                     |     Active Context Aggregator          |   |
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

### 4.1 Sliding Drawer State Machine

The Engineering Assistant sliding drawer at the bottom of the workstation viewport implements a deterministic two-state lifecycle:

```
[COLLAPSED STATE]
  - Height: 38px
  - Toggle Icon: ▲ (Upward Triangle)
  - Background: Semi-transparent backdrop-blur
  - Interaction: Single-line quick prompt or toggle click
        |
        | User clicks toggle OR enters multi-line query
        v
[EXPANDED STATE]
  - Height: 320px - 480px (Dynamic split)
  - Toggle Icon: ▼ (Downward Triangle)
  - Conversation History: Full scrolling markdown log with code syntax highlighting
  - CAD Context Tag: Displays active assembly metadata badge (e.g. "[12 Bodies | Metric mm]")
```

### 4.2 Conversational Reasoning & System Instruction Invariants

The Assistant backend is grounded with the following authoritative domain rules:
- **B-Rep Primacy:** The assistant treats exact B-Rep geometry as truth and explains features in terms of faces, loops, surfaces, and solids rather than render meshes.
- **Geospatial Awareness:** Recognizes local site coordinate frames anchored at Fullerton, CA ($33.8814^\circ\text{N}, -117.9213^\circ\text{W}$) with ENU-to-WGS84 transformations.
- **Action Intent Emitting:** When a user requests geometric operations (e.g., *"fillet the top edge by 5mm"* or *"export Python CadQuery script"*), the assistant emits actionable JSON command intents alongside explanatory engineering prose.

---

## 5. Canonical B-Rep vs. Derived Render Mesh Dual-Route Pipeline

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

### 5.1 The Seven-Level Topological Hierarchy

GeoParametric3D strictly maintains topological closure through seven explicit entity levels:

1. **`GeoAssembly`:** Multi-part hierarchical container with transformation tree $\{\mathbf{T}_i\}$ and lightweight instances.
2. **`GeoInstance`:** Reference to a `GeoPart` definition coupled with an individual $4\times 4$ rigid transform matrix.
3. **`GeoPart`:** Standalone geometric part containing canonical dictionaries of topological primitives.
4. **`GeoSolid`:** Manifold 3D closed volume defined by an outer bounding shell and zero or more internal void shells.
5. **`GeoShell`:** Connected 2-manifold orientation of `GeoFace` entities.
6. **`GeoFace`:** 2D surface patch bounded by exactly one outer `GeoLoop` and optional inner cutout `GeoLoop`s.
7. **`GeoLoop` / `GeoEdge` / `GeoVertex`:** 1D boundary wire composed of oriented edges backed by mathematical curves and finite 3D points.

---

## 6. Comprehensive Verification Matrix

| Subsystem / Test Target | Verification Test Suite | Governing Spec Section | Verification Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_box_brep_structure` | Sec. 1–10 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Transform Composition** | `test_transform_composition_and_instancing` | Sec. 11–20 | 100 instances share 1 part definition; matrix multiplication valid | **PASS** |
| **Adaptive Tessellation** | `test_adaptive_tessellation_derived_mesh` | Sec. 21–30 | 12 triangles derived without mutating canonical part | **PASS** |
| **Unit Scale Precision** | `test_unit_conversion_integrity` | Sec. 31–40 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_step_topological_brep_hierarchy` | Sec. 41–50 | `MANIFOLD_SOLID_BREP` entity traversal and diagnostics PASS | **PASS** |
| **Mesh Compaction** | `test_vertex_and_triangle_integrity_pipeline`| Sec. 51–60 | Non-finite vertex culling, index remapping, degenerate face removal | **PASS** |
| **Scale Dimensionless Invariant**| `test_scale_dimensionless_invariant` | Sec. 61–70 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scale transformations | **PASS** |
| **FreeCAD FCStd Ingestion**| `test_fcstd_byte_container_inspection` | Sec. 71–80 | XML container unpack and topological feature recovery | **PASS** |
| **SDF Golden Equivalence** | `test_box_golden_equivalence` | Sec. 81–90 | $G(\mathbf{x}) = 0$ on boundary; exact volume $W \times D \times H$ | **PASS** |
| **Linear/Angular Deflection**| `parallel_process_step_solids` | Sec. 91–100 | Dynamic deflection prevents polygon explosion on cylinders | **PASS** |

---

## 7. Operational Guidelines for Future Development

1. **No Direct Mesh Editing as CAD Source:** Never modify render mesh vertices directly to represent CAD feature edits. Always mutate the canonical B-Rep parameters or feature graph, then trigger adaptive re-tessellation.
2. **Preserve Metric Millimeters at all Internal Boundaries:** Conversion to imperial units (inches, feet) must occur exclusively at the presentation/UI perimeter.
3. **Isolate Bearing Edges with Normal Weighting:** Ensure all mouse-picking and snapping routines incorporate depth sorting and face-normal orientation weighting to prevent ambiguous edge captures.
4. **Maintain Vertex AI Telemetry Grounding:** Every request to the Engineering Assistant must transmit the active document's summary metrics to maintain contextually grounded generative guidance.

---  
*End of Master Architectural Summary Specification.*
