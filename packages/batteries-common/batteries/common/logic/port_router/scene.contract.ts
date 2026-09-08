// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "portRouter",
  "contractVersion": "1.0.0",
  "opId": "port_router",
  "description": "Route one of several dynamic input ports to the output based on rules + params. Rules is a string like [{A:2},{C:3}] (key -> dynamic port index); params is a string like (A,C) (the set of active keys). The first rule (in written order) whose key is in params selects its dynamic port port_<n>, forwarded unchanged. No output when nothing matches or that port is unconnected.",
  "inputs": [
    {
      "name": "rules",
      "type": "string",
      "access": "tree",
      "required": false,
      "defaultValue": "",
      "description": "Routing rules string like [{A:2},{C:3}]: maps a key to a dynamic port index. Matched in written order; first hit wins.",
      "label": "规则",
      "mode": "parameter"
    },
    {
      "name": "params",
      "type": "string",
      "access": "tree",
      "required": false,
      "defaultValue": "",
      "description": "Active key set string like (A,C). Keys present here are matched against the rules to pick a port.",
      "label": "参数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "any",
      "access": "tree",
      "description": "The selected dynamic port's input, forwarded unchanged.",
      "label": "输出"
    }
  ],
  "deterministic": true
})
