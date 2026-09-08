// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "trackMeshRasterize",
  "contractVersion": "1.0.0",
  "opId": "track_mesh_rasterize",
  "description": "Rasterizes a centerline point sequence into a 2D grid using a circular brush with configurable track width.",
  "inputs": [
    {
      "name": "centerline",
      "type": "array",
      "description": "Smooth centerline point sequence JSON string from track_spline_smooth.",
      "label": "中心线点列"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 100,
      "description": "Number of columns in the output grid.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 100,
      "description": "Number of rows in the output grid.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "trackWidth",
      "type": "number",
      "defaultValue": 8,
      "description": "Track width in cells (circle brush diameter).",
      "label": "赛道宽度",
      "mode": "parameter"
    },
    {
      "name": "trackId",
      "type": "number",
      "defaultValue": 1,
      "description": "Integer mask ID for the track area.",
      "label": "赛道掩码值",
      "mode": "parameter"
    },
    {
      "name": "bgId",
      "type": "number",
      "defaultValue": 0,
      "description": "Integer mask ID for the background area.",
      "label": "背景掩码值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "2D grid with track mask filled.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list mapping mask IDs to names [{id,name}...].",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
