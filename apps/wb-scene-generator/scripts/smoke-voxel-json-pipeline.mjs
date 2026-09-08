#!/usr/bin/env node
/**
 * End-to-end smoke: text_panel(JSON) → json2voxels → voxels2scene → scene_output
 * on an ephemeral backend port + temp project root.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExampleVoxelBuildingDocument } from '../examples/voxel-city-block.build.ts';

const PORT = Number(process.env.SMOKE_PORT ?? 9578);
const HOST = '127.0.0.1';

const projectRoot = mkdtempSync(join(tmpdir(), 'wb-voxel-json-'));
process.env.FORGEAX_PROJECT_ROOT = projectRoot;

const { buildApp } = await import('../backend/src/main.ts');
const app = await buildApp();

function fail(msg, extra) {
  console.error(`[smoke-voxel-json] FAIL — ${msg}`, extra !== undefined ? JSON.stringify(extra) : '');
  process.exitCode = 1;
}

async function api(path, body) {
  const res = await fetch(`http://${HOST}:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const voxelJson = JSON.stringify(buildExampleVoxelBuildingDocument());

try {
  await app.listen({ port: PORT, host: HOST });

  const ops = [
    {
      type: 'createNode',
      nodeId: 'json_text',
      opId: 'text_panel',
      position: { x: 0, y: 0 },
      params: { text: voxelJson },
    },
    {
      type: 'createNode',
      nodeId: 'parse',
      opId: 'json2voxels',
      position: { x: 280, y: 0 },
      params: {},
    },
    {
      type: 'createNode',
      nodeId: 'build',
      opId: 'voxels2scene',
      position: { x: 560, y: 0 },
      params: {},
    },
    {
      type: 'createNode',
      nodeId: 'out',
      opId: 'scene_output',
      position: { x: 840, y: 0 },
      params: {},
    },
    {
      type: 'connect',
      edgeId: 'e1',
      source: { nodeId: 'json_text', port: 'output' },
      target: { nodeId: 'parse', port: 'json' },
    },
    {
      type: 'connect',
      edgeId: 'e2',
      source: { nodeId: 'parse', port: 'nodes' },
      target: { nodeId: 'build', port: 'nodes' },
    },
    {
      type: 'connect',
      edgeId: 'e3',
      source: { nodeId: 'parse', port: 'root' },
      target: { nodeId: 'build', port: 'root' },
    },
    {
      type: 'connect',
      edgeId: 'e4',
      source: { nodeId: 'parse', port: 'schema' },
      target: { nodeId: 'build', port: 'schema' },
    },
    {
      type: 'connect',
      edgeId: 'e5',
      source: { nodeId: 'build', port: 'scene' },
      target: { nodeId: 'out', port: 'scene' },
    },
  ];

  const batch = await api('/api/v1/batch', { ops });
  if (batch.status !== 'ok') fail('applyBatch rejected', batch);

  const exec = await api('/api/v1/execute', {});
  if (exec.status !== 'completed') fail('execute did not complete', exec);

  const unwrap = (entries) => entries?.[0]?.items?.[0];

  const parseOut = exec.outputs?.parse ?? {};
  const voxelCount = unwrap(parseOut.voxelCount);
  if (typeof voxelCount !== 'number' || voxelCount < 100) {
    fail('json2voxels.voxelCount too small', voxelCount);
  }

  const buildOut = exec.outputs?.build ?? {};
  const nodeCount = unwrap(buildOut.nodeCount);
  if (nodeCount !== 3) fail('voxels2scene.nodeCount expected 3', nodeCount);

  const scene = unwrap(buildOut.scene);
  const rootNode = scene?.tree?.children?.find((c) => c.name === 'CityBlock');
  const childNames = (rootNode?.children ?? []).map((c) => c.name).sort();
  if (childNames.join(',') !== 'floor0_base,floor1_interior,floor2_roof') {
    fail('CityBlock children mismatch', childNames);
  }

  console.log('[smoke-voxel-json] OK — voxels:', voxelCount, 'nodes:', nodeCount, 'children:', childNames.join(', '));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await app.close();
  rmSync(projectRoot, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
