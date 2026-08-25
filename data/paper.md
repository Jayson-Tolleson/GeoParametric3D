# MASTER ARCHITECTURAL SPECIFICATION: AUTHORITATIVE UNIT SUBSYSTEM & CANONICAL PIPELINE STANDARDIZATION

**System:** GeoParametric3D Authoritative Cloud CAD/CAM Workstation  
**Document Version:** 8.0.0-PROD-STANDARDIZATION  
**Status:** Mandatory Architectural Invariant  
**Classification:** Core Geometry, B-Rep Ingestion & Geospatial Coordinate Contract  

---

## 1. Executive Summary & Root-Cause Forensic Audit

A cross-subsystem forensic audit evaluated ingestion vectors, kernel transformations, B-Rep construction stages, rendering projections, and frontend serialization pathways to resolve unit scaling discrepancies and bridge desktop/cloud pipelines.

```
+-------------------------------------------------------------------------------------------------------+
|                                  INSPECTION & INGESTION TAXONOMY                                      |
+-------------------------------------------------------------------------------------------------------+
| A. STEP Reader Scale Fault     | TopoDS_Shape length units mismatched with declared exchange scale     |
| B. Canonical Distortion        | Ingestion pipeline applied redundant conversion multipliers          |
| C. Tessellation Scaling Fault  | Chordal deflection evaluated in disparate unit space                  |
| D. Viewport Adapter Corruption | UI layer scaled underlying geometries instead of presentation values |
| E. Geodetic Projection Error   | Local mm -> WGS84 Geodetic conversion double-scaled meter altitudes  |
+-------------------------------------------------------------------------------------------------------+
```

### Forensic Diagnosis Across Architecture Layers
1. **Layer A (STEP Header vs Kernel Read):** `STEPControl_Reader` without explicit unit static configuration defaulted coordinates to millimeter assumptions regardless of whether `CONVERSION_BASED_UNIT('INCH', ...)` or `LENGTH_UNIT()` was declared in the STEP schema.
2. **Layer B (Canonical Transformation Multiplication):** The parser extracted `scale_to_canonical` from header tokens, yet simultaneously accepted OCCT coordinates where internal scaling had already been executed, causing $(25.4)^2$ double-scaling on inch models.
3. **Layer C (Tessellation Metric):** Linear deflection was hardcoded to scalar constants ($0.1$) without adjusting for bounding box diagonal metrics expressed in canonical millimeters.
4. **Layer D (Frontend Unit Drift):** Measurement tools and inspection handlers evaluated `extents_mm` using arbitrary multiplication factors instead of strict single-point division by authoritative constants ($25.4$ for inches, $304.8$ for feet).

---

## 2. Standardized File Tree Strategy

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

## 3. Authoritative Unit Subsystem & Conversion Constants

Canonical internal length truth is strictly **Linear Millimeters ($\text{mm}$)**. All imported dimensions, B-Rep geometries, and internal calculations are normalized once at ingestion. Conversions to user presentation units must strictly perform explicit division.

$$\text{Value}_{\text{in}} = \frac{\text{Value}_{\text{mm}}}{25.4}, \quad \text{Value}_{\text{ft}} = \frac{\text{Value}_{\text{mm}}}{304.8}, \quad \text{Volume}_{\text{in}^3} = \frac{\text{Volume}_{\text{cm}^3}}{16.387064}$$

### Core Unit Table

| Unit Identifier | Normalization Factor to Canonical ($\text{mm}$) | Display Calculation from Canonical ($\text{mm}$) |
| :--- | :--- | :--- |
| `mm`, `millimeter` | $1.0$ | $\text{val} / 1.0$ |
| `cm`, `centimeter` | $10.0$ | $\text{val} / 10.0$ |
| `m`, `meter` | $1000.0$ | $\text{val} / 1000.0$ |
| `in`, `inch`, `"` | $25.4$ | $\mathbf{\text{val} / 25.4}$ |
| `ft`, `foot`, `'` | $304.8$ | $\mathbf{\text{val} / 304.8}$ |

---

## 4. Binary Wire Protocol & 64-Byte Magic Header

To eliminate JSON serialization bottlenecks, geometry updates flow over WebSockets as contiguous binary blocks prefixed by a fixed 64-byte header.

```
 0x00               0x08           0x0C          0x10          0x18                0x20                 0x40
┌──────────────────┬──────────────┬─────────────┬─────────────┬───────────────────┬────────────────────┐
│ Magic Identifier │ Format Type  │ Schema Ver  │ Vertex Count│ Interleaved Stride│ Attribute Mask     │
│  "XBF_STREAM\0"  │ (Enum U32)   │ (U32)       │ (U64)       │ (U32, e.g. 32B)   │ (Flags U256/32B)   │
└──────────────────┴──────────────┴─────────────┴─────────────┴───────────────────┴────────────────────┘
```

### Interleaved Vertex Buffer Architecture (32-Byte Stride)
* **Bytes 00–11:** `Position [X, Y, Z]` — 3 $\times$ `Float32` (12 Bytes)
* **Bytes 12–23:** `Normal [Nx, Ny, Nz]` — 3 $\times$ `Float32` (12 Bytes)
* **Bytes 24–27:** `TexCoord [U, V]` or `FaceID` — 2 $\times$ `Float16` / `UInt32` (4 Bytes)
* **Bytes 28–31:** `Color RGBA / Scalar Value` — 4 $\times$ `UInt8` / 1 $\times$ `Float32` (4 Bytes)

---

## 5. Analytical $N$-Gon with Holes SDF Kernel

For planar faces and cutout voids, geometry evaluation is delegated to GPU fragment shaders via Signed Distance Functions rather than generating internal triangle diagonals:

$$f_{\text{Ngon}}(p, r, N) = \left( \cos\left(\frac{\pi}{N}\right) \cdot \Vert p \Vert \cdot \cos\left( \left( \left(\arctan(y, x) + \frac{\pi}{N}\right) \bmod \frac{2\pi}{N} \right) - \frac{\pi}{N} \right) \right) - r$$

$$\text{SDF}_{\text{Final}}(p) = \max\left( f_{\text{Ngon}}(p, r, N), \, \max_{i=1}^{M} \left( r_i - \Vert p - c_i \Vert \right) \right)$$

---

## 6. Mandatory File Modifications

### 6.1 `universal_byte_parser.py` (Enforcing Unit Division)

```python
# FILE MODIFICATION: universal_byte_parser.py
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

### 6.2 `static/js/toolbar.js` (Enforcing Unit Division)

```javascript
// FILE MODIFICATION: static/js/toolbar.js
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

  // Authoritative division by 25.4 for inches and 304.8 for feet
  const dx_in = dx_mm / 25.4;
  const dy_in = dy_mm / 25.4;
  const dz_in = dz_mm / 25.4;

  const dx_ft = dx_mm / 304.8;
  const dy_ft = dy_mm / 304.8;
  const dz_ft = dz_mm / 304.8;

  const vol_cm3 = Number(sel.volume_cm3) || 0;
  const vol_in3 = vol_cm3 / 16.387064;

  const formattedDim = `Dimensions: ${dx_in.toFixed(3)} × ${dy_in.toFixed(3)} × ${dz_in.toFixed(3)} in (${dx_ft.toFixed(3)} × ${dy_ft.toFixed(3)} × ${dz_ft.toFixed(3)} ft) [${dx_mm.toFixed(1)} × ${dy_mm.toFixed(1)} × ${dz_mm.toFixed(1)} mm]`;
  alert(`MEASURE\n${sel.name}\n${formattedDim}\nVolume: ${vol_cm3.toFixed(2)} cm³ (${vol_in3.toFixed(2)} in³)`);
});
```

### 6.3 `static/js/viewport.js` (Enforcing Unit Division)

```javascript
// FILE MODIFICATION: static/js/viewport.js
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

## 7. Quality Gates & Regression Verification

1. **Unit Invariant Gate:** Any calculation transforming canonical $\text{mm}$ to imperial display dimensions must strictly divide by $25.4$ ($\text{in}$) or $304.8$ ($\text{ft}$).
2. **Deterministic Mesh Contract:** NumPy positions must be `float64`/`float32` arrays of shape $(N, 3)$ with zero $\text{NaN}$ or infinite coordinates.
3. **Zero-Copy Streaming:** Binary endpoints must transmit raw `Float32Array` buffers with 64-byte headers, avoiding per-frame JSON overhead.
4. **Authoritative B-Rep Separation:** Visual meshes are derived tessellations and must never mutate canonical topological solid truth.
