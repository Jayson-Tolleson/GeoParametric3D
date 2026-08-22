# MASTER ARCHITECTURAL SPECIFICATION: CAD SEMANTIC ENGINE, DERIVED REPRESENTATION SYSTEM & VIEWPORT ADAPTER (V4.3)

**Author:** Principal CAD Systems Architect & Computational Geometry Governor  
**System:** GeoParametric3D / CascadeCAD Production Workstation  
**Target Ecosystem:** Google Maps 3D Web Component (`<gmp-map-3d>`) / Open CASCADE Technology (OCCT / OCP 7.9) / CadQuery 2.8 / Vertex AI Engine (`broadcasterfishmap`/`global`)  
**Classification:** Core System Architecture, Semantic Invariance & Numerical Governance  
**Document Version:** 4.3.0 (Semantic Engine & Viewport Adapter Architecture Release)  

---

## 1. System Conception: The Tripartite Model

GeoParametric3D is fundamentally structured not as a monolithic CAD-renderer hybrid, but as three strictly decoupled subsystems:

```text
                             GEOPARAMETRIC3D
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│   CAD SEMANTIC    │     │      DERIVED      │     │ VIEWPORT ADAPTER  │
│      ENGINE       │ ──► │  REPRESENTATION   │ ──► │                   │
│ (Authoritative    │     │      SYSTEM       │     │   <gmp-map-3d>    │
│  B-Rep Truth)     │     │ (Transient Data)  │     │  (Presentation)   │
└───────────────────┘     └───────────────────┘     └───────────────────┘
```

### 1.1 The Invariant Hierarchy
1. **CAD Semantic Engine:** Authoritative geometric truth lives exclusively in exact B-Rep entities (`GeoAssembly` → `GeoInstance` → `GeoPart` → `GeoSolid` → `GeoShell` → `GeoFace` → `GeoLoop` → `GeoEdge` → `GeoVertex`) and exact mathematical definitions (Planes, Cylinders, Spheres, Cones, Toroids, NURBS, Signed Distance Fields).
2. **Derived Representation System:** Render meshes, triangulations, and spatial bounding boxes are *derived, transient artifacts*. Render triangles NEVER become authoritative CAD geometry.
3. **Viewport Adapter:** The renderer is an adapter over derived representations, delegating geospatial rendering, 3D tiles, and camera frustum management directly to the native Google Maps 3D Web Component (`<gmp-map-3d>`).

---

## 2. Specialization: Planar Boundary Loops vs. Curved Surfaces

To eradicate visual triangulation diagonals across flat engineering faces without compromising smooth surface curvature:

```text
                            AUTHORITATIVE CAD FACE
                                      │
                     [Surface Classification Adaptor]
                                      │
             ┌────────────────────────┴────────────────────────┐
             ▼ (GeomAbs_Plane)                                 ▼ (Curved / Freeform)
┌─────────────────────────────┐                  ┌─────────────────────────────┐
│ TOPOLOGICAL PLANAR BOUNDARY │                  │     ADAPTIVE DEFLECTION     │
│            LOOPS            │                  │        TESSELLATION         │
│ ├─ Outer Wire (CCW)         │                  │ ├─ BRepMesh Incremental     │
│ └─ Inner Cutout Wires (CW)  │                  │ ├─ Chordal / Angular Defl.  │
│ (Zero Internal Diagonals)   │                  │ └─ Analytic Vertex Normals  │
└──────────────┬──────────────┘                  └──────────────┬──────────────┘
               │                                                │
               ▼                                                ▼
      <gmp-polygon-3d>                             Continuous Render Buffers
  (Native Outer/Inner Rings)                       (Hardware Depth-Occluded)
```

### 2.1 Planar Boundary Loop Formulation (`GeomAbs_Plane`)
Planar faces preserve boundary loop topology $(\mathcal{W}_{\text{outer}}, \mathcal{W}_{\text{inner}}^{(1)}, \dots, \mathcal{W}_{\text{inner}}^{(K)})$ directly from `BRepTools_WireExplorer`. Wires are sampled using chordal deflection for curved edge segments, but the interior planar face receives zero internal triangulation diagonals, rendering cleanly via `<gmp-polygon-3d>`.

### 2.2 Curved Surface Formulation
Curved analytical surfaces (cylinders, spheres, cones, NURBS) are tessellated via adaptive deflection parameters (`linear_deflection = 0.2 mm`, `angular_deflection = 0.5 rad`), retaining explicit face provenance IDs (`data-face-id`) for unbroken selection hit-testing.

---

## 3. Parallel Ingestion Architecture & Worker Isolation

To ingest complex assemblies (such as `jetdrive.step`, 61 solids, 181,956 vertices) cleanly without race conditions or shared state corruption:

```text
                    STEP EXCHANGE BYTES
                             │
                     [STEP Reader (OCCT)]
                             │
                   Compound Shape Unpacker
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
       [Solid Task 1]  [Solid Task 2]  [Solid Task N]
       (Immutable)     (Immutable)     (Immutable)
             │               │               │
             ▼               ▼               ▼
      Worker Pool     Worker Pool     Worker Pool
       (Derived        (Derived        (Derived
        Buffers)        Buffers)        Buffers)
             │               │               │
             └───────────────┼───────────────┘
                             ▼
                 Canonical Assembly Aggregator
                 (Single-Threaded State Commit)
```

### Invariant Rule for Parallel Execution:
> **Workers process immutable geometric descriptors and produce derived representation buffers. Workers NEVER mutate shared canonical CAD state.**

---

## 4. Authoritative Unit Invariance & Physical Scale Standard

### Law 1: Canonical Internal Millimeter Standard
All internal coordinates, vertex buffers, edge boundaries, and spatial indices are stored in linear millimeters (`mm`):

$$\mathcal{U}_{\text{internal}} \equiv \text{mm}$$

### Law 2: Single Ingestion Scale Conversion
Source CAD dimensions are scaled exactly once upon ingestion based on detected header units:

$$\mathbf{p}_{\text{canonical}} = \mathbf{p}_{\text{source}} \times S_{\text{source} \to \text{mm}}$$

### Law 3: Dynamic Presentation Formatting
Imperial display values in inspectors and measurement dialogues are dynamically derived for presentation only:

$$L_{\text{inches}} = \frac{L_{\text{canonical\_mm}}}{25.4}$$

*Defect Resolution:* Eliminates the 25.4x scale inflation bug (preventing the `Collector` flange from displaying as 136.8 ft instead of its actual 64.654 in ≈ 5.38 ft intake within the 8.0 ft assembly).

---

## 5. Stable Semantic Identity System

Every entity across the CAD hierarchy maintains an invariant UUID:
- `GeoAssembly` $\to$ Stable Assembly ID
- `GeoInstance` $\to$ Lightweight transform matrix (4×4) + reference to `GeoPart`
- `GeoPart` $\to$ Part definition ID
- `GeoSolid` $\to$ Manifold Solid ID
- `GeoShell` $\to$ Outer/Inner Shell ID
- `GeoFace` $\to$ Exact Face ID (`data-face-id` in DOM)

Selection in the `<gmp-map-3d>` viewport directly targets `data-face-id` or `data-object-id`, providing 1:1 bidirectional synchronization with the Workspace Assembly Tree, Properties Inspector, and Vertex AI Engineering Assistant.
