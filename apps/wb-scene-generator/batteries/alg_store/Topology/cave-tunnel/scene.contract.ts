// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "caveTunnel",
  "contractVersion": "2.0.0",
  "opId": "cave_tunnel",
  "description": "Generates branching cave tunnels inside rock regions. Uses 3D Perlin noise direction bias, width decay, and recursive branching to produce tree-like cave networks.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid mask; non-zero cells are treated as rock (diggable), 0 is background.",
      "label": "输入网格"
    },
    {
      "name": "maxOpenTunnels",
      "type": "number",
      "defaultValue": 3,
      "description": "Max open tunnels per connected rock group (dig inward from edges). Actual count auto-computed at 5.8 per 10000 cells.",
      "label": "开放隧道上限",
      "mode": "parameter"
    },
    {
      "name": "maxClosedTunnels",
      "type": "number",
      "defaultValue": 1,
      "description": "Max closed tunnels per connected rock group (dig from interior in random direction). Actual count auto-computed at 2.5 per 10000 cells.",
      "label": "封闭隧道上限",
      "mode": "parameter"
    },
    {
      "name": "minGroupSize",
      "type": "number",
      "defaultValue": 20,
      "description": "Minimum pixel count for a connected rock group; smaller groups are skipped. Original is 300 (for 250x250), lowered for 50x50.",
      "label": "最小区域面积",
      "mode": "parameter"
    },
    {
      "name": "tunnelWidth",
      "type": "number",
      "defaultValue": 0,
      "description": "Initial tunnel diameter. 0=auto-scale by group size via WIDTH_CURVE (100→2, 300→4, 3000→5.5); >0 uses fixed value.",
      "label": "隧道宽度",
      "mode": "parameter"
    },
    {
      "name": "widthDecay",
      "type": "number",
      "defaultValue": 0.034,
      "description": "Width reduction per step; larger values produce shorter tunnels.",
      "label": "宽度衰减",
      "mode": "parameter"
    },
    {
      "name": "minWidth",
      "type": "number",
      "defaultValue": 1.4,
      "description": "Stop digging when tunnel width drops below this value.",
      "label": "最小宽度",
      "mode": "parameter"
    },
    {
      "name": "branchChance",
      "type": "number",
      "defaultValue": 0.1,
      "description": "Per-step probability of spawning a branch tunnel; default 10%.",
      "label": "分支概率",
      "mode": "parameter"
    },
    {
      "name": "branchAfter",
      "type": "number",
      "defaultValue": 15,
      "description": "Minimum steps before branching is allowed.",
      "label": "分支最小步数",
      "mode": "parameter"
    },
    {
      "name": "dirChangeSpeed",
      "type": "number",
      "defaultValue": 8,
      "description": "Max direction change per step in degrees.",
      "label": "方向变化幅度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different tunnel layouts.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid with tunnel cells set to 1 and all others 0.",
      "label": "隧道网格"
    }
  ],
  "deterministic": true
})
