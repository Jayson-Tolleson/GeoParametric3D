"""
GeoParametric3D Canonical Geometry, Adaptive Tessellation & Maps 3D Integration Test Suite
Verifies Sections 1-30 of the Governing Architecture Specification:
  - Canonical entities independent of render mesh
  - B-Rep preservation: GeoPart, GeoSurface, GeoFace, GeoLoop, GeoEdge, GeoVertex
  - Separate GeoTransform and lightweight GeoInstance handling
  - Adaptive tessellation and derived RenderMesh contract
  - Render representation selector for native <gmp-map-3d> components
  - Pipeline error diagnostics
"""

import unittest
import numpy as np
from canonical_geometry import (
    GeoVertex,
    GeoCurve,
    GeoEdge,
    GeoLoop,
    GeoSurface,
    GeoFace,
    GeoShell,
    GeoSolid,
    GeoPart,
    GeoInstance,
    GeoAssembly,
    GeoTransform,
    CurveType,
    SurfaceType,
    AdaptiveTessellator,
    LODLevel,
    NativeRenderRepresentationType,
    RenderRepresentationSelector,
    GeometryPipelineException,
    GeometryPipelineStage,
    create_canonical_box_part,
    CANONICAL_INTERNAL_UNIT
)


class TestCanonicalGeometryPipeline(unittest.TestCase):

    def test_canonical_box_brep_structure(self):
        """Verify Box is created as pure semantic B-Rep before any tessellation."""
        part = create_canonical_box_part(304.8, 304.8, 304.8)
        self.assertEqual(len(part.vertices), 8)
        self.assertEqual(len(part.edges), 12)
        self.assertEqual(len(part.loops), 6)
        self.assertEqual(len(part.surfaces), 6)
        self.assertEqual(len(part.faces), 6)
        self.assertEqual(len(part.shells), 1)
        self.assertEqual(len(part.solids), 1)

        # Each face has an outer loop with exactly 4 edges
        for face in part.faces.values():
            loop = part.loops[face.outer_loop_id]
            self.assertEqual(len(loop.ordered_edge_ids), 4)

    def test_transform_composition_and_instancing(self):
        """Verify transformations and instancing maintain single geometry with multiple transforms."""
        part = create_canonical_box_part(100.0, 100.0, 100.0)
        assembly = GeoAssembly("asm_main", "Test Assembly")
        assembly.add_part(part)

        # Create 100 lightweight instances
        for i in range(100):
            trsf = GeoTransform.translation(i * 150.0, 0.0, 0.0)
            assembly.create_instance(part.id, trsf, name=f"Instance_{i+1}")

        self.assertEqual(len(assembly.parts), 1, "Geometry definition must not be duplicated")
        self.assertEqual(len(assembly.instances), 100)

        # Test transform point math
        t_move = GeoTransform.translation(10.0, 20.0, 30.0)
        t_rot = GeoTransform.rotation_z(90.0)
        combined = t_move.compose(t_rot)
        pt = np.array([10.0, 0.0, 0.0])
        res = combined.apply_point(pt)
        self.assertAlmostEqual(res[0], 10.0, places=4)
        self.assertAlmostEqual(res[1], 30.0, places=4)
        self.assertAlmostEqual(res[2], 30.0, places=4)

    def test_adaptive_tessellation_derived_mesh(self):
        """Verify tessellation generates clean render buffers without modifying source canonical part."""
        part = create_canonical_box_part(304.8, 304.8, 304.8)
        tessellator = AdaptiveTessellator(chordal_tolerance=0.05)
        render_mesh = tessellator.tessellate_part(part, LODLevel.HIGH_LOD3)

        # 6 faces of box -> 12 triangles
        self.assertEqual(len(render_mesh.indices), 12)
        self.assertEqual(len(render_mesh.vertices), 8)
        self.assertTrue(np.isfinite(render_mesh.vertices).all())
        # Canonical part remains intact
        self.assertEqual(len(part.faces), 6)

    def test_native_render_representation_selection(self):
        """Verify selection of native Maps 3D representations over raw triangles where appropriate."""
        part = create_canonical_box_part(304.8, 304.8, 304.8)
        first_face = list(part.faces.values())[0]
        first_surf = part.surfaces[first_face.surface_id]

        rep = RenderRepresentationSelector.select_face_representation(first_surf, first_face, 4)
        self.assertEqual(rep, NativeRenderRepresentationType.NATIVE_POLYGON_3D)

        curve = part.add_curve(CurveType.CIRCLE, {"radius": 50.0})
        curve_rep = RenderRepresentationSelector.select_curve_representation(curve)
        self.assertEqual(curve_rep, NativeRenderRepresentationType.NATIVE_POLYLINE_3D)

    def test_finite_coordinate_validation_exception(self):
        """Verify strict rejection of NaN / Infinite coordinates with pipeline diagnostic stage."""
        with self.assertRaises(GeometryPipelineException) as cm:
            GeoVertex("v_bad", [np.nan, 0.0, 0.0])
        self.assertEqual(cm.exception.stage, GeometryPipelineStage.CANONICALIZATION)


if __name__ == '__main__':
    unittest.main()
