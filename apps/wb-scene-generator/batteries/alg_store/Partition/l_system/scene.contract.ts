// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "lSystem",
  "contractVersion": "1.0.0",
  "opId": "l_system",
  "description": "Lindenmayer system fractal/branching generator: iteratively rewrites a grammar string then interprets it as turtle-graphics commands to produce road networks, river deltas, organic branches, space-filling curves, and other topological structures on a grid.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; non-zero cells define the drawing area. The L-system output is auto-scaled to fit within this region.",
      "label": "输入网格"
    },
    {
      "name": "preset",
      "type": "string",
      "defaultValue": "none",
      "description": "Preset: none=custom, organic_branch, river_delta, road_network, fractal_tree, dragon_curve, hilbert_curve. When a preset is active, core L-system params (axiom, rules, iterations, angle, startAngle, widthDecay, lengthDecay) are locked to preset values; drawing params (lineWidth, angleJitter, padding, etc.) remain freely adjustable.",
      "label": "预设模式",
      "options": [
        "none",
        "organic_branch",
        "river_delta",
        "road_network",
        "fractal_tree",
        "dragon_curve",
        "hilbert_curve"
      ],
      "mode": "parameter"
    },
    {
      "name": "axiom",
      "type": "string",
      "defaultValue": "X",
      "description": "Initial axiom string. Ignored when a preset is active (preset provides its own axiom); only effective when preset=none.",
      "label": "公理",
      "mode": "parameter"
    },
    {
      "name": "rules",
      "type": "string",
      "defaultValue": "X=F-[[X]+X]+F[+FX]-X;F=FF",
      "description": "Production rules: \"symbol=replacement\" separated by \";\". Stochastic: separate alternatives with \"|\", optional \":weight\" suffix. Ignored when a preset is active.",
      "label": "产生规则",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 5,
      "description": "Number of rule-rewriting iterations. Each pass replaces all matching symbols. Higher values produce more complex structures.",
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "angle",
      "type": "number",
      "defaultValue": 22.5,
      "description": "Turtle turn angle in degrees for + and - commands. 90° → orthogonal; 22-30° → natural branching; 60°/120° → snowflake/triangular.",
      "label": "转向角度",
      "mode": "parameter"
    },
    {
      "name": "startAngle",
      "type": "number",
      "defaultValue": 0,
      "description": "Initial turtle heading: 0=up, 90=right, 180=down, 270=left.",
      "label": "初始朝向",
      "mode": "parameter"
    },
    {
      "name": "lineWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Base line width in pixels. Actual branch width = lineWidth × accumulated widthDecay.",
      "label": "线条宽度",
      "mode": "parameter"
    },
    {
      "name": "widthDecay",
      "type": "number",
      "defaultValue": 0.75,
      "description": "Width decay factor per branch push [. 0.7 = branches noticeably thinner; 1.0 = no decay.",
      "label": "宽度衰减",
      "mode": "parameter"
    },
    {
      "name": "lengthDecay",
      "type": "number",
      "defaultValue": 0.8,
      "description": "Step-length decay factor per branch push [. 0.7 = branch segments much shorter; 1.0 = no decay.",
      "label": "长度衰减",
      "mode": "parameter"
    },
    {
      "name": "angleJitter",
      "type": "number",
      "defaultValue": 3,
      "description": "Random angle perturbation range (±degrees) per turn, breaking symmetry and making the seed produce visible variation. 0=fully deterministic (seed has no effect), 3=subtle, 5-15=moderate organic, >20=highly random.",
      "label": "角度抖动",
      "mode": "parameter"
    },
    {
      "name": "padding",
      "type": "number",
      "defaultValue": 2,
      "description": "Inner padding in pixels between the L-system output and mask boundary.",
      "label": "内边距",
      "mode": "parameter"
    },
    {
      "name": "constrainToMask",
      "type": "boolean",
      "defaultValue": true,
      "description": "Constrain drawing to non-zero mask cells. When enabled, pixels outside the mask are not drawn.",
      "label": "约束到掩码",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed for angle jitter and stochastic rules. 0 uses the current timestamp. Note: seed has no effect when angleJitter=0 and rules are deterministic.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: L-system structure cells = 1, all others = 0.",
      "label": "L-System 网格"
    }
  ],
  "deterministic": true
})
