# MASTER ARCHITECTURAL SPECIFICATION & SYSTEM DESIGN REPORT

**System Name:** GeoParametric3D (CascadeCAD High-Precision Workstation)
**Document Version:** 6.0.0 (Consolidated Master Technical Paper)
**Author:** Principal CAD Systems Architect & Computational Geometry Governor
**Target Platforms:** Google Maps 3D Web Component (`<gmp-map-3d>`), WebGL/WebGPU Hardware Pipeline, OpenCASCADE (OCCT/OCP) Kernel, Vertex AI Assistant Engine

---

## Table of Contents
1. [Executive Summary & Core Architectural Tenets](#1-executive-summary--core-architectural-tenets)
2. [Mathematical & Canonical Geometry Foundations](#2-mathematical--canonical-geometry-foundations)
3. [Coordinate Systems, Dynamic Geodetic Anchoring & Infinite CAD Space](#3-coordinate-systems-dynamic-geodetic-anchoring--infinite-cad-space)
4. [Units Detection, Ingestion, and Multiscale Pipeline](#4-units-detection-ingestion-and-multiscale-pipeline)
5. [B-Rep Authority vs. Derived Render Mesh Separation](#5-b-rep-authority-vs-derived-render-mesh-separation)
6. [OpenCASCADE Dual-Route Extraction & Planar N-Gon Topology](#6-opencascade-dual-route-extraction--planar-n-gon-topology)
7. [Hybrid Rendering Pipeline: `<gmp-map-3d>` & WebGL Overlay](#7-hybrid-rendering-pipeline-gmp-map-3d--webgl-overlay)
8. [Camera Frustum, Dynamic Framing, and Infinite 1'x1' Ground Grid](#8-camera-frustum-dynamic-framing-and-infinite-1x1-ground-grid)
9. [Vertex AI Assistant & REST API Integration](#9-vertex-ai-assistant--rest-api-integration)
10. [Verification, Telemetry, and Diagnostics](#10-verification-telemetry-and-diagnostics)

---

## 1. Executive Summary & Core Architectural Tenets

GeoParametric3D is a cloud-native, browser-executable parametric CAD workstation engineered for high-precision mechanical, architectural, and civil engineering modeling. The workstation bridges exact Boundary Representation (B-Rep) topological solids with geospatial visualization engines—specifically Google Maps 3D Web Components (`<gmp-map-3d>`) augmented by a synchronized WebGL/Canvas hardware overlay.

### Primary Directives & Invariants
1. **Exact B-Rep Geometric Truth:** The source CAD geometry (`GeoPart`, `GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`) is the immutable mathematical truth. Triangulated meshes are ephemeral derived views.
2. **Arbitrary Scale Operational Domain:** The system seamlessly spans scales from sub-millimeter precision parts (5 mm screws, micro-fluidics) to civil structures (2,000 ft skyscrapers and infrastructure corridors) without visual clipping, floating-point jitter, or coordinate collapse.
3. **Decoupled Geospatial & Cartesian Space:** The internal modeling kernel operates in pure, canonical metric millimeters ($mm$) at Cartesian origin $(0, 0, 0)$. Dynamic projection maps Cartesian ENU (East-North-Up) offsets to Earth-Centered Earth-Fixed (ECEF) / WGS84 coordinates on demand, removing hardcoded regional site anchors.
4. **Dual-Route Planar Extraction:** Planar faces (`GeomAbs_Plane`) are preserved as pristine N-Gon perimeter and hole loops, eliminating diagonal triangulation artifacts. Non-planar surfaces are discretized under adaptive chordal and angular deflection controls.
5. **High-Efficiency Memory Contract:** Zero-copy binary serialization and typed arrays (`Float32Array`, `Uint32Array`) ensure 60 FPS viewport throughput and instant memory compaction.

---

## 2. Mathematical & Canonical Geometry Foundations

### 2.1 B-Rep Topological Hierarchy
Every solid in GeoParametric3D adheres to standard Euler-Poincaré topological characteristics:
$$\mathcal{V} - \mathcal{E} + \mathcal{F} = 2(\mathcal{S} - \mathcal{G}) + \mathcal{H}$$
where $\mathcal{V}$ is vertices, $\mathcal{E}$ is edges, $\mathcal{F}$ is faces, $\mathcal{S}$ is shells, $\mathcal{G}$ is genus (through-holes), and $\mathcal{H}$ is internal void cavities.

```
GeoAssembly (Hierarchical Scene Graph / Lightweight Transforms)
  └── GeoInstance (4x4 Affine Matrix M, Material, Visibility)
        └── GeoPart (Topological Container, Canonical Unit = mm)
              └── GeoSolid (Closed Manifold Domain)
                    └── GeoShell (Oriented Face Manifold)
                          └── GeoFace (Parametric Surface Manifold)
                                ├── Outer GeoLoop (Winding Order CCW)
                                │     └── [GeoEdge -> GeoCurve]
                                └── Inner GeoLoops (Winding Order CW - Holes)
                                      └── [GeoEdge -> GeoCurve]
```

### 2.2 Analytical Surface & Curve Mathematics
- **Planar Face:**
  $$\mathbf{P}(u, v) = \mathbf{P}_0 + u \mathbf{D}_u + v \mathbf{D}_v, \quad \mathbf{N} = \frac{\mathbf{D}_u \times \mathbf{D}_v}{\|\mathbf{D}_u \times \mathbf{D}_v\|}$$
- **Cylindrical Surface:**
  $$\mathbf{P}(u, v) = \mathbf{P}_0 + R (\cos(2\pi u) \mathbf{X} + \sin(2\pi u) \mathbf{Y}) + v \mathbf{Z}$$
- **Signed Distance Field (SDF) Formulation for Solid Validation:**
  $$\Phi_{\text{Box}}(\mathbf{p}) = \|\max(|\mathbf{p} - \mathbf{c}| - \mathbf{h}, \mathbf{0})\| + \min(\max(|\mathbf{p} - \mathbf{c}| - \mathbf{h}), 0.0)$$
  where $\mathbf{c}$ is the center vector and $\mathbf{h} = \left(\frac{w}{2}, \frac{d}{2}, \frac{h}{2}\right)$ represents the half-extents.

---

## 3. Coordinate Systems, Dynamic Geodetic Anchoring & Infinite CAD Space

### 3.1 Unanchored CAD Space & Dynamic Global Origin
Prior implementations coupled CAD rendering to a static site anchor in Fullerton, California (`33.8814° N, 117.9213° W, 95.0m`). This caused severe distortion and rendering failures when viewing local Cartesian models at $(0, 0, 0)$.

The modernized architecture adopts a **Dynamic World Reference Point (DWRP)**:
1. The user workspace operates at a pure, unconstrained local Cartesian origin: $(x, y, z) = (0.0, 0.0, 0.0)$.
2. When projecting to `<gmp-map-3d>`, an arbitrary base geodetic datum $(\phi_0, \lambda_0, h_0)$ acts solely as a smooth mathematical carrier frame.
3. The mapping converts local metric millimeter offsets $\Delta x, \Delta y, \Delta z$ to WGS84 ellipsoidal coordinates using the meridian and prime vertical radii of curvature:

$$M = \frac{a(1 - e^2)}{(1 - e^2 \sin^2 \phi_0)^{3/2}}, \quad N = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi_0}}$$
$$\phi = \phi_0 + \left(\frac{\Delta y \cdot 10^{-3}}{M + h_0}\right) \left(\frac{180}{\pi}\right)$$
$$\lambda = \lambda_0 + \left(\frac{\Delta x \cdot 10^{-3}}{(N + h_0) \cos \phi_0}\right) \left(\frac{180}{\pi}\right)$$
$$h = h_0 + \Delta z \cdot 10^{-3}$$

where $a = 6378137.0\,\text{m}$ (WGS84 semi-major axis) and $e^2 = 0.00669437999014$ (first eccentricity squared).

### 3.2 Dynamic Extent Scaling (5 mm to 2,000 ft)
To avoid WebGL single-precision depth buffer degradation (Z-fighting) and `<gmp-map-3d>` near/far plane clipping, camera distance and clipping ranges scale dynamically:
$$R_{\text{fit}} = 60 \cdot \max\left(r_{\text{bbox}}, 25.0\,\text{mm}\right)$$
$$\text{near} = \max(0.001\,\text{m}, 10^{-5} \cdot R_{\text{fit}}), \quad \text{far} = \min(10^9\,\text{m}, 10^4 \cdot R_{\text{fit}})$$

---

## 4. Units Detection, Ingestion, and Multiscale Pipeline

### 4.1 Authoritative Single-Conversion Rule
All geometry across every parser and input pipe is converted **strictly once** upon ingestion into canonical internal linear millimeters ($mm$). Display formatting applies user preferences (Imperial vs. Metric) only at the presentation layer.

```
Incoming Stream (STEP, FCStd, XBF, STL, 3MF, OBJ, GLB, PLY)
     │
     ├──> Header / Unit Entity Parser
     │     ├── SI_UNIT (.MILLI., .METRE.)     ──> Scale: 1.0
     │     ├── SI_UNIT (.CENTI., .METRE.)     ──> Scale: 10.0
     │     ├── SI_UNIT ($, .METRE.)           ──> Scale: 1000.0
     │     ├── CONVERSION_BASED_UNIT ('INCH') ──> Scale: 25.4
     │     └── CONVERSION_BASED_UNIT ('FOOT') ──> Scale: 304.8
     │
     ├──> Scale Normalization Engine (v_canonical = v_raw * scale)
     │
     └──> Canonical Store: GeoPart (Linear Unit: mm)
```

### 4.2 Multi-Format Scale Factors
| Unit Key | Scale to Canonical ($mm$) | Dimensionality Factor ($D=2$) | Dimensionality Factor ($D=3$) |
| :--- | :--- | :--- | :--- |
| `mm`, `millimeter` | $1.0$ | $1.0$ | $1.0$ |
| `cm`, `centimeter` | $10.0$ | $100.0$ | $1,000.0$ |
| `m`, `meter` | $1000.0$ | $1,000,000.0$ | $1,000,000,000.0$ |
| `in`, `inch` | $25.4$ | $645.16$ | $16,387.064$ |
| `ft`, `foot` | $304.8$ | $92,903.04$ | $28,316,846.592$ |
| `yd`, `yard` | $914.4$ | $836,127.36$ | $764,554,857.984$ |
| `um`, `micron` | $0.001$ | $10^{-6}$ | $10^{-9}$ |

---

## 5. B-Rep Authority vs. Derived Render Mesh Separation

### 5.1 The Anti-Corruption Principle
Under no circumstance does client-side rendering alter the underlying `GeoPart` data structures. Tessellation buffers (`RenderMesh`, `Float32Array` positions, `Uint32Array` indices) are derived representations cached for display.

### 5.2 Compaction & Validation Pipeline
Before render data reaches the viewport, it passes through `validate_and_compact_mesh`:
1. **Finite Verification:** Coordinates containing `NaN` or `±Inf` are stripped.
2. **Index Re-mapping:** Vertex gaps are compacted into contiguous zero-indexed buffers.
3. **Degenerate Triangle Elimination:** Zero-area triangles ($\|(p_1 - p_0) \times (p_2 - p_0)\| < 10^{-8}$) and self-referencing indices are pruned.
4. **Manifold Continuity:** Normals and face provenance IDs are preserved.

---

## 6. OpenCASCADE Dual-Route Extraction & Planar N-Gon Topology

### 6.1 Route A: Planar Faces (`GeomAbs_Plane`)
1. OpenCASCADE adaptor queries `adaptor.GetType() == GeomAbs_Plane`.
2. `BRepTools_WireExplorer` extracts ordered loops of edges without internal diagonals.
3. Continuous curves on boundary edges are discretized using chordal deflection.
4. Output is rendered directly via `<gmp-polygon-3d>` as clean N-Gons.

### 6.2 Route B: Curved & Analytical Solids
1. Curved surfaces (Cylinders, Cones, Spheres, Tori, B-Splines, NURBS) undergo adaptive meshing (`BRepMesh_IncrementalMesh`).
2. Linear deflection $\delta_L$ and angular deflection $\theta_A$ scale with solid diagonal:
   $$\delta_L = \max(0.2, d_{\text{diag}} \cdot 0.002)\,\text{mm}, \quad \theta_A = 0.45\,\text{rad}$$
3. High-density watertight triangle meshes are packed into binary base64 buffers.

---

## 7. Hybrid Rendering Pipeline: `<gmp-map-3d>` & WebGL Overlay

### 7.1 Multi-Layer Architecture

```
+--------------------------------------------------------------------------+
|                       USER BROWSER VIEWPORT                              |
+--------------------------------------------------------------------------+
|  LAYER 2: Canvas / WebGL Interactive Overlay (Z-Index: 2)                |
|   - Interactive Sub-element Highlighting (Vertex, Edge, Face)            |
|   - Csnap Snapping Targets (Vertex, Midpoint, Center)                    |
|   - Transform Gizmos (Move, Rotate, Scale, Align)                        |
|   - 1'x1' Infinite Ground Grid & Origin Coordinate Axes                  |
|   - 2D Drag-Select Box & Construction Lines                              |
+--------------------------------------------------------------------------+
|  LAYER 1: Google Maps 3D Web Component `<gmp-map-3d>` (Z-Index: 1)       |
|   - Native Photorealistic Photogrammetry / 3D Tiles                      |
|   - Native `<gmp-polygon-3d>` for Planar CAD Faces (Zero Diagonals)      |
|   - Hardware Depth Buffering & GPU Occlusion                             |
+--------------------------------------------------------------------------+
```

### 7.2 Initial Primitive Display Resolution
To ensure default 1-Foot ($304.8\,\text{mm}$) reference cubes and imported solids display immediately upon load:
1. Solids are registered in `CADState` and projected via local ENU coordinates.
2. `<gmp-polygon-3d>` nodes are attached to `<gmp-map-3d>` with `altitude-mode="absolute"`.
3. The synchronized 2D/WebGL canvas overlay performs immediate depth-sorted polygonal projection so parts are visible even if Web component tiles are loading.

---

## 8. Camera Frustum, Dynamic Framing, and Infinite 1'x1' Ground Grid

### 8.1 Infinite 1-Foot Grid Construction
The ground plane features an infinite procedural grid calibrated in 1-foot increments ($304.8\,\text{mm}$ in Imperial, $300.0\,\text{mm}$ in Metric):
- Grid lines span radially across the view frustum on the $XY$ plane ($Z = 0$).
- Orthogonal RGB coordinate axes denote $+X$ (Red), $+Y$ (Green), and $+Z$ (Blue).
- Grid line rendering adjusts dynamic alpha fading based on camera altitude to eliminate aliasing at glancing angles.

### 8.2 Spherical Trackball Gizmo & Quick Presets
An enlarged Viridian-teal spherical gizmo with a neon-blue outer glow provides intuitive 3D orientation tracking:
- Displays Top, Bottom, North, South, East, West face tags.
- Instant alignment chips: `FIT`, `ISO`, `TOP`, `FRONT`, `SIDE`.

---

## 9. Vertex AI Assistant & REST API Integration

### 9.1 Environment & Model Configuration
- **GCP Project ID:** `broadcasterfishmap`
- **Location:** `global`
- **Model:** `gemini-1.5-flash`
- **System Prompt:** Configured as a specialized Senior CAD Systems Engineer with deep knowledge of B-Rep topology, material densities, stress formulas, LinuxCNC toolpath generation, and CadQuery script generation.

### 9.2 Context Injection
Every chat interaction automatically serializes the active assembly scene context:
- Total body count, names, materials, bounding boxes, volume ($cm^3$), and mass ($g$).
- Active selection status (Part ID, Face ID, Surface Type, Normal Vector, Area $mm^2$).

---

## 10. Verification, Telemetry, and Diagnostics

### 10.1 Automated Test Suite Coverage
1. `test_canonical_geometry.py`: Verifies B-Rep structure, instance transforms, adaptive tessellation, and representation selection.
2. `test_cad_architecture.py`: Verifies universal byte parsing, STEP AP203/214/242 schemas, unit conversions, and binary STL scaling.
3. `test_kernel_math.py`: Validates Box SDF golden reference equivalence, prism geometries, and boolean scalar fields.
4. `test_workstation_repair.py`: Validates scale-invariance of world coordinates, XBF roundtrip integrity, and FreeCAD FCStd archive extraction.

### 10.2 Real-Time Diagnostic Dashboard
The system reports live telemetry metrics via the inspector terminal:
- Active Object Count & Vertex Counts.
- Live FPS Counter (60 FPS baseline target).
- Pipeline Execution Logs (`STEP_BUFFER_STAGED`, `OCCT_TOPODS_TRANSFER`, `UNIT_RESOLUTION`, `DUAL_ROUTE_EXTRACTION`).

---

*Master Architectural Specification authored and verified for GeoParametric3D production workstation deployment.*
