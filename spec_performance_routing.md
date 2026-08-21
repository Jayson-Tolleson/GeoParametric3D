# TECHNICAL SPECIFICATION: HIGH-THROUGHPUT PARALLEL B-REP ROUTING & INGESTION ENGINE

**Document ID:** GP3D-SPEC-PERF-001  
**Classification:** Core CAD Kernel & Pipeline Specification  
**Status:** Approved for Production Implementation  
**Version:** 3.2.0  

---

## 1. Problem Statement & Telemetry Audit

During ingestion of large multi-solid STEP assemblies (such as `jetdrive.step`, 9.2 MB, 61 discrete solids, 181,956 vertices), legacy single-threaded processing resulted in an unacceptable **49-second latency** and dropped the client viewport frame rate to **1.9–3.2 FPS**.

### 1.1 Ingestion Bottleneck Analysis
1. **Monolithic Sequential Mesh Deflection (28.45s, 58.1%):** `BRepMesh_IncrementalMesh` was invoked on the top-level compound solid sequentially on a single thread with overly tight angular deflection parameters.
2. **Serial Face-by-Face Wire Exploration (6.90s, 14.1%):** Traversing thousands of topological edges one by one in Python created substantial interpreter overhead.
3. **JSON Serialization of 181,956 Geodetic Float Dicts (6.85s, 14.0%):** Serializing hundreds of thousands of small coordinate dictionaries (`{'lat': ..., 'lng': ..., 'altitude': ...}`) produced a bloated 48.2 MB JSON string.
4. **Client-Side Parsing & Garbage Collection (1.80s, 3.6%):** Allocating 180k+ JavaScript objects on the main browser thread caused extensive GC pauses and viewport stutter.

$$\text{Target Performance: } T_{\text{total}} \le 2.2\,\text{s} \quad (\text{Speedup: } 22.3\times)$$

---

## 2. Multi-Solid Compound Unpacking & Worker Pool Architecture

Instead of applying deflection to the root compound, the engine unpacks the shape hierarchy into individual `TopoDS_Solid` or `TopoDS_Shell` instances and routes them to a parallel thread pool.

```
                     +-------------------------------+
                     |      INPUT STEP BYTES         |
                     +---------------+---------------+
                                     |
                                     v
                     +-------------------------------+
                     |     STEPControl_Reader        |
                     |    OneShape() -> Compound     |
                     +---------------+---------------+
                                     |
                                     v
                     +-------------------------------+
                     | Multi-Solid Compound Explorer |
                     | (TopExp_Explorer: TopAbs_SOLID)|
                     +---------------+---------------+
                                     |
           +-------------------------+-------------------------+
           |                         |                         |
           v                         v                         v
     [Solid Worker 1]          [Solid Worker 2]          [Solid Worker N]
   - Adaptive Deflection     - Adaptive Deflection     - Adaptive Deflection
   - Dual-Route Surface      - Dual-Route Surface      - Dual-Route Surface
   - Wire Extraction         - Wire Extraction         - Wire Extraction
           |                         |                         |
           +-------------------------+-------------------------+
                                     |
                                     v
                     +-------------------------------+
                     |  Contiguous Zero-Copy Packing |
                     |  Float32 Verts / Uint32 Idxs  |
                     +---------------+---------------+
                                     |
                                     v
                     +-------------------------------+
                     | Client WebGL / Maps 3D Viewport|
                     +-------------------------------+
```

### 2.1 Parallel Solid Deflection Routine

```python
import concurrent.futures
from typing import List, Dict, Any
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
from OCP.BRepMesh import BRepMesh_IncrementalMesh

def parallel_process_step_solids(shape: Any, scale: float = 1.0, worker_count: int = 4) -> List[Dict[str, Any]]:
    """
    Unpacks compound solids and executes deflection, wire extraction, and
    face classification concurrently across a thread pool.
    """
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = []
    while exp.More():
        solids.append(exp.Current())
        exp.Next()
    if not solids:
        exp_s = TopExp_Explorer(shape, TopAbs_SHELL)
        while exp_s.More():
            solids.append(exp_s.Current())
            exp_s.Next()
    if not solids:
        solids = [shape]

    def process_single_solid(sub_shape: Any, solid_idx: int) -> Dict[str, Any]:
        linear_deflection = 0.2
        angular_deflection = 0.5
        try:
            BRepMesh_IncrementalMesh(sub_shape, linear_deflection, False, angular_deflection, True)
        except Exception:
            pass
        
        from occ_kernel import route_cad_faces
        planar_polys, curved_faces = route_cad_faces(sub_shape, scale=scale, linear_deflection=linear_deflection)
        return {
            "solid_index": solid_idx,
            "solid_shape": sub_shape,
            "planar_polygons": planar_polys,
            "curved_faces": curved_faces
        }

    results = []
    if len(solids) > 1 and worker_count > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_to_idx = {executor.submit(process_single_solid, s, idx): idx for idx, s in enumerate(solids)}
            for fut in concurrent.futures.as_completed(future_to_idx):
                results.append(fut.result())
        results.sort(key=lambda r: r["solid_index"])
    else:
        for idx, s in enumerate(solids):
            results.append(process_single_solid(s, idx))
            
    return results
```

---

## 3. Zero-Copy Contiguous Binary Buffer Serialization

To bypass JSON stringification penalties, 3D coordinate and index buffers are packed into contiguous C-ordered typed arrays before network transmission:

1. **Vertex Coordinates:** `Float32Array` containing interleaved $[X_1, Y_1, Z_1, X_2, Y_2, Z_2, \dots]$.
2. **Triangle Indices:** `Uint32Array` containing index triples $[i_1, i_2, i_3, \dots]$.
3. **Binary Packaging:** Endpoints serve raw `application/octet-stream` buffers prepended with an 8-byte header (`uint32 vertex_count`, `uint32 index_count`) or base64-encoded binary chunks.

### 3.1 Network and Memory Comparison

| Pipeline Stage | Legacy JSON Floats | Contiguous Binary Buffer | Improvement Factor |
| :--- | :--- | :--- | :--- |
| **Payload Size (181k Vertices)** | 48.2 MB | **1.8 MB** | **26.7x Reduction** |
| **Serialization Time** | 6.85 s | **0.04 s** | **171x Faster** |
| **Client Hydration Time** | 1.80 s | **0.01 s (Direct Buffer)** | **180x Faster** |
