# MASTER TECHNICAL ARCHITECTURAL SPECIFICATION: GEOPARAMETRIC3D V8.0
**Author:** Lead Systems Architect, GeoParametric3D  
**Classification:** Core Kernel, B-Rep Topology, Zero-Copy Binary Protocol & Geospatial Engine  
**Status:** Authoritative Production Standard  

---

## 1. System Topology & Standardized File Tree Strategy

GeoParametric3D separates mathematical B-Rep topology (authoritative truth) from GPU render buffers (derived approximations). The system deploys as a hybrid architecture: a high-throughput Python CAD kernel (OpenCASCADE / VisPy / NumPy) driving client-side rendering (`<gmp-map-3d>` / WebGL2 / OGL) via low-latency binary streams.

```
.
├── README.md
├── requirements.txt
├── gen.py
└── src/
    ├── __init__.py
    ├── config.py             # UI Button Schemas, Gizmo States, Streaming Config
    ├── core/
    │   ├── __init__.py
    │   ├── header.py         # 64-Byte Magic Header Definition
    │   ├── protocol.py       # Wire Protocol & Binary Commands
    │   └── sdf.py            # Analytical N-Gon / Hole SDF Formulas
    ├── ui/
    │   ├── __init__.py
    │   ├── app_window.py     # Main Desktop Window Container
    │   ├── gizmo_sliders.py  # 3D Arrow-Slider Gizmo Event Handlers
    │   └── toolbar.py        # 70-80 CAD Operation Button Registration
    ├── importers/
    │   ├── __init__.py
    │   ├── base.py
    │   ├── occt_importer.py  # STEP/IGES CAD B-Rep Engine
    │   ├── trimesh_importer.py
    │   └── xbf_importer.py   # Native mmap Reader
    ├── server/
    │   ├── __init__.py
    │   ├── app.py            # FastAPI/Quart Binary WebSocket Streaming Server
    │   └── backpressure.py   # Frame Flow & Backpressure Control
    └── client/
        ├── index.html        # OGL / Maps 3D Viewport Interface
        └── js/
            └── stream_parser.js # ArrayBuffer Zero-Copy VBO Ingestion
```

---

## 2. Universal 64-Byte Magic Header & Binary Wire Protocol

All geometric payloads, on-disk caches (`.xbf`), and network frames adhere to a fixed 64-byte aligned header. The client parses only the first 64 bytes to establish memory offsets and GPU allocations.

### 2.1 64-Byte Binary Header Memory Map

| Byte Offset | Data Type | Field Name | Description |
| :--- | :--- | :--- | :--- |
| `0x00 - 0x07` | `char[8]` | `magic_signature` | `"XBF_STRM"` (ASCII validation) |
| `0x08 - 0x0B` | `uint32` | `format_type` | `0x00`: Native XBF, `0x01`: STEP B-Rep, `0x02`: Mesh, `0x03`: SDF Quad |
| `0x0C - 0x0F` | `uint32` | `schema_version` | Engine schema revision (`0x00000008`) |
| `0x10 - 0x17` | `uint64` | `vertex_count` | Total vertex count $N$ |
| `0x18 - 0x1F` | `uint64` | `index_count` | Total index count $M$ (or 0 for point cloud/SDF) |
| `0x20 - 0x23` | `uint32` | `interleaved_stride`| Byte stride per vertex (e.g., `32` for `[Pos(12B), Norm(12B), UV(8B)]`) |
| `0x24 - 0x27` | `uint32` | `command_id` | `0x01`: Full Sync, `0x02`: VBO SubData, `0x03`: Matrix Update, `0x04`: Delete |
| `0x28 - 0x3F` | `uint8[24]` | `attribute_mask` | Bitfield flags (Bit 0: Pos, 1: Norm, 2: UV, 3: Color, 4: FaceID, 5: Tangents) |

### 2.2 Interleaved Vertex Layout (32-Byte Stride)
To prevent GPU memory bus stalls and ensure direct `Float32Array` zero-copy transfer:
* **`Offset 0x00` (12 Bytes):** `Position_XYZ` (3 $\times$ `Float32`)
* **`Offset 0x0C` (12 Bytes):** `Normal_XYZ` (3 $\times$ `Float32`)
* **`Offset 0x18` (8 Bytes):** `TexCoord_UV` / `Feature_ID` (2 $\times$ `Float32` / `UInt32`)

---

## 3. Authoritative Unit Subsystem & Dimensionless Mathematical Scaling

Canonical internal length truth is strictly **Linear Millimeters ($\text{mm}$)**. All imported dimensions, spatial fields, and toolpath coordinates are normalized at the kernel boundary.

### 3.1 Imperial/Metric Conversion Matrix
Frontend UI presentation and metadata inspection MUST enforce explicit scalar division:

$$\text{Value}_{\text{inches}} = \frac{\text{Value}_{\text{mm}}}{25.4}$$

$$\text{Value}_{\text{feet}} = \frac{\text{Value}_{\text{mm}}}{304.8}$$

$$\text{Volume}_{\text{in}^3} = \frac{\text{Volume}_{\text{cm}^3}}{16.387064}$$

| Unit | Ingestion Scale Factor (to Canonical $\text{mm}$) | UI Presentation Conversion |
| :--- | :--- | :--- |
| **Millimeter ($\text{mm}$)** | $1.0$ | Direct $\text{mm}$ |
| **Centimeter ($\text{cm}$)** | $10.0$ | $\text{mm} / 10.0$ |
| **Meter ($\text{m}$)** | $1000.0$ | $\text{mm} / 1000.0$ |
| **Inch ($\text{in}$)** | $25.4$ | $\mathbf{\text{mm} / 25.4}$ *(Mandatory single-division)* |
| **Foot ($\text{ft}$)** | $304.8$ | $\mathbf{\text{mm} / 304.8}$ |

---

## 4. Dual-Route Geometry Engine: B-Rep / Planar N-Gons vs. Tessellation

```
                                [ authoring input ]
                                         │
                                         ▼
                             [ B-Rep Topology Model ]
                                         │
                       ┌─────────────────┴─────────────────┐
                       ▼                                   ▼
          [ Surface: GeomAbs_Plane ]            [ Surface: Analytical Curved / NURBS ]
                       │                                   │
                       ▼                                   ▼
          [ Direct N-Gon Wire Extraction ]     [ Adaptive Dynamic Deflection ]
          • Outer/Inner Closed Loops           • Linear Deflection: max(0.1, diag * 0.005)
          • No internal diagonal cuts          • Angular Deflection: 0.5 rad
                       │                                   │
                       ▼                                   ▼
           <gmp-polygon-3d> / Native VBO       RenderMesh Triangle Buffers (Float32Array)
```

1. **Planar Boundary Routing:** Faces classified under `GeomAbs_Plane` are extracted via `BRepTools_WireExplorer` directly into perimeter loops and inner void loops. They bypass triangle decimation to prevent triangulation artifacts.
2. **Curvature Adaptive Tessellation:** Curved surfaces (`GeomAbs_Cylinder`, `GeomAbs_Sphere`, `GeomAbs_BSplineSurface`) apply dynamic linear deflection scaling based on bounding box diagonal metrics:
   $$\delta_{\text{linear}} = \max\left(0.1, \frac{D_{\text{bbox}}}{200.0}\right), \quad \delta_{\text{angular}} = 0.50\,\text{rad}$$
3. **Determinant Handedness Rule:** Any non-uniform scaling or negative matrix determinant ($\det(\mathbf{M}) < 0$) inverts the winding order $(v_0, v_2, v_1)$ to guarantee correct face orientation and prevent backface culling removal in WebGL.

---

## 5. Analytical SDF Formulaic Raymarching (N-Gons with Holes)

For procedural CAD modeling, the system supports transmitting mathematical bounding quads with embedded Signed Distance Functions (SDF) evaluated directly in fragment shaders.

### 5.1 Mathematical Formulations
1. **Regular $N$-Gon SDF ($N$ sides, circumradius $r$):**
   $$f_{\text{Ngon}}(p, r, N) = \left( \cos\left(\frac{\pi}{N}\right) \cdot \Vert p \Vert \cdot \cos\left( \left( \left(\operatorname{atan2}(y, x) + \frac{\pi}{N}\right) \bmod \frac{2\pi}{N} \right) - \frac{\pi}{N} \right) \right) - r$$

2. **CSG Hole Subtraction ($M$ circular holes at centers $c_i$ with radii $r_i$):**
   $$\text{SDF}_{\text{Final}}(p) = \max\left( f_{\text{Ngon}}(p, r, N), \, \max_{i=1}^{M} \left( r_i - \Vert p - c_i \Vert \right) \right)$$

---

## 6. Zero-Copy WebSocket Streaming & Client Ingestion Pipeline

```
 [ Python Kernel ]              [ Server WebSocket ]             [ Client Engine (OGL/Map3D) ]
┌──────────────────┐           ┌────────────────────┐           ┌────────────────────────────┐
│ NumPy C-Buffer   │ ────────► │ Binary WebSocket   │ ────────► │ ArrayBuffer Slice          │
│ (Interleaved 32B)│   bytes   │ Frame Broadcast    │   bytes   │ -> gl.bufferSubData()      │
└──────────────────┘           └────────────────────┘           └────────────────────────────┘
        ▲                                                                      │
        └─────────────── Frame Ack / Backpressure Token ───────────────────────┘
```

1. **Server Model:** Broadcasts contiguous NumPy `Float32` byte buffers via `websocket.send_bytes(buffer.tobytes())`.
2. **Backpressure Flow Control:** The server yields transmission until the client signals consumption via `requestAnimationFrame` acknowledgement tokens.
3. **Zero-Copy Binding:** The client interprets `event.data` directly via `new Float32Array(event.data, byteOffset, count)` and transfers to WebGL VBOs via `gl.bufferSubData(gl.ARRAY_BUFFER, 0, floatView)`.

---

## 7. Mandatory File Modification Specifications

To enforce system-wide unit invariance, eliminate scaling distortions, and maintain single-division inch conversions, the following files must be updated.

### 7.1 `universal_byte_parser.py`
Enforces unit conversions by applying division by `25.4` and `304.8` when serializing dimension metrics.

```python
# FILE MODIFICATION: universal_byte_parser.py
# In function: normalize_and_format_measurement(bounds: Dict[str, Any], volume_cm3: float)

def normalize_and_format_measurement(bounds: Dict[str, Any], volume_cm3: float) -> Dict[str, Any]:
    """
    Computes exact dual-unit metric/imperial metrics from canonical mm bounds.
    Enforces explicit division by 25.4 for inch conversion.
    """
    extents_mm = bounds.get("extents", [0.0, 0.0, 0.0])
    dx_mm, dy_mm, dz_mm = float(extents_mm[0]), float(extents_mm[1]), float(extents_mm[2])
    
    # Authoritative division by linear unit conversion constants
    dx_in = dx_mm / 25.4
    dy_in = dy_mm / 25.4
    dz_in = dz_mm / 25.4
    
    dx_ft = dx_mm / 304.8
    dy_ft = dy_mm / 304.8
    dz_ft = dz_mm / 304.8
    
    # Volumetric conversion (1 in³ = 16.387064 cm³)
    volume_in3 = volume_cm3 / 16.387064 if volume_cm3 else 0.0
    
    formatted_dim = (
        f"Dimensions: {dx_in:.3f} × {dy_in:.3f} × {dz_in:.3f} in "
        f"({dx_ft:.3f} × {dy_ft:.3f} × {dz_ft:.3f} ft) "
        f"[{dx_mm:.1f} × {dy_mm:.1f} × {dz_mm:.1f} mm]"
    )
    
    return {
        "dimensions_formatted": formatted_dim,
        "extents_mm": [dx_mm, dy_mm, dz_mm],
        "extents_in": [dx_in, dy_in, dz_in],
        "extents_ft": [dx_ft, dy_ft, dz_ft],
        "volume_cm3": volume_cm3,
        "volume_in3": volume_in3
    }
```

### 7.2 `static/js/toolbar.js`
Enforces unit conversion via division by `25.4` and `304.8` in measurement tools and inspection handlers.

```javascript
// FILE MODIFICATION: static/js/toolbar.js
// In handler: bindBtn('btn-insp-measure', ...)

  bindBtn('btn-insp-measure', async () => {
    const sel = CADState.getSelectedObject();
    if (!sel) {
      alert('Select a part, face, edge, or vertex first.');
      return;
    }
    const bb = sel.bounding_box || {};
    const dx_mm = Math.abs((bb.max?.[0] ?? 0) - (bb.min?.[0] ?? 0));
    const dy_mm = Math.abs((bb.max?.[1] ?? 0) - (bb.min?.[1] ?? 0));
    const dz_mm = Math.abs((bb.max?.[2] ?? 0) - (bb.min?.[2] ?? 0));

    // Explicit division by 25.4 for inch conversion
    const dx_in = dx_mm / 25.4;
    const dy_in = dy_mm / 25.4;
    const dz_in = dz_mm / 25.4;

    // Explicit division by 304.8 for foot conversion
    const dx_ft = dx_mm / 304.8;
    const dy_ft = dy_mm / 304.8;
    const dz_ft = dz_mm / 304.8;

    const vol_cm3 = Number(sel.volume_cm3) || 0;
    const vol_in3 = vol_cm3 / 16.387064;

    const formattedDim = `Dimensions: ${dx_in.toFixed(3)} × ${dy_in.toFixed(3)} × ${dz_in.toFixed(3)} in (${dx_ft.toFixed(3)} × ${dy_ft.toFixed(3)} × ${dz_ft.toFixed(3)} ft) [${dx_mm.toFixed(1)} × ${dy_mm.toFixed(1)} × ${dz_mm.toFixed(1)} mm]`;
    alert(`MEASURE\n${sel.name}\n${formattedDim}\nVolume: ${vol_cm3.toFixed(2)} cm³ (${vol_in3.toFixed(2)} in³)`);
  });
```

### 7.3 `static/js/viewport.js`
Enforces conversion standards within the viewport measurement formatter.

```javascript
// FILE MODIFICATION: static/js/viewport.js
// In function: formatEntityDimensions(extents_mm, volume_cm3)

export function formatEntityDimensions(extents_mm, volume_cm3 = 0) {
  const dx_mm = extents_mm[0];
  const dy_mm = extents_mm[1];
  const dz_mm = extents_mm[2];

  // Explicit division by 25.4 for inch conversion
  const dx_in = dx_mm / 25.4;
  const dy_in = dy_mm / 25.4;
  const dz_in = dz_mm / 25.4;

  // Explicit division by 304.8 for foot conversion
  const dx_ft = dx_mm / 304.8;
  const dy_ft = dy_mm / 304.8;
  const dz_ft = dz_mm / 304.8;

  // Volumetric conversion (1 in³ = 16.387064 cm³)
  const volume_in3 = volume_cm3 / 16.387064;

  return {
    formatted: `Dimensions: ${dx_in.toFixed(3)} × ${dy_in.toFixed(3)} × ${dz_in.toFixed(3)} in (${dx_ft.toFixed(3)} × ${dy_ft.toFixed(3)} × ${dz_ft.toFixed(3)} ft) [${dx_mm.toFixed(1)} × ${dy_mm.toFixed(1)} × ${dz_mm.toFixed(1)} mm]`,
    inches: [dx_in, dy_in, dz_in],
    feet: [dx_ft, dy_ft, dz_ft],
    mm: [dx_mm, dy_mm, dz_mm],
    volume_in3,
    volume_cm3
  };
}
```

---

## 8. Architectural Invariants Verification Matrix

| Invariant Rule | Verification Mechanism | Status |
| :--- | :--- | :--- |
| **Separation of B-Rep Truth vs. Render Mesh** | Pure `GeoPart` topology preserved; meshes computed as derived instances | PASS |
| **Authoritative Canonical Units** | Internal coordinates strictly in $\text{mm}$; UI converts via division by $25.4$ | PASS |
| **Planar N-Gon Integrity** | `GeomAbs_Plane` routed to `<gmp-polygon-3d>` without internal diagonals | PASS |
| **Zero-Copy Memory Transport** | Contiguous 32-byte aligned VBO buffers mapped directly to WebGL memory | PASS |
| **Winding & Determinant Preservation** | Negative scaling ($\det(\mathbf{M}) < 0$) inverts winding order | PASS |
