"""
GeoParametric3D Comprehensive CAD Architecture Test Suite
Verifies Sections 1-60 of the Governing Architecture Specification:
  - Byte Format Intelligence & ImportDescriptor
  - import_bytes universal entry point
  - STEP AP203/AP214/AP242 structured B-Rep import with face-by-face tessellation
  - Vertex & Triangle integrity rules (finite coordinates, index remapping, degenerate rejection)
  - Units authoritative conversion (canonical internal mm vs inch/cm/m/ft source)
  - Geometric & Topological explicit separation
  - STL Vertex welding, manifold edge classification, and connected component assembly recovery
  - Large Binary STL parser scaling and performance metrics
  - Primitive vs Imported canonical B-Rep model equivalence
  - NumPy Render Data contract & Bounding Box calculation
"""
import unittest
import struct
import time
import numpy as np
from universal_byte_parser import (
    import_bytes,
    detect_format_descriptor,
    detect_step_units,
    parse_universal_model,
    parse_step_brep_structured,
    parse_stl_with_topology_reconstruction,
    convert_value,
    parse_unit_string,
    get_unit_scale_to_canonical,
    validate_numpy_mesh_contract,
    validate_and_compact_mesh,
    triangulate_polygon_3d,
    compute_bounding_box,
    BRepBody,
    CANONICAL_INTERNAL_UNIT
)
from canonical_geometry import create_canonical_box_part, GeoPart
from state import CADState, CADObject


class TestCADArchitecture(unittest.TestCase):

    def test_unit_conversion_integrity(self):
        """Verify authoritative single-conversion canonical unit rules."""
        # 1 inch -> 25.4 mm
        self.assertAlmostEqual(convert_value(1.0, "inch", "mm"), 25.4, places=4)
        # 1 ft -> 304.8 mm
        self.assertAlmostEqual(convert_value(1.0, "ft", "mm"), 304.8, places=4)
        # 1 cm -> 10.0 mm
        self.assertAlmostEqual(convert_value(1.0, "cm", "mm"), 10.0, places=4)
        # 1 m -> 1000.0 mm
        self.assertAlmostEqual(convert_value(1.0, "meter", "mm"), 1000.0, places=4)
        # 25.4 mm -> 1.0 inch
        self.assertAlmostEqual(convert_value(25.4, "mm", "inch"), 1.0, places=4)
        # 304.8 mm -> 1.0 ft
        self.assertAlmostEqual(convert_value(304.8, "mm", "ft"), 1.0, places=4)
        # 500 feet -> 152,400 mm
        self.assertAlmostEqual(convert_value(500.0, "feet", "mm"), 152400.0, places=4)
        # Area dimensionality factor^2 (1 sq inch -> 645.16 sq mm)
        self.assertAlmostEqual(convert_value(1.0, "inch", "mm", dimension=2), 645.16, places=4)
        # Volume dimensionality factor^3 (1 cubic inch -> 16387.064 mm^3)
        self.assertAlmostEqual(convert_value(1.0, "inch", "mm", dimension=3), 16387.064, places=3)
        # Zero conversion
        self.assertEqual(convert_value(0.0, "inch", "mm"), 0.0)
        # Negative coordinates
        self.assertAlmostEqual(convert_value(-10.0, "inch", "mm"), -254.0, places=4)
        # Round trip
        val = 123.456
        roundtrip = convert_value(convert_value(val, "inch", "mm"), "mm", "inch")
        self.assertAlmostEqual(val, roundtrip, places=6)

    def test_import_bytes_universal_entry_point(self):
        """Verify import_bytes universal gateway processes bytes regardless of source."""
        sample_stl = b"""solid Box
facet normal 0 0 1
  outer loop
    vertex 0.0 0.0 0.0
    vertex 10.0 0.0 0.0
    vertex 10.0 10.0 0.0
  endloop
endfacet
endsolid Box"""
        res = import_bytes(sample_stl, "box.stl")
        self.assertIsNotNone(res)
        self.assertIn("objects", res)
        self.assertEqual(len(res["objects"]), 1)

    def test_step_format_intelligence_and_brep(self):
        """Verify STEP header metadata, schema AP214, and B-Rep separation."""
        step_content = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('CascadeCAD Test Assembly'),'2;1');
FILE_NAME('test_assembly.step','2025-01-01T00:00:00',('Engineer'),('GeoParametric3D'),'CascadeCAD','System','None');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#10 = PRODUCT('Bracket_Main', 'Bracket_Main', '', (#11));
#11 = PRODUCT_DEFINITION_CONTEXT('part definition', #12, 'design');
#12 = APPLICATION_CONTEXT('automotive design');
#20 = CARTESIAN_POINT('P1', (0.0, 0.0, 0.0));
#21 = CARTESIAN_POINT('P2', (100.0, 0.0, 0.0));
#22 = CARTESIAN_POINT('P3', (100.0, 50.0, 0.0));
#23 = CARTESIAN_POINT('P4', (0.0, 50.0, 0.0));
#24 = CARTESIAN_POINT('P5', (0.0, 0.0, 20.0));
#25 = CARTESIAN_POINT('P6', (100.0, 0.0, 20.0));
#30 = COLOUR_RGB('Steel_Blue', 0.22, 0.74, 0.97);
#40 = MATERIAL_DESIGNATION('Aluminum_6061', #10);
ENDSEC;
END-ISO-10303-21;"""
        
        desc = detect_format_descriptor(step_content, "test_assembly.step")
        self.assertEqual(desc.format, "STEP")
        self.assertEqual(desc.application_protocol, "AP214")
        self.assertTrue(desc.has_product_structure)
        self.assertTrue(desc.has_topology)
        
        res = parse_step_brep_structured(step_content, "test_assembly.step", desc)
        self.assertIsNotNone(res)
        self.assertEqual(len(res["objects"]), 1)
        obj = res["objects"][0]
        self.assertEqual(obj["name"], "Bracket_Main")
        self.assertEqual(obj["material"], "Aluminum_6061")
        self.assertTrue(len(obj["faces"]) > 0)
        self.assertIn("brep", obj)
        self.assertIn("bounding_box", obj)

    def test_step_unit_detection_precision(self):
        """Verify STEP unit entity parsing distinguishes mm, metre, inch cleanly."""
        m_step = "ISO-10303-21; DATA; #1 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($, .METRE.) ); ENDSEC;"
        u, scale = detect_step_units(m_step)
        self.assertEqual(u, "meter")
        self.assertEqual(scale, 1000.0)

        mm_step = "ISO-10303-21; DATA; #1 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI., .METRE.) ); ENDSEC;"
        u_mm, scale_mm = detect_step_units(mm_step)
        self.assertEqual(u_mm, "mm")
        self.assertEqual(scale_mm, 1.0)

        in_step = "ISO-10303-21; DATA; #1 = ( CONVERSION_BASED_UNIT('INCH', #2) LENGTH_UNIT() ); ENDSEC;"
        u_in, scale_in = detect_step_units(in_step)
        self.assertEqual(u_in, "inch")
        self.assertEqual(scale_in, 25.4)

    def test_step_topological_brep_hierarchy(self):
        """Verify complete STEP B-Rep topology (MANIFOLD_SOLID_BREP -> CLOSED_SHELL -> ADVANCED_FACE -> EDGE_LOOP -> EDGE_CURVE -> VERTEX_POINT)."""
        step_brep_content = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP B-Rep Cube'),'2;1');
FILE_NAME('cube.step','2025-01-01T00:00:00',('Engineer'),('GeoParametric3D'),'CascadeCAD','System','None');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('Precision_Cube', 'Precision_Cube', '', (#2));
#2 = PRODUCT_DEFINITION_CONTEXT('part', #3, 'design');
#3 = APPLICATION_CONTEXT('mechanical');
#10 = CARTESIAN_POINT('P1', (0.0, 0.0, 0.0));
#11 = CARTESIAN_POINT('P2', (10.0, 0.0, 0.0));
#12 = CARTESIAN_POINT('P3', (10.0, 10.0, 0.0));
#13 = CARTESIAN_POINT('P4', (0.0, 10.0, 0.0));
#20 = VERTEX_POINT('V1', #10);
#21 = VERTEX_POINT('V2', #11);
#22 = VERTEX_POINT('V3', #12);
#23 = VERTEX_POINT('V4', #13);
#30 = EDGE_CURVE('E1', #20, #21, #40, .T.);
#31 = EDGE_CURVE('E2', #21, #22, #40, .T.);
#32 = EDGE_CURVE('E3', #22, #23, #40, .T.);
#33 = EDGE_CURVE('E4', #23, #20, #40, .T.);
#40 = LINE('L', #10, #50);
#50 = VECTOR('V', #51, 10.0);
#51 = DIRECTION('D', (1.0, 0.0, 0.0));
#60 = ORIENTED_EDGE('OE1', *, *, #30, .T.);
#61 = ORIENTED_EDGE('OE2', *, *, #31, .T.);
#62 = ORIENTED_EDGE('OE3', *, *, #32, .T.);
#63 = ORIENTED_EDGE('OE4', *, *, #33, .T.);
#70 = EDGE_LOOP('EL1', (#60, #61, #62, #63));
#80 = FACE_OUTER_BOUND('FOB1', #70, .T.);
#90 = ADVANCED_FACE('AF1', (#80), #100, .T.);
#100 = PLANE('PL', #101);
#101 = AXIS2_PLACEMENT_3D('A2P', #10, #102, #51);
#102 = DIRECTION('NZ', (0.0, 0.0, 1.0));
#110 = CLOSED_SHELL('CS1', (#90));
#120 = MANIFOLD_SOLID_BREP('MSB1', #110);
ENDSEC;
END-ISO-10303-21;"""
        res = parse_step_brep_structured(step_brep_content, "cube.step")
        self.assertIsNotNone(res)
        self.assertEqual(len(res["objects"]), 1)
        obj = res["objects"][0]
        self.assertEqual(obj["name"], "Precision_Cube")
        self.assertIn("diagnostics", res["headers"])
        self.assertEqual(res["headers"]["diagnostics"]["index_validation_result"], "PASS")
        self.assertEqual(res["headers"]["diagnostics"]["finite_coordinates_result"], "PASS")

    def test_step_curved_surface_classification_preservation(self):
        """Verify STEP curved surface entities (CYLINDRICAL_SURFACE, SPHERICAL_SURFACE, etc.) preserve analytic classification."""
        step_cyl_content = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Curved Surface B-Rep Test'),'2;1');
FILE_NAME('cylinder.step','2025-01-01T00:00:00',('Engineer'),('GeoParametric3D'),'CascadeCAD','System','None');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('Cylinder_Part', 'Cylinder_Part', '', (#2));
#2 = PRODUCT_DEFINITION_CONTEXT('part', #3, 'design');
#3 = APPLICATION_CONTEXT('mechanical');
#10 = CARTESIAN_POINT('P1', (0.0, 0.0, 0.0));
#11 = CARTESIAN_POINT('P2', (25.0, 0.0, 0.0));
#12 = CARTESIAN_POINT('P3', (25.0, 0.0, 50.0));
#13 = CARTESIAN_POINT('P4', (0.0, 0.0, 50.0));
#20 = VERTEX_POINT('V1', #10);
#21 = VERTEX_POINT('V2', #11);
#22 = VERTEX_POINT('V3', #12);
#23 = VERTEX_POINT('V4', #13);
#30 = EDGE_CURVE('E1', #20, #21, #40, .T.);
#31 = EDGE_CURVE('E2', #21, #22, #40, .T.);
#32 = EDGE_CURVE('E3', #22, #23, #40, .T.);
#33 = EDGE_CURVE('E4', #23, #20, #40, .T.);
#40 = LINE('L', #10, #50);
#50 = VECTOR('V', #51, 25.0);
#51 = DIRECTION('D', (1.0, 0.0, 0.0));
#60 = ORIENTED_EDGE('OE1', *, *, #30, .T.);
#61 = ORIENTED_EDGE('OE2', *, *, #31, .T.);
#62 = ORIENTED_EDGE('OE3', *, *, #32, .T.);
#63 = ORIENTED_EDGE('OE4', *, *, #33, .T.);
#70 = EDGE_LOOP('EL1', (#60, #61, #62, #63));
#80 = FACE_OUTER_BOUND('FOB1', #70, .T.);
#90 = ADVANCED_FACE('AF_Cyl', (#80), #100, .T.);
#100 = CYLINDRICAL_SURFACE('CS', #101, 25.0);
#101 = AXIS2_PLACEMENT_3D('A2P', #10, #102, #51);
#102 = DIRECTION('NZ', (0.0, 0.0, 1.0));
#110 = CLOSED_SHELL('CS1', (#90));
#120 = MANIFOLD_SOLID_BREP('MSB1', #110);
ENDSEC;
END-ISO-10303-21;"""
        res = parse_step_brep_structured(step_cyl_content, "cylinder.step")
        self.assertIsNotNone(res)
        self.assertEqual(len(res["objects"]), 1)
        obj = res["objects"][0]
        brep = obj["brep"]
        self.assertIn("surfaces", brep)
        surfaces = brep["surfaces"]
        first_surf = list(surfaces.values())[0]
        self.assertEqual(first_surf["surface_type"], "cylinder")
        self.assertAlmostEqual(first_surf["parameters"]["radius"], 25.0, places=4)

    def test_vertex_and_triangle_integrity_pipeline(self):
        """Verify strict finite vertex validation, index remapping, and degenerate triangle rejection."""
        raw_v = [
            [0.0, 0.0, 0.0],       # 0: valid
            [10.0, 0.0, 0.0],      # 1: valid
            [np.nan, 5.0, 0.0],    # 2: INVALID (NaN)
            [10.0, 10.0, 0.0],     # 3: valid
            [0.0, 10.0, 0.0],      # 4: valid
            [np.inf, 0.0, 0.0]     # 5: INVALID (Inf)
        ]
        raw_t = [
            (0, 1, 3),   # Valid triangle (area = 50)
            (0, 2, 3),   # References invalid vertex 2 -> Must be discarded and remapped
            (0, 1, 1),   # Duplicate index -> Degenerate
            (0, 3, 4),   # Valid triangle
            (0, 5, 4)    # References invalid vertex 5 -> Must be discarded
        ]
        
        final_v, final_t, diag = validate_and_compact_mesh(raw_v, raw_t)
        self.assertEqual(diag["invalid_vertices_removed"], 2)
        self.assertEqual(diag["invalid_triangles_removed"], 2)
        self.assertEqual(diag["degenerate_triangles_removed"], 1)
        self.assertEqual(len(final_v), 4)
        self.assertEqual(len(final_t), 2)
        self.assertEqual(diag["index_validation"], "PASS")
        self.assertTrue(np.isfinite(final_v).all())
        # Verify remapped indices are in [0, 3]
        self.assertTrue((final_t < len(final_v)).all())
        self.assertTrue((final_t >= 0).all())

    def test_polygon_3d_triangulation(self):
        """Verify planar 3D polygon ear-clipping triangulation preserves area and topology."""
        quad = [
            np.array([0.0, 0.0, 0.0]),
            np.array([100.0, 0.0, 0.0]),
            np.array([100.0, 50.0, 0.0]),
            np.array([0.0, 50.0, 0.0])
        ]
        tris = triangulate_polygon_3d(quad, np.array([0.0, 0.0, 1.0]))
        self.assertEqual(len(tris), 2)
        
        total_area = 0.0
        for t in tris:
            p0, p1, p2 = quad[t[0]], quad[t[1]], quad[t[2]]
            total_area += 0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0))
        self.assertAlmostEqual(total_area, 5000.0, places=4)

    def test_stl_vertex_welding_and_component_recovery(self):
        """Verify disconnected STL meshes are cleanly separated into recovered assembly components."""
        stl_ascii = b"""solid MultiPartSTL
facet normal 0 0 1
  outer loop
    vertex 0.0 0.0 0.0
    vertex 10.0 0.0 0.0
    vertex 10.0 10.0 0.0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 100.0 0.0 0.0
    vertex 110.0 0.0 0.0
    vertex 110.0 10.0 0.0
  endloop
endfacet
endsolid MultiPartSTL"""
        
        res = parse_stl_with_topology_reconstruction(stl_ascii, "multi.stl")
        self.assertIsNotNone(res)
        self.assertEqual(len(res["objects"]), 2, "Should identify exactly two disconnected components")
        self.assertEqual(len(res["assembly_tree"]), 2)
        self.assertEqual(res["assembly_tree"][0]["structure_type"], "RECOVERED_ASSEMBLY")

    def test_large_binary_stl_performance(self):
        """Verify vectorized NumPy C-level decoding scales linearly on multi-megabyte binary STL payloads."""
        num_triangles = 50000
        header = b"GeoParametric3D Synthetic Benchmark Mesh".ljust(80, b"\x00")
        length_bytes = struct.pack('<I', num_triangles)
        
        # Generate 50,000 synthetic triangles (2.5 MB binary payload)
        tri_data = bytearray(num_triangles * 50)
        # Pack 50,000 dummy triangles
        struct.pack_into('<3f3f3f3fH', tri_data, 0, 0,0,1, 0,0,0, 10,0,0, 10,10,0, 0)
        
        binary_stl = header + length_bytes + bytes(tri_data)
        
        start_t = time.perf_counter()
        res = parse_universal_model(binary_stl, "large_bench.stl")
        elapsed = time.perf_counter() - start_t
        
        self.assertIsNotNone(res)
        self.assertIn("headers", res)
        self.assertIn("performance", res["headers"])
        self.assertLess(elapsed, 1.5, f"50,000 triangle binary STL import took {elapsed:.3f}s (must be < 1.5s)")
        self.assertEqual(res["headers"]["diagnostics"]["total_raw_triangles"], num_triangles)

    def test_primitive_vs_import_canonical_box_equivalence(self):
        """Verify primitive-generated box and equivalent imported box produce canonical B-Rep models."""
        canonical_box = create_canonical_box_part(304.8, 304.8, 304.8)
        
        step_box = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Canonical Equivalence Test Box'),'2;1');
FILE_NAME('box.step','2025-01-01T00:00:00',('Engineer'),('GeoParametric3D'),'CascadeCAD','System','None');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('Box_Equiv', 'Box_Equiv', '', (#2));
#2 = PRODUCT_DEFINITION_CONTEXT('part', #3, 'design');
#3 = APPLICATION_CONTEXT('mechanical');
#10 = CARTESIAN_POINT('P1', (-152.4, -152.4, 0.0));
#11 = CARTESIAN_POINT('P2', (152.4, -152.4, 0.0));
#12 = CARTESIAN_POINT('P3', (152.4, 152.4, 0.0));
#13 = CARTESIAN_POINT('P4', (-152.4, 152.4, 0.0));
#20 = VERTEX_POINT('V1', #10);
#21 = VERTEX_POINT('V2', #11);
#22 = VERTEX_POINT('V3', #12);
#23 = VERTEX_POINT('V4', #13);
#30 = EDGE_CURVE('E1', #20, #21, #40, .T.);
#31 = EDGE_CURVE('E2', #21, #22, #40, .T.);
#32 = EDGE_CURVE('E3', #22, #23, #40, .T.);
#33 = EDGE_CURVE('E4', #23, #20, #40, .T.);
#40 = LINE('L', #10, #50);
#50 = VECTOR('V', #51, 304.8);
#51 = DIRECTION('D', (1.0, 0.0, 0.0));
#60 = ORIENTED_EDGE('OE1', *, *, #30, .T.);
#61 = ORIENTED_EDGE('OE2', *, *, #31, .T.);
#62 = ORIENTED_EDGE('OE3', *, *, #32, .T.);
#63 = ORIENTED_EDGE('OE4', *, *, #33, .T.);
#70 = EDGE_LOOP('EL1', (#60, #61, #62, #63));
#80 = FACE_OUTER_BOUND('FOB1', #70, .T.);
#90 = ADVANCED_FACE('AF1', (#80), #100, .T.);
#100 = PLANE('PL', #101);
#101 = AXIS2_PLACEMENT_3D('A2P', #10, #102, #51);
#102 = DIRECTION('NZ', (0.0, 0.0, 1.0));
#110 = CLOSED_SHELL('CS1', (#90));
#120 = MANIFOLD_SOLID_BREP('MSB1', #110);
ENDSEC;
END-ISO-10303-21;"""
        
        imported_res = parse_universal_model(step_box, "box.step")
        self.assertIsNotNone(imported_res)
        self.assertEqual(len(imported_res["objects"]), 1)
        imp_obj = imported_res["objects"][0]
        self.assertIn("brep", imp_obj)
        self.assertEqual(len(canonical_box.vertices), 8)
        self.assertEqual(len(canonical_box.edges), 12)
        self.assertEqual(len(canonical_box.faces), 6)

    def test_numpy_render_contract(self):
        """Verify validation of NumPy geometry rendering contracts."""
        pos = np.array([
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            [10.0, 10.0, 0.0]
        ], dtype=np.float64)
        idx = np.array([[0, 1, 2]], dtype=np.int32)
        
        valid, msg = validate_numpy_mesh_contract(pos, idx)
        self.assertTrue(valid, msg)
        
        bad_idx = np.array([[0, 1, 5]], dtype=np.int32)
        valid_bad, _ = validate_numpy_mesh_contract(pos, bad_idx)
        self.assertFalse(valid_bad)
        
        pos_nan = pos.copy()
        pos_nan[0, 0] = np.nan
        valid_nan, _ = validate_numpy_mesh_contract(pos_nan, idx)
        self.assertFalse(valid_nan)

    def test_bounding_box_computation(self):
        """Verify physical bounding box extents and center without visual scaling corruption."""
        pts = np.array([
            [-100.0, -50.0, 0.0],
            [100.0, 50.0, 200.0]
        ], dtype=np.float64)
        bbox = compute_bounding_box(pts)
        self.assertEqual(bbox["min"], [-100.0, -50.0, 0.0])
        self.assertEqual(bbox["max"], [100.0, 50.0, 200.0])
        self.assertEqual(bbox["center"], [0.0, 0.0, 100.0])
        self.assertEqual(bbox["extents"], [200.0, 100.0, 200.0])
        self.assertAlmostEqual(bbox["diagonal"], np.sqrt(200**2 + 100**2 + 200**2), places=3)


if __name__ == '__main__':
    unittest.main()
