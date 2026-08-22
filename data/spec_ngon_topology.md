# TECHNICAL SPECIFICATION: CONCAVE N-GON & MULTI-VOID ALPHABET TOPOLOGY EXTRACTION

**Document ID:** GP3D-SPEC-NGON-002  
**Classification:** Computational Geometry & Topological Classification  
**Status:** Approved for Production Implementation  
**Version:** 3.2.0  

---

## 1. Architectural Mandate: Zero Internal Triangulation Diagonals on Planar Faces

Standard WebGL mesh converters divide all faces into triangles. On planar surfaces (such as rectangular baseplates, L-brackets, structural webs, or machine mounts), this introduces visual triangulation diagonals across flat surfaces, distorts selection picking, and inflates index buffers.

GeoParametric3D mandates the **Dual-Route Surface Extractor**:
- **`GeomAbs_Plane`:** Rendered exclusively as true N-Gon closed wire loops (`outerCoordinates` and optional `innerCoordinates`) without interior triangulation.
- **Curved Surfaces (Cylinders, Cones, Spheres, Toroids, NURBS):** Rendered using adaptive chordal deflection.

---

## 2. Arbitrary Concave Perimeter Extraction ('L', 'T', 'E' Topology)

Concave perimeters must be represented as single, unbroken closed boundary loops without partitioning into convex polygons or triangle fans.

### 2.1 The 'L'-Shaped Bracket Canonical Formulation
Consider an 'L'-shaped flange face with 6 boundary vertices:

$$\mathcal{P}_L = \Big\{ \mathbf{v}_1=(0,0,0), \; \mathbf{v}_2=(100,0,0), \; \mathbf{v}_3=(100,20,0), \; \mathbf{v}_4=(20,20,0), \; \mathbf{v}_5=(20,100,0), \; \mathbf{v}_6=(0,100,0) \Big\}$$

```
   (0,100) v6 +-------+ v5 (20,100)
              |       |
              |       |   ZERO TRIANGULATION DIAGONALS
              |       +-------------------+ v3 (100,20)
              |       v4 (20,20)          |
              |                           |
        (0,0) +---------------------------+ (100,0)
              v1                          v2
```

- The boundary wire $\mathcal{W}_{\text{outer}} = (\mathbf{v}_1, \mathbf{v}_2, \mathbf{v}_3, \mathbf{v}_4, \mathbf{v}_5, \mathbf{v}_6)$ has an exact outward normal $\mathbf{\hat{n}} = (0, 0, 1)$.
- Winding order is Counter-Clockwise (CCW) relative to $\mathbf{\hat{n}}$.
- Directly rendered by `<gmp-polygon-3d>` as `outerCoordinates = [v1, v2, v3, v4, v5, v6]`.

---

## 3. Multiply-Connected Domains: Alphabet Genus Matrix

Faces with internal cutouts, void pockets, or bolt patterns constitute multiply-connected surfaces where the outer boundary and interior void boundaries must remain topologically separated.

$$\mathcal{F} = \Omega_{\text{outer}} \setminus \bigcup_{k=1}^K \Omega_{\text{inner}}^{(k)}$$

```
+-----------------------------------------------------------------------------------------+
|                                 ALPHABET TOPOLOGY MATRIX                                |
+--------+--------------------------+-----------------------+-----------------------------+
| Letter | Outer Perimeter (CCW)    | Inner Loops (CW)      | Genus / Manifold Class      |
+--------+--------------------------+-----------------------+-----------------------------+
| **C, E, F, L, T, U, V, W, Z**     | 1 Concave Loop        | 0 Loops (Genus 0)           | Simple Concave Polygon      |
| **A, D, O, P, Q, R**              | 1 Outer Perimeter     | 1 Cutout Void (Genus 1)     | Single-Void Connected       |
| **B**                             | 1 Outer Perimeter     | 2 Cutout Voids (Genus 2)    | Double-Void Connected       |
| **8**                             | 1 Outer Perimeter     | 2 Cutout Voids (Genus 2)    | Double-Void Connected       |
+--------+--------------------------+-----------------------+-----------------------------+
```

### 3.1 Letter 'B' Multi-Void Schema Contract

```json
{
  "face_id": "Face_Letter_B_Top",
  "type": "N_GON_POLYGON_3D",
  "color": "#38bdf8",
  "normal": [0.0, 0.0, 1.0],
  "outer_coordinates": [
    {"lat": 33.881400, "lng": -117.921300, "altitude": 95.0},
    {"lat": 33.881400, "lng": -117.921280, "altitude": 95.0},
    {"lat": 33.881420, "lng": -117.921280, "altitude": 95.0}
  ],
  "inner_coordinates": [
    [
      {"lat": 33.881405, "lng": -117.921295, "altitude": 95.0},
      {"lat": 33.881405, "lng": -117.921285, "altitude": 95.0},
      {"lat": 33.881410, "lng": -117.921285, "altitude": 95.0}
    ],
    [
      {"lat": 33.881412, "lng": -117.921295, "altitude": 95.0},
      {"lat": 33.881412, "lng": -117.921285, "altitude": 95.0},
      {"lat": 33.881418, "lng": -117.921285, "altitude": 95.0}
    ]
  ]
}
```

---

## 4. OCCT Topological Wire & Loop Extractor Implementation

```python
def extract_clean_planar_wires(occ_face: Any, scale: float = 1.0, linear_deflection: float = 0.05) -> Dict[str, Any]:
    exp_wire = TopExp_Explorer(occ_face, TopAbs_WIRE)
    loops = []

    while exp_wire.More():
        occ_wire = TopoDS_Wire_Cast(exp_wire.Current())
        wire_explorer = BRepTools_WireExplorer(occ_wire, occ_face)
        loop_points = []

        while wire_explorer.More():
            occ_edge = wire_explorer.Current()
            curve_adaptor = BRepAdaptor_Curve(occ_edge)
            sampler = GCPnts_QuasiUniformDeflection(curve_adaptor, linear_deflection)
            if sampler.IsDone() and sampler.NbPoints() > 1:
                for i in range(1, sampler.NbPoints() + 1):
                    pnt = sampler.Value(i)
                    loop_points.append([float(pnt.X() * scale), float(pnt.Y() * scale), float(pnt.Z() * scale)])
            else:
                u0, u1 = curve_adaptor.FirstParameter(), curve_adaptor.LastParameter()
                p0, p1 = curve_adaptor.Value(u0), curve_adaptor.Value(u1)
                loop_points.append([float(p0.X() * scale), float(p0.Y() * scale), float(p0.Z() * scale)])
                loop_points.append([float(p1.X() * scale), float(p1.Y() * scale), float(p1.Z() * scale)])
            wire_explorer.Next()

        # Deduplicate vertices within 1e-6 mm
        clean_loop = []
        for pt in loop_points:
            if not clean_loop or np.linalg.norm(np.array(pt) - np.array(clean_loop[-1])) > 1e-6:
                clean_loop.append(pt)
        if len(clean_loop) >= 2 and np.linalg.norm(np.array(clean_loop[0]) - np.array(clean_loop[-1])) < 1e-6:
            clean_loop.pop()
        if len(clean_loop) >= 3:
            loops.append(clean_loop)
        exp_wire.Next()

    return {
        "outer": loops[0] if loops else [],
        "inner": loops[1:] if len(loops) > 1 else []
    }
```
