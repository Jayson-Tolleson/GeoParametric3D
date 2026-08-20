"use strict";

/**
 * GeoParametric3D / CascadeCAD WebAssembly Geometric Kernel Bridge
 * Revision Doctrine v4.2 — Hierarchical Assembly Kernel (WASM to DOM)
 * Implements sliceGeometryFromHeap and recursive G(x,y,z) scenegraph tree construction.
 * Preserves topology, normal vectors, and validates finite vertex contracts without inventing triangles.
 * Directives:
 *  - Determinant Check & Winding Fix on negative scale/inversion.
 *  - Robust per-face and per-vertex normal vector preservation without zero-length normal collapse.
 */

export function sliceGeometryFromHeap(wasmMemory, geomMeta) {
  if (!wasmMemory?.buffer || !geomMeta) {
    return null;
  }

  const { buffer } = wasmMemory;
  const vertexPtr = geomMeta.vertex_ptr ?? geomMeta.vertexOffset ?? 0;
  const vertexCount = geomMeta.vertex_count ?? geomMeta.vertexCount ?? 0;
  const normalPtr = geomMeta.normal_ptr ?? geomMeta.normalOffset ?? 0;
  const indexPtr = geomMeta.index_ptr ?? geomMeta.indexOffset ?? 0;
  const indexCount = geomMeta.index_count ?? geomMeta.indexCount ?? 0;

  let vertices = null;
  let normals = null;
  let indices = null;

  try {
    if (vertexPtr + vertexCount * 3 * 4 <= buffer.byteLength && vertexCount > 0) {
      vertices = new Float32Array(buffer, vertexPtr, vertexCount * 3);
    }
    if (normalPtr + vertexCount * 3 * 4 <= buffer.byteLength && vertexCount > 0) {
      normals = new Float32Array(buffer, normalPtr, vertexCount * 3);
    }
    if (indexPtr + indexCount * 4 <= buffer.byteLength && indexCount > 0) {
      indices = new Uint32Array(buffer, indexPtr, indexCount);
    }
  } catch (err) {
    console.error('[WasmKernel] Memory slice out-of-bounds:', err);
  }

  return { vertices, normals, indices };
}

export class WasmKernelBridge {
  constructor() {
    this.isInitialized = false;
    this.occtModule = null;
    this.initPromise = null;
  }

  async init() {
    if (this.isInitialized) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        if (window.occtimportjs) {
          this.occtModule = await window.occtimportjs();
          this.isInitialized = true;
          console.log('[WasmKernel] OpenCASCADE WebAssembly Module initialized.');
          return true;
        }
        if (typeof window.occtimportjsInit === 'function') {
          this.occtModule = await window.occtimportjsInit();
          this.isInitialized = true;
          return true;
        }
        this.isInitialized = true;
        return true;
      } catch (err) {
        console.warn('[WasmKernel] OCCT fallback initialization:', err);
        this.isInitialized = true;
        return true;
      }
    })();

    return this.initPromise;
  }

  isStepOrBRep(filename) {
    const low = (filename || '').toLowerCase();
    return low.endsWith('.step') || low.endsWith('.stp') || low.endsWith('.fcstd') || low.endsWith('.brep') || low.endsWith('.iges') || low.endsWith('.igs');
  }

  computeMatrixDeterminant(mat) {
    if (!Array.isArray(mat) || mat.length < 16) return 1.0;
    const m00 = mat[0], m01 = mat[1], m02 = mat[2];
    const m10 = mat[4], m11 = mat[5], m12 = mat[6];
    const m20 = mat[8], m21 = mat[9], m22 = mat[10];
    return (
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20)
    );
  }

  multiplyMat4(a, b) {
    const out = new Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        out[r * 4 + c] =
          a[r * 4 + 0] * b[0 * 4 + c] +
          a[r * 4 + 1] * b[1 * 4 + c] +
          a[r * 4 + 2] * b[2 * 4 + c] +
          a[r * 4 + 3] * b[3 * 4 + c];
      }
    }
    return out;
  }

  applyTransformToPoint(pt, mat) {
    const { x, y, z } = pt;
    const w = mat[12] * x + mat[13] * y + mat[14] * z + mat[15] || 1.0;
    const res = {
      x: (mat[0] * x + mat[4] * y + mat[8] * z + mat[12]) / w,
      y: (mat[1] * x + mat[5] * y + mat[9] * z + mat[13]) / w,
      z: (mat[2] * x + mat[6] * y + mat[10] * z + mat[14]) / w
    };
    if (pt.nx !== undefined && pt.ny !== undefined && pt.nz !== undefined) {
      const nx = mat[0] * pt.nx + mat[4] * pt.ny + mat[8] * pt.nz;
      const ny = mat[1] * pt.nx + mat[5] * pt.ny + mat[9] * pt.nz;
      const nz = mat[2] * pt.nx + mat[6] * pt.ny + mat[10] * pt.nz;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      res.nx = nx / len;
      res.ny = ny / len;
      res.nz = nz / len;
    }
    return res;
  }

  buildAssemblyTree(wasmResult) {
    if (!wasmResult) {
      return { name: 'Empty Assembly', objects: [], assemblyTree: [] };
    }

    const wasmMemory = wasmResult.wasmMemory || wasmResult.memory || (this.occtModule?.HEAPU8 ? { buffer: this.occtModule.HEAPU8.buffer } : null);
    const rootNode = wasmResult.root || wasmResult.assemblyTree || wasmResult.tree || wasmResult;

    const objects = [];
    const visited = new WeakSet();
    const defaultIdentityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];

    const traverseNode = (node, parentTransform, depth = 0, path = '') => {
      if (!node || typeof node !== 'object') return null;
      if (visited.has(node)) {
        console.warn(`[WasmKernel] Circular scenegraph reference skipped at depth ${depth}`);
        return null;
      }
      visited.add(node);

      const localTransform = (Array.isArray(node.transform) && node.transform.length === 16)
        ? node.transform
        : (Array.isArray(node.matrix) && node.matrix.length === 16 ? node.matrix : defaultIdentityMatrix);

      const worldTransform = parentTransform ? this.multiplyMat4(parentTransform, localTransform) : localTransform;
      const det = this.computeMatrixDeterminant(worldTransform);
      const isInverted = det < 0;

      const nodeId = node.id || node.uuid || `node_${depth}_${Math.random().toString(36).substring(2, 7)}`;
      const originalStepName = node.name || node.stepName || node.partName || `Part_${nodeId}`;
      const currentPath = path ? `${path}/${originalStepName}` : originalStepName;

      const treeNode = {
        id: nodeId,
        name: originalStepName,
        path: currentPath,
        type: node.type || ((node.metadata || node.geometry || node.vertex_ptr !== undefined || node.vertexOffset !== undefined) ? 'PartInstance' : 'AssemblyGroup'),
        transform: localTransform,
        worldTransform,
        children: []
      };

      const meta = node.metadata || node.geometry || (node.vertex_ptr !== undefined || node.vertexOffset !== undefined ? node : null);
      if (meta) {
        const geomData = wasmMemory ? sliceGeometryFromHeap(wasmMemory, meta) : null;

        const posArr = geomData?.vertices || (node.positions instanceof Float32Array ? node.positions : (node.positions ? new Float32Array(node.positions) : null));
        const normArr = geomData?.normals || (node.normals instanceof Float32Array ? node.normals : (node.normals ? new Float32Array(node.normals) : null));
        const idxArr = geomData?.indices || (node.indices instanceof Uint32Array ? node.indices : (node.indices ? new Uint32Array(node.indices) : null));
        const brepFaces = node.brep_faces || meta.brep_faces || null;

        if (posArr && posArr.length >= 9) {
          const localFaces = [];
          const worldFaces = [];
          const brepMap = {};

          if (idxArr && idxArr.length >= 3) {
            for (let i = 0; i < idxArr.length - 2; i += 3) {
              const rawIdx0 = idxArr[i];
              const rawIdx1 = isInverted ? idxArr[i + 2] : idxArr[i + 1];
              const rawIdx2 = isInverted ? idxArr[i + 1] : idxArr[i + 2];

              const i0 = rawIdx0 * 3;
              const i1 = rawIdx1 * 3;
              const i2 = rawIdx2 * 3;

              if (i0 + 2 < posArr.length && i1 + 2 < posArr.length && i2 + 2 < posArr.length) {
                const p0 = { x: posArr[i0], y: posArr[i0 + 1], z: posArr[i0 + 2] };
                const p1 = { x: posArr[i1], y: posArr[i1 + 1], z: posArr[i1 + 2] };
                const p2 = { x: posArr[i2], y: posArr[i2 + 1], z: posArr[i2 + 2] };

                if (normArr && i0 + 2 < normArr.length && i1 + 2 < normArr.length && i2 + 2 < normArr.length) {
                  p0.nx = normArr[i0]; p0.ny = normArr[i0 + 1]; p0.nz = normArr[i0 + 2];
                  p1.nx = normArr[i1]; p1.ny = normArr[i1 + 1]; p1.nz = normArr[i1 + 2];
                  p2.nx = normArr[i2]; p2.ny = normArr[i2 + 1]; p2.nz = normArr[i2 + 2];
                } else {
                  const v10 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
                  const v20 = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
                  const cx = v10[1] * v20[2] - v10[2] * v20[1];
                  const cy = v10[2] * v20[0] - v10[0] * v20[2];
                  const cz = v10[0] * v20[1] - v10[1] * v20[0];
                  const len = Math.hypot(cx, cy, cz) || 1.0;
                  p0.nx = p1.nx = p2.nx = cx / len;
                  p0.ny = p1.ny = p2.ny = cy / len;
                  p0.nz = p1.nz = p2.nz = cz / len;
                }

                if (Number.isFinite(p0.x) && Number.isFinite(p0.y) && Number.isFinite(p0.z) &&
                    Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p1.z) &&
                    Number.isFinite(p2.x) && Number.isFinite(p2.y) && Number.isFinite(p2.z)) {
                  const faceId = brepFaces ? (brepFaces[Math.floor(i / 3)] || `face_${Math.floor(i / 3)}`) : `face_${Math.floor(i / 3)}`;
                  p0.face_id = faceId;
                  p1.face_id = faceId;
                  p2.face_id = faceId;

                  localFaces.push([p0, p1, p2]);
                  worldFaces.push([
                    this.applyTransformToPoint(p0, worldTransform),
                    this.applyTransformToPoint(p1, worldTransform),
                    this.applyTransformToPoint(p2, worldTransform)
                  ]);
                }
              }
            }
          }

          const partColor = node.color ? (Array.isArray(node.color) ? `rgb(${Math.round(node.color[0] * 255)}, ${Math.round(node.color[1] * 255)}, ${Math.round(node.color[2] * 255)})` : node.color) : '#38bdf8';

          const cadObj = {
            id: nodeId,
            object_id: nodeId,
            name: originalStepName,
            primitive_type: 'solid_imported',
            parameters: {
              treePath: currentPath,
              facets: worldFaces.length,
              wasm_processed: true,
              vertexCount: meta.vertex_count || (posArr.length / 3),
              indexCount: meta.index_count || (idxArr ? idxArr.length : 0)
            },
            position: [worldTransform[12], worldTransform[13], worldTransform[14]],
            rotation: [0, 0, 0],
            color: partColor,
            visible: node.visible !== false,
            material: node.material || 'Steel',
            opacity: node.opacity !== undefined ? node.opacity : 1.0,
            faces: worldFaces,
            localFaces,
            normals: normArr ? Array.from(normArr) : null,
            brep: node.brep || { faces: brepMap },
            transform: worldTransform,
            localTransform
          };

          objects.push(cadObj);
          treeNode.objectId = nodeId;
        }
      }

      const childList = node.children || node.nodes || node.subAssemblies || node.parts || [];
      if (Array.isArray(childList)) {
        for (const child of childList) {
          const childTreeNode = traverseNode(child, worldTransform, depth + 1, currentPath);
          if (childTreeNode) {
            treeNode.children.push(childTreeNode);
          }
        }
      }

      return treeNode;
    };

    const treeHierarchy = Array.isArray(rootNode)
      ? rootNode.map(n => traverseNode(n, defaultIdentityMatrix, 0, '')).filter(Boolean)
      : [traverseNode(rootNode, defaultIdentityMatrix, 0, '')].filter(Boolean);

    return {
      name: wasmResult.name || 'Hierarchical Assembly',
      objects,
      assemblyTree: treeHierarchy
    };
  }

  async parseStepArrayBuffer(arrayBuffer, filename = 'assembly.step') {
    await this.init();
    const startTime = performance.now();
    const uint8View = new Uint8Array(arrayBuffer);

    if (this.occtModule && typeof this.occtModule.ReadStepFile === 'function') {
      try {
        const wasmMemSize = uint8View.byteLength;
        const wasmBufferPtr = this.occtModule._malloc ? this.occtModule._malloc(wasmMemSize) : null;
        let resultMeshes = null;

        if (wasmBufferPtr && this.occtModule.HEAPU8) {
          this.occtModule.HEAPU8.set(uint8View, wasmBufferPtr);
          resultMeshes = this.occtModule.ReadStepFile(wasmBufferPtr, wasmMemSize, null);
          if (this.occtModule._free) this.occtModule._free(wasmBufferPtr);
        } else {
          resultMeshes = this.occtModule.ReadStepFile(uint8View, null);
        }

        if (resultMeshes) {
          const doc = this.buildAssemblyTree({
            name: filename,
            assemblyTree: resultMeshes.tree || resultMeshes.root || resultMeshes.meshes || [],
            wasmMemory: { buffer: arrayBuffer }
          });
          const elapsed = (performance.now() - startTime).toFixed(1);
          if (doc?.objects?.length > 0) {
            return { ok: true, document: doc, elapsedMs: elapsed, source: 'WASM_OCCT_TREE' };
          }
        }
      } catch (e) {
        console.warn('[WasmKernel] OCCT direct parse notice:', e);
      }
    }

    return null;
  }
}

export const WasmCADKernel = new WasmKernelBridge();
window.WasmCADKernel = WasmCADKernel;
