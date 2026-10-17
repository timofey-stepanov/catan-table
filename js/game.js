import {
  RESOURCES,
  RESOURCE_KEYS,
  BUILD_COSTS,
  PIECE_LIMITS,
  DEV_CARD_INFO,
  DEV_DECK_DISTRIBUTION,
  PLAYER_PRESETS
} from './constants.js';
import {
  generateBoard,
  shuffle,
  getValidSettlementVertices,
  getValidCityVertices,
  getValidRoadEdges,
  computePlayerLongestRoad
} from './board.js';

const STORAGE_KEY = 'catan_ipad_tabletop_state_v1';
const MAX_UNDO_STACK = 25;

export class CatanGame {
  constructor() {
    this.state = null;
    this.undoStack = [];
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.saveToStorage();
    for (const fn of this.listeners) {
      fn(this.state);
    }
  }

  saveToStorage() {
    if (!this.state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Could not save state to localStorage:', e);
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.board && parsed.players) {
        this.state = parsed;
        this.undoStack = [];
        return true;
      }
    } catch (e) {
      console.warn('Could not load saved game:', e);
    }
    return false;
  }

  pushUndoSnapshot(actionLabel = 'Action') {
    if (!this.state) return;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    this.undoStack.push({ label: actionLabel, snapshot });
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const last = this.undoStack.pop();
    this.state = last.snapshot;
    this.addLog(`↩️ Undid: ${last.label}`);
    this.notify();
    return true;
  }

  /**
   * Starts a new game with custom player config and options.
   */
  startNewGame({
    playerConfigs = [
      { name: 'Red', presetId: 0 },
      { name: 'Blue', presetId: 1 },
      { name: 'Orange', presetId: 2 },
      { name: 'Purple', presetId: 3 }
    ],
    balancedNumbers = true,
    diceMode = 'random', // 'random' | 'deck'
    victoryTarget = 10,
    rotateEdgeCards = true
  } = {}) {
    const count = playerConfigs.length;
    const seatAssignments =
      count === 2
        ? ['bottom', 'top']
        : count === 3
        ? ['bottom', 'left', 'right']
        : ['bottom', 'left', 'top', 'right'];

    const players = playerConfigs.map((cfg, idx) => {
      const preset = PLAYER_PRESETS[cfg.presetId ?? idx] || PLAYER_PRESETS[idx];
      return {
        id: idx,
        name: (cfg.name || preset.defaultName).trim() || preset.defaultName,
        emoji: preset.emoji,
        color: preset.color,
        darkColor: preset.darkColor,
        lightColor: preset.lightColor,
        seat: seatAssignments[idx],
        resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
        devCards: [], // [{ id, type, boughtTurn }]
        knightsPlayed: 0,
        roadsLeft: PIECE_LIMITS.roads,
        settlementsLeft: PIECE_LIMITS.settlements,
        citiesLeft: PIECE_LIMITS.cities,
        longestRoadLength: 0
      };
    });

    const board = generateBoard({ balancedNumbers });
    const devDeck = shuffle(DEV_DECK_DISTRIBUTION);

    // Snake draft order: [0, 1, ..., n-1, n-1, ..., 1, 0]
    const setupOrder = [
      ...players.map(p => p.id),
      ...[...players.map(p => p.id)].reverse()
    ];

    this.undoStack = [];
    this.state = {
      version: 1,
      settings: {
        balancedNumbers,
        diceMode,
        victoryTarget,
        rotateEdgeCards
      },
      board,
      players,
      devDeck,
      diceShoe: this.createDiceShoe(),
      turnNumber: 1,
      currentPlayerId: setupOrder[0],
      // Phases:
      // 'SETUP_SETTLEMENT' -> 'SETUP_ROAD' -> 'PRE_ROLL' -> 'DISCARD_7' -> 'MOVE_ROBBER' -> 'STEAL_ROBBER' -> 'MAIN_TURN' -> 'ROAD_BUILDING_DEV' -> 'GAME_OVER'
      phase: 'SETUP_SETTLEMENT',
      phaseBeforeRobber: 'MAIN_TURN',
      setupOrder,
      setupStep: 0,
      lastPlacedSettlementVertexId: null,
      freeRoadsRemaining: 0,
      devCardPlayedThisTurn: false,
      buildMode: null, // null | 'road' | 'settlement' | 'city'
      lastRoll: null, // { d1, d2, sum }
      diceStats: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      discardState: {}, // { [playerId]: { required: number, selected: { wood..ore }, done: boolean } }
      stealCandidates: [], // [playerId]
      longestRoadHolderId: null,
      largestArmyHolderId: null,
      winnerId: null,
      activeTrade: {
        isOpen: false,
        give: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
        want: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
        targetPlayerId: 'all', // 'all' or playerId
        passedPlayerIds: [],
        edgeErrorByPlayer: {}
      },
      bannerMessage: `${players[0].emoji} ${players[0].name}: Place your 1st Settlement`,
      log: [
        `🏝️ New Catan game started (${players.length} players, target ${victoryTarget} VP).`,
        `${players[0].emoji} ${players[0].name} begins initial placement.`
      ]
    };

    this.notify();
  }

  createDiceShoe() {
    const pairs = [];
    for (let d1 = 1; d1 <= 6; d1++) {
      for (let d2 = 1; d2 <= 6; d2++) {
        pairs.push({ d1, d2, sum: d1 + d2 });
      }
    }
    return shuffle(pairs);
  }

  addLog(msg) {
    if (!this.state) return;
    this.state.log.unshift(msg);
    if (this.state.log.length > 60) {
      this.state.log.length = 60;
    }
  }

  setBanner(msg) {
    if (!this.state) return;
    this.state.bannerMessage = msg;
  }

  toggleRotateEdgeCards() {
    if (!this.state) return;
    this.state.settings.rotateEdgeCards = !this.state.settings.rotateEdgeCards;
    this.notify();
  }

  getPlayer(playerId = this.state.currentPlayerId) {
    return this.state.players[playerId];
  }

  getTotalResources(player) {
    return RESOURCE_KEYS.reduce((acc, k) => acc + (player.resources[k] || 0), 0);
  }

  /**
   * Computes Victory Points for a player.
   * includeSecretVP = true includes Victory Point Dev Cards.
   */
  getVictoryPoints(playerId, includeSecretVP = false) {
    const s = this.state;
    let vp = 0;

    for (const v of s.board.vertices) {
      if (v.building && v.building.owner === playerId) {
        vp += v.building.type === 'city' ? 2 : 1;
      }
    }

    if (s.longestRoadHolderId === playerId) vp += 2;
    if (s.largestArmyHolderId === playerId) vp += 2;

    if (includeSecretVP) {
      const p = s.players[playerId];
      const vpCards = p.devCards.filter(c => c.type === 'vp').length;
      vp += vpCards;
    }

    return vp;
  }

  checkWinner() {
    const s = this.state;
    if (s.phase === 'GAME_OVER') return true;
    // Per Catan rules, a player wins on their turn when their total VP (including secret VP cards) reaches victoryTarget
    const currentId = s.currentPlayerId;
    const totalVp = this.getVictoryPoints(currentId, true);
    if (totalVp >= s.settings.victoryTarget) {
      s.winnerId = currentId;
      s.phase = 'GAME_OVER';
      s.buildMode = null;
      s.activeTrade.isOpen = false;
      const p = s.players[currentId];
      this.setBanner(`🏆 ${p.emoji} ${p.name} wins with ${totalVp} Victory Points!`);
      this.addLog(`🏆🎉 ${p.emoji} ${p.name} has reached ${totalVp} VP and won the game!`);
      return true;
    }
    return false;
  }

  /**
   * Returns all harbors owned by a player and their best bank trade ratio per resource.
   */
  getPlayerHarborRates(playerId) {
    const rates = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    const ownedHarbors = [];
    const seenTypes = new Set();

    for (const v of this.state.board.vertices) {
      if (v.building && v.building.owner === playerId && v.harbor) {
        if (!seenTypes.has(v.harbor.type + ':' + v.harbor.ratio)) {
          seenTypes.add(v.harbor.type + ':' + v.harbor.ratio);
          ownedHarbors.push(v.harbor);
        }
        if (v.harbor.type === 'any') {
          for (const k of RESOURCE_KEYS) {
            rates[k] = Math.min(rates[k], 3);
          }
        } else if (rates[v.harbor.type] !== undefined) {
          rates[v.harbor.type] = Math.min(rates[v.harbor.type], 2);
        }
      }
    }

    return { rates, ownedHarbors };
  }

  canAfford(playerId, costObj) {
    const p = this.state.players[playerId];
    return RESOURCE_KEYS.every(k => (p.resources[k] || 0) >= (costObj[k] || 0));
  }

  payCost(playerId, costObj) {
    const p = this.state.players[playerId];
    for (const k of RESOURCE_KEYS) {
      if (costObj[k]) {
        p.resources[k] -= costObj[k];
      }
    }
  }

  /**
   * Updates Longest Road for all players after any road or settlement placement.
   */
  updateLongestRoad() {
    const s = this.state;
    for (const p of s.players) {
      p.longestRoadLength = computePlayerLongestRoad(s.board, p.id);
    }

    const currentHolder = s.longestRoadHolderId;
    const currentHolderLen =
      currentHolder !== null ? s.players[currentHolder].longestRoadLength : 0;

    // Find max road length across all players
    let maxLen = 0;
    for (const p of s.players) {
      if (p.longestRoadLength > maxLen) {
        maxLen = p.longestRoadLength;
      }
    }

    if (maxLen < 5) {
      if (currentHolder !== null) {
        const oldP = s.players[currentHolder];
        this.addLog(`🛤️ ${oldP.emoji} ${oldP.name} lost Longest Road (dropped below 5).`);
        s.longestRoadHolderId = null;
      }
      return;
    }

    const tiedLeaders = s.players.filter(p => p.longestRoadLength === maxLen);

    if (currentHolder !== null && s.players[currentHolder].longestRoadLength === maxLen) {
      // Current holder retains Longest Road on a tie
      return;
    }

    if (tiedLeaders.length === 1) {
      const newHolder = tiedLeaders[0];
      if (newHolder.id !== currentHolder) {
        s.longestRoadHolderId = newHolder.id;
        this.addLog(`🛤️ ${newHolder.emoji} ${newHolder.name} claims Longest Road (${maxLen} roads, +2 VP)!`);
      }
    } else if (currentHolder !== null && s.players[currentHolder].longestRoadLength < maxLen) {
      // Old holder was broken and two others are tied for the lead -> nobody holds it until tie breaks
      s.longestRoadHolderId = null;
      this.addLog(`🛤️ Longest Road is currently tied at ${maxLen} — badge is unclaimed!`);
    }
  }

  /**
   * Updates Largest Army after a Knight is played.
   */
  updateLargestArmy(playerId) {
    const s = this.state;
    const p = s.players[playerId];
    if (p.knightsPlayed < 3) return;

    const currentHolder = s.largestArmyHolderId;
    const currentMax =
      currentHolder !== null ? s.players[currentHolder].knightsPlayed : 2;

    if (p.knightsPlayed > currentMax) {
      s.largestArmyHolderId = playerId;
      this.addLog(`🛡️ ${p.emoji} ${p.name} claims Largest Army (${p.knightsPlayed} Knights, +2 VP)!`);
    }
  }

  // =========================================================================
  // BOARD INTERACTION: VERTEX, EDGE, HEX CLICKS
  // =========================================================================

  handleVertexClick(vertexId) {
    const s = this.state;
    const player = this.getPlayer();

    if (s.phase === 'SETUP_SETTLEMENT') {
      const validIds = getValidSettlementVertices(s.board, player.id, true);
      if (!validIds.includes(vertexId)) return false;

      this.pushUndoSnapshot(`${player.name} setup settlement`);
      const vertex = s.board.vertices[vertexId];
      vertex.building = { owner: player.id, type: 'settlement' };
      player.settlementsLeft -= 1;
      s.lastPlacedSettlementVertexId = vertexId;

      const isSecondRound = s.setupStep >= s.players.length;
      if (isSecondRound) {
        // Grant starting resources for each adjacent non-desert hex
        const gained = [];
        for (const hId of vertex.hexIds) {
          const hex = s.board.hexes[hId];
          if (hex.terrain !== 'desert' && RESOURCES[hex.terrain]) {
            player.resources[hex.terrain] += 1;
            gained.push(RESOURCES[hex.terrain].emoji);
          }
        }
        if (gained.length > 0) {
          this.addLog(`${player.emoji} ${player.name} placed 2nd 🏠 and received ${gained.join(' ')}`);
        } else {
          this.addLog(`${player.emoji} ${player.name} placed 2nd 🏠`);
        }
      } else {
        this.addLog(`${player.emoji} ${player.name} placed 1st 🏠`);
      }

      s.phase = 'SETUP_ROAD';
      this.setBanner(`${player.emoji} ${player.name}: Place an attached Road 🛣️`);
      this.notify();
      return true;
    }

    if (s.phase === 'MAIN_TURN' && s.buildMode === 'settlement') {
      const validIds = getValidSettlementVertices(s.board, player.id, false);
      if (!validIds.includes(vertexId)) return false;
      if (!this.canAfford(player.id, BUILD_COSTS.settlement) || player.settlementsLeft <= 0) {
        return false;
      }

      this.pushUndoSnapshot(`${player.name} built Settlement`);
      this.payCost(player.id, BUILD_COSTS.settlement);
      s.board.vertices[vertexId].building = { owner: player.id, type: 'settlement' };
      player.settlementsLeft -= 1;
      s.buildMode = null;

      this.addLog(`${player.emoji} ${player.name} built a Settlement 🏠`);
      this.updateLongestRoad();
      if (!this.checkWinner()) {
        this.setBanner(`${player.emoji} ${player.name} built a Settlement 🏠`);
      }
      this.notify();
      return true;
    }

    if (s.phase === 'MAIN_TURN' && s.buildMode === 'city') {
      const validIds = getValidCityVertices(s.board, player.id);
      if (!validIds.includes(vertexId)) return false;
      if (!this.canAfford(player.id, BUILD_COSTS.city) || player.citiesLeft <= 0) {
        return false;
      }

      this.pushUndoSnapshot(`${player.name} upgraded to City`);
      this.payCost(player.id, BUILD_COSTS.city);
      s.board.vertices[vertexId].building = { owner: player.id, type: 'city' };
      player.settlementsLeft += 1; // Returns settlement piece to supply
      player.citiesLeft -= 1;
      s.buildMode = null;

      this.addLog(`${player.emoji} ${player.name} upgraded to a City 🏛️`);
      if (!this.checkWinner()) {
        this.setBanner(`${player.emoji} ${player.name} upgraded to a City 🏛️`);
      }
      this.notify();
      return true;
    }

    return false;
  }

  handleEdgeClick(edgeId) {
    const s = this.state;
    const player = this.getPlayer();

    if (s.phase === 'SETUP_ROAD') {
      const validEdges = getValidRoadEdges(
        s.board,
        player.id,
        s.lastPlacedSettlementVertexId
      );
      if (!validEdges.includes(edgeId)) return false;

      this.pushUndoSnapshot(`${player.name} setup road`);
      s.board.edges[edgeId].road = { owner: player.id };
      player.roadsLeft -= 1;
      this.updateLongestRoad();

      s.setupStep += 1;
      if (s.setupStep < s.setupOrder.length) {
        s.currentPlayerId = s.setupOrder[s.setupStep];
        s.phase = 'SETUP_SETTLEMENT';
        const nextP = this.getPlayer();
        const roundNum = s.setupStep >= s.players.length ? '2nd' : '1st';
        this.setBanner(`${nextP.emoji} ${nextP.name}: Place your ${roundNum} Settlement 🏠`);
      } else {
        // Setup complete! Start Turn 1 with Player 0
        s.currentPlayerId = 0;
        s.phase = 'PRE_ROLL';
        s.lastPlacedSettlementVertexId = null;
        const p0 = s.players[0];
        this.addLog(`🎲 Setup complete! ${p0.emoji} ${p0.name}'s turn to roll.`);
        this.setBanner(`${p0.emoji} ${p0.name}'s Turn — Roll Dice 🎲`);
      }

      this.notify();
      return true;
    }

    if (s.phase === 'ROAD_BUILDING_DEV') {
      const validEdges = getValidRoadEdges(s.board, player.id, null);
      if (!validEdges.includes(edgeId)) return false;

      this.pushUndoSnapshot(`${player.name} free road`);
      s.board.edges[edgeId].road = { owner: player.id };
      player.roadsLeft -= 1;
      s.freeRoadsRemaining -= 1;
      this.updateLongestRoad();

      this.addLog(`${player.emoji} ${player.name} placed a free Road 🛣️`);

      if (this.checkWinner()) {
        this.notify();
        return true;
      }

      const nextValid = getValidRoadEdges(s.board, player.id, null);
      if (s.freeRoadsRemaining <= 0 || player.roadsLeft <= 0 || nextValid.length === 0) {
        s.freeRoadsRemaining = 0;
        s.phase = s.phaseBeforeRobber || 'MAIN_TURN';
        this.setBanner(`${player.emoji} ${player.name} — Trade or Build`);
      } else {
        this.setBanner(`${player.emoji} ${player.name}: Place 1 more free Road 🛣️`);
      }

      this.notify();
      return true;
    }

    if (s.phase === 'MAIN_TURN' && s.buildMode === 'road') {
      const validEdges = getValidRoadEdges(s.board, player.id, null);
      if (!validEdges.includes(edgeId)) return false;
      if (!this.canAfford(player.id, BUILD_COSTS.road) || player.roadsLeft <= 0) {
        return false;
      }

      this.pushUndoSnapshot(`${player.name} built Road`);
      this.payCost(player.id, BUILD_COSTS.road);
      s.board.edges[edgeId].road = { owner: player.id };
      player.roadsLeft -= 1;
      s.buildMode = null;

      this.addLog(`${player.emoji} ${player.name} built a Road 🛣️`);
      this.updateLongestRoad();
      if (!this.checkWinner()) {
        this.setBanner(`${player.emoji} ${player.name} built a Road 🛣️`);
      }
      this.notify();
      return true;
    }

    return false;
  }

  handleHexClick(hexId) {
    const s = this.state;
    if (s.phase !== 'MOVE_ROBBER') return false;

    const targetHex = s.board.hexes[hexId];
    if (!targetHex || targetHex.hasRobber) return false;

    this.pushUndoSnapshot('Move Robber');
    for (const h of s.board.hexes) {
      h.hasRobber = h.id === hexId;
    }

    const activePlayer = this.getPlayer();
    const terrainLabel =
      targetHex.terrain === 'desert'
        ? '🏜️ Desert'
        : `${RESOURCES[targetHex.terrain].emoji} ${RESOURCES[targetHex.terrain].name} (${targetHex.number})`;
    this.addLog(`🏴‍☠️ ${activePlayer.emoji} ${activePlayer.name} moved the Robber to ${terrainLabel}.`);

    // Find opponent players with a building on this hex who have >= 1 resource card
    const candidateSet = new Set();
    for (const vId of targetHex.vertexIds) {
      const b = s.board.vertices[vId].building;
      if (b && b.owner !== activePlayer.id) {
        const opp = s.players[b.owner];
        if (this.getTotalResources(opp) > 0) {
          candidateSet.add(opp.id);
        }
      }
    }

    const candidates = Array.from(candidateSet);
    if (candidates.length === 0) {
      s.phase = s.phaseBeforeRobber || 'MAIN_TURN';
      this.setBanner(
        s.phase === 'PRE_ROLL'
          ? `${activePlayer.emoji} ${activePlayer.name} — Roll Dice 🎲`
          : `${activePlayer.emoji} ${activePlayer.name} — Trade or Build`
      );
    } else if (candidates.length === 1) {
      this.stealRandomResourceFrom(candidates[0]);
      s.phase = s.phaseBeforeRobber || 'MAIN_TURN';
    } else {
      s.stealCandidates = candidates;
      s.phase = 'STEAL_ROBBER';
      this.setBanner(`🏴‍☠️ ${activePlayer.emoji} ${activePlayer.name}: Choose a player on that hex to steal 1 card from`);
    }

    this.notify();
    return true;
  }

  chooseStealTarget(victimId) {
    const s = this.state;
    if (s.phase !== 'STEAL_ROBBER' || !s.stealCandidates.includes(victimId)) return false;

    this.pushUndoSnapshot('Steal card');
    this.stealRandomResourceFrom(victimId);
    s.stealCandidates = [];
    s.phase = s.phaseBeforeRobber || 'MAIN_TURN';
    this.notify();
    return true;
  }

  stealRandomResourceFrom(victimId) {
    const s = this.state;
    const thief = this.getPlayer();
    const victim = s.players[victimId];

    const pool = [];
    for (const k of RESOURCE_KEYS) {
      for (let i = 0; i < victim.resources[k]; i++) {
        pool.push(k);
      }
    }
    if (pool.length === 0) return;

    const stolenKey = pool[Math.floor(Math.random() * pool.length)];
    victim.resources[stolenKey] -= 1;
    thief.resources[stolenKey] += 1;

    this.addLog(
      `🏴‍☠️ ${thief.emoji} ${thief.name} stole 1 random resource from ${victim.emoji} ${victim.name}.`
    );
    this.setBanner(
      `🏴‍☠️ ${thief.emoji} ${thief.name} stole 1 card from ${victim.emoji} ${victim.name}!`
    );
  }

  // =========================================================================
  // DICE ROLL & 7-DISCARD ON PLAYER EDGES
  // =========================================================================

  rollDice() {
    const s = this.state;
    if (s.phase !== 'PRE_ROLL') return false;

    this.pushUndoSnapshot('Roll Dice');
    let d1, d2, sum;

    if (s.settings.diceMode === 'deck') {
      if (!s.diceShoe || s.diceShoe.length <= 5) {
        s.diceShoe = this.createDiceShoe();
      }
      const card = s.diceShoe.pop();
      d1 = card.d1;
      d2 = card.d2;
      sum = card.sum;
    } else {
      d1 = Math.floor(Math.random() * 6) + 1;
      d2 = Math.floor(Math.random() * 6) + 1;
      sum = d1 + d2;
    }

    s.lastRoll = { d1, d2, sum };
    s.diceStats[sum] = (s.diceStats[sum] || 0) + 1;

    const activePlayer = this.getPlayer();

    if (sum === 7) {
      this.addLog(`🎲 ${activePlayer.emoji} ${activePlayer.name} rolled a 7! (${d1} + ${d2})`);

      // Check who has > 7 cards
      const discardState = {};
      let anyoneMustDiscard = false;
      for (const p of s.players) {
        const total = this.getTotalResources(p);
        if (total > 7) {
          anyoneMustDiscard = true;
          discardState[p.id] = {
            required: Math.floor(total / 2),
            selected: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
            done: false
          };
        }
      }

      s.phaseBeforeRobber = 'MAIN_TURN';
      if (anyoneMustDiscard) {
        s.discardState = discardState;
        s.phase = 'DISCARD_7';
        this.setBanner(`🎲 Rolled 7! Players with >7 cards: discard half on your edge card.`);
      } else {
        s.phase = 'MOVE_ROBBER';
        this.setBanner(`🎲 Rolled 7! ${activePlayer.emoji} ${activePlayer.name}: Tap a hex to move the Robber 🏴‍☠️`);
      }
    } else {
      // Distribute resources for matching hexes without Robber
      const gainsByPlayer = {};
      for (const h of s.board.hexes) {
        if (h.number === sum && !h.hasRobber && RESOURCES[h.terrain]) {
          const resKey = h.terrain;
          for (const vId of h.vertexIds) {
            const b = s.board.vertices[vId].building;
            if (b) {
              const amount = b.type === 'city' ? 2 : 1;
              s.players[b.owner].resources[resKey] += amount;
              if (!gainsByPlayer[b.owner]) {
                gainsByPlayer[b.owner] = {};
              }
              gainsByPlayer[b.owner][resKey] = (gainsByPlayer[b.owner][resKey] || 0) + amount;
            }
          }
        }
      }

      const summaryParts = [];
      for (const p of s.players) {
        const g = gainsByPlayer[p.id];
        if (g) {
          const items = RESOURCE_KEYS.filter(k => g[k] > 0)
            .map(k => `+${g[k]}${RESOURCES[k].emoji}`)
            .join(' ');
          summaryParts.push(`${p.emoji} ${items}`);
        }
      }

      const rollStr = `🎲 Rolled ${sum} (${d1}+${d2})`;
      if (summaryParts.length > 0) {
        const summary = `${rollStr}: ${summaryParts.join(' · ')}`;
        this.addLog(summary);
        this.setBanner(summary);
      } else {
        this.addLog(`${rollStr}: No resources produced.`);
        this.setBanner(`${rollStr} — No resources produced`);
      }

      s.phase = 'MAIN_TURN';
    }

    this.notify();
    return true;
  }

  /**
   * Adjusts a player's discard selection right on their Edge Station when a 7 is rolled.
   */
  adjustEdgeDiscard(playerId, resKey, delta) {
    const s = this.state;
    if (s.phase !== 'DISCARD_7') return;
    const d = s.discardState[playerId];
    if (!d || d.done) return;

    const player = s.players[playerId];
    const currentSelectedTotal = RESOURCE_KEYS.reduce((a, k) => a + d.selected[k], 0);
    const nextVal = d.selected[resKey] + delta;

    if (nextVal < 0 || nextVal > player.resources[resKey]) return;
    if (delta > 0 && currentSelectedTotal >= d.required) return;

    d.selected[resKey] = nextVal;
    this.notify();
  }

  confirmEdgeDiscard(playerId) {
    const s = this.state;
    if (s.phase !== 'DISCARD_7') return false;
    const d = s.discardState[playerId];
    if (!d || d.done) return false;

    const totalSelected = RESOURCE_KEYS.reduce((a, k) => a + d.selected[k], 0);
    if (totalSelected !== d.required) return false;

    const player = s.players[playerId];
    for (const k of RESOURCE_KEYS) {
      player.resources[k] -= d.selected[k];
    }
    d.done = true;
    this.addLog(`🗑️ ${player.emoji} ${player.name} discarded ${d.required} cards.`);

    const allDone = Object.values(s.discardState).every(item => item.done);
    if (allDone) {
      s.discardState = {};
      s.phase = 'MOVE_ROBBER';
      const activeP = this.getPlayer();
      this.setBanner(`🏴‍☠️ ${activeP.emoji} ${activeP.name}: Tap any hex to move the Robber`);
    }

    this.notify();
    return true;
  }

  // =========================================================================
  // BUILDING & DEVELOPMENT CARDS
  // =========================================================================

  setBuildMode(mode) {
    const s = this.state;
    if (s.phase !== 'MAIN_TURN') return;
    s.buildMode = s.buildMode === mode ? null : mode;
    if (s.buildMode) {
      s.activeTrade.isOpen = false;
    }
    this.notify();
  }

  buyDevCard() {
    const s = this.state;
    if (s.phase !== 'MAIN_TURN') return false;
    const player = this.getPlayer();

    if (s.devDeck.length === 0) {
      this.setBanner(`⚠️ Development Card deck is empty!`);
      this.notify();
      return false;
    }
    if (!this.canAfford(player.id, BUILD_COSTS.devCard)) {
      return false;
    }

    this.pushUndoSnapshot(`${player.name} bought Dev Card`);
    this.payCost(player.id, BUILD_COSTS.devCard);
    const drawnType = s.devDeck.pop();
    player.devCards.push({
      id: `${ s.turnNumber }-${ Math.random().toString(36).slice(2, 7) }`,
      type: drawnType,
      boughtTurn: s.turnNumber
    });

    s.buildMode = null;
    this.addLog(`📜 ${player.emoji} ${player.name} bought a Development Card (${s.devDeck.length} left).`);
    if (!this.checkWinner()) {
      this.setBanner(
        `📜 ${player.emoji} ${player.name} bought a Dev Card (Hold 👁️ Peek on your card to view)`
      );
    }
    this.notify();
    return true;
  }

  canPlayDevCard(playerId, cardObj) {
    const s = this.state;
    if (playerId !== s.currentPlayerId) return false;
    if (s.phase !== 'PRE_ROLL' && s.phase !== 'MAIN_TURN') return false;
    if (s.devCardPlayedThisTurn) return false;
    if (cardObj.type === 'vp') return false; // VP cards are passive and auto-counted for winning
    if (cardObj.boughtTurn === s.turnNumber) return false; // Cannot play on the same turn bought
    return true;
  }

  playKnightCard(cardId) {
    const s = this.state;
    const player = this.getPlayer();
    const idx = player.devCards.findIndex(c => c.id === cardId && c.type === 'knight');
    if (idx === -1 || !this.canPlayDevCard(player.id, player.devCards[idx])) return false;

    this.pushUndoSnapshot(`${player.name} played Knight`);
    player.devCards.splice(idx, 1);
    player.knightsPlayed += 1;
    s.devCardPlayedThisTurn = true;
    s.buildMode = null;
    s.activeTrade.isOpen = false;

    this.addLog(`⚔️ ${player.emoji} ${player.name} played a Knight (${player.knightsPlayed} total)!`);
    this.updateLargestArmy(player.id);

    if (this.checkWinner()) {
      this.notify();
      return true;
    }

    s.phaseBeforeRobber = s.phase;
    s.phase = 'MOVE_ROBBER';
    this.setBanner(`⚔️ ${player.emoji} ${player.name}: Tap a hex to move the Robber 🏴‍☠️`);
    this.notify();
    return true;
  }

  playRoadBuildingCard(cardId) {
    const s = this.state;
    const player = this.getPlayer();
    const idx = player.devCards.findIndex(c => c.id === cardId && c.type === 'roadBuilding');
    if (idx === -1 || !this.canPlayDevCard(player.id, player.devCards[idx])) return false;

    const validEdges = getValidRoadEdges(s.board, player.id, null);
    if (validEdges.length === 0 || player.roadsLeft <= 0) {
      this.setBanner(`⚠️ No valid places or road pieces left to build roads!`);
      this.notify();
      return false;
    }

    this.pushUndoSnapshot(`${player.name} played Road Building`);
    player.devCards.splice(idx, 1);
    s.devCardPlayedThisTurn = true;
    s.buildMode = null;
    s.activeTrade.isOpen = false;
    s.phaseBeforeRobber = s.phase;
    s.freeRoadsRemaining = Math.min(2, player.roadsLeft);
    s.phase = 'ROAD_BUILDING_DEV';

    this.addLog(`🛣️ ${player.emoji} ${player.name} played Road Building (2 free roads)!`);
    this.setBanner(`🛣️ ${player.emoji} ${player.name}: Tap an edge to place free Road 1 of ${s.freeRoadsRemaining}`);
    this.notify();
    return true;
  }

  playYearOfPlentyCard(cardId, resKey1, resKey2) {
    const s = this.state;
    const player = this.getPlayer();
    const idx = player.devCards.findIndex(c => c.id === cardId && c.type === 'yearOfPlenty');
    if (idx === -1 || !this.canPlayDevCard(player.id, player.devCards[idx])) return false;
    if (!RESOURCES[resKey1] || !RESOURCES[resKey2]) return false;

    this.pushUndoSnapshot(`${player.name} played Year of Plenty`);
    player.devCards.splice(idx, 1);
    s.devCardPlayedThisTurn = true;
    player.resources[resKey1] += 1;
    player.resources[resKey2] += 1;

    this.addLog(
      `🎁 ${player.emoji} ${player.name} played Year of Plenty and took ${RESOURCES[resKey1].emoji} + ${RESOURCES[resKey2].emoji}.`
    );
    this.setBanner(
      `🎁 ${player.emoji} ${player.name} took ${RESOURCES[resKey1].emoji} and ${RESOURCES[resKey2].emoji} from the Bank!`
    );
    this.notify();
    return true;
  }

  playMonopolyCard(cardId, targetResKey) {
    const s = this.state;
    const player = this.getPlayer();
    const idx = player.devCards.findIndex(c => c.id === cardId && c.type === 'monopoly');
    if (idx === -1 || !this.canPlayDevCard(player.id, player.devCards[idx])) return false;
    if (!RESOURCES[targetResKey]) return false;

    this.pushUndoSnapshot(`${player.name} played Monopoly`);
    player.devCards.splice(idx, 1);
    s.devCardPlayedThisTurn = true;

    let totalClaimed = 0;
    for (const p of s.players) {
      if (p.id === player.id) continue;
      const count = p.resources[targetResKey] || 0;
      if (count > 0) {
        p.resources[targetResKey] = 0;
        player.resources[targetResKey] += count;
        totalClaimed += count;
      }
    }

    const resEmoji = RESOURCES[targetResKey].emoji;
    const resName = RESOURCES[targetResKey].name;
    this.addLog(
      `👑 ${player.emoji} ${player.name} played Monopoly on ${resEmoji} ${resName} and claimed ${totalClaimed} cards!`
    );
    this.setBanner(
      `👑 Monopoly! ${player.emoji} ${player.name} claimed ${totalClaimed} ${resEmoji} ${resName} from all players!`
    );
    this.notify();
    return true;
  }

  // =========================================================================
  // FRICTIONLESS TABLETOP TRADING (MARITIME + EDGE-CONFIRMATION)
  // =========================================================================

  toggleTradePanel(forceState) {
    const s = this.state;
    if (s.phase !== 'MAIN_TURN') return;
    const nextOpen = forceState !== undefined ? forceState : !s.activeTrade.isOpen;
    s.activeTrade = {
      isOpen: nextOpen,
      give: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      want: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      targetPlayerId: 'all',
      passedPlayerIds: [],
      edgeErrorByPlayer: {}
    };
    if (nextOpen) {
      s.buildMode = null;
    }
    this.notify();
  }

  adjustTradeAmount(side, resKey, delta) {
    const s = this.state;
    if (!s.activeTrade.isOpen) return;
    const player = this.getPlayer();
    const bucket = side === 'give' ? s.activeTrade.give : s.activeTrade.want;
    const nextVal = (bucket[resKey] || 0) + delta;

    if (nextVal < 0) return;
    if (side === 'give' && nextVal > player.resources[resKey]) return;
    if (side === 'want' && nextVal > 19) return;

    bucket[resKey] = nextVal;
    // Reset passed status & edge errors when trade terms change
    s.activeTrade.passedPlayerIds = [];
    s.activeTrade.edgeErrorByPlayer = {};
    this.notify();
  }

  setTradeTarget(targetId) {
    const s = this.state;
    if (!s.activeTrade.isOpen) return;
    s.activeTrade.targetPlayerId = targetId;
    s.activeTrade.passedPlayerIds = [];
    s.activeTrade.edgeErrorByPlayer = {};
    this.notify();
  }

  clearTradeSelection() {
    const s = this.state;
    s.activeTrade.give = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    s.activeTrade.want = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    s.activeTrade.passedPlayerIds = [];
    s.activeTrade.edgeErrorByPlayer = {};
    this.notify();
  }

  /**
   * Evaluates whether the current activeTrade selection is a valid Bank / Harbor trade.
   */
  evaluateBankTrade() {
    const s = this.state;
    const player = this.getPlayer();
    const { give, want } = s.activeTrade;
    const { rates } = this.getPlayerHarborRates(player.id);

    const totalWant = RESOURCE_KEYS.reduce((a, k) => a + want[k], 0);
    const totalGive = RESOURCE_KEYS.reduce((a, k) => a + give[k], 0);
    if (totalWant === 0 || totalGive === 0) {
      return { valid: false, reason: 'Select resources to give and receive' };
    }

    // Cannot give and want the exact same resource
    for (const k of RESOURCE_KEYS) {
      if (give[k] > 0 && want[k] > 0) {
        return { valid: false, reason: 'Cannot trade same resource with Bank' };
      }
    }

    // Compute how many "output units" the offered resources buy at the player's port rates
    let boughtUnits = 0;
    const usedRates = [];
    for (const k of RESOURCE_KEYS) {
      const g = give[k];
      if (g === 0) continue;
      const r = rates[k];
      if (g % r !== 0) {
        return {
          valid: false,
          reason: `Need multiples of ${r} ${RESOURCES[k].emoji} (${r}:1 rate)`
        };
      }
      boughtUnits += g / r;
      usedRates.push(`${r}:1 ${RESOURCES[k].emoji}`);
    }

    if (boughtUnits !== totalWant) {
      return {
        valid: false,
        reason: `Offered cards buy ${boughtUnits} resource${boughtUnits === 1 ? '' : 's'}, but ${totalWant} selected`
      };
    }

    return {
      valid: true,
      label: `🏦 Bank Trade (${usedRates.join(', ')})`
    };
  }

  executeBankTrade() {
    const s = this.state;
    const check = this.evaluateBankTrade();
    if (!check.valid) return false;

    const player = this.getPlayer();
    const { give, want } = s.activeTrade;

    this.pushUndoSnapshot(`${player.name} Maritime Trade`);
    const giveParts = [];
    const wantParts = [];

    for (const k of RESOURCE_KEYS) {
      if (give[k] > 0) {
        player.resources[k] -= give[k];
        giveParts.push(`${give[k]}${RESOURCES[k].emoji}`);
      }
      if (want[k] > 0) {
        player.resources[k] += want[k];
        wantParts.push(`${want[k]}${RESOURCES[k].emoji}`);
      }
    }

    this.addLog(
      `🏦 ${player.emoji} ${player.name} traded ${giveParts.join(' ')} → ${wantParts.join(' ')} with the Bank.`
    );
    this.setBanner(
      `🏦 ${player.emoji} ${player.name} traded ${giveParts.join(' ')} for ${wantParts.join(' ')}`
    );
    s.activeTrade.isOpen = false;
    this.notify();
    return true;
  }

  /**
   * Checks if there is an active player-to-player offer ready for edge confirmation.
   */
  isPlayerTradeOfferReady() {
    const s = this.state;
    if (!s.activeTrade.isOpen || s.phase !== 'MAIN_TURN') return false;
    const { give, want } = s.activeTrade;
    const totalGive = RESOURCE_KEYS.reduce((a, k) => a + give[k], 0);
    const totalWant = RESOURCE_KEYS.reduce((a, k) => a + want[k], 0);
    return totalGive > 0 && totalWant > 0;
  }

  /**
   * Called when an opponent taps "✅ Accept" on their Edge HUD card!
   */
  acceptTradeOnEdge(partnerId) {
    const s = this.state;
    if (!this.isPlayerTradeOfferReady()) return false;
    if (partnerId === s.currentPlayerId) return false;
    if (
      s.activeTrade.targetPlayerId !== 'all' &&
      s.activeTrade.targetPlayerId !== partnerId
    ) {
      return false;
    }

    const activePlayer = this.getPlayer();
    const partner = s.players[partnerId];
    const { give, want } = s.activeTrade;

    // Verify activePlayer has `give` and partner has `want`
    if (!this.canAfford(activePlayer.id, give)) {
      return false;
    }
    if (!this.canAfford(partner.id, want)) {
      s.activeTrade.edgeErrorByPlayer[partnerId] = 'Not enough resources!';
      this.notify();
      return false;
    }

    this.pushUndoSnapshot(`Trade: ${activePlayer.name} & ${partner.name}`);

    const giveParts = [];
    const wantParts = [];
    for (const k of RESOURCE_KEYS) {
      if (give[k] > 0) {
        activePlayer.resources[k] -= give[k];
        partner.resources[k] += give[k];
        giveParts.push(`${give[k]}${RESOURCES[k].emoji}`);
      }
      if (want[k] > 0) {
        partner.resources[k] -= want[k];
        activePlayer.resources[k] += want[k];
        wantParts.push(`${want[k]}${RESOURCES[k].emoji}`);
      }
    }

    const summary = `🤝 ${activePlayer.emoji} ${activePlayer.name} traded ${giveParts.join(' ')} with ${partner.emoji} ${partner.name} for ${wantParts.join(' ')}!`;
    this.addLog(summary);
    this.setBanner(summary);

    s.activeTrade.isOpen = false;
    this.notify();
    return true;
  }

  passTradeOnEdge(partnerId) {
    const s = this.state;
    if (!this.isPlayerTradeOfferReady()) return;
    if (!s.activeTrade.passedPlayerIds.includes(partnerId)) {
      s.activeTrade.passedPlayerIds.push(partnerId);
      this.notify();
    }
  }

  // =========================================================================
  // END TURN
  // =========================================================================

  endTurn() {
    const s = this.state;
    if (s.phase !== 'MAIN_TURN') return false;

    this.pushUndoSnapshot(`End ${this.getPlayer().name}'s turn`);
    s.buildMode = null;
    s.activeTrade.isOpen = false;
    s.devCardPlayedThisTurn = false;
    s.currentPlayerId = (s.currentPlayerId + 1) % s.players.length;
    s.turnNumber += 1;
    s.phase = 'PRE_ROLL';

    const nextP = this.getPlayer();
    this.addLog(`➡️ Turn ${s.turnNumber}: ${nextP.emoji} ${nextP.name}'s turn.`);
    this.setBanner(`${nextP.emoji} ${nextP.name}'s Turn — Roll Dice 🎲`);
    this.notify();
    return true;
  }
}
