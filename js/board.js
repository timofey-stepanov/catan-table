import {
  TILE_DISTRIBUTION,
  NUMBER_TOKENS,
  HARBOR_TYPES
} from './constants.js';

export const HEX_SIZE = 58;
const SQRT3 = Math.sqrt(3);

export function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function axialToPixel(q, r, size = HEX_SIZE) {
  const x = size * SQRT3 * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

export function areHexesAdjacent(h1, h2) {
  const dq = h1.q - h2.q;
  const dr = h1.r - h2.r;
  const ds = (-h1.q - h1.r) - (-h2.q - h2.r);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) === 2;
}

/**
 * Generates a complete Catan board with 19 hexes, 54 vertices, 72 edges, and 9 harbors.
 */
export function generateBoard({ balancedNumbers = true } = {}) {
  // 1. Create 19 axial coordinates for radius-2 hex island
  const coords = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) {
      if (Math.abs(q + r) <= 2) {
        coords.push({ q, r });
      }
    }
  }

  // 2. Shuffle terrain tiles
  const terrains = shuffle(TILE_DISTRIBUTION);

  const hexes = coords.map((coord, idx) => {
    const { x, y } = axialToPixel(coord.q, coord.r);
    const terrain = terrains[idx];
    return {
      id: idx,
      q: coord.q,
      r: coord.r,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      terrain,
      number: null,
      hasRobber: terrain === 'desert',
      vertexIds: [],
      edgeIds: []
    };
  });

  // 3. Assign number tokens to non-desert hexes
  const nonDesertHexes = hexes.filter(h => h.terrain !== 'desert');
  let numbers = shuffle(NUMBER_TOKENS);

  if (balancedNumbers) {
    // Ensure no two '6' or '8' tokens are on adjacent hexes
    for (let attempt = 0; attempt < 300; attempt++) {
      const candidate = shuffle(NUMBER_TOKENS);
      let valid = true;
      for (let i = 0; i < nonDesertHexes.length && valid; i++) {
        if (candidate[i] !== 6 && candidate[i] !== 8) continue;
        for (let j = i + 1; j < nonDesertHexes.length; j++) {
          if (candidate[j] !== 6 && candidate[j] !== 8) continue;
          if (areHexesAdjacent(nonDesertHexes[i], nonDesertHexes[j])) {
            valid = false;
            break;
          }
        }
      }
      if (valid) {
        numbers = candidate;
        break;
      }
    }
  }

  nonDesertHexes.forEach((hex, idx) => {
    hex.number = numbers[idx];
  });

  // 4. Build deduplicated 54 Vertices and 72 Edges
  const vertices = [];
  const vertexByKey = new Map();
  const edges = [];
  const edgeByKey = new Map();

  function getOrCreateVertex(x, y) {
    const rx = Math.round(x * 10) / 10;
    const ry = Math.round(y * 10) / 10;
    // Search within 1.5px tolerance to avoid floating-point rounding splits
    for (const v of vertices) {
      if (Math.hypot(v.x - rx, v.y - ry) < 1.5) {
        return v;
      }
    }
    const v = {
      id: vertices.length,
      x: rx,
      y: ry,
      hexIds: [],
      adjacentVertexIds: [],
      edgeIds: [],
      building: null, // { owner: playerId, type: 'settlement' | 'city' }
      harbor: null    // { type: 'any' | resourceKey, ratio: 2 | 3, label, emoji }
    };
    vertices.push(v);
    vertexByKey.set(`${rx},${ry}`, v);
    return v;
  }

  function getOrCreateEdge(v1, v2) {
    const a = Math.min(v1.id, v2.id);
    const b = Math.max(v1.id, v2.id);
    const key = `${a}-${b}`;
    if (edgeByKey.has(key)) {
      return edgeByKey.get(key);
    }
    const edge = {
      id: edges.length,
      v1: a,
      v2: b,
      x1: vertices[a].x,
      y1: vertices[a].y,
      x2: vertices[b].x,
      y2: vertices[b].y,
      mx: Math.round(((vertices[a].x + vertices[b].x) / 2) * 10) / 10,
      my: Math.round(((vertices[a].y + vertices[b].y) / 2) * 10) / 10,
      hexIds: [],
      road: null // { owner: playerId }
    };
    edges.push(edge);
    edgeByKey.set(key, edge);

    if (!vertices[a].adjacentVertexIds.includes(b)) {
      vertices[a].adjacentVertexIds.push(b);
    }
    if (!vertices[b].adjacentVertexIds.includes(a)) {
      vertices[b].adjacentVertexIds.push(a);
    }
    if (!vertices[a].edgeIds.includes(edge.id)) {
      vertices[a].edgeIds.push(edge.id);
    }
    if (!vertices[b].edgeIds.includes(edge.id)) {
      vertices[b].edgeIds.push(edge.id);
    }
    return edge;
  }

  for (const hex of hexes) {
    const cornerVerts = [];
    for (let i = 0; i < 6; i++) {
      const angleRad = ((60 * i - 30) * Math.PI) / 180;
      const vx = hex.x + HEX_SIZE * Math.cos(angleRad);
      const vy = hex.y + HEX_SIZE * Math.sin(angleRad);
      const v = getOrCreateVertex(vx, vy);
      if (!v.hexIds.includes(hex.id)) {
        v.hexIds.push(hex.id);
      }
      cornerVerts.push(v);
      hex.vertexIds.push(v.id);
    }

    for (let i = 0; i < 6; i++) {
      const v1 = cornerVerts[i];
      const v2 = cornerVerts[(i + 1) % 6];
      const edge = getOrCreateEdge(v1, v2);
      if (!edge.hexIds.includes(hex.id)) {
        edge.hexIds.push(hex.id);
      }
      hex.edgeIds.push(edge.id);
    }
  }

  // 5. Place 9 Harbors around the 30-edge coastal perimeter
  // Walk the coastal edges in connected cyclic order around the island
  const coastalEdges = edges.filter(e => e.hexIds.length === 1);
  const orderedCoastal = orderCoastalLoop(coastalEdges);
  const shuffledHarbors = shuffle(HARBOR_TYPES);
  const harborIndices = [0, 3, 7, 10, 13, 17, 20, 23, 27];

  const harbors = harborIndices.map((loopIdx, idx) => {
    const edge = orderedCoastal[loopIdx % orderedCoastal.length];
    const harborInfo = shuffledHarbors[idx];
    const parentHex = hexes[edge.hexIds[0]];

    // Compute outward vector from parent hex center through the coastal edge midpoint
    const dx = edge.mx - parentHex.x;
    const dy = edge.my - parentHex.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const dockX = Math.round((edge.mx + ux * 28) * 10) / 10;
    const dockY = Math.round((edge.my + uy * 28) * 10) / 10;

    const harborObj = {
      id: idx,
      edgeId: edge.id,
      v1: edge.v1,
      v2: edge.v2,
      type: harborInfo.type,
      ratio: harborInfo.ratio,
      label: harborInfo.label,
      emoji: harborInfo.emoji,
      x: dockX,
      y: dockY
    };

    vertices[edge.v1].harbor = {
      type: harborInfo.type,
      ratio: harborInfo.ratio,
      label: harborInfo.label,
      emoji: harborInfo.emoji
    };
    vertices[edge.v2].harbor = {
      type: harborInfo.type,
      ratio: harborInfo.ratio,
      label: harborInfo.label,
      emoji: harborInfo.emoji
    };

    return harborObj;
  });

  return {
    hexes,
    vertices,
    edges,
    harbors
  };
}

function orderCoastalLoop(coastalEdges) {
  if (coastalEdges.length === 0) return [];
  // Start with the top-most coastal edge
  const remaining = [...coastalEdges];
  remaining.sort((a, b) => Math.atan2(a.my, a.mx) - Math.atan2(b.my, b.mx));

  const loop = [remaining.shift()];
  let currentVertex = loop[0].v2;

  while (remaining.length > 0) {
    const nextIdx = remaining.findIndex(
      e => e.v1 === currentVertex || e.v2 === currentVertex
    );
    if (nextIdx === -1) {
      loop.push(remaining.shift());
      currentVertex = loop[loop.length - 1].v2;
    } else {
      const nextEdge = remaining.splice(nextIdx, 1)[0];
      loop.push(nextEdge);
      currentVertex = nextEdge.v1 === currentVertex ? nextEdge.v2 : nextEdge.v1;
    }
  }
  return loop;
}

/**
 * Checks whether a vertex satisfies the Catan Distance Rule (no adjacent buildings)
 * and, during main gameplay, connects to one of the player's roads.
 */
export function getValidSettlementVertices(board, playerId, isSetup = false) {
  const valid = [];
  for (const v of board.vertices) {
    if (v.building !== null) continue;

    // Distance rule: no adjacent vertex may have a building
    const hasAdjacentBuilding = v.adjacentVertexIds.some(
      adjId => board.vertices[adjId].building !== null
    );
    if (hasAdjacentBuilding) continue;

    if (isSetup) {
      valid.push(v.id);
    } else {
      // Must connect to at least one road owned by playerId
      const hasConnectedRoad = v.edgeIds.some(
        eId => board.edges[eId].road && board.edges[eId].road.owner === playerId
      );
      if (hasConnectedRoad) {
        valid.push(v.id);
      }
    }
  }
  return valid;
}

/**
 * Checks valid city upgrade vertices for a player (must be an existing settlement owned by playerId).
 */
export function getValidCityVertices(board, playerId) {
  return board.vertices
    .filter(v => v.building && v.building.owner === playerId && v.building.type === 'settlement')
    .map(v => v.id);
}

/**
 * Returns valid road edge IDs for a player.
 * If anchorVertexId is provided (during setup after placing a settlement), road must attach to that vertex.
 */
export function getValidRoadEdges(board, playerId, anchorVertexId = null) {
  if (anchorVertexId !== null) {
    const v = board.vertices[anchorVertexId];
    return v.edgeIds.filter(eId => board.edges[eId].road === null);
  }

  const valid = [];
  for (const e of board.edges) {
    if (e.road !== null) continue;

    // Check if either endpoint v1 or v2 connects to player's building or road (not blocked by opponent building)
    const connectsAtV1 = canPlayerExtendFromVertex(board, playerId, e.v1);
    const connectsAtV2 = canPlayerExtendFromVertex(board, playerId, e.v2);

    if (connectsAtV1 || connectsAtV2) {
      valid.push(e.id);
    }
  }
  return valid;
}

function canPlayerExtendFromVertex(board, playerId, vertexId) {
  const v = board.vertices[vertexId];
  if (v.building) {
    return v.building.owner === playerId;
  }
  // No building on this vertex: check if player has a road incident to this vertex
  return v.edgeIds.some(
    eId => board.edges[eId].road && board.edges[eId].road.owner === playerId
  );
}

/**
 * Computes the length of the longest continuous road for a given player,
 * respecting opponent buildings that break road continuity.
 */
export function computePlayerLongestRoad(board, playerId) {
  const playerEdges = board.edges.filter(
    e => e.road && e.road.owner === playerId
  );
  if (playerEdges.length === 0) return 0;

  let maxLen = 0;
  const visitedEdges = new Set();

  function dfs(currentVertexId, currentLength) {
    if (currentLength > maxLen) {
      maxLen = currentLength;
    }

    const v = board.vertices[currentVertexId];
    for (const eId of v.edgeIds) {
      if (visitedEdges.has(eId)) continue;
      const edge = board.edges[eId];
      if (!edge.road || edge.road.owner !== playerId) continue;

      const nextVertexId = edge.v1 === currentVertexId ? edge.v2 : edge.v1;
      const nextVertex = board.vertices[nextVertexId];

      visitedEdges.add(eId);

      // If nextVertex has an opponent's building, the road ends at nextVertex (cannot continue through it)
      if (nextVertex.building && nextVertex.building.owner !== playerId) {
        if (currentLength + 1 > maxLen) {
          maxLen = currentLength + 1;
        }
      } else {
        dfs(nextVertexId, currentLength + 1);
      }

      visitedEdges.delete(eId);
    }
  }

  // Run DFS from every vertex incident to any of the player's roads
  const startVertices = new Set();
  for (const e of playerEdges) {
    startVertices.add(e.v1);
    startVertices.add(e.v2);
  }

  for (const vId of startVertices) {
    dfs(vId, 0);
  }

  return maxLen;
}
