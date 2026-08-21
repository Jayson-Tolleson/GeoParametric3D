import asyncio
import json
import os
import pathlib
import urllib.request
import uuid
import numpy as np
from quart import Quart, render_template, request, jsonify, send_from_directory
from hypercorn.config import Config
from hypercorn.asyncio import serve

from command_engine import CommandEngine
from geometry import SITE_ANCHOR
from state import global_cad_state, CADObject
from universal_byte_parser import compute_bounding_box
from canonical_geometry import (
    create_canonical_box_part,
    AdaptiveTessellator,
    LODLevel,
    CANONICAL_INTERNAL_UNIT,
    sanitize_for_json,
    GeometryPipelineException
)

app = Quart(__name__, static_folder='static', template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 1420 * 1024 * 1024

BASE_DIR = pathlib.Path(__file__).parent.resolve()
STORAGE_DIR = BASE_DIR / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

command_engine = CommandEngine()
USE_VERTEX_AI = True
PROJECT_ID = "broadcasterfishmap"
LOCATION = "global"
VERTEX_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", PROJECT_ID)
MAPS_API_KEY = os.environ.get("MAPS_API_KEY", os.environ.get("GOOGLE_API_KEY", ""))

def json_response(data: dict, status_code: int = 200):
    try:
        return jsonify(sanitize_for_json(data)), status_code
    except GeometryPipelineException as e:
        return jsonify({
            "ok": False,
            "success": False,
            "stage": getattr(e, 'stage', None) and e.stage.value or "JSON_SERIALIZATION_ERROR",
            "error": str(e)
        }), 400
    except Exception as e:
        return jsonify({
            "ok": False,
            "success": False,
            "stage": "JSON_SERIALIZATION_ERROR",
            "error": str(e)
        }), 500

@app.route('/')
@app.route('/cad')
@app.route('/cad/')
@app.route('/GeoParametric3D')
@app.route('/GeoParametric3D/')
async def index():
    return await render_template('index.html')

@app.route('/health')
@app.route('/api/health')
@app.route('/GeoParametric3D/api/health')
@app.route('/cad/api/health')
async def health():
    return json_response({
        'status': 'healthy',
        'app': 'GeoParametric3D',
        'anchor': SITE_ANCHOR,
        'canonical_unit': CANONICAL_INTERNAL_UNIT,
        'vertex_ai': USE_VERTEX_AI,
        'project_id': PROJECT_ID,
        'location': LOCATION
    })

@app.route('/api/site')
@app.route('/GeoParametric3D/api/site')
@app.route('/cad/api/site')
async def site_info():
    return json_response({'success': True, 'anchor': SITE_ANCHOR, 'map3d_enabled': True, 'canonical_unit': CANONICAL_INTERNAL_UNIT})

@app.route('/api/project/new', methods=['POST'])
@app.route('/GeoParametric3D/api/project/new', methods=['POST'])
@app.route('/cad/api/project/new', methods=['POST'])
async def project_new():
    project_id = str(uuid.uuid4())
    global_cad_state.project_id = project_id
    global_cad_state.clear()
    box = CADObject(
        object_id="obj_box_1",
        name="1-Foot Reference Block",
        primitive_type="box",
        parameters={"width": 304.8, "depth": 304.8, "height": 304.8},
        position=[0.0, 0.0, 0.0],
        color="#38bdf8",
        material="Steel",
        opacity=1.0
    )
    global_cad_state.add_object(box)
    doc = global_cad_state.to_dict()
    file_path = STORAGE_DIR / f"{project_id}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_for_json(doc), f, indent=2)
    return json_response({'success': True, 'ok': True, 'project_id': project_id, 'document': doc})

@app.route('/api/project/save', methods=['POST'])
@app.route('/GeoParametric3D/api/project/save', methods=['POST'])
@app.route('/cad/api/project/save', methods=['POST'])
async def project_save():
    data = (await request.get_json()) or {}
    project_id = data.get('project_id') or global_cad_state.project_id or str(uuid.uuid4())
    global_cad_state.project_id = project_id
    doc = data.get('document', global_cad_state.to_dict())
    doc['project_id'] = project_id
    file_path = STORAGE_DIR / f"{project_id}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_for_json(doc), f, indent=2)
    return json_response({'success': True, 'ok': True, 'project_id': project_id, 'filename': f"{project_id}.json", 'document': doc})

@app.route('/api/project/load/<project_id>', methods=['GET'])
@app.route('/GeoParametric3D/api/project/load/<project_id>', methods=['GET'])
@app.route('/cad/api/project/load/<project_id>', methods=['GET'])
async def project_load(project_id):
    safe_id = os.path.basename(project_id).replace('.json', '')
    file_path = STORAGE_DIR / f"{safe_id}.json"
    if not file_path.exists():
        return json_response({'success': False, 'ok': False, 'error': f'Project file {safe_id}.json not found in storage'}, 404)
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        global_cad_state.from_dict(doc)
        return json_response({'success': True, 'ok': True, 'project_id': safe_id, 'document': global_cad_state.to_dict()})
    except Exception as e:
        return json_response({'success': False, 'ok': False, 'error': str(e)}, 500)

@app.route('/api/manifest', methods=['GET'])
@app.route('/GeoParametric3D/api/manifest', methods=['GET'])
@app.route('/cad/api/manifest', methods=['GET'])
async def cad_manifest():
    manifest_path = BASE_DIR / "cad_manifest.json"
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json_response(json.load(f))
    except Exception as e:
        return json_response({"success": False, "error": str(e)}, 500)

@app.route('/api/command', methods=['POST'])
@app.route('/GeoParametric3D/api/command', methods=['POST'])
@app.route('/cad/api/command', methods=['POST'])
async def handle_command():
    data = (await request.get_json()) or {}
    res = await command_engine.execute(data)
    return json_response(res)

@app.route('/api/canonical/export', methods=['GET'])
@app.route('/GeoParametric3D/api/canonical/export', methods=['GET'])
@app.route('/cad/api/canonical/export', methods=['GET'])
async def canonical_export():
    canonical_part = create_canonical_box_part(304.8, 304.8, 304.8)
    mesh = AdaptiveTessellator().tessellate_part(canonical_part, LODLevel.HIGH_LOD3)
    return json_response({
        'success': True,
        'canonical_part': canonical_part.to_dict(),
        'render_mesh': mesh.to_dict(),
        'canonical_unit': CANONICAL_INTERNAL_UNIT
    })

@app.route('/api/geometry/binary', methods=['GET', 'POST'])
@app.route('/GeoParametric3D/api/geometry/binary', methods=['GET', 'POST'])
@app.route('/cad/api/geometry/binary', methods=['GET', 'POST'])
async def handle_geometry_binary():
    """
    Zero-copy binary transport endpoint.
    Transports packed float32 vertex coordinates and uint32 index arrays.
    """
    import struct
    from quart import Response
    data = (await request.get_json(silent=True)) or {}
    obj_id = data.get('id') or request.args.get('id')
    
    obj = global_cad_state.get_object(obj_id) if obj_id else next(iter(global_cad_state.objects.values()), None)
    if not obj:
        return json_response({'ok': False, 'error': 'No active CAD object found'}, 404)

    flat_verts = []
    flat_indices = []
    v_idx = 0
    for face in obj.faces:
        if len(face) >= 3:
            base = v_idx
            for pt in face:
                flat_verts.extend([float(pt.get('x', 0)), float(pt.get('y', 0)), float(pt.get('z', 0))])
                v_idx += 1
            for i in range(1, len(face) - 1):
                flat_indices.extend([base, base + i, base + i + 1])
                
    pos_arr = np.array(flat_verts, dtype=np.float32)
    idx_arr = np.array(flat_indices, dtype=np.uint32)
    
    header = struct.pack('<II', len(pos_arr) // 3, len(idx_arr))
    payload = header + pos_arr.tobytes() + idx_arr.tobytes()
    return Response(payload, mimetype='application/octet-stream')

@app.route('/api/manifest/transform', methods=['POST'])
@app.route('/GeoParametric3D/api/manifest/transform', methods=['POST'])
@app.route('/cad/api/manifest/transform', methods=['POST'])
async def handle_manifest_transform():
    data = (await request.get_json()) or {}
    return json_response(await command_engine.execute({"command": "transform_object", "parameters": data}))

@app.route('/api/manifest/properties', methods=['POST'])
@app.route('/GeoParametric3D/api/manifest/properties', methods=['POST'])
@app.route('/cad/api/manifest/properties', methods=['POST'])
async def handle_manifest_properties():
    data = (await request.get_json()) or {}
    return json_response(await command_engine.execute({"command": "set_property", "parameters": data}))

@app.route('/api/manifest/hide', methods=['POST'])
@app.route('/GeoParametric3D/api/manifest/hide', methods=['POST'])
@app.route('/cad/api/manifest/hide', methods=['POST'])
async def handle_manifest_hide():
    data = (await request.get_json()) or {}
    return json_response(await command_engine.execute({"command": "toggle_visibility", "parameters": data}))

@app.route('/api/manifest/delete', methods=['POST'])
@app.route('/GeoParametric3D/api/manifest/delete', methods=['POST'])
@app.route('/cad/api/manifest/delete', methods=['POST'])
async def handle_manifest_delete():
    data = (await request.get_json()) or {}
    return json_response(await command_engine.execute({"command": "delete_object", "parameters": data}))

@app.route('/api/geometry/instantiate', methods=['POST'])
@app.route('/GeoParametric3D/api/geometry/instantiate', methods=['POST'])
@app.route('/cad/api/geometry/instantiate', methods=['POST'])
async def handle_geometry_instantiate():
    data = (await request.get_json()) or {}
    p_type = data.get("type", "box")
    return json_response(await command_engine.execute({"command": "create_primitive", "parameters": data, "primitive": p_type}))

@app.route('/api/geometry/select-at-point', methods=['POST'])
@app.route('/GeoParametric3D/api/geometry/select-at-point', methods=['POST'])
@app.route('/cad/api/geometry/select-at-point', methods=['POST'])
async def handle_point_selection():
    data = (await request.get_json()) or {}
    pt = data.get("point", [0.0, 0.0, 0.0])
    obj_id = data.get("target_id")
    face_idx = data.get("face_index", 0)
    
    target_obj = global_cad_state.get_object(obj_id) if obj_id else (next(iter(global_cad_state.objects.values()), None))
    
    surface_type = "Plane"
    area = 0.0
    normal = [0.0, 0.0, 1.0]
    boundary_edges = 0
    source_face_id = f"Face_{face_idx + 1}"
    
    if target_obj:
        resolved_face_id = None
        if face_idx < len(target_obj.faces):
            face_pts = target_obj.faces[face_idx]
            if len(face_pts) > 0 and 'face_id' in face_pts[0]:
                resolved_face_id = face_pts[0]['face_id']
                
        if target_obj.brep and "faces" in target_obj.brep:
            faces = target_obj.brep["faces"]
            face_data = None
            if resolved_face_id and resolved_face_id in faces:
                face_data = faces[resolved_face_id]
                source_face_id = resolved_face_id
            else:
                face_keys = list(faces.keys())
                if face_idx < len(face_keys):
                    f_id = face_keys[face_idx]
                    face_data = faces[f_id]
                    source_face_id = face_data.get("id", f_id)
                    
            if face_data:
                if "surface_id" in face_data and "surfaces" in target_obj.brep:
                    surf_data = target_obj.brep["surfaces"].get(face_data["surface_id"], {})
                    surface_type = str(surf_data.get("surface_type", face_data.get("surface_type", "Plane"))).capitalize()
                    normal = surf_data.get("parameters", {}).get("normal", face_data.get("normal", [0.0, 0.0, 1.0]))
                else:
                    surface_type = str(face_data.get("surface_type", "Plane")).capitalize()
                    normal = face_data.get("normal", [0.0, 0.0, 1.0])
                    
                if "outer_loop_id" in face_data and "loops" in target_obj.brep:
                    outer_loop = target_obj.brep["loops"].get(face_data["outer_loop_id"], {})
                    boundary_edges = len(outer_loop.get("ordered_edge_ids", []))
        
        if face_idx < len(target_obj.faces):
            face_pts = target_obj.faces[face_idx]
            if boundary_edges == 0:
                boundary_edges = len(face_pts)
            
            if len(face_pts) >= 3:
                p0 = np.array([face_pts[0].get('x', 0), face_pts[0].get('y', 0), face_pts[0].get('z', 0)])
                total_area = 0.0
                for i in range(1, len(face_pts) - 1):
                    p1 = np.array([face_pts[i].get('x', 0), face_pts[i].get('y', 0), face_pts[i].get('z', 0)])
                    p2 = np.array([face_pts[i+1].get('x', 0), face_pts[i+1].get('y', 0), face_pts[i+1].get('z', 0)])
                    cross = np.cross(p1 - p0, p2 - p0)
                    total_area += 0.5 * np.linalg.norm(cross)
                area = float(total_area)
                
                if not target_obj.brep or "faces" not in target_obj.brep:
                    p1 = np.array([face_pts[1].get('x', 0), face_pts[1].get('y', 0), face_pts[1].get('z', 0)])
                    p2 = np.array([face_pts[2].get('x', 0), face_pts[2].get('y', 0), face_pts[2].get('z', 0)])
                    n = np.cross(p1 - p0, p2 - p0)
                    n_norm = np.linalg.norm(n)
                    if n_norm > 1e-9:
                        normal = (n / n_norm).tolist()
    
    info = {
        "selected": True,
        "point": pt,
        "target_object": target_obj.name if target_obj else "Reference Object",
        "face_id": source_face_id,
        "surface_type": surface_type,
        "boundary_edges": boundary_edges,
        "normal": normal,
        "area_mm2": area,
        "authoritative_layer": "B-Rep Topology"
    }
    return json_response({"success": True, "selection": info})

@app.route('/api/draft/commit-advanced', methods=['POST'])
@app.route('/GeoParametric3D/api/draft/commit-advanced', methods=['POST'])
@app.route('/cad/api/draft/commit-advanced', methods=['POST'])
async def handle_advanced_draft_commit():
    data = (await request.get_json()) or {}
    tool = data.get("tool", "box")
    params = data.get("parameters", {})
    return json_response(await command_engine.execute({"command": f"create_{tool}", "parameters": params}))

@app.route('/api/instructions/build', methods=['POST'])
@app.route('/GeoParametric3D/api/instructions/build', methods=['POST'])
@app.route('/cad/api/instructions/build', methods=['POST'])
async def handle_instructions_build():
    data = (await request.get_json()) or {}
    user_input = data.get("input", "")
    spindle = data.get("spindle", 12000)
    feedrate = data.get("feedrate", 1200)
    target_id = data.get("target_id")
    
    target_obj = global_cad_state.get_object(target_id) if target_id else next(iter(global_cad_state.objects.values()), None)
    obj_name = target_obj.name if target_obj else "GeoParametric3D_Part"
    
    gcode_lines = [
        f"(LinuxCNC Program Digest - Generated for {obj_name})",
        f"(Date: {os.uname().nodename} / Project: {global_cad_state.project_id})",
        "G21 (Units: Metric mm)",
        "G90 (Absolute Distance Mode)",
        "G94 (Units per minute feed rate mode)",
        f"M3 S{spindle} (Spindle on clockwise)",
        "G0 Z25.0 (Safe Clearance Plane)",
        "G0 X0.0 Y0.0",
        f"G1 Z-2.0 F{feedrate / 2}",
        f"G1 X100.0 Y0.0 F{feedrate}",
        f"G1 X100.0 Y100.0 F{feedrate}",
        f"G1 X0.0 Y100.0 F{feedrate}",
        f"G1 X0.0 Y0.0 F{feedrate}",
        "G0 Z25.0",
        "M5 (Spindle off)",
        "M2 (Program End and Rewind)"
    ]
    digest_text = "\n".join(gcode_lines)
    return json_response({
        "ok": True,
        "success": True,
        "input": user_input,
        "digest": digest_text,
        "gcode": digest_text,
        "target_object": obj_name
    })

@app.route('/api/cnc/generate', methods=['POST'])
@app.route('/GeoParametric3D/api/cnc/generate', methods=['POST'])
@app.route('/cad/api/cnc/generate', methods=['POST'])
async def handle_cnc_generate():
    data = (await request.get_json()) or {}
    spindle = data.get("spindle", 12000)
    feedrate = data.get("feedrate", 1200)
    target_id = data.get("target_id")
    
    target_obj = global_cad_state.get_object(target_id) if target_id else next(iter(global_cad_state.objects.values()), None)
    obj_name = target_obj.name if target_obj else "Workpiece"
    bounds = (target_obj and target_obj.bounding_box) or {"min": [-50, -50, 0], "max": [50, 50, 25]}
    
    min_x, max_x = bounds.get('min', [-50, -50, 0])[0], bounds.get('max', [50, 50, 25])[0]
    min_y, max_y = bounds.get('min', [-50, -50, 0])[1], bounds.get('max', [50, 50, 25])[1]
    max_z = bounds.get('max', [50, 50, 25])[2]
    
    gcode = f"""(LinuxCNC ISO G-Code — {obj_name})
G21 G90 G64 P0.01 (Metric mm, Absolute, Continuous contouring)
G17 (XY plane)
M3 S{spindle}
G0 Z{max_z + 10.0:.2f}
G0 X{min_x:.2f} Y{min_y:.2f}
G1 Z{max_z:.2f} F{feedrate/2}
G1 X{max_x:.2f} Y{min_y:.2f} F{feedrate}
G1 X{max_x:.2f} Y{max_y:.2f}
G1 X{min_x:.2f} Y{max_y:.2f}
G1 X{min_x:.2f} Y{min_y:.2f}
G0 Z{max_z + 15.0:.2f}
M5
M30
"""
    return json_response({"ok": True, "success": True, "gcode": gcode, "target_id": target_id, "target_name": obj_name})

@app.route('/api/import', methods=['POST'])
@app.route('/GeoParametric3D/api/import', methods=['POST'])
@app.route('/cad/api/import', methods=['POST'])
async def handle_import():
    try:
        files = await request.files
        if 'file' in files:
            uploaded_file = files['file']
            filename = uploaded_file.filename or "imported_model.stl"
            content_bytes = uploaded_file.read()
        else:
            content_bytes = await request.get_data()
            filename = request.headers.get("X-File-Name", "import_stream.bin")
        return json_response(await command_engine.process_import(filename, content_bytes))
    except Exception as e:
        return json_response({"ok": False, "success": False, "stage": "IMPORT_ERROR", "error": str(e)})

@app.route('/api/telemetry', methods=['GET'])
@app.route('/GeoParametric3D/api/telemetry', methods=['GET'])
@app.route('/cad/api/telemetry', methods=['GET'])
async def get_telemetry():
    doc = global_cad_state.to_dict()
    objs = doc['objects']
    total_vertices = sum(len(obj.get('faces', [])) * 4 for obj in objs)
    return json_response({
        "success": True,
        "objects": len(objs),
        "objectsCount": len(objs),
        "vertices": total_vertices,
        "totalVertices": total_vertices,
        "fps": 60,
        "status": "READY",
        "vertex_ai": USE_VERTEX_AI,
        "project_id": PROJECT_ID,
        "location": LOCATION
    })

async def call_vertex_gemini(prompt: str, cad_context: dict = None) -> str:
    system_context = (
        f"You are the dedicated Engineering Assistant for GeoParametric3D (Project: {PROJECT_ID}, Location: {LOCATION}).\n"
        "Provide substantive, technically precise engineering reasoning, CAD/CAM/CAE guidance, mechanical/structural analysis, "
        "B-Rep topological insight, material selection, and mathematical derivations.\n"
        "B-Rep geometry is authoritative; render meshes are derived representations.\n"
        "Always distinguish CAD topology (faces, edges, loops, vertices) from render artifacts (triangles, diagonals)."
    )
    
    context_snippet = ""
    if cad_context:
        objs = cad_context.get('objects', [])
        parts_summary = [
            f"{o.get('name')} (ID: {o.get('id')}, Material: {o.get('material')}, Faces: {len(o.get('faces', []))}, Volume: {o.get('volume_cm3')} cm³)"
            for o in objs[:10]
        ]
        context_snippet = f"\nCurrent Active Assembly Scene ({len(objs)} bodies, canonical unit: {CANONICAL_INTERNAL_UNIT}): " + "; ".join(parts_summary)

    # Vertex AI REST invocation with project broadcasterfishmap and location global
    token = None
    try:
        import google.auth
        import google.auth.transport.requests
        creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        token = creds.token
    except Exception as auth_err:
        token = os.environ.get("VERTEX_AI_BEARER_TOKEN") or None

    headers = {'Content-Type': 'application/json'}
    if token:
        url = f"https://aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/gemini-1.5-flash:generateContent"
        headers['Authorization'] = f"Bearer {token}"
    elif MAPS_API_KEY:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={MAPS_API_KEY}"
    else:
        return f"[Vertex AI ({PROJECT_ID}/{LOCATION})]: Active CAD context analyzed ({len(cad_context.get('objects', [])) if cad_context else 0} bodies). Configure Google Cloud application default credentials for live generation."

    payload = {
        "contents": [{
            "parts": [{
                "text": f"{system_context}{context_snippet}\n\nUser Query: {prompt}"
            }]
        }]
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers
    )
    try:
        loop = asyncio.get_event_loop()
        def _fetch():
            with urllib.request.urlopen(req, timeout=12) as response:
                return response.read().decode('utf-8')
        res_text = await loop.run_in_executor(None, _fetch)
        res_json = json.loads(res_text)
        candidates = res_json.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                return parts[0].get("text", "")
    except Exception as api_exc:
        return f"[Vertex AI Diagnostics ({PROJECT_ID}/{LOCATION})]: {str(api_exc)}"
            
    return ""

@app.route('/api/assistant/chat', methods=['POST'])
@app.route('/api/assistant', methods=['POST'])
@app.route('/api/generate', methods=['POST'])
@app.route('/GeoParametric3D/api/assistant/chat', methods=['POST'])
@app.route('/GeoParametric3D/api/generate', methods=['POST'])
@app.route('/cad/api/assistant/chat', methods=['POST'])
@app.route('/cad/api/assistant', methods=['POST'])
@app.route('/cad/api/generate', methods=['POST'])
async def assistant_chat():
    data = (await request.get_json()) or {}
    user_message = (data.get('message', '') or data.get('prompt', '') or '').strip()
    chat_response = command_engine.process_chat(user_message)
    cad_ctx = global_cad_state.to_dict()
    ai_reply = await call_vertex_gemini(user_message, cad_ctx)
    
    if chat_response.requires_action:
        final_message = f"{chat_response.text}\n\n{ai_reply}" if ai_reply else chat_response.text
    else:
        final_message = ai_reply if ai_reply else f"Engineering Assistant ({PROJECT_ID}/{LOCATION}): Analyzed model state with {len(cad_ctx.get('objects', []))} bodies."
        
    return json_response({
        "status": "success",
        "success": True,
        "message": final_message,
        "reply": final_message,
        "response": final_message,
        "action_intent": chat_response.action_intent if chat_response.requires_action else {},
        "vertex_ai_project": PROJECT_ID,
        "location": LOCATION,
        "document": global_cad_state.to_dict()
    })

@app.route('/static/<path:filename>')
@app.route('/GeoParametric3D/static/<path:filename>')
@app.route('/cad/static/<path:filename>')
async def serve_prefixed_static(filename):
    return await send_from_directory(app.static_folder, filename)

if __name__ == '__main__':
    config = Config()
    config.bind = ['0.0.0.0:5000']
    asyncio.run(serve(app, config))
