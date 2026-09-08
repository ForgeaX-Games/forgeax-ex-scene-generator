// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rtsCenterDevice",
  "contractVersion": "1.0.0",
  "opId": "rts_center_device",
  "description": "Places multi-ring devices (barriers, turrets, pillars, core markers) inside an RTS center region using concentric ring patterns, outputting a grid list and name list.",
  "inputs": [
    {
      "name": "centerGrid",
      "type": "grid",
      "description": "Mask grid of the RTS center region; non-zero cells are treated as the center area.",
      "label": "中心区域网格"
    },
    {
      "name": "layers",
      "type": "string",
      "defaultValue": "[{\"name\":\"护栏\",\"ring\":1,\"count\":16,\"shape\":\"full_ring\"},{\"name\":\"炮台\",\"ring\":2,\"count\":8,\"shape\":\"corners\"},{\"name\":\"结构柱\",\"ring\":3,\"count\":4,\"shape\":\"cross\"},{\"name\":\"中心核\",\"ring\":5,\"count\":1,\"shape\":\"ring\"}]",
      "description": "JSON array of layer configs: [{\"name\":\"barrier\",\"ring\":1,\"count\":8,\"shape\":\"ring\"}]. ring=1 is outermost. shape: ring/cross/corners/full_ring.",
      "label": "装置层配置",
      "mode": "parameter"
    },
    {
      "name": "ringStep",
      "type": "number",
      "defaultValue": 3,
      "description": "Cell gap between adjacent rings, measured inward from the boundary.",
      "label": "环间距",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "One grid per device layer; non-zero values are the layer's assigned id.",
      "label": "装置网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Name list [{id, name, type}] corresponding to each grid in outputGridList.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
