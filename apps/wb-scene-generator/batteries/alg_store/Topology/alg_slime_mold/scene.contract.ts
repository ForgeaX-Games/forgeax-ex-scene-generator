// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algSlimeMold",
  "contractVersion": "2.0.0",
  "opId": "alg_slime_mold",
  "description": "Simulates Physarum polycephalum slime mold foraging behavior to generate organic web-like network patterns within a grid mask.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; non-zero cells define the simulation domain where agents move.",
      "label": "输入网格"
    },
    {
      "name": "agentCount",
      "type": "number",
      "defaultValue": 500,
      "description": "Number of slime mold agents; more agents produce denser networks.",
      "label": "智能体数量",
      "mode": "parameter"
    },
    {
      "name": "steps",
      "type": "number",
      "defaultValue": 200,
      "description": "Total simulation steps; more steps produce more mature and converged networks.",
      "label": "仿真步数",
      "mode": "parameter"
    },
    {
      "name": "sensorAngle",
      "type": "number",
      "defaultValue": 45,
      "description": "Angle (degrees) between the forward direction and side sensors, controlling turning sensitivity.",
      "label": "感知角度",
      "mode": "parameter"
    },
    {
      "name": "sensorDistance",
      "type": "number",
      "defaultValue": 8,
      "description": "Look-ahead distance in cells for agent sensors; larger values produce smoother paths.",
      "label": "感知距离",
      "mode": "parameter"
    },
    {
      "name": "turnSpeed",
      "type": "number",
      "defaultValue": 45,
      "description": "Maximum turn angle per step in degrees; larger values produce more winding paths.",
      "label": "转向速度",
      "mode": "parameter"
    },
    {
      "name": "stepSize",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Distance each agent moves per step in grid units; larger values produce sparser trails.",
      "label": "步长",
      "mode": "parameter"
    },
    {
      "name": "decayRate",
      "type": "number",
      "defaultValue": 0.99,
      "description": "Fraction of trail concentration retained each step (0~1); smaller values cause faster decay and sparser networks.",
      "label": "轨迹衰减率",
      "mode": "parameter"
    },
    {
      "name": "depositAmount",
      "type": "number",
      "defaultValue": 1,
      "description": "Amount of trail deposited (additive) per step; larger values produce thicker paths.",
      "label": "轨迹沉积量",
      "mode": "parameter"
    },
    {
      "name": "depositRadius",
      "type": "number",
      "defaultValue": 1.5,
      "description": "Radius of the disk footprint for trail deposition in grid units; larger values produce wider paths.",
      "label": "沉积半径",
      "mode": "parameter"
    },
    {
      "name": "trailThreshold",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Cells with trail >= maxTrail * this value are marked as path (0~1); larger values produce thinner output paths.",
      "label": "路径阈值",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp for automatic randomization.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: cells with high trail concentration = 1 (path), all others = 0.",
      "label": "黏菌网格"
    }
  ],
  "deterministic": true
})
