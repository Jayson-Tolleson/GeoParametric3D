# TECHNICAL SPECIFICATION: HIGH-THROUGHPUT PARALLEL B-REP ROUTING & INGESTION ENGINE (V4.3)

**Document ID:** GP3D-SPEC-PERF-001  
**Classification:** Core CAD Kernel & Pipeline Specification  
**Status:** Approved for Production Implementation  
**Version:** 4.3.0  

---

## 1. Problem Statement & Architecture Redesign

During ingestion of large multi-solid STEP assemblies (such as `jetdrive.step`, 9.2 MB, 61 discrete solids, 181,956 vertices), legacy sequential processing produced bottleneck latencies and dropped client viewport performance.

### 1.1 Acceptance Benchmarks (Performance Goals)
- **Ingestion Target:** $T_{\text{ingestion}} \le 2.5\,\text{s}$
- **Client Viewport Frame Rate:** Sustained $60.0\,\text{FPS}$ native rendering
- **Planar Face Quality:** $100\%$ zero internal diagonals on planar boundaries
- **Memory & Bandwidth:** Contiguous packed typed array buffers

---

## 2. Immutable Work Units & Worker Scheduler Isolation

To prevent threading conflicts and eliminate shared mutable state, the STEP shape compound is unpacked into discrete immutable work units:

```text
                     INPUT STEP BYTES
                            │
                    [STEP Parser (OCCT)]
                            │
              Topological Compound Unpacker
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
  [Immutable Solid A] [Immutable Solid B] [Immutable Solid N]
         │                  │                  │
         ▼                  ▼                  ▼
   Worker Pool        Worker Pool        Worker Pool
   (Deflection &      (Deflection &      (Deflection & 
   Classification)    Classification)    Classification)
         │                  │                  │
         ▼                  ▼                  ▼
   Derived Buffers    Derived Buffers    Derived Buffers
         │                  │                  │
         └──────────────────┼──────────────────┘
                            ▼
               Canonical Assembly Aggregator
              (Single-Threaded State Commit)
```

### 2.1 Parallel Execution Invariant
> **Workers are strictly producers of derived representations (planar wire coordinates, deflection meshes, bounding boxes). Workers NEVER mutate the authoritative canonical state.**

---

## 3. Surface Classification Adaptor Routine

```python
def route_cad_faces(shape: Any, scale: float = 1.0, linear_deflection: float = 0.05) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Routes every TopoDS_Face into either:
      - Planar boundary loops (GeomAbs_Plane, zero internal diagonals, outer & inner cutout loops)
      - Curved analytical surfaces requiring adaptive chordal deflection.
    """
    planar_faces = []
    curved_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_idx = 0

    while explorer.More():
        face_idx += 1
        occ_face = TopoDS_Face_Cast(explorer.Current())
        try:
            adaptor = BRepAdaptor_Surface(occ_face)
            surface_type = adaptor.GetType()
        except Exception:
            surface_type = GeomAbs_Plane

        if surface_type == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale=scale, linear_deflection=linear_deflection)
            if wire_data.get("outer"):
                planar_faces.append({
                    "face_index": face_idx,
                    "face_id": f"Face_Planar_{face_idx}",
                    "surface_type": "Plane",
                    "outer_coordinates": wire_data["outer"],
                    "inner_coordinates": wire_data.get("inner", []),
                    "vertex_count": len(wire_data["outer"]),
                    "has_holes": len(wire_data.get("inner", [])) > 0
                })
        else:
            curved_faces.append({
                "face_index": face_idx,
                "face_id": f"Face_Curved_{face_idx}",
                "surface_type": str(surface_type)
            })
        explorer.Next()

    return planar_faces, curved_faces
```

---

## 4. Zero-Copy Binary Buffer Packaging

1. Interleaved `Float32Array` vertex buffers $[X_1, Y_1, Z_1, X_2, Y_2, Z_2, \dots]$
2. Packed `Uint32Array` index triples $[i_1, i_2, i_3, \dots]$
3. Pre-allocated continuous memory transferred via `application/octet-stream` endpoint `/api/geometry/binary`.
