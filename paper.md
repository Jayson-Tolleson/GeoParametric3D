# MASTER ARCHITECTURAL SPECIFICATION: CAD SEMANTIC ENGINE, DERIVED REPRESENTATION SYSTEM & VIEWPORT ADAPTER (V4.3.1)

**Author:** Principal CAD Systems Architect & Computational Geometry Governor  
**System:** GeoParametric3D / CascadeCAD Production Workstation  
**Target Ecosystem:** Google Maps 3D Web Component (`<gmp-map-3d>`) / Open CASCADE Technology (OCCT / OCP 7.9) / CadQuery 2.8 / Vertex AI Engine (`broadcasterfishmap`/`global`)  
**Classification:** Core System Architecture, Semantic Invariance & Numerical Governance  
**Document Version:** 4.3.1 (Architectural Constitution & Worker Concurrency Release)  

---

## 1. System Conception: The Tripartite Model

GeoParametric3D strictly enforces unidirectional semantic decoupling across three discrete subsystems:

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

### 1.1 Unidirectional Invariant Hierarchy
1. **CAD Semantic Engine:** Authoritative geometric truth resides exclusively in exact topological B-Rep entities (`GeoAssembly` → `GeoInstance` → `GeoPart` → `GeoSolid` → `GeoShell` → `GeoFace` → `GeoLoop` → `GeoEdge` → `GeoVertex`) and mathematical definitions (Planes, Cylinders, Spheres, Cones, Toroids, NURBS surfaces, Analytic Curves, Signed Distance Fields).
2. **Derived Representation System:** Meshes, triangulations, spatial bounds, and normal buffers are *transient, disposable projections*. Render triangles NEVER flow backward to pollute or define CAD truth.
3. **Viewport Adapter:** The renderer is a presentation adapter that maps derived representations to web components. The viewport never invents geometry, the AI never directly mutates kernel solids, and the UI never acts as the geometry state store.

---

## 2. Instancing & Hierarchical Assembly Model

To scale efficiently to large-scale mechanical and geospatial assemblies without memory duplication, `GeoPart` definitions remain immutable and shared across lightweight `GeoInstance` nodes:

```text
                              GeoAssembly
                                   │
            ┌──────────────────────┴──────────────────────┐
            ▼                                             ▼
       GeoInstance A                                 GeoInstance B
  (Transform: T1, Color: C1)                    (Transform: T2, Color: C2)
            │                                             │
            └──────────────────────┬──────────────────────┘
                                   ▼
                                GeoPart
                    (Canonical B-Rep Definition)
```

- **`GeoPart`:** Authoritative geometric definition containing exact solids, shells, faces, loops, edges, and vertices in canonical millimeters (`mm`).
- **`GeoInstance`:** Lightweight occurrence holding a 4×4 affine transformation matrix, presentation styling (color, opacity, material), and a stable UUID reference to its source `GeoPart`.

---

## 3. Concurrency Contract: Immutable Task Descriptors

Parallel ingestion and batch deflection routines adhere to strict process isolation:

> **Invariant Rule: Workers process immutable geometric task descriptors and produce derived representation buffers. Workers NEVER mutate shared canonical CAD state.**

```text
                    CANONICAL B-REP STATE
                              │
                [Task Descriptor Generator]
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  DerivedTask #1        DerivedTask #2        DerivedTask #N
  (Immutable)           (Immutable)           (Immutable)
        │                     │                     │
        ▼                     ▼                     ▼
   Worker Pool           Worker Pool           Worker Pool
  (Classification &     (Classification &     (Classification &
   Deflection)           Deflection)           Deflection)
        │                     │                     │
        ▼                     ▼                     ▼
  DerivedResult #1      DerivedResult #2      DerivedResult #N
  (Polygon Loops /      (Polygon Loops /      (Polygon Loops /
   Mesh Buffers)         Mesh Buffers)         Mesh Buffers)
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                  SINGLE-THREADED AGGREGATOR
                              │
                    CANONICAL COMMIT PASS
```

---

## 4. Dual-Route Surface Classification & Adaptive Deflection Policy

```text
                            AUTHORITATIVE CAD FACE
                                      │
                         [Surface Type Classifier]
                                      │
             ┌────────────────────────┴────────────────────────┐
             ▼ (GeomAbs_Plane)                                 ▼ (Curved / Freeform)
┌─────────────────────────────┐                   ┌─────────────────────────────┐
│ TOPOLOGICAL PLANAR BOUNDARY │                   │   ADAPTIVE TESSELLATION     │
│            LOOPS            │                   │         (MeshPolicy)        │
│ ├─ Outer Wire (CCW)         │                   │ ├─ linear_deflection (mm)   │
│ └─ Inner Cutout Wires (CW)  │                   │ ├─ angular_deflection (rad) │
│ (Zero Internal Diagonals)   │                   │ └─ Analytic Vertex Normals  │
└──────────────┬──────────────┘                   └──────────────┬──────────────┘
               │                                                 │
               ▼                                                 ▼
      <gmp-polygon-3d>                              Hardware-Occluded Buffers
  (Native Outer/Inner Rings)                        (Contiguous Typed Arrays)
```

### 4.1 Configurable `MeshPolicy` Abstraction
Tessellation parameters are governed via explicit policy configurations rather than hardcoded kernel constants:

```python
class MeshPolicy:
    def __init__(
        self,
        linear_deflection: float = 0.1,
        angular_deflection_deg: float = 12.0,
        minimum_edge_length: float = 0.01,
        maximum_chord_error: float = 0.05,
        quality_mode: str = "standard"
    ):
        self.linear_deflection = float(linear_deflection)
        self.angular_deflection = math.radians(float(angular_deflection_deg))
        self.minimum_edge_length = float(minimum_edge_length)
        self.maximum_chord_error = float(maximum_chord_error)
        self.quality_mode = quality_mode
```

---

## 5. Physical Scale Standardization & Unit Invariance Laws

### Law 1: Canonical Internal Millimeter Invariance
All internal coordinates, vertex buffers, edge boundaries, and spatial indices reside in linear millimeters (`mm`):

$$\mathcal{U}_{\text{internal}} \equiv \text{mm}$$

### Law 2: Single Ingestion Scale Conversion
Source CAD dimensions are scaled exactly once upon ingestion based on detected header units:

$$\mathbf{p}_{\text{canonical}} = \mathbf{p}_{\text{source}} \times S_{\text{source} \to \text{mm}}$$

### Law 3: Dynamic Presentation Formatting
Display values in inspectors and measurement dialogs are computed dynamically on-the-fly for presentation only:

$$L_{\text{inches}} = \frac{L_{\text{canonical\_mm}}}{25.4}$$

*Defect Resolution:* Eliminates the scale inflation defect where a 1642.218 mm intake flange (~64.65 in / ~5.38 ft) is erroneously formatted as 1642.218 inches (~136.85 ft).

---

## 6. V4.3 Architectural Constitution

```text
+--------------------------------------------------------------------------+
|                       V4.3 ARCHITECTURAL CONSTITUTION                    |
+--------------------------------------------------------------------------+
|  1. CAD Semantic Engine = Authority                                      |
|  2. Derived Representation = Disposable                                  |
|  3. Viewport Adapter = Presentation                                      |
|  4. No reverse geometric ownership                                       |
|  5. No duplicate geometric authority                                     |
|  6. No client canvas CAD rendering engines                              |
|  7. No worker mutation of canonical state                                |
|  8. No unit mutation after canonicalization                              |
|  9. No UUID regeneration during viewport rendering                       |
| 10. No architecture replacement to circumvent implementation challenges   |
+--------------------------------------------------------------------------+
```
