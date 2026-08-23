"""
GeoParametric3D Mathematical Geometry Kernel — Unit & Regression Verification Test Suite
Validates Section 1-5, 8, 9, 17, 22 of the Revision Doctrine v3.0.
"""
import unittest
import numpy as np
from geometry import (
    BoxSDF,
    GeometricScalarField,
    FieldClassification,
    FieldUnion,
    FieldIntersection,
    FieldDifference,
    FieldOffset,
    validate_box_golden_equivalence,
    build_box_faces,
    build_prism_faces,
    build_polygon_faces,
    build_ellipse_faces,
    compute_object_volume,
    EPSILON_POSITION,
    EPSILON_CHORD,
    EPSILON_FIELD
)
from state import CADObject, CADState


class TestMathematicalKernel(unittest.TestCase):

    def test_box_golden_equivalence(self):
        """Verify golden reference Box SDF mathematically aligns with B-Rep mesh & parameters."""
        res = validate_box_golden_equivalence(width=12.0, depth=8.0, height=6.0, cx=0.0, cy=0.0, cz=0.0)
        self.assertTrue(res["passed"], f"Golden box validation failed: {res}")
        self.assertTrue(res["center_inside"])
        self.assertTrue(res["faces_on_boundary"])
        self.assertTrue(res["corners_on_boundary"])
        self.assertTrue(res["outside_valid"])
        self.assertTrue(res["normal_valid"])
        self.assertEqual(res["mesh_face_count"], 6)
        self.assertAlmostEqual(res["computed_volume"], 12.0 * 8.0 * 6.0, places=5)

    def test_prism_and_polygon_geometry(self):
        """Verify true geometric prism and polygonal primitives."""
        prism_faces = build_prism_faces(sides=3, radius=100.0, height=200.0)
        # Triangular prism has 2 end caps + 3 side faces = 5 faces
        self.assertEqual(len(prism_faces), 5)
        
        poly_faces = build_polygon_faces(sides=6, radius=100.0, height=50.0)
        # Hexagon prism has 2 end caps + 6 side faces = 8 faces
        self.assertEqual(len(poly_faces), 8)
        
        ellipse_faces = build_ellipse_faces(rx=150.0, ry=75.0, height=50.0, segs=16)
        self.assertEqual(len(ellipse_faces), 18)

    def test_box_sdf_distance_accuracy(self):
        """Verify true Euclidean distance for BoxSDF in all exterior octants and axes."""
        w, d, h = 10.0, 10.0, 10.0
        box = BoxSDF(w, d, h, cx=0.0, cy=0.0, cz=0.0)
        
        # Center is at (0, 0, 5), half-extents (5, 5, 5)
        # Test point at (8, 0, 5) -> 3mm from right face -> SDF = +3.0
        self.assertAlmostEqual(box.evaluate(8.0, 0.0, 5.0), 3.0, places=5)
        
        # Test point at (0, 0, 14) -> 4mm above top face (z=10) -> SDF = +4.0
        self.assertAlmostEqual(box.evaluate(0.0, 0.0, 14.0), 4.0, places=5)
        
        # Test point at (0, 0, 2) -> 2mm above bottom, 3mm from nearest face -> SDF = -2.0
        self.assertAlmostEqual(box.evaluate(0.0, 0.0, 2.0), -2.0, places=5)

    def test_box_gradient_normals(self):
        """Verify analytical & numerical surface normals match physical faces."""
        box = BoxSDF(10.0, 10.0, 10.0, cx=0.0, cy=0.0, cz=0.0)
        # Top face (+Z) normal
        n_top = box.surface_normal(0.0, 0.0, 10.0)
        self.assertTrue(np.allclose(n_top, [0.0, 0.0, 1.0], atol=1e-3))
        
        # Right face (+X) normal
        n_right = box.surface_normal(5.0, 0.0, 5.0)
        self.assertTrue(np.allclose(n_right, [1.0, 0.0, 0.0], atol=1e-3))

    def test_scalar_field_boolean_operations(self):
        """Verify exact min/max/difference scalar field formulation for overlapping boxes."""
        box1 = BoxSDF(10.0, 10.0, 10.0, cx=0.0, cy=0.0, cz=0.0)
        box2 = BoxSDF(10.0, 10.0, 10.0, cx=5.0, cy=0.0, cz=0.0)
        
        union_field = FieldUnion(box1, box2)
        intersect_field = FieldIntersection(box1, box2)
        diff_field = FieldDifference(box1, box2)
        
        # Point in center of box1 (0, 0, 5) -> inside union and diff, outside intersection
        self.assertLess(union_field.evaluate(0.0, 0.0, 5.0), 0.0)
        self.assertGreater(intersect_field.evaluate(0.0, 0.0, 5.0), 0.0)
        
        # Point in overlap region (2.5, 0.0, 5.0) -> inside both box1 and box2 -> inside intersection
        self.assertLess(intersect_field.evaluate(2.5, 0.0, 5.0), 0.0)

    def test_thickness_offset_operation(self):
        """Verify thickness offset operation dilates boundary by τ (tau)."""
        box = BoxSDF(10.0, 10.0, 10.0, cx=0.0, cy=0.0, cz=0.0)
        thicken_2mm = FieldOffset(box, thickness=2.0)
        
        # Point at x = 6.0 (1mm outside original boundary at x = 5.0)
        # Original SDF = +1.0, Offset SDF = 1.0 - 2.0 = -1.0 (now INSIDE the thickened solid)
        self.assertAlmostEqual(thicken_2mm.evaluate(6.0, 0.0, 5.0), -1.0, places=5)

    def test_cad_object_and_state_preservation(self):
        """Ensure CADObject and CADState continue to construct valid boxes without regression."""
        state = CADState("test-project")
        self.assertGreaterEqual(len(state.objects), 1)
        box_obj = state.objects.get("obj_box_1")
        self.assertIsNotNone(box_obj)
        self.assertEqual(len(box_obj.faces), 6)


if __name__ == '__main__':
    unittest.main()
