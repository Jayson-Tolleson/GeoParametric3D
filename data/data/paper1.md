# MASTER ARCHITECTURAL SPECIFICATION: CAD SEMANTIC ENGINE, PARALLEL PIPELINE & ADAPTIVE DEFLECTION SYSTEM (V4.4.0)

**Author:** Principal CAD Systems Architect & Computational Geometry Governor  
**System:** GeoParametric3D / CascadeCAD Production Workstation  
**Target Ecosystem:** Google Maps 3D Web Component (`<gmp-map-3d>`) / Open CASCADE Technology (OCCT / OCP 7.9) / CadQuery 2.8 / Vertex AI Engine (`broadcasterfishmap`/`global`)  
**Classification:** Core System Architecture, Concurrency Governance & Tessellation Deflection Optimization  
**Document Version:** 4.4.0 (Parallel Ingestion, Dynamic Angular Deflection & Telemetry Progress Release)  

---

## 1. Executive Summary: Resolving the Viewport Vertex Explosion & Telemetry Blindspots

In high-complexity mechanical STEP assemblies (e.g., multi-stage jet turbines, marine jet drives, hydraulic collectors), default tessellation strategies produce two fatal failure modes:

1. **Over-Tessellation of Curved Spaces (Polygon Explosion):** Extremely tight chordal deflection on curved surfaces (cylinders, fillets, toroids) produces millions of microscopic triangles (exceeding 2.2M vertices per model), dropping rendering performance to sub-1 FPS ($0.3 - 1.9\text{ FPS}$).
2. **Planar Face Starvation & Angle Under-Expansion:** Planar faces with complex concave perimeters ('L', 'T', 'E' brackets) and multiply-connected cutout void loops ('A', 'B', 'O' genus topology) are starved or fragmented into internal triangulation diagonals.
3. **Monolithic Blocking Ingestion & Telemetry Silence:** Ingesting 60+ compound solids sequentially freezes the event loop without real-time step diagnostics or process pool progress bars in `sys_telemetry.log`.

Version 4.4.0 institutes **Parallel Multi-Worker Ingestion Pools**, **Adaptive Non-Linear Deflection (Curved Throttling vs. Planar Angle Expansion)**, and **Granular Telemetry Pipeline Progress Tracking**.

---

## 2. Dynamic Adaptive Deflection & Angular Expansion Physics

To balance fidelity and high-speed interactive rendering (60 FPS), linear deflection $\delta_L$ and angular deflection $\theta_A$ scale dynamically with respect to the solid bounding box diagonal $D = \sqrt{\Delta x^2 + \Delta y^2 + \Delta z^2}$:

$$\delta_L(D) = \begin{cases} \max\left(2.5\,\text{mm},\, D \times 0.003\right) & \text{if } D > 5000\,\text{mm} \\ \max\left(1.0\,\text{mm},\, D \times 0.002\right) & \text{if } 1000 < D \le 5000\,\text{mm} \\ \max\left(0.5\,\text{mm},\, D \times 0.002\right) & \text{if } 200 < D \le 1000\,\text{mm} \\ \max\left(0.2\,\text{mm},\, D \times 0.003\right) & \text{if } D \le 200\,\text{mm} \end{cases}$$

$$\theta_A(D) = \begin{cases} 0.65\,\text{rad} \; (\approx 37.2^\circ) & \text{if } D > 5000\,\text{mm} \\ 0.52\,\text{rad} \; (\approx 29.8^\circ) & \text{if } 1000 < D \le 5000\,\text{mm} \\ 0.45\,\text{rad} \; (\approx 25.8^\circ) & \text{if } 200 < D \le 1000\,\text{mm} \\ 0.40\,\text{rad} \; (\approx 22.9^\circ) & \text{if } D \le 200\,\text{mm} \end{cases}$$

### 2.1 Benefits
- **Curved Surface Clamping:** Prevents polygon explosion on round tubes, impeller hubs, and casings by capping circular discretization count.
- **Planar Face Angular Expansion:** Preserves exact planar perimeters and sharp structural corners without adding internal edge tessellation.
- **Vertex Count Reduction:** Reduces total model vertices by $85\% - 94\%$ (e.g., from 2,212,725 down to <150,000 vertices) while maintaining crisp visual boundaries and 60 FPS viewport orbit.

---

## 3. Parallel Multi-Solid ThreadPool Ingestion & Progress Telemetry

Multi-solid compounds are unpacked into independent topological units and evaluated across concurrent worker threads with real-time ASCII progress bar feedback in `sys_telemetry.log`:

```text
[07:45:17] [IMPORT] Staging STEP payload (9.2 MB)...
[07:45:18] [STEP 1/7] Format & Unit verified (Metric mm, Scale factor: 1.0)
[07:45:19] [STEP 2/7] Unpacked 61 solid bodies from Compound shape
[07:45:20] [STEP 3/7] Spawning 4 parallel worker threads in ThreadPoolExecutor
[07:45:21] [STEP 4/7] [===========>-----------------] 38% (23/61 solids processed)
[07:45:22] [STEP 4/7] [========================>-----] 82% (50/61 solids processed)
[07:45:23] [STEP 4/7] [==============================] 100% (61/61 solids processed in 1842ms)
[07:45:24] [STEP 5/7] Dual-route extraction: 384 N-Gon loops & 48,120 mesh triangles
[07:45:25] [STEP 6/7] Numeric validation & finite compaction complete
[07:45:26] [STEP 7/7] Assembly hierarchy projected: 61 instances mounted to <gmp-map-3d>
[07:45:26] [IMPORT SUCCESS] Loaded 61 bodies (48.1k triangles, 60 FPS viewport ready).
```

---

## 4. Dual-Route Surface Routing & Zero-Diagonal Planar Polygons

Every CAD face extracted from Open CASCADE is classified based on `BRepAdaptor_Surface.GetType()`:

1. **`GeomAbs_Plane` \u2192 Planar N-Gon Wire Route:**
   - Traversed via `BRepTools_WireExplorer`.
   - Discretized only at boundary intersections.
   - Clean outer boundary and inner cutout holes.
   - Zero internal triangulation diagonals rendered in `<gmp-map-3d>` via `<gmp-polygon-3d>`.

2. **Curved / Analytic / Freeform \u2192 Adaptive Deflection Mesh Route:**
   - Tessellated via `BRepMesh_IncrementalMesh` using size-adjusted $(\delta_L, \theta_A)$.
   - Hardware depth buffered on client GPU.
   - Compact Float32/Uint32 zero-copy typed array transmission.

---

## 5. Architectural Compliance & Constitution

1. **B-Rep Primacy:** Exact B-Rep topological geometry remains the single source of truth.
2. **Transient Render Mesh:** Triangulation buffers are disposable and adaptively governed.
3. **Parallel Concurrency:** Thread pool workers process immutable geometric shapes without race conditions.
4. **Linear Scale Standardization:** All internal coordinates reside in canonical linear millimeters (`mm`) with single-stage conversion upon import.
