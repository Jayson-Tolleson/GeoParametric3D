# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM AUDIT REPORT
**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 6.1.0-CONSOLIDATED-MASTER  
**Status:** Authoritative Architectural Governing Standard  
**Classification:** Core CAD/CAM & Geospatial Engine Architecture  

---
reintroduce templates/index.html
## 1. Executive Summary & System Overview

GeoParametric3D represents a modern paradigm in web-native Computer-Aided Design (CAD), Computer-Aided Manufacturing (CAM), and Computer-Aided Engineering (CAE). It unifies exact boundary representation (B-Rep) topological solid modeling with the planetary geospatial viewport of Google Maps 3D Web Components (`<gmp-map-3d>`), accelerated client-side WebAssembly/Canvas rendering, and Google Cloud Vertex AI generative engineering intelligence (`broadcasterfishmap` / `global`).

The architectural mandate of GeoParametric3D is founded on a fundamental axiom:
> **SOURCE GEOMETRY IS NOT THE RENDER MESH.**  
> Triangles and tessellation vertices are derived presentation artifacts for rasterization. The authoritative CAD truth is preserved exclusively in exact analytical surfaces, curves, loops, faces, shells, and solids under linear millimeter canonical normalization.

This consolidated document specifies the comprehensive architectural foundation, mathematical formulations, subsystem contracts, operational workflows, and verification requirements governing the GeoParametric3D workstation.

---

## 2. Core Topological Architecture: 7-Level B-Rep Hierarchy

```
                                  GeoAssembly
                                 /           \
                       GeoInstance 1       GeoInstance 2 ... [4x4 Transforms]
                             |                   |
                          GeoPart 1           GeoPart 2
                             |                   |
                          GeoSolid            GeoSolid
                             |                   |
                          GeoShell            GeoShell
                             |
                +------------+------------+
                |                         |
             GeoFace 1                 GeoFace 2 ...
           /         \               /         \
   GeoSurface 1    GeoLoop (Outer) GeoSurface 2  GeoLoop (Outer)
         |                |              |              |
   [Plane/Cyl/..]      GeoEdge ...  [Plane/Cyl/..]   GeoEdge ...
                          |                             |
                      GeoCurve                      GeoCurve
                          |                             |
                      GeoVertex                     GeoVertex
```

### 2.1 Entity Invariants & Definitions

1. **`GeoAssembly`:** The root or intermediate hierarchical container holding part definitions, child sub-assemblies, and lightweight spatial instances.
2. **`GeoInstance`:** A zero-copy reference linking a single `GeoPart` definition to a rigid affine transformation matrix $\mathbf{T} \in \mathbb{SE}(3)$. Multiple instances share the exact underlying B-Rep without memory duplication.
3. **`GeoPart`:** The authoritative CAD part definition containing canonical lookup dictionaries for `vertices`, `curves`, `edges`, `loops`, `surfaces`, `faces`, `shells`, and `solids`.
4. **`GeoSolid`:** A watertight, 2-manifold closed 3D solid bounded by one outer `GeoShell` and zero or more internal void `GeoShell`s (representing hollow cavities or cutout pockets).
5. **`GeoShell`:** A continuous, orientable collection of connected `GeoFace` entities.
6. **`GeoFace`:** A 2D bounded parametric surface manifold defined by an underlying `GeoSurface`, exactly one outer perimeter `GeoLoop`, and zero or more inner hole `GeoLoop`s.
7. **`GeoLoop`:** An ordered, closed circuit of directed `GeoEdge` entities forming watertight 1D boundary perimeters.
8. **`GeoEdge`:** A topological segment bounded by start and end `GeoVertex` entities, parameterized along an underlying 3D `GeoCurve`.
9. **`GeoVertex`:** An exact 3D Cartesian point $\mathbf{p} = [x, y, z]^T \in \mathbb{R}^3$ defined strictly with finite coordinates in canonical internal units.

---

## 3. Authoritative Units & Coordinate Normalization

```
+-------------------------------------------------------------------------------------------------+
|                                    CAD IMPORT / INGESTION                                       |
|   STEP AP203/214/242, STL, FCStd, OBJ, 3MF, GLTF/GLB, PLY, DAE, VRML, XBF                     |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 1: FORMAT & UNIT INTELLIGENCE                                    |
|   - Inspect Header: SI_UNIT(.MILLI., .METRE.) -> 1.0                                           |
|   - Inspect Header: CONVERSION_BASED_UNIT('INCH', 25.4) -> 25.4                                 |
|   - Inspect Header: CONVERSION_BASED_UNIT('FOOT', 304.8) -> 304.8                               |
|   - Unitless Fallback: Explicit user configuration (default: mm)                                |
+-------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------+
|                           STEP 2: CANONICAL MILLIMETER NORMALIZATION                            |
|                           All internal geometry converted to Linear mm                          |
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

### 3.1 The Canonical Internal Unit Standard
To eliminate unit drift, floating-point catastrophic cancellation, and multi-body assembly misalignments:

$$\mathbf{U}_{\text{internal}} \equiv \text{Linear Millimeters (mm)}$$

### 3.2 Conversion Scale Factors

| Unit Key | Canonical Scale Factor ($S_{\text{to\_mm}}$) | Display Conversion ($S_{\text{from\_mm}}$) |
| :--- | :--- | :--- |
| `mm` | $1.0$ | $1.0$ |
| `cm` | $10.0$ | $0.1$ |
| `meter` / `m` | $1000.0$ | $0.001$ |
| `inch` / `in` | $25.4$ | $\frac{1}{25.4} \approx 0.0393700787$ |
| `foot` / `ft` | $304.8$ | $\frac{1}{304.8} \approx 0.0032808399$ |
| `yard` / `yd` | $914.4$ | $\frac{1}{914.4} \approx 0.0010936133$ |

### 3.3 Resolution of the 1" vs. 1' Import Scale Anomaly
1. **STEP Schema Multipliers:** STEP files containing `'INCH'` unit conversion entities scale by $25.4$ to reach canonical mm; 1-foot standard blocks ($304.8\text{ mm}$) match exact $12.0\text{ in}$ models.
2. **Out-of-Scale Adaptation Bounds:** Small parts ($< 0.15\text{ mm}$) and oversized civil models are adapted only when source unit tags are absent, preserving true dimensions for micro-machined and inch-denominated parts.
3. **Viewport Unit Decoupling:** Display units in the user interface (inches, feet, mm) are presentation transforms only and never mutate internal canonical arrays.

---

## 4. Coordinate Snapping (CSnap) & Bearing Edge Disambiguation

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

### 4.1 CSnap Distance & Normal Weighting Formulation
For an edge segment with projected screen endpoints $\mathbf{s}_1, \mathbf{s}_2 \in \mathbb{R}^2$ and pointer position $\mathbf{p} \in \mathbb{R}^2$, the perpendicular screen distance is:

$$d_{\text{2D}}(\mathbf{p}, \mathbf{s}_1, \mathbf{s}_2) = \| \mathbf{p} - (\mathbf{s}_1 + t^* (\mathbf{s}_2 - \mathbf{s}_1)) \|$$

$$t^* = \operatorname{clip}\left(\frac{(\mathbf{p} - \mathbf{s}_1) \cdot (\mathbf{s}_2 - \mathbf{s}_1)}{\|\mathbf{s}_2 - \mathbf{s}_1\|^2}, 0.0, 1.0\right)$$

To isolate the bearing edge on multi-face boundaries, candidate edges are weighted by face-normal orientation relative to the camera vector $\mathbf{v}_{\text{cam}}$:

$$w_{\text{edge}} = \frac{1}{\max(d_{\text{2D}}, 0.5)} \times \max(0.0, \mathbf{n}_{\text{face}} \cdot \mathbf{v}_{\text{cam}})$$

This guarantees clean, jitter-free edge selection without capturing internal tessellation diagonals or occluded rear boundaries.

---

## 5. Dual-Route Rendering & Native Google Maps 3D Integration

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

### 5.1 Native Component Dispatch
- **Planar Faces & Cutouts:** Routed to `<gmp-polygon-3d>` with outer boundary loops and inner hole coordinates.
- **CAD Curves & Boundary Edges:** Routed to `<gmp-polyline-3d>` for crisp engineering vector strokes.
- **Control Points & Snapping Vertices:** Routed to `<gmp-marker-3d>`.
- **Complex Assemblies & Non-Planar Shells:** Rendered via adaptive mesh buffers and `<gmp-model-3d>` / WebGL overlays.

---

## 6. Conversational Engineering Assistant Architecture

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

### 6.1 Vertex AI Integration Contract
- **Project ID:** `broadcasterfishmap`
- **Location:** `global`
- **Endpoint:** `https://aiplatform.googleapis.com/v1/projects/broadcasterfishmap/locations/global/publishers/google/models/gemini-1.5-flash:generateContent`
- **Context Grounding:** Every request injects full assembly state, body counts, material densities, bounding boxes, volume calculations, and selected sub-element metadata.

---

## 7. Verification & Production Test Matrix

| Subsystem / Test Target | Verification Test Suite | Governing Spec Section | Verification Metric | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Canonical Box B-Rep** | `test_canonical_box_brep_structure` | Sec. 1\u201310 | 8 Vertices, 12 Edges, 6 Loops, 6 Faces, 1 Shell, 1 Solid | **PASS** |
| **Transform Composition** | `test_transform_composition_and_instancing` | Sec. 11\u201320 | 100 instances share 1 part definition; matrix math valid | **PASS** |
| **Adaptive Tessellation** | `test_adaptive_tessellation_derived_mesh` | Sec. 21\u201330 | 12 triangles derived without mutating canonical part | **PASS** |
| **Unit Scale Precision** | `test_unit_conversion_integrity` | Sec. 31\u201340 | $1\text{ in} = 25.4\text{ mm}$, $1\text{ ft} = 304.8\text{ mm}$, round-trip error $< 10^{-6}$ | **PASS** |
| **STEP B-Rep Ingestion** | `test_step_topological_brep_hierarchy` | Sec. 41\u201350 | `MANIFOLD_SOLID_BREP` entity traversal and diagnostics PASS | **PASS** |
| **Mesh Compaction** | `test_vertex_and_triangle_integrity_pipeline`| Sec. 51\u201360 | Non-finite vertex culling, index remapping, degenerate face removal | **PASS** |
| **Scale Dimensionless Invariant**| `test_scale_dimensionless_invariant` | Sec. 61\u201370 | $\mathbf{P}_{\text{before}} \equiv \mathbf{P}_{\text{after}}$ under scale transformations | **PASS** |
| **FreeCAD FCStd Ingestion**| `test_fcstd_byte_container_inspection` | Sec. 71\u201380 | XML container unpack and topological feature recovery | **PASS** |
| **SDF Golden Equivalence** | `test_box_golden_equivalence` | Sec. 81\u201390 | $G(\mathbf{x}) = 0$ on boundary; exact volume $W \times D \times H$ | **PASS** |
| **Linear/Angular Deflection**| `parallel_process_step_solids` | Sec. 91\u2013100 | Dynamic deflection prevents polygon explosion on cylinders | **PASS** |

---

## 8. Architectural Invariants & Production Guidelines

1. **No Direct Render Mesh Mutations:** CAD edits must always modify parametric feature parameters or canonical B-Rep geometry, triggering clean re-tessellation.
2. **Canonical Millimeters Everywhere Internally:** Imperial/metric unit conversions take place strictly at user input and display boundaries.
3. **Bearing Edge Prioritization:** CSnap must always compute view-angle dot products to disambiguate shared boundary edges.
4. **Context-Grounded AI Engineering:** The engineering assistant must always receive live scene geometry telemetry to provide mathematically and physically grounded CAD guidance.

---  
*End of Consolidated Master Architectural Specification.*
