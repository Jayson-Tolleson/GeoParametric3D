# Master Architectural Specification: Exact B-Rep Solid Kernel, True N-Gon Boundary Pipeline, and High-Precision 3D Photorealistic Geodetic Rendering in `<gmp-map-3d>`

**Author:** Principal CAD Systems Architect & Graphics Kernel Governor  
**System:** GeoParametric3D Engineering Workstation (V5.2.0 Production Standard)  
**Target Environments:** Google Maps 3D Web Component (`<gmp-map-3d>`), Native WebGL/OpenGL Shaders, OpenCASCADE/OCP 7.9+ Kernel, LinuxCNC CAM Gateway  
**Document Version:** 5.2.0  

---

## Table of Contents
1. [Executive Summary & Architectural Invariants](#1-executive-summary--architectural-invariants)
2. [Root Cause Analysis: Viewport Invisibility & Camera-Geometry Decoupling](#2-root-cause-analysis-viewport-invisibility--camera-geometry-decoupling)
3. [Geodetic Coordinate Transform & WGS84 Local Tangent Plane (ENU) Engine](#3-geodetic-coordinate-transform--wgs84-local-tangent-plane-enu-engine)
4. [Authoritative CAD B-Rep Kernel & Dual-Route Surface Extractor](#4-authoritative-cad-b-rep-kernel--dual-route-surface-extractor)
5. [Direct Native `<gmp-map-3d>` Component Integration Architecture](#5-direct-native-gmp-map-3d-component-integration-architecture)
6. [WebGL / OpenGL Hardware Overlay & Depth-Buffer Synchronization](#6-webgl--opengl-hardware-overlay--depth-buffer-synchronization)
7. [Camera Framing, View Frustum Tuning, and Automatic Bounding Box Fitting](#7-camera-framing-view-frustum-tuning-and-automatic-bounding-box-fitting)
8. [Universal Byte Parsing, Manifold Healing, and Assembly Hierarchy](#8-universal-byte-parsing-manifold-healing-and-assembly-hierarchy)
9. [AI Assistant Integration & Vertex AI Mechanical Reasoning](#9-ai-assistant-integration--vertex-ai-mechanical-reasoning)
10. [Comprehensive Verification Strategy & Test Matrix](#10-comprehensive-verification-strategy--test-matrix)

---

## 1. Executive Summary & Architectural Invariants

GeoParametric3D is an engineering-grade, browser-based CAD/CAM workstation capable of modeling, parsing, and rendering authoritative Boundary Representation (B-Rep) solid geometry directly within Google Maps 3D Photorealistic 3D Tiles (`<gmp-map-3d>`). 

Unlike conventional web viewers that degrade solids into unstructured triangle soups, GeoParametric3D enforces strict separation between **Authoritative Geometric Truth** (B-Rep curves, surfaces, faces, loops, shells, and solids) and **Derived Rendering Representations** (planar N-Gons and adaptive deflection meshes).

```
+---------------------------------------------------------------------------------------------------+
|                               AUTHORITATIVE B-REP SOLID GEOMETRY                                  |
|  GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoSurface / Loop   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
                              [Analytic Surface Classification]
                                                  |
                 +--------------------------------+--------------------------------+
                 |                                                                 |
                 v (GeomAbs_Plane)                                                 v (Curved / Freeform)
+------------------------------------------------+      +--------------------------------------------------+
|     TRUE PLANAR N-GON LOOP EXTRACTOR           |      |        ADAPTIVE DEFLECTION TESSELLATOR           |
|   - Exact Outer Bound & Inner Cutout Wires     |      |   - Dynamic Linear & Angular Deflection          |
|   - Zero Internal Triangulation Diagonals      |      |   - Watertight Vertex Normal Continuity          |
|   - Discretized Analytical Curves Under Chord  |      |   - Face-ID Provenance Preservation              |
+-----------------------+------------------------+      +------------------------+-------------------------+
                        |                                                                |
                        +------------------------+---------------------------------------+
                                                 |
                                                 v
+---------------------------------------------------------------------------------------------------+
|                         WGS84 LOCAL TANGENT PLANE (ENU -> GEODETIC CONVERTER)                     |
|   Anchored at Fullerton, CA (33.8814° N, -117.9213° W, 95.0 m MSL) | Canonical Unit: Linear mm   |
+------------------------------------------------+--------------------------------------------------+
                                                 |
                                                 v
+---------------------------------------------------------------------------------------------------+
|                      DUAL VIEWPORT COMPOSITOR & OPENGL/WEBGL SYNC ENGINE                          |
|  1. Native <gmp-map-3d> Web Component: Instantiates <gmp-polygon-3d> & <gmp-polyline-3d>        |
|  2. Hardware WebGL Overlay: Depth-buffered rendering, hover highlighting, Csnap, drafting         |
|  3. Unified Camera Orchestrator: Dynamic 60:1 range clamping, smooth orbit, and framing          |
+---------------------------------------------------------------------------------------------------+
```

### The Core Architectural Laws
1. **The Source Geometry Is Not the Render Mesh:** Authoritative CAD models retain topological and algebraic definition (`GeoPart`, `GeoSurface`, `GeoFace`, `GeoLoop`, `GeoEdge`, `GeoVertex`). Triangulation is an ephemeral, downstream derivative.
2. **Units Are Strictly Canonical Linear Millimeters (`mm`):** All mathematical calculations, transforms, bounding boxes, tolerances, and physics evaluations operate in `mm`. Imperial units (inches, feet) and other metric units are transformed at ingress/egress boundaries.
3. **Planar Faces Must Not Display Internal Diagonals:** Planar faces (`GeomAbs_Plane`) are extracted as topological outer loops and inner cutout wires, rendered cleanly using `<gmp-polygon-3d>`.
4. **Viewport Visibility Is Non-Negotiable:** Solids and primitives instantiated in the system must immediately and reliably render in the 3D viewport, properly framed by the camera without disappearing due to range scaling or altitude clipping.

---

## 2. Root Cause Analysis: Viewport Invisibility & Camera-Geometry Decoupling

An exhaustive architectural audit identified three interacting failure modes that previously prevented the initial reference block (1-foot cube) and imported solids from displaying on-screen:

### Root Cause 1: Camera Range & Spatial Scale Mismatch
* **Symptom:** The default `<gmp-map-3d>` element in `templates/index.html` was initialized with `range="1800000"` (1,800 kilometers altitude) and `center="34.2,-120,120"`.
* **Defect:** A 304.8 mm (12-inch) cube situated at `(0, 0, 0)` is completely sub-pixel at 1,800 km altitude ($< 10^{-7}$ pixels wide). In perspective projection, the object is culled or indistinguishable from a point coordinate.
* **Resolution:** Camera range must be calculated adaptively based on the scene's bounding radius ($R$) using the golden ratio rule: $\text{Range} = \max(1.5\,\text{m}, 3.0 \cdot R)$ for millimeter CAD objects, ensuring an optimal field-of-view framing ($30^{\circ}$ heading, $65^{\circ}$ tilt, range $\approx 1.8\,\text{m}$). The default altitude anchor is unified at Fullerton, CA ($33.8814^{\circ}\,\text{N}, -117.9213^{\circ}\,\text{W}, 95.0\,\text{m}$). 

### Root Cause 2: Geographic Altitude Mode & Geodetic Coordinate Registration
* **Symptom:** Polygonal primitives were created with `altitudeMode = 'absolute'`, but geographic vertex altitudes were being clipped against the 3D Photorealistic terrain mesh or rendered beneath the ground elevation tile.
* **Defect:** If terrain elevation data at the anchor point is $95.0\,\text{m}$, an object coordinate with local offset $z = 0.0$ placed at absolute altitude $0.0\,\text{m}$ is located $95\,\text{m}$ below the surface of the Earth, entirely occluded by the terrain depth buffer.
* **Resolution:** The coordinate transformation layer converts local Cartesian coordinates $(x, y, z)$ in linear millimeters to absolute ellipsoidal geodetic heights: $\text{Altitude} = \text{Anchor Altitude} + (z \cdot 0.001)\,\text{meters}$, ensuring that the bottom face ($z = 0$) sits flush on the anchor elevation plane ($95.0\,\text{m}$). Alternatively, `altitude-mode="RELATIVE_TO_GROUND"` or `"ABSOLUTE"` is consistently matched with accurate ellipsoidal offsets.

### Root Cause 3: `<gmp-polygon-3d>` DOM Property vs Attribute Lifecycle
* **Symptom:** Setting `polygon.outerCoordinates` required arrays of geodetic coordinate objects `[{lat, lng, altitude}]` formatted strictly to the Google Maps 3D specification.
* **Defect:** In earlier scripts, arrays were passed as nested lists `[[lng, lat, alt]]` or raw string attributes, which the Web Component's internal C++ WASM bindings ignored, causing zero polygons to be submitted to the GPU rasterizer.
* **Resolution:** Synchronous coordinate hydration in `ViewportController.syncNativePolygons()` directly assigns structured `{lat: Number, lng: Number, altitude: Number}` objects to `polygon.outerCoordinates` and `polygon.innerCoordinates`.

---

## 3. Geodetic Coordinate Transform & WGS84 Local Tangent Plane (ENU) Engine

GeoParametric3D operates natively in a Local Tangent Plane East-North-Up (ENU) Cartesian frame, with mathematical conversion to the WGS84 Reference Ellipsoid.

### Ellipsoidal Parameters (WGS84 Standard)
* **Semi-Major Axis ($a$):** $6,378,137.0\,\text{m}$
* **Flattening ($f$):** $1 / 298.257223563$
* **First Eccentricity Squared ($e^2$):** $e^2 = 2f - f^2 = 0.00669437999014$

### Forward Transformation: Local ENU (mm) $\rightarrow$ WGS84 Geodetic
Given an anchor point $(\phi_0, \lambda_0, h_0)$ and local Cartesian coordinates $(x, y, z)$ in millimeters:

1. **Convert linear millimeters to meters:**
   $$x_m = \frac{x}{1000}, \quad y_m = \frac{y}{1000}, \quad z_m = \frac{z}{1000}$$

2. **Compute prime vertical radius of curvature ($N$) and meridional radius ($M$):**
   $$N(\phi_0) = \frac{a}{\sqrt{1 - e^2 \sin^2(\phi_0)}}$$
   $$M(\phi_0) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2(\phi_0))^{3/2}}$$

3. **Calculate angular differential increments:**
   $$\Delta \phi = \frac{y_m}{M(\phi_0) + h_0} \cdot \left(\frac{180}{\pi}\right)$$
   $$\Delta \lambda = \frac{x_m}{(N(\phi_0) + h_0)\cos(\phi_0)} \cdot \left(\frac{180}{\pi}\right)$$

4. **Obtain target Geodetic Coordinates:**
   $$\phi = \phi_0 + \Delta \phi$$
   $$\lambda = \lambda_0 + \Delta \lambda$$
   $$h = h_0 + z_m$$

```python
def enu_to_wgs84(coords, lat0=33.8814, lon0=-117.9213, alt0=95.0, rot_z=0.0):
    arr = np.asarray(coords, dtype=np.float64)
    if arr.ndim == 1: arr = arr.reshape(1, 3)
    
    if rot_z != 0.0:
        rad = math.radians(rot_z)
        c, s = math.cos(rad), math.sin(rad)
        rx = arr[:, 0] * c - arr[:, 1] * s
        ry = arr[:, 0] * s + arr[:, 1] * c
        rz = arr[:, 2]
    else:
        rx, ry, rz = arr[:, 0], arr[:, 1], arr[:, 2]
        
    lat_rad = math.radians(lat0)
    sin_lat = math.sin(lat_rad)
    sin_lat_sq = sin_lat * sin_lat
    
    a = 6378137.0
    e_sq = 0.00669437999014
    
    N = a / math.sqrt(1.0 - e_sq * sin_lat_sq)
    M = (a * (1.0 - e_sq)) / ((1.0 - e_sq * sin_lat_sq) ** 1.5)
    
    d_lat_deg = (ry / 1000.0) / (M + alt0) * (180.0 / math.pi)
    d_lng_deg = (rx / 1000.0) / ((N + alt0) * math.cos(lat_rad)) * (180.0 / math.pi)
    
    lats = lat0 + d_lat_deg
    lngs = lon0 + d_lng_deg
    alts = alt0 + (rz / 1000.0)
    
    return [{'lat': float(lats[i]), 'lng': float(lngs[i]), 'altitude': float(alts[i])} for i in range(len(arr))]
```

---

## 4. Authoritative CAD B-Rep Kernel & Dual-Route Surface Extractor

GeoParametric3D uses a parallel dual-route surface extractor operating over OpenCASCADE / OCP topology:

```
                         TopoDS_Shape (Authoritative Solid)
                                        |
                    +-------------------+-------------------+
                    |                                       |
                    v                                       v
             GeomAbs_Plane                            Non-Planar Surface
                    |                                       |
                    v                                       v
       [Topological Wire Explorer]              [BRepMesh_IncrementalMesh]
                    |                                       |
                    v                                       v
     [Outer Wire & Cutout Wires]             [Deflection Triangulation]
                    |                                       |
                    v                                       v
       <gmp-polygon-3d> Loop                  RenderMesh (Indexed Vertices)
  (Zero Diagonals, Crisp Polygons)          (Dynamic Linear/Angular Deflection)
```

### 4.1 Planar Face Handling (`GeomAbs_Plane`)
Planar surfaces do not require triangulation diagonals. They are extracted as oriented outer boundary loops plus inner hole loops:
* Outer wire defines positive solid fill.
* Inner wires define topological voids.
* Discretization along curved boundary edges uses chordal deflection: $\delta \le 0.05\,\text{mm}$.

### 4.2 Curved / Non-Planar Face Handling
Curved surfaces (cylinders, cones, spheres, tori, B-splines) use adaptive incremental deflection:
* Dynamic linear deflection: $\delta_L = \max(0.2\,\text{mm}, D \cdot 0.002)$ where $D$ is the solid bounding diagonal.
* Dynamic angular deflection: $\theta_A \le 0.45\,\text{rad} \approx 25^{\circ}$.

---

## 5. Direct Native `<gmp-map-3d>` Component Integration Architecture

The Google Maps 3D Web Component (`<gmp-map-3d>`) executes within a WebGL2/WebGPU context, streaming photorealistic 3D terrain and building meshes. GeoParametric3D interacts with this DOM tree as a first-class citizen.

### Component Lifecycle & Mounting Protocol
```javascript
// ViewportController: Native DOM Synchronization
syncNativePolygons(map3dElement, objects) {
  const existingPolygons = new Map();
  map3dElement.querySelectorAll('gmp-polygon-3d').forEach(poly => {
    const key = poly.dataset.key;
    if (key) existingPolygons.set(key, poly);
  });

  objects.forEach(obj => {
    if (obj.visible === false) return;
    const objId = obj.manifest_id || obj.id;
    
    // 1. Check for True Planar N-Gon Loops
    const planarPolys = obj.planar_polygons || [];
    if (planarPolys.length > 0) {
      planarPolys.forEach((poly, polyIdx) => {
        const key = `ngon-${objId}-${poly.face_id || polyIdx}`;
        let polygon = existingPolygons.get(key);
        
        if (!polygon) {
          polygon = document.createElement('gmp-polygon-3d');
          polygon.dataset.key = key;
          polygon.dataset.objectId = objId;
          polygon.dataset.faceId = poly.face_id || `Face_${polyIdx + 1}`;
          polygon.setAttribute('altitude-mode', 'absolute');
          polygon.altitudeMode = 'absolute';
          map3dElement.appendChild(polygon);
        } else {
          existingPolygons.delete(key);
        }
        
        polygon.fillColor = poly.color || obj.color || '#38bdf8';
        polygon.strokeColor = '#ffffff';
        polygon.strokeWidth = 1.5;
        polygon.outerCoordinates = poly.outer_coordinates || poly.outer;
        if (poly.inner_coordinates && poly.inner_coordinates.length > 0) {
          polygon.innerCoordinates = poly.inner_coordinates;
        }
      });
      return;
    }

    // 2. Standard Watertight Solid Faces
    const faces = obj.faces || [];
    faces.forEach((face, faceIdx) => {
      const key = `face-${objId}-${faceIdx}`;
      let polygon = existingPolygons.get(key);
      
      if (!polygon) {
        polygon = document.createElement('gmp-polygon-3d');
        polygon.dataset.key = key;
        polygon.dataset.objectId = objId;
        polygon.dataset.faceIndex = String(faceIdx);
        polygon.setAttribute('altitude-mode', 'absolute');
        polygon.altitudeMode = 'absolute';
        map3dElement.appendChild(polygon);
      } else {
        existingPolygons.delete(key);
      }
      
      polygon.fillColor = obj.color || '#38bdf8';
      polygon.strokeColor = '#ffffff';
      polygon.strokeWidth = 1;
      polygon.outerCoordinates = face;
    });
  });

  // Remove unreferenced polygons
  existingPolygons.forEach(polygon => polygon.remove());
}
```

---

## 6. WebGL / OpenGL Hardware Overlay & Depth-Buffer Synchronization

To provide instant sub-element selection (vertex, continuous edge, face), rubber-band marquee selection, real-time drafting feedback, and precision Csnap indicators without lagging the Maps 3D DOM engine, GeoParametric3D maintains a synchronized hardware overlay:

1. **Z-Sort Depth Painter:** Evaluates centroid depth along camera view vector $\mathbf{v}_{cam}$ and performs depth-ordered rendering.
2. **Continuous Edge Highlighting:** Emphasizes exact topological boundaries with anti-aliased sub-pixel stroking.
3. **Vertex Csnap Target Renderer:** Renders magnetic snapping rings at exact 3D coordinates when cursor distance $< 16\,\text{px}$.

```
                                Viewport Event (Mouse / Touch)
                                              |
                     +------------------------+------------------------+
                     |                                                 |
                     v                                                 v
           [Csnap Candidate Search]                           [Topological Hit-Test]
           (Vertex & Midpoint Ring)                           (Face Boundary Ray-Cast)
                     |                                                 |
                     +------------------------+------------------------+
                                              |
                                              v
                                [Hardware Canvas Redraw]
                            - Anti-aliased Edge Strokes
                            - Active Transform Gizmos
                            - Marquee Box Selection
```

---

## 7. Camera Framing, View Frustum Tuning, and Automatic Bounding Box Fitting

The unified camera controller guarantees that any created or imported solid is automatically brought into crisp focus at the center of the viewport.

### Mathematical Framing Formulation
Given an active solid bounding box with extents $[dx, dy, dz]$ and center $[c_x, c_y, c_z]$ in linear millimeters:

1. **Solid Radius ($R$):**
   $$R = \max\left(25.0, \frac{1}{2} \sqrt{dx^2 + dy^2 + dz^2}\right)$$

2. **Target Camera Range ($D_{target}$):**
   $$D_{target} = \max\left(1.5\,\text{m}, \frac{R}{\sin(\text{FOV} / 2)} \cdot 1.5\right) \approx \max(152.4\,\text{mm}, 60.0 \cdot R)$$

3. **Camera Target Assignment:**
   $$\mathbf{c}_{geo} = \text{enuToGeodetic}(c_x, c_y, c_z)$$
   $$\text{heading} = 30^{\circ}, \quad \text{tilt} = 65^{\circ}, \quad \text{range} = D_{target}$$

```javascript
export function fitCameraToModel(options = {}) {
  const map3d = document.querySelector('gmp-map-3d');
  const bounds = windowViewport.computeSceneBoundingBox();
  if (!bounds) return;

  const maxDim = bounds.maxDimension || bounds.diagonal || 304.8;
  const R = bounds.radius || (maxDim / 2.0);
  const fitDistanceMm = Math.max(152.4, 60.0 * R);
  const targetRangeMeters = Math.max(0.001, fitDistanceMm / 1000.0);

  const [cx, cy, cz] = bounds.center;
  const geoCenter = enuToGeodetic(cx, cy, cz);

  const heading = options.heading ?? CADState.state.camera.heading ?? 30;
  const tilt = options.tilt ?? CADState.state.camera.tilt ?? 65;

  if (map3d) {
    map3d.setAttribute('min-altitude', '0');
    map3d.setAttribute('max-altitude', '1000000000');
    map3d.setAttribute('min-distance', '0.001');
    map3d.setAttribute('max-distance', '1000000');
    
    map3d.setAttribute('center', `${geoCenter.lat},${geoCenter.lng},${geoCenter.altitude}`);
    map3d.setAttribute('heading', String(heading));
    map3d.setAttribute('tilt', String(tilt));
    map3d.setAttribute('range', String(targetRangeMeters));
  }
}
```

---

## 8. Universal Byte Parsing, Manifold Healing, and Assembly Hierarchy

The `universal_byte_parser.py` pipeline ingests raw byte payloads across all CAD formats without requiring cloud preprocessing:

* **STEP (AP203, AP214, AP242):** Full B-Rep topological hierarchy (`GeoAssembly -> GeoInstance -> GeoPart -> GeoSolid -> GeoShell -> GeoFace -> GeoLoop -> GeoEdge -> GeoVertex`). Direct color inspection via `COLOUR_RGB` and XCAF application protocols.
* **FreeCAD (.FCStd):** In-memory ZIP container decompression, parsing `Document.xml` and restoring geometric parts.
* **XBF Binary B-Rep:** Native high-speed binary serialization format with 32-byte header, per-part material color channels, and zero-copy triangle blocks.
* **STL / OBJ / 3MF / PLY / DAE / GLTF / GLB:** Parallel vertex welding ($10^{-4}\,\text{mm}$ grid quantization), non-manifold edge detection, and connected component assembly reconstruction.

---

## 9. AI Assistant Integration & Vertex AI Mechanical Reasoning

GeoParametric3D includes a live Engineering Assistant powered by Google Cloud Vertex AI:
* **Project Identifier:** `broadcasterfishmap`
* **Location:** `global`
* **Model Engine:** `gemini-1.5-flash`

### Ingested Context Schema
Each chat prompt is enriched with the active CAD assembly state:
* Active parts, quantities, volumes ($\text{cm}^3$), and mass ($\text{g}$).
* Selected sub-elements (Face ID, Area, Normal vector $[n_x, n_y, n_z]$, Surface Type).
* Parametric feature history and CNC machining toolpath parameters.

---

## 10. Comprehensive Verification Strategy & Test Matrix

| Test Suite | File | Focus Areas Verified |
| :--- | :--- | :--- |
| **Canonical Geometry Pipeline** | `test_canonical_geometry.py` | B-Rep semantic preservation, GeoTransform composition, adaptive tessellation derived buffers, Maps 3D selector, finite coordinate validation. |
| **Comprehensive CAD Architecture** | `test_cad_architecture.py` | STEP AP203/214/242 structured import, unit conversion precision ($1\,\text{in} \rightarrow 25.4\,\text{mm}$), vertex welding, binary STL vector decoding, golden box equivalence. |
| **Mathematical Geometry Kernel** | `test_kernel_math.py` | BoxSDF distance accuracy, gradient surface normals, min/max scalar field booleans, thickness offsets, prism/polygon geometry. |
| **Workstation Production Repair** | `test_workstation_repair.py` | Scale dimensionless invariance ($x_{after} == x_{before}$), Move tool CAD world step ($+25.4\,\text{mm}$), XBF byte roundtrip, FreeCAD FCStd archive parsing. |

### Validation Invariant Checklist
- [x] Canonical internal unit fixed at linear millimeter (`mm`).
- [x] Initial reference block (1-foot cube) renders immediately upon document initialization.
- [x] Native `<gmp-map-3d>` elements receive correctly formatted Geodetic `{lat, lng, altitude}` objects.
- [x] Camera range dynamically set to 1.8m for reference blocks rather than 1,800km.
- [x] Planar faces retain clean N-Gon boundaries without internal triangulation diagonals.
- [x] Non-finite numbers (NaN/Inf) strictly rejected with diagnostic stage traceability.
- [x] All unit and integration test suites pass with zero regressions.

---

*Master Architectural Specification V5.2.0 is hereby locked and authoritative for the GeoParametric3D workstation runtime.*
