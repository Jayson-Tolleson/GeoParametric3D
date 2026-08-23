# GeoParametric3D: Architectural Specification & Engineering Whitepaper
**Document Version:** 10.0.0-PROD  
**System Designation:** GeoParametric3D Authoritative CAD Workstation  
**Core Runtime Environment:** WebAssembly / Python 3.13 / Quart / OpenCASCADE (OCP) / Google Maps 3D Platform  

---

## 1. Executive Summary

GeoParametric3D is an authoritative engineering CAD/CAM/CAE workstation operating directly within the browser and connected microservices. It bridges parametric Boundary Representation (B-Rep) solid modeling with global geospatial photorealistic visualization via the Google Maps 3D Web Component ecosystem (`<gmp-map-3d>`).

```
+---------------------------------------------------------------------------------------------------+
|                                 GEOPARAMETRIC3D CORE INVARIANTS                                   |
+---------------------------------------------------------------------------------------------------+
| 1. EXACT B-REP IS AUTHORITATIVE TRUTH: Triangles are non-authoritative, derived render artifacts. |
| 2. CANONICAL INTERNAL UNIT: Linear millimeters (mm) across all math, geometry, and storage.       |
| 3. SINGLE CONVERSION RULE: Imperial (12" / 1') / metric inputs map to canonical mm at boundary.    |
| 4. ZERO-DIAGONAL PLANAR FACES: Planar topological faces map to clean N-gon boundary loops.        |
| 5. 100% OPAQUE SOLID SHADING: Production engineering solids render with full hardware occlusion.  |
| 6. SEPARATED TRANSFORMS & INSTANCING: Part definitions are immutably decoupled from 4x4 matrices. |
+---------------------------------------------------------------------------------------------------+
```

### 1.1 Architectural Pillars & Invariants
* **Topological Separation:** Geometric definitions (`GeoSurface`, `GeoCurve`, `GeoVertex`) and topological relations (`GeoSolid`, `GeoShell`, `GeoFace`, `GeoLoop`, `GeoEdge`) are strictly decoupled from rendering buffers.
* **Geodetic Anchoring:** Models are positioned relative to a global geodetic origin anchor (Default: *Null Island Geodetic Origin Anchor*, Latitude $0.0^\circ\text{N}$, Longitude $0.0^\circ\text{E}$, Altitude $0.0\text{ m}$).
* **Native Component Direct Rendering:** Planar solid faces route directly to native `<gmp-polygon-3d>` elements, curves route to `<gmp-polyline-3d>`, anchor datums route to `<gmp-marker-3d>`, and complex composite meshes route to `<gmp-model-3d>`.
* **Zero-Loss Assembly Pipeline:** Full B-Rep product hierarchies (STEP AP203/AP214/AP242, FreeCAD `.FCStd`, Native XBF Binary) are preserved from ingestion to GPU dispatch.

---

## 2. Viewport & Grid Assembly

```
+--------------------------------------------------------------------------------------------------+
|                                    VIEWPORT LAYER STACK                                          |
+--------------------------------------------------------------------------------------------------+
| [LAYER 4: HUD & DOM]          Spherical Trackball Gizmo | Telemetry HUD | Assistant Dock        |
| [LAYER 3: 2D/3D OVERLAY]      HTML5 Canvas Overlay (CSnap, Marquee, Draft Lines, Vertex/Edge)   |
| [LAYER 2: GEOSPATIAL CAD]     <gmp-map-3d> (Native <gmp-polygon-3d>, <gmp-polyline-3d>)         |
| [LAYER 1: GEODETIC DATUM]     Photorealistic 3D Tiles / 2,000-Foot Ground Grid (1-ft Spacing)    |
+--------------------------------------------------------------------------------------------------+
```

### 2.1 Coordinate Space Transformations

Local Cartesian CAD coordinates in East-North-Up (ENU) millimeters $[x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}]^T$ map to WGS84 Geodetic Coordinates $[\phi, \lambda, h]^T$ (Latitude, Longitude, Ellipsoidal Altitude) centered on anchor $(\phi_0, \lambda_0, h_0)$:

$$\begin{aligned}
x_{\text{m}} &= \frac{x_{\text{mm}}}{1000.0}, \quad y_{\text{m}} = \frac{y_{\text{mm}}}{1000.0}, \quad z_{\text{m}} = \frac{z_{\text{mm}}}{1000.0} \\
N(\phi_0) &= \frac{a}{\sqrt{1 - e^2 \sin^2(\phi_0)}}, \quad M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2(\phi_0))^{3/2}} \\
\Delta\phi &= \frac{y_{\text{m}}}{M(\phi_0) + h_0}, \quad \Delta\lambda = \frac{x_{\text{m}}}{(N(\phi_0) + h_0) \cos(\phi_0)} \\
\phi &= \phi_0 + \Delta\phi \cdot \left(\frac{180^\circ}{\pi}\right), \quad \lambda = \lambda_0 + \Delta\lambda \cdot \left(\frac{180^\circ}{\pi}\right), \quad h = h_0 + z_{\text{m}}
\end{aligned}$$

*WGS84 Constants:* Semi-major axis $a = 6378137.0\text{ m}$, First eccentricity squared $e^2 = 0.00669437999014$.

### 2.2 Ground Grid & Horizon Construction
* **Grid Bounds:** Continuous grid spanning $\pm 2,000\text{ ft}$ ($\pm 609,600\text{ mm}$) centered at $(0, 0, 0)$.
* **Subdivision Mesh:** Primary intervals of $1\text{ ft}$ ($304.8\text{ mm}$) with major accent datums at $10\text{ ft}$ ($3,048\text{ mm}$).
* **Dynamic LOD Stride:** To guarantee $60\text{ FPS}$, rendering adapts grid line step according to camera range:

| Camera Range ($R$) | Rendering Grid Stride | Displayed Grid Spacing |
| :--- | :--- | :--- |
| $R \le 20\text{ m}$ | $1\times$ Stride | $1\text{ ft}$ ($304.8\text{ mm}$) |
| $20\text{ m} < R \le 50\text{ m}$ | $2\times$ Stride | $2\text{ ft}$ ($609.6\text{ mm}$) |
| $50\text{ m} < R \le 150\text{ m}$ | $5\times$ Stride | $5\text{ ft}$ ($1524.0\text{ mm}$) |
| $150\text{ m} < R \le 500\text{ m}$ | $20\times$ Stride | $20\text{ ft}$ ($6096.0\text{ mm}$) |
| $R > 500\text{ m}$ | $50\times$ Stride | $50\text{ ft}$ ($15240.0\text{ mm}$) |

### 2.3 Native `<gmp-polygon-3d>` Face Invariants
To prevent rendering dropouts and z-fighting artifacts, the rendering pipeline enforces four mandatory DOM invariants:

1. **Explicit Loop Closure:** Every coordinate array assigned to `outerCoordinates` or `innerCoordinates` must be explicitly closed ($P_0 \equiv P_N$).
2. **Altitude Mode Integrity:** `altitude-mode="absolute"` or `altitude-mode="relative-to-mesh"` must be declared on every `<gmp-polygon-3d>` node.
3. **100% Opaque Solid Shading:** Colors default to solid hex strings (`#38bdf8`, `#3b82f6`) or fully opaque RGBA (`rgba(56, 189, 248, 1.0)`).
4. **Occlusion Handling:** `draws-occluded-segments="true"` and `extruded="false"` prevent depth-buffer clipping across complex topological hulls.

```javascript
// Native <gmp-polygon-3d> DOM Mounting Contract
export function mountPlanarFacePolygon(map3dElement, faceData, objectId) {
  const polygon = document.createElement('gmp-polygon-3d');
  polygon.dataset.objectId = objectId;
  polygon.dataset.faceId = faceData.face_id;
  polygon.setAttribute('altitude-mode', 'absolute');
  polygon.altitudeMode = 'absolute';
  polygon.fillColor = faceData.color || '#38bdf8';
  polygon.strokeColor = '#ffffff';
  polygon.strokeWidth = 1.5;
  polygon.drawsOccludedSegments = true;

  // Enforce Loop Closure Invariant
  const outer = [...faceData.outer_coordinates];
  if (outer.length >= 3) {
    const first = outer[0], last = outer[outer.length - 1];
    if (Math.hypot(first.lat - last.lat, first.lng - last.lng, first.altitude - last.altitude) > 1e-7) {
      outer.push({ lat: first.lat, lng: first.lng, altitude: first.altitude });
    }
  }
  polygon.outerCoordinates = outer;

  if (faceData.inner_coordinates?.length > 0) {
    polygon.innerCoordinates = faceData.inner_coordinates.map(hole => {
      const h = [...hole];
      const f = h[0], l = h[h.length - 1];
      if (Math.hypot(f.lat - l.lat, f.lng - l.lng, f.altitude - l.altitude) > 1e-7) {
        h.push({ lat: f.lat, lng: f.lng, altitude: f.altitude });
      }
      return h;
    });
  }
  map3dElement.appendChild(polygon);
  return polygon;
}
```

### 2.4 Spherical Trackball Gizmo Specification
* **Dimensions:** $115\text{px} \times 115\text{px}$ SVG overlay with spherical normal gradient (`#40E0D0` $\to$ `#00A877` $\to$ `#004d40`).
* **Neon Glow Rim:** Circumferential ring stroke `#00f3ff`, filter width $160\%$, Gaussian blur stdDev $3\text{px}$.
* **Orthogonal Face Projections:** Real-time projected cardinal labels: `TOP`, `BOT`, `N`, `S`, `E`, `W`.
* **Preset Direct Navigation Chips:** Instant trigger nodes for `FIT` ($60:1$ scale framing), `ISO` ($H=45^\circ, T=54.74^\circ$), `TOP` ($H=0^\circ, T=1^\circ$), `FRONT` ($H=0^\circ, T=90^\circ$), `SIDE` ($H=90^\circ, T=90^\circ$).

---

## 3. Kernel & B-Rep Translation

```
+--------------------------------------------------------------------------------------------------+
|                                    B-REP TOPOLOGY HIERARCHY                                      |
+--------------------------------------------------------------------------------------------------+
| GeoAssembly ──<1:N>── GeoInstance ──<1:1>── GeoTransform (4x4 Matrix)                            |
|                            │                                                                     |
|                            └──<1:1>── GeoPart                                                    |
|                                         ├── GeoSolid ──<1:N>── GeoShell                          |
|                                         │                        └── GeoFace ──<1:1>── GeoSurface|
|                                         │                                │                       |
|                                         │                                ├──<1:1>── Outer Loop   |
|                                         │                                └──<0:N>── Inner Loops  |
|                                         │                                             │          |
|                                         └── GeoVertex <── GeoEdge <── GeoCurve <──────┘          |
+--------------------------------------------------------------------------------------------------+
```

### 3.1 B-Rep Class Model Invariants

```python
class SurfaceType(str, Enum):
    PLANE = "plane"
    CYLINDER = "cylinder"
    CONE = "cone"
    SPHERE = "sphere"
    TORUS = "torus"
    NURBS = "nurbs"
    BSPLINE = "bspline"
    REVOLUTION = "revolution"
    EXTRUSION = "extrusion"

class CurveType(str, Enum):
    LINE = "line"
    CIRCLE = "circle"
    ARC = "arc"
    ELLIPSE = "ellipse"
    BSPLINE = "bspline"
    NURBS = "nurbs"

class GeoTransform:
    """Rigid 4x4 Affine Transformation Matrix decoupled from mesh definitions."""
    def __init__(self, matrix: Optional[Union[List[float], np.ndarray]] = None):
        self.matrix = np.eye(4, dtype=np.float64) if matrix is None else np.asarray(matrix, dtype=np.float64).reshape((4, 4))
        if not np.isfinite(self.matrix).all():
            raise GeometryPipelineException(GeometryPipelineStage.CANONICALIZATION, "Non-finite transform matrix")

    def compose(self, other: "GeoTransform") -> "GeoTransform":
        return GeoTransform(np.matmul(self.matrix, other.matrix))

    def apply_point(self, pt: np.ndarray) -> np.ndarray:
        p = np.array([pt[0], pt[1], pt[2], 1.0], dtype=np.float64)
        res = np.dot(self.matrix, p)
        return res[:3] / (res[3] if abs(res[3]) > 1e-12 else 1.0)
```

### 3.2 Dual-Route Classification Engine

Every solid body processed through OpenCASCADE (`TopoDS_Shape`) undergoes automated classification:

```
                              Authoritative TopoDS_Shape
                                          │
                        TopExp_Explorer(TopAbs_FACE)
                                          │
                       BRepAdaptor_Surface.GetType()
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         GeomAbs_Plane                                  Non-Planar / Freeform
  (Planar Polygonal Manifold)                     (Cylinder, Cone, Torus, BSpline)
                  │                                               │
    extract_clean_planar_wires()                    BRepMesh_IncrementalMesh
  • BRepTools_WireExplorer                        • compute_optimal_deflection(diag)
  • Zero internal diagonals                       • Linear Deflection: $0.2 - 2.5\text{ mm}$
  • Outer + Inner Cutouts                         • Angular Deflection: $0.40 - 0.65\text{ rad}$
                  │                                               │
                  ▼                                               ▼
          <gmp-polygon-3d>                             Derived RenderMesh Buffers
      Native Web Component Array                      [Positions, Indices, Normals]
```

### 3.3 Multi-Format Parser Matrix

| Format | Classification | Product Tree | Unit Auto-Detection | Color Metadata Extraction |
| :--- | :--- | :--- | :--- | :--- |
| **STEP (AP203/214/242)** | Exact Solid B-Rep | Full Instance Tree | `SI_UNIT` / `CONVERSION_BASED` | `XCAFDoc_ColorTool` / `COLOUR_RGB` |
| **FCStd (FreeCAD)** | XML/B-Rep Archive | Document Parts | Embedded `Document.xml` | Per-Feature Diffuse Color |
| **XBF (Binary B-Rep)** | Compact CAD Stream | Multi-Body List | Native Linear mm | 32-bit Packed RGBA Header |
| **STL (ASCII / Binary)** | Faceted Mesh | Welded Components | Adaptive Scale Metric | Fallback Precision Palette |
| **GLTF / GLB** | Scene Graph Buffer | Node Hierarchy | glTF Asset Unit (Meter $\to$ mm) | PBR BaseColor Factor / Textures |
| **3MF / OBJ / PLY** | Indexed Mesh Hull | Component Groups | Unit Metadata / Normalized | Material Library (`.mtl`) / Vertex RGBA |

### 3.4 Vectorized Zero-Copy Memory Compaction

Raw mesh inputs are scrubbed of non-finite floats ($\text{NaN}, \pm\infty$), out-of-bounds references, and zero-area degenerate triangles using vectorized NumPy operations:

```python
def validate_and_compact_mesh(
    raw_vertices: np.ndarray,
    raw_triangles: np.ndarray,
    tolerance: float = 1e-8
) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    v_arr = np.asarray(raw_vertices, dtype=np.float64)
    t_arr = np.asarray(raw_triangles, dtype=np.int32)
    
    # 1. Finite Vertex Masking
    finite_mask = np.all(np.isfinite(v_arr), axis=1)
    compact_verts = v_arr[finite_mask]
    
    old_to_new = np.full(len(v_arr), -1, dtype=np.int32)
    old_to_new[np.where(finite_mask)[0]] = np.arange(len(compact_verts), dtype=np.int32)
    
    # 2. Triangle Re-indexing
    out_of_bounds = np.any((t_arr < 0) | (t_arr >= len(v_arr)), axis=1)
    remapped_t = old_to_new[np.clip(t_arr, 0, max(0, len(v_arr) - 1))]
    valid_tri_mask = (~out_of_bounds) & (~np.any(remapped_t < 0, axis=1))
    
    filtered_t = remapped_t[valid_tri_mask]
    
    # 3. Degenerate and Zero-Area Elimination
    non_same_mask = (filtered_t[:, 0] != filtered_t[:, 1]) & \
                    (filtered_t[:, 1] != filtered_t[:, 2]) & \
                    (filtered_t[:, 2] != filtered_t[:, 0])
    valid_t = filtered_t[non_same_mask]
    
    p0 = compact_verts[valid_t[:, 0]]
    p1 = compact_verts[valid_t[:, 1]]
    p2 = compact_verts[valid_t[:, 2]]
    cross = np.cross(p1 - p0, p2 - p0)
    area2 = np.linalg.norm(cross, axis=1)
    
    final_indices = valid_t[(area2 > tolerance) & np.isfinite(area2)]
    return compact_verts, final_indices, {"status": "PASS", "vertices": len(compact_verts), "triangles": len(final_indices)}
```

---

## 4. UI & Assistant Components

```
+--------------------------------------------------------------------------------------------------+
|                                  WORKSTATION UI TOPOLOGY                                         |
+--------------------------------------------------------------------------------------------------+
| [TOP SLIDING TOOLBAR (80vw)]                                                                     |
| Row 1: Session Actions | Share & Capture (Snap, Rec MP4) | 12" Primitives (Box, Cyl, Sph, etc.)   |
| Row 2: Transform (Move, Rot, Scale) | Draft 2D Tools | CSnap Toggle | Selection (Part, Face, Edge)|
| Row 3: Features (Extrude, Cross-Sect, Revolve) | Boolean | Modify (Fillet) | Inspect & LinuxCNC |
+--------------------------------+--------------------------------+--------------------------------+
| [LEFT PANEL (320px)]           | [CENTRAL VIEWPORT]             | [RIGHT PANEL (320px)]          |
| Hierarchical Assembly Tree     | <gmp-map-3d> Geospatial Canvas | Action Parameter Panel         |
| Bidirectional Node Sync        | Trackball Navigation Gizmo     | Material & Property Inspector  |
| Vis/Hide/Selection State       | CSnap Predictive Indicators    | Real-Time Telemetry Stream     |
+--------------------------------+--------------------------------+--------------------------------+
| [BOTTOM FLOATING DRAWER]                                                                         |
| Engineering Assistant (Vertex AI Gemini-1.5-Flash / Project: broadcasterfishmap / Global)        |
+--------------------------------------------------------------------------------------------------+
```

### 4.1 CSnap (Continuous Snap) Predictive Engine

CSnap calculates real-time geometric constraints across vertices, midpoints, and continuous edges using view-normal weighting and depth disambiguation:

$$\text{Weight}(S_k) = \left(\frac{1.0}{\|P_{\text{cursor}} - P_{S_k}\|_2 + \epsilon}\right) \cdot \Big(|\vec{n}_{S_k} \cdot \vec{v}_{\text{camera}}| + 0.1\Big)$$

* **Target Classification:** Vertex ($8\text{px}$ target circle), Midpoint ($12\text{px} \times 12\text{px}$ target diamond), Edge (linear projection distance $< 10\text{px}$).
* **Occlusion Check:** Features facing away from camera view direction ($\vec{n} \cdot \vec{v} > 0.05$) are deprioritized or filtered.

### 4.2 Vertex AI Engineering Assistant Gateway

The engineering assistant is powered by Google Cloud Vertex AI (`gemini-1.5-flash`), configured under enterprise project `broadcasterfishmap` with location `global`.

```python
# Context Injection Payload Schema
payload = {
    "system_instruction": {
        "parts": [{
            "text": "You are the Lead Systems Architect and Engineering Assistant for GeoParametric3D. "
                    "B-Rep geometry is authoritative truth; render meshes are derived representations. "
                    "Distinguish exact CAD topology from render triangles. Emit CadQuery executable scripts."
        }]
    },
    "contents": [{
        "role": "user",
        "parts": [{
            "text": f"Active Assembly Context: {json.dumps(cad_state_summary)}\n\nQuery: {user_prompt}"
        }]
    }]
}
```

### 4.3 Social Media Capture & Cam Manufacturing
* **Snapshot Engine:** Multi-layer offscreen canvas compositing (WebGL CAD + Canvas HUD + Engineering Typography). Generates auto-downloading PNG files.
* **Video Stream Capture:** Hardware `MediaStream.captureStream(60)` encoding direct $60\text{ FPS}$ MP4/WebM clips (up to 60 seconds) for Bluesky, Instagram, and Facebook.
* **LinuxCNC Toolpath Digest:** Generates validated ISO 6983 G-code programs (`G21`, `G90`, `G64 P0.01`, `G17`, `M3`) directly from bounding hulls and pocket profiles.

---

## 5. System Telemetry & Pipeline Diagnostics

### 5.1 Telemetry Contract & Schema

```json
{
  "system": "GeoParametric3D Workstation",
  "version": "10.0.0-PROD",
  "status": "READY",
  "canonical_unit": "mm",
  "geodetic_origin": {
    "name": "Null Island Geodetic Origin Anchor",
    "lat": 0.0,
    "lng": 0.0,
    "altitude": 0.0
  },
  "grid": {
    "mesh_spacing": "1 ft (304.8 mm)",
    "max_extent": "2000 ft (609600 mm)"
  },
  "shading": {
    "mode": "100% Opaque Solid",
    "default_opacity": 1.0
  },
  "objects": 1,
  "objectsCount": 1,
  "vertices": 24,
  "totalVertices": 24,
  "fps": 60,
  "vertex_ai": {
    "enabled": true,
    "project_id": "broadcasterfishmap",
    "location": "global",
    "model": "gemini-1.5-flash"
  }
}
```

### 5.2 Pipeline Error Classifications & Quality Gates

```
[INGESTION] ──> FORMAT_DETECTION_ERROR  (Magic byte / header schema mismatch)
     │
     ├──> STEP_IMPORT_ERROR       (Entity syntax corruption / missing product definition)
     │
     ├──> UNIT_CONVERSION_ERROR   (Invalid unit string / unresolvable scale factor)
     │
     ├──> BREP_TOPOLOGY_ERROR     (Non-manifold shells / unsewn boundary wires)
     │
     ├──> SURFACE_EXTRACTION_ERROR(Adaptor failure / degenerate plane basis vectors)
     │
     ├──> TESSELLATION_ERROR      (Deflection divergence / zero-area triangle generation)
     │
     ├──> MESH_VALIDATION_ERROR   (Index out-of-bounds / NaN coordinate rejection)
     │
     └──> JSON_SERIALIZATION_ERROR(Non-finite float traversal at REST/ASGI boundary)
```

### 5.3 Diagnostic Verification Suite

All architectural invariants are verified via continuous integration suites:
1. `test_canonical_geometry.py`: Verifies B-Rep entity preservation, transformation composition, and native representation selection.
2. `test_cad_architecture.py`: Verifies multi-format parsing, finite coordinate scrubbing, and large-scale binary STL streaming ($>50{,}000$ triangles in $<1.5\text{s}$).
3. `test_kernel_math.py`: Verifies exact Signed Distance Fields (Box SDF), boolean field intersection, and volumetric calculations.
4. `test_workstation_repair.py`: Verifies scale dimensionless invariance ($\text{pos}_{\text{initial}} \equiv \text{pos}_{\text{final}}$) and XBF byte roundtripping.
