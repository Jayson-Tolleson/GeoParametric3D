# GeoParametric3D: Enterprise OCCT to `<gmp-map-3d>` CAD/CAM & Geospatial Architecture

**Document Version:** 6.1.0-ENTERPRISE  
**Classification:** Core Solid Modeling, Geospatial Vector Pipeline & Measurement Architecture  
**Canonical Unit:** Linear Millimeters (`mm`)  
**Geospatial Projection:** Local Tangent Plane ENU $\leftrightarrow$ Geodetic WGS84  

---

## 1. System Pipeline Architecture Breakdown

```
[ 3 Upload Pipes ] ──> [ OCCT Byte Parser ] ──> [ NumPy Polygon Machine ] ──> [ <gmp-map-3d> Viewport ]
 (STEP/STL/FCStd)       (B-Rep & Tessellation)    (Coplanar N-Gons & WGS84)     (Native GPU Rendering)
```

| Phase | Component | Responsibilities | Clean Input / Output |
| :--- | :--- | :--- | :--- |
| **1. Ingestion** | 3 Ingestion Pipes | Accepts streaming multi-part CAD byte payloads (STEP AP203/214/242, STL, FCStd, OBJ, 3MF). | `Byte Stream` $\rightarrow$ `Memory-Mapped Buffer` |
| **2. Geometry Engine** | OCCT Parser (`OpenCASCADE`) | Authoritative B-Rep topology extraction, surface classification (`GeomAbs_Plane` vs. curved), adaptive chordal/angular deflection. | `Memory Buffer` $\rightarrow$ `TopoDS_Shape / B-Rep Entities` |
| **3. Vector Engine** | 3D-Polygon Machine | Dissolves coplanar triangles into clean boundary loops; projects local ENU mm coordinates to WGS84 geodetic coordinates. | `TopoDS_Shape` $\rightarrow$ `Packed NumPy (float32 / uint32)` |
| **4. Display Layer** | `<gmp-map-3d>` | Renders native `<gmp-polygon-3d>`, `<gmp-polyline-3d>`, and zero-copy binary WebGL overlays on photorealistic 3D maps. | `Binary ArrayBuffer` $\rightarrow$ GPU DOM Custom Elements |

---

## 2. Ingestion & Byte Parsing Optimizations

### 2.1 Memory-Mapped I/O (`mmap`)
* Eliminates double-buffering between disk, kernel, and Python runtime memory spaces.
* Byte streams write to temporary descriptor backed by `mmap.mmap(fileno, 0, access=mmap.ACCESS_READ)`.
* OCCT C++ handles read memory pointers directly via raw buffers.

### 2.2 Chunked Multiprocessing
* STEP assemblies containing multiple `MANIFOLD_SOLID_BREP` entities are unpacked in an initial lightweight pass.
* Sub-solids are dispatched to a persistent `concurrent.futures.ProcessPoolExecutor` or `ThreadPoolExecutor(max_workers=4)`.
* Independent deflection calculation, wire traversal, and vertex remapping occur in parallel per solid.

### 2.3 STEP AP242 & Mesh Fast-Lane
* **AP242 Tessellation Bypass:** Flag `Interface_Static::SetIVal("read.step.tessellated", 1)` extracts pre-computed faceted geometry when present, eliminating iterative Newton-Raphson boundary projection.
* **Mesh Fast-Lane:** STL, OBJ, and PLY payloads bypass OCCT entirely, routing directly through vectorized `np.frombuffer` binary decoders.

---

## 3. Core NumPy Array Protocol & Schema

```python
import numpy as np

part_data = {
    "part_id": "part_bracket_101",
    "flatness_deg": 0.0,
    "outer_boundary": np.ndarray,  # shape: (N, 3) -> float64 [lat, lng, altitude]
    "holes": [np.ndarray],         # list of (M, 3) arrays for inner cutout loops
    "surface_type": "plane",       # "plane" | "cylinder" | "nurbs" | "freeform"
    "bounding_box_mm": {
        "min": [-152.4, -152.4, 0.0],
        "max": [152.4, 152.4, 304.8],
        "extents": [304.8, 304.8, 304.8]
    }
}
```

---

## 4. Quart / ASGI Streaming & Zero-Copy Binary Serialization

### 4.1 Zero-Copy Transport Contract
* Endpoints `/cad/api/geometry/binary` and `/cad/api/stream-ngons` return raw packed little-endian binary buffers.
* **Header Structure:** 8-byte preamble (`uint32 vertexCount`, `uint32 indexCount`).
* **Vertex Payload:** $N \times 3 \times \text{float32}$ coordinates in local mm.
* **Index Payload:** $M \times \text{uint32}$ triangle index array.
* Frontend slices directly with `new Float32Array(arrayBuffer, 8, vertexCount * 3)` without JSON parsing overhead.

---

## 5. Polygon Reduction & N-Gon Boundary Dissolver

* **Coplanar Clustering:** Triangle normals quantized via $\operatorname{round}(\mathbf{n}, 2)$.
* **Boundary Edge Tracing:** Directed half-edges evaluated; internal shared diagonals ($E_{ij} + E_{ji}$) cancelled.
* **Hole Segregation:** Closed boundary loops sorted by enclosed area; index 0 assigned as outer perimeter, subsequent loops assigned as inner cutouts.
* **DOM Reduction:** Reduces 10,000 planar triangles to 6 native `<gmp-polygon-3d>` elements, eliminating triangular artifacts and maintaining 60 FPS viewport orbit.

---

## 6. Unit System Architecture & Authoritative Imperial Conversion Invariants

### 6.1 Unit Governing Rule
* **Internal Canonical Unit:** Pure Linear Millimeters (`mm`).
* **Raw OCCT B-Rep Values:** Output directly in millimeters (e.g., length $= 1642.218\text{ mm}$).
* **Conversion to Imperial (Inches):** $\text{inches} = \frac{\text{raw\_mm}}{25.4}$ (MUST divide by $25.4$, never multiply).
* **Conversion to Feet:** $\text{feet} = \frac{\text{raw\_mm}}{304.8}$ (MUST divide by $304.8$, never multiply).
* **Volumetric Conversion:** $\text{in}^3 = \frac{\text{cm}^3}{16.387064}$.

### 6.2 Standardized String Formatting Contract
```
Dimensions: 64.654 × 20.000 × 16.312 in (5.388 × 1.667 × 1.359 ft) [1642.2 × 508.0 × 414.3 mm]
```

---

## 7. Mandatory Source Code Modifications

### 7.1 `universal_byte_parser.py` (Measurement Normalization)

```python
# FILE: universal_byte_parser.py
# ENFORCE: Division by 25.4 for inch conversion and 304.8 for foot conversion

def normalize_and_format_measurement(bounds: Dict[str, Any], volume_cm3: float) -> Dict[str, Any]:
    """
    Computes exact dual-unit metric/imperial metrics from canonical mm bounds.
    Enforces division by 25.4 (mm -> inch) and 304.8 (mm -> foot).
    """
    extents_mm = bounds.get("extents", [0.0, 0.0, 0.0])
    dx_mm = float(extents_mm[0])
    dy_mm = float(extents_mm[1])
    dz_mm = float(extents_mm[2])
    
    # Authoritative linear conversion: division by scale constants
    dx_in = dx_mm / 25.4
    dy_in = dy_mm / 25.4
    dz_in = dz_mm / 25.4
    
    dx_ft = dx_mm / 304.8
    dy_ft = dy_mm / 304.8
    dz_ft = dz_mm / 304.8
    
    volume_in3 = (volume_cm3 / 16.387064) if volume_cm3 else 0.0
    
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

### 7.2 `static/js/toolbar.js` (Inspection & Measure Alert)

```javascript
// FILE: static/js/toolbar.js
// ENFORCE: Division by 25.4 for inches and 304.8 for feet in measure handler

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

  // Correct Unit Conversion: Raw MM divided by conversion factors
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

### 7.3 `static/js/viewport.js` (Measurement & Unit Scaling Invariant)

```javascript
// FILE: static/js/viewport.js
// ENFORCE: Correct imperial conversions and dual-unit formatting in tooltips and overlays

export function formatEntityDimensions(extents_mm, volume_cm3 = 0) {
  const dx_mm = extents_mm[0];
  const dy_mm = extents_mm[1];
  const dz_mm = extents_mm[2];

  const dx_in = dx_mm / 25.4;
  const dy_in = dy_mm / 25.4;
  const dz_in = dz_mm / 25.4;

  const dx_ft = dx_mm / 304.8;
  const dy_ft = dy_mm / 304.8;
  const dz_ft = dz_mm / 304.8;

  const vol_in3 = volume_cm3 / 16.387064;

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

## 8. Frontend Viewport Implementation (`<gmp-map-3d>`)

Position camera directly centered over the top of the 3D CAD model box at anchor `(0,0,0)` and stream binary N-gon geometries with medium-small neon outlines (`strokeWidth = 2`).

```javascript
async function loadPolygonData(apiEndpoint) {
  const response = await fetch(apiEndpoint);
  const buffer = await response.arrayBuffer();
  const dataView = new DataView(buffer);
  const mapElement = document.querySelector('gmp-map-3d') || document.getElementById('boatscreen');
  
  let byteOffset = 0;
  while (byteOffset < buffer.byteLength) {
    const vertexCount = dataView.getInt32(byteOffset, true);
    byteOffset += 4;
    
    const faceVertices = [];
    for (let i = 0; i < vertexCount; i++) {
      const lat = dataView.getFloat32(byteOffset, true);
      const lng = dataView.getFloat32(byteOffset + 4, true);
      const alt = dataView.getFloat32(byteOffset + 8, true);
      faceVertices.push({ lat, lng, altitude: alt });
      byteOffset += 12;
    }
    
    const polygon = document.createElement('gmp-polygon-3d');
    polygon.outerCoordinates = faceVertices;
    polygon.fillColor = 'rgba(20, 20, 20, 0.85)';
    polygon.strokeColor = '#00f3ff';
    polygon.strokeWidth = 2;
    polygon.altitudeMode = 'absolute';
    
    mapElement.appendChild(polygon);
  }
}

async function initMap() {
  const { Map3DElement } = await google.maps.importLibrary('maps3d');
  const map = new Map3DElement({
    center: { lat: 33.8814, lng: -117.9213, altitude: 250.0 },
    tilt: 45,
    heading: 30,
    range: 500
  });
  document.getElementById('viewport-container').appendChild(map);
  await loadPolygonData('/cad/api/stream-ngons');
}

document.addEventListener('DOMContentLoaded', initMap);
```

---

## 9. Verification & Mathematical Invariants

* **Single-Point Golden Equivalence:** $12.0\text{ in} \times 25.4 = 304.8\text{ mm}$ internal datum.
* **Measurement Accuracy:** $1642.218\text{ mm} / 25.4 = 64.654\text{ in}$; $1642.218\text{ mm} / 304.8 = 5.388\text{ ft}$.
* **Dimensionless Scale Invariance:** Scale operations mutate object scale vectors $[\sigma_x, \sigma_y, \sigma_z]$ without shifting world translations $\mathbf{p}$.
* **Topological Boundary Truth:** Outer wire loops retain exact clockwise/counter-clockwise orientation relative to surface normals $\mathbf{n}$.
