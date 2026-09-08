/**
 * json2voxels — 解析 JSON 体素坐标列表，输出 point3d 列表与可选分层 nodes 描述。
 *
 * 支持格式：
 *   - [{ "x":0,"y":0,"z":0,"token":"wall" }, ...]
 *   - { "voxels": [...] } / { "cells": [...] }
 *   - { "root":"Building", "nodes":[{ "name":"floor0", "cells":[...] }, ...] }
 */

import { parseVoxelDocument, tryParseJSON } from './parse.ts';

export function json2Voxels(input: Record<string, unknown>): Record<string, unknown> {
  const rawJson = input.json ?? input.str;
  if (typeof rawJson !== 'string' || rawJson.trim() === '') {
    return {
      error: 'json (or str) is required and must be a non-empty JSON string',
      voxels: [],
      tokens: [],
      voxelCount: 0,
    };
  }

  const parsed = tryParseJSON(rawJson.trim());
  if (parsed === null) {
    return {
      error: 'json could not be parsed',
      voxels: [],
      tokens: [],
      voxelCount: 0,
    };
  }

  const defaultToken = typeof input.defaultToken === 'string' && input.defaultToken.trim()
    ? input.defaultToken.trim()
    : 'cell';

  const doc = parseVoxelDocument(parsed, defaultToken);
  if ('error' in doc) {
    return {
      error: doc.error,
      voxels: [],
      tokens: [],
      voxelCount: 0,
    };
  }

  const voxels = doc.voxels.map(({ x, y, z }) => ({ x, y, z }));
  return {
    voxels,
    tokens: doc.tokens,
    ...(doc.nodes ? { nodes: doc.nodes } : {}),
    ...(doc.root ? { root: doc.root } : {}),
    ...(doc.schema ? { schema: doc.schema } : {}),
    voxelCount: voxels.length,
  };
}

export default json2Voxels;
