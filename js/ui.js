import {
  RESOURCES,
  RESOURCE_KEYS,
   DESERT_TERRAIN,
  NUMBER_PIPS,
  BUILD_COSTS,
  DEV_CARD_INFO,
  PLAYER_PRESETS
} from './constants.js';
import {
  HEX_SIZE,
  getValidSettlementVertices,
  getValidCityVertices,
  getValidRoadEdges
} from './board.js';

export class CatanUI {
  constructor(game) {
    this.game = game;
    this.peekingPlayers = new Set();
    // Active dev card sub-modal state (for Year of Plenty or Monopoly resource selection)
    this.devCardModalOpen = false;
    this.pendingDevCardAction = null; // { cardId, type: 'yearOfPlenty' | 'monopoly', picked: [] }
    this.statsModalOpen = false;
    this.setupModalOpen = false;

    this.boardSvg = document.getElementById('catan-board-svg');
    this.bannerEl = document.getElementById('turn-banner');
    this.diceDisplayEl = document.getElementById('dice-display');
    this.actionBarEl = document.getElementById('action-bar');
    this.tradeComposerEl = document.getElementById('trade-composer');
    this.stationsContainerEl = document.getElementById('player-stations');
    this.modalOverlayEl = document.getElementById('modal-overlay');
    this.modalContentEl = document.getElementById('modal-content');

    this.bindGlobalEvents();
    this.game.subscribe(() => this.render());
  }

  bindGlobalEvents() {
    const endAllPeeks = () => {
      if (this.peekingPlayers.size > 0) {
        this.peekingPlayers.clear();
        this.syncPeekClasses();
      }
    };

    window.addEventListener('pointerup', endAllPeeks);
    window.addEventListener('pointercancel', endAllPeeks);
    window.addEventListener('touchend', endAllPeeks);
    window.addEventListener('touchcancel', endAllPeeks);

    // Top utility buttons
    document.getElementById('btn-undo').addEventListener('click', () => {
      this.game.undo();
    });

    document.getElementById('btn-rotate-seats').addEventListener('click', () => {
      this.game.toggleRotateEdgeCards();
    });

    document.getElementById('btn-stats-log').addEventListener('click', () => {
      this.statsModalOpen = true;
      this.devCardModalOpen = false;
      this.setupModalOpen = false;
      this.renderModal();
    });

    document.getElementById('btn-new-game').addEventListener('click', () => {
      this.setupModalOpen = true;
      this.statsModalOpen = false;
      this.devCardModalOpen = false;
      this.renderModal();
    });

    this.modalOverlayEl.addEventListener('click', e => {
      if (e.target === this.modalOverlayEl) {
        this.closeModals();
      }
    });
  }

  syncPeekClasses() {
    if (!this.stationsContainerEl) return;
    this.stationsContainerEl.querySelectorAll('.player-station').forEach(station => {
      const pid = Number(station.dataset.stationPlayer);
      const isPeeking = this.peekingPlayers.has(pid);
      station.classList.toggle('is-peeking', isPeeking);
      const btn = station.querySelector('[data-peek-player]');
      if (btn) {
        btn.classList.toggle('peeking-now', isPeeking);
        btn.textContent = isPeeking ? '🙈 Release to Hide' : '👁️ Hold to Peek Hand';
      }
    });
  }

  closeModals() {
    this.devCardModalOpen = false;
    this.pendingDevCardAction = null;
    this.statsModalOpen = false;
    this.setupModalOpen = false;
    this.renderModal();
  }

  render() {
    const s = this.game.state;
    if (!s) return;

    // Update top utility bar buttons
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) {
      undoBtn.disabled = !this.game.canUndo();
    }
    const rotateBtn = document.getElementById('btn-rotate-seats');
    if (rotateBtn) {
      rotateBtn.classList.toggle('active-toggle', !!s.settings.rotateEdgeCards);
      rotateBtn.textContent = s.settings.rotateEdgeCards ? '🔄 Tabletop Seats: ON' : '🔄 Tabletop Seats: OFF';
    }

    this.renderBannerAndDice();
    this.renderBoard();
    this.renderStations();
    this.renderTradeComposer();
    this.renderActionBar();
    this.renderModal();
  }

  renderBannerAndDice() {
    const s = this.game.state;
    const activePlayer = this.game.getPlayer();
    this.bannerEl.style.setProperty('--active-player-color', activePlayer.color);
    this.bannerEl.innerHTML = `
      <span class="banner-turn-pill" style="background:${activePlayer.color}">
        Turn ${s.turnNumber} · ${activePlayer.emoji} ${this.escapeHtml(activePlayer.name)}
      </span>
      <span class="banner-text">${this.escapeHtml(s.bannerMessage)}</span>
    `;

    if (s.lastRoll) {
      const dieFaces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      const isRed = s.lastRoll.sum === 6 || s.lastRoll.sum === 8;
      const isSeven = s.lastRoll.sum === 7;
      this.diceDisplayEl.innerHTML = `
        <div class="dice-badge ${isRed ? 'hot-roll' : ''} ${isSeven ? 'robber-roll' : ''}" title="Last Dice Roll">
          <span class="die-face">${dieFaces[s.lastRoll.d1]}</span>
          <span class="die-face">${dieFaces[s.lastRoll.d2]}</span>
          <strong class="dice-sum">${s.lastRoll.sum}</strong>
        </div>
      `;
    } else {
      this.diceDisplayEl.innerHTML = `<div class="dice-badge empty-roll">🎲 —</div>`;
    }
  }

  // =========================================================================
  // SVG HEX BOARD RENDERER
  // =========================================================================

  renderBoard() {
    const s = this.game.state;
    const board = s.board;
    const activePlayer = this.game.getPlayer();

    // Determine valid interactive elements for current phase / build mode
    let validVertices = new Set();
    let validEdges = new Set();
    let validHexes = new Set();

    if (s.phase === 'SETUP_SETTLEMENT') {
      validVertices = new Set(getValidSettlementVertices(board, activePlayer.id, true));
    } else if (s.phase === 'SETUP_ROAD') {
      validEdges = new Set(
        getValidRoadEdges(board, activePlayer.id, s.lastPlacedSettlementVertexId)
      );
    } else if (s.phase === 'ROAD_BUILDING_DEV') {
      validEdges = new Set(getValidRoadEdges(board, activePlayer.id, null));
    } else if (s.phase === 'MOVE_ROBBER') {
      for (const h of board.hexes) {
        if (!h.hasRobber) validHexes.add(h.id);
      }
    } else if (s.phase === 'MAIN_TURN') {
      if (s.buildMode === 'road') {
        validEdges = new Set(getValidRoadEdges(board, activePlayer.id, null));
      } else if (s.buildMode === 'settlement') {
        validVertices = new Set(getValidSettlementVertices(board, activePlayer.id, false));
      } else if (s.buildMode === 'city') {
        validVertices = new Set(getValidCityVertices(board, activePlayer.id));
      }
    }

    const parts = [];

    // 0. Ocean backdrop island silhouette
    parts.push(`
      <defs>
        <radialGradient id="oceanGrad" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.32" />
          <stop offset="75%" stop-color="#0284c7" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#0369a1" stop-opacity="0.0" />
        </radialGradient>
        <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.45" />
        </filter>
      </defs>
      <circle cx="0" cy="0" r="285" fill="url(#oceanGrad)" />
    `);

    // 1. Harbors (Docks & Port Badges around perimeter)
    for (const h of board.harbors) {
      const v1 = board.vertices[h.v1];
      const v2 = board.vertices[h.v2];
      const isSpecific = h.type !== 'any';
      const portBg = isSpecific ? RESOURCES[h.type].fillColor : '#1e293b';
      const portBorder = isSpecific ? '#fef08a' : '#94a3b8';

      parts.push(`
        <g class="harbor-group">
          <line x1="${v1.x}" y1="${v1.y}" x2="${h.x}" y2="${h.y}" stroke="#d97706" stroke-width="4" stroke-dasharray="4,3" stroke-linecap="round" />
          <line x1="${v2.x}" y1="${v2.y}" x2="${h.x}" y2="${h.y}" stroke="#d97706" stroke-width="4" stroke-dasharray="4,3" stroke-linecap="round" />
          <circle cx="${h.x}" cy="${h.y}" r="18" fill="${portBg}" stroke="${portBorder}" stroke-width="2" filter="url(#dropShadow)" />
          <text x="${h.x}" y="${h.y - 3}" text-anchor="middle" dominant-baseline="central" font-size="13">${h.emoji}</text>
          <text x="${h.x}" y="${h.y + 10}" text-anchor="middle" dominant-baseline="central" font-size="8.5" font-weight="800" fill="#ffffff">${h.label}</text>
        </g>
      `);
    }

    // 2. Hex Tiles
    for (const hex of board.hexes) {
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angleRad = ((60 * i - 30) * Math.PI) / 180;
        const px = (hex.x + (HEX_SIZE - 1.5) * Math.cos(angleRad)).toFixed(1);
        const py = (hex.y + (HEX_SIZE - 1.5) * Math.sin(angleRad)).toFixed(1);
        points.push(`${px},${py}`);
      }

      const info = hex.terrain === 'desert' ? DESERT_TERRAIN : RESOURCES[hex.terrain];
      const isClickableHex = validHexes.has(hex.id);
      const isLastRolledHex =
        s.lastRoll &&
        s.lastRoll.sum !== 7 &&
        hex.number === s.lastRoll.sum &&
        !hex.hasRobber;

      parts.push(`
        <g class="hex-group ${isClickableHex ? 'hex-selectable' : ''} ${isLastRolledHex ? 'hex-rolled-glow' : ''}" data-hex-id="${hex.id}">
          <polygon
            points="${points.join(' ')}"
            fill="${info.fillColor}"
            stroke="${isLastRolledHex ? '#fde047' : '#ebd5b3'}"
            stroke-width="${isLastRolledHex ? '4.5' : '3'}"
            stroke-linejoin="round"
          />
          <text x="${hex.x}" y="${hex.number ? hex.y - 22 : hex.y - 8}" text-anchor="middle" dominant-baseline="central" font-size="22" class="hex-emoji">${info.emoji}</text>
      `);

      // Number Token
      if (hex.number) {
        const isRed = hex.number === 6 || hex.number === 8;
        const pipsCount = NUMBER_PIPS[hex.number] || 0;
        const pipsStr = '•'.repeat(pipsCount);

        parts.push(`
          <circle cx="${hex.x}" cy="${hex.y + 8}" r="16.5" fill="#fffbeb" stroke="${isRed ? '#dc2626' : '#b45309'}" stroke-width="${isRed ? '2.2' : '1.5'}" filter="url(#dropShadow)" />
          <text x="${hex.x}" y="${hex.y + 5}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="900" fill="${isRed ? '#dc2626' : '#1e293b'}">${hex.number}</text>
          <text x="${hex.x}" y="${hex.y + 17}" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="900" letter-spacing="0.5" fill="${isRed ? '#dc2626' : '#64748b'}">${pipsStr}</text>
        `);
      }

      // Robber Token
      if (hex.hasRobber) {
        const rx = hex.number ? hex.x + 22 : hex.x;
        const ry = hex.number ? hex.y - 18 : hex.y + 14;
        parts.push(`
          <g class="robber-badge" filter="url(#dropShadow)">
            <circle cx="${rx}" cy="${ry}" r="14" fill="#111827" stroke="#f87171" stroke-width="2" />
            <text x="${rx}" y="${ry + 1}" text-anchor="middle" dominant-baseline="central" font-size="15">🏴‍☠️</text>
          </g>
        `);
      }

      // Interactive Robber Placement Overlay
      if (isClickableHex) {
        parts.push(`
          <circle cx="${hex.x}" cy="${hex.y + 8}" r="26" fill="rgba(239, 68, 68, 0.28)" stroke="#fca5a5" stroke-width="2.5" stroke-dasharray="5,3" class="pulse-target" />
        `);
      }

      parts.push(`</g>`);
    }

    // 3. Built Roads & Interactive Road Targets
    for (const edge of board.edges) {
      if (edge.road) {
        const owner = s.players[edge.road.owner];
        parts.push(`
          <g class="road-built">
            <line x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" stroke="#0f172a" stroke-width="11" stroke-linecap="round" />
            <line x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" stroke="${owner.color}" stroke-width="7.5" stroke-linecap="round" />
          </g>
        `);
      } else if (validEdges.has(edge.id)) {
        parts.push(`
          <g class="edge-selectable" data-edge-id="${edge.id}">
            <line x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" stroke="${activePlayer.color}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.65" class="pulse-line" />
            <circle cx="${edge.mx}" cy="${edge.my}" r="15" fill="rgba(255,255,255,0.22)" stroke="${activePlayer.color}" stroke-width="2.5" class="pulse-target" />
          </g>
        `);
      }
    }

    // 4. Built Settlements/Cities & Interactive Vertex Targets
    for (const v of board.vertices) {
      const isSelectable = validVertices.has(v.id);

      if (v.building) {
        const owner = s.players[v.building.owner];
        const isCity = v.building.type === 'city';
        const radius = isCity ? 16 : 13;
        const emoji = isCity ? '🏛️' : '🏠';
        const strokeColor = isSelectable ? '#fde047' : '#ffffff';
        const strokeWidth = isSelectable ? 3.5 : 2.2;

        parts.push(`
          <g class="vertex-built ${isSelectable ? 'vertex-selectable' : ''}" ${isSelectable ? `data-vertex-id="${v.id}"` : ''} filter="url(#dropShadow)">
            <circle cx="${v.x}" cy="${v.y}" r="${radius}" fill="${owner.color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
            <text x="${v.x}" y="${v.y + 1}" text-anchor="middle" dominant-baseline="central" font-size="${isCity ? '16' : '13'}">${emoji}</text>
            ${
              isSelectable
                ? `<circle cx="${v.x}" cy="${v.y}" r="20" fill="none" stroke="#fde047" stroke-width="2.5" stroke-dasharray="4,3" class="pulse-target" />`
                : ''
            }
          </g>
        `);
      } else if (isSelectable) {
        parts.push(`
          <g class="vertex-selectable" data-vertex-id="${v.id}">
            <circle cx="${v.x}" cy="${v.y}" r="15" fill="${activePlayer.color}" fill-opacity="0.35" stroke="#ffffff" stroke-width="2.5" class="pulse-target" />
            <circle cx="${v.x}" cy="${v.y}" r="5.5" fill="#ffffff" />
          </g>
        `);
      }
    }

    this.boardSvg.innerHTML = parts.join('');

    // Attach SVG click handlers
    this.boardSvg.querySelectorAll('[data-vertex-id]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        this.game.handleVertexClick(Number(el.dataset.vertexId));
      });
    });

    this.boardSvg.querySelectorAll('[data-edge-id]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        this.game.handleEdgeClick(Number(el.dataset.edgeId));
      });
    });

    this.boardSvg.querySelectorAll('[data-hex-id]').forEach(el => {
      el.addEventListener('click', e => {
        const hexId = Number(el.dataset.hexId);
        if (validHexes.has(hexId)) {
          e.stopPropagation();
          this.game.handleHexClick(hexId);
        }
      });
    });
  }

  // =========================================================================
  // 4-EDGE PLAYER STATIONS (HOLD-TO-PEEK + EDGE TRADE CONFIRM + EDGE DISCARD)
  // =========================================================================

  renderStations() {
    const s = this.game.state;
    const isTradeReady = this.game.isPlayerTradeOfferReady();
    const rotate = !!s.settings.rotateEdgeCards;

    this.stationsContainerEl.innerHTML = s.players
      .map(p => {
        const isCurrentTurn = p.id === s.currentPlayerId;
        const isPeeking = this.peekingPlayers.has(p.id);
        const publicVp = this.game.getVictoryPoints(p.id, false);
        const secretVp = this.game.getVictoryPoints(p.id, true);
        const totalRes = this.game.getTotalResources(p);
        const { ownedHarbors } = this.game.getPlayerHarborRates(p.id);
        const hasLongestRoad = s.longestRoadHolderId === p.id;
        const hasLargestArmy = s.largestArmyHolderId === p.id;

        // Check if this player needs to discard on a 7
        const discardInfo =
          s.phase === 'DISCARD_7' && s.discardState[p.id] && !s.discardState[p.id].done
            ? s.discardState[p.id]
            : null;

        // Check if this player has an incoming trade offer on their edge
        const showEdgeTrade =
          isTradeReady &&
          p.id !== s.currentPlayerId &&
          (s.activeTrade.targetPlayerId === 'all' ||
            s.activeTrade.targetPlayerId === p.id);
        const hasPassedTrade = s.activeTrade.passedPlayerIds.includes(p.id);
        const edgeError = s.activeTrade.edgeErrorByPlayer[p.id] || '';

        const seatClass = `seat-${p.seat} ${rotate ? 'seat-rotated' : ''} ${isPeeking ? 'is-peeking' : ''}`;

        return `
          <div class="player-station ${seatClass} ${isCurrentTurn ? 'active-station' : ''}" data-station-player="${p.id}" style="--player-color: ${p.color}; --player-dark: ${p.darkColor}">
            <div class="station-header">
              <div class="station-identity">
                <span class="station-dot">${p.emoji}</span>
                <span class="station-name">${this.escapeHtml(p.name)}</span>
                ${isCurrentTurn ? `<span class="turn-tag">TURN</span>` : ''}
              </div>
              <div class="station-vp" title="Victory Points">
                <span class="vp-public">⭐ ${publicVp} VP</span>
                <span class="vp-secret">⭐ ${secretVp} VP ${secretVp !== publicVp ? `(${publicVp}+${secretVp - publicVp}🔒)` : ''}</span>
              </div>
            </div>

            <div class="station-metrics">
              <span class="metric-pill" title="Resource Cards in Hand">🃏 ${totalRes}</span>
              <span class="metric-pill" title="Unplayed Development Cards">📜 ${p.devCards.length}</span>
              <span class="metric-pill" title="Played Knights">⚔️ ${p.knightsPlayed}</span>
              <span class="metric-pill" title="Longest Continuous Road">🛣️ ${p.longestRoadLength}</span>
              ${hasLongestRoad ? `<span class="badge-pill badge-road" title="Longest Road (+2 VP)">🛤️ +2</span>` : ''}
              ${hasLargestArmy ? `<span class="badge-pill badge-army" title="Largest Army (+2 VP)">🛡️ +2</span>` : ''}
              ${ownedHarbors
                .map(
                  h =>
                    `<span class="port-mini-pill" title="Harbor ${h.label}">${h.emoji}${h.label}</span>`
                )
                .join('')}
            </div>

            ${this.renderPeekDrawer(p, isCurrentTurn)}

            ${
              discardInfo
                ? this.renderEdgeDiscardBox(p, discardInfo)
                : ''
            }

            ${
              showEdgeTrade
                ? this.renderEdgeTradeBox(p, hasPassedTrade, edgeError)
                : ''
            }

            <div class="station-footer">
              <button
                type="button"
                class="btn-peek ${isPeeking ? 'peeking-now' : ''}"
                data-peek-player="${p.id}"
              >
                ${isPeeking ? '🙈 Release to Hide' : '👁️ Hold to Peek Hand'}
              </button>
              <span class="pieces-left" title="Remaining pieces: Roads / Settlements / Cities">
                🛣️${p.roadsLeft} 🏠${p.settlementsLeft} 🏛️${p.citiesLeft}
              </span>
            </div>
          </div>
        `;
      })
      .join('');

    // Bind Hold-to-Peek pointerdown & touchstart without destroying DOM
    this.stationsContainerEl.querySelectorAll('[data-peek-player]').forEach(btn => {
      const startPeek = e => {
        e.preventDefault();
        const pid = Number(btn.dataset.peekPlayer);
        this.peekingPlayers.add(pid);
        this.syncPeekClasses();
      };
      const endPeek = () => {
        const pid = Number(btn.dataset.peekPlayer);
        if (this.peekingPlayers.has(pid)) {
          this.peekingPlayers.delete(pid);
          this.syncPeekClasses();
        }
      };
      btn.addEventListener('pointerdown', startPeek);
      btn.addEventListener('pointerup', endPeek);
      btn.addEventListener('pointerleave', endPeek);
      btn.addEventListener('touchstart', startPeek, { passive: false });
      btn.addEventListener('touchend', endPeek);
    });

    // Bind Edge Trade Accept / Pass buttons
    this.stationsContainerEl.querySelectorAll('[data-edge-accept]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pid = Number(btn.dataset.edgeAccept);
        this.game.acceptTradeOnEdge(pid);
      });
    });

    this.stationsContainerEl.querySelectorAll('[data-edge-pass]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pid = Number(btn.dataset.edgePass);
        this.game.passTradeOnEdge(pid);
      });
    });

    // Bind Edge Discard controls
    this.stationsContainerEl.querySelectorAll('[data-discard-adj]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pid = Number(btn.dataset.playerId);
        const res = btn.dataset.res;
        const delta = Number(btn.dataset.discardAdj);
        this.game.adjustEdgeDiscard(pid, res, delta);
      });
    });

    this.stationsContainerEl.querySelectorAll('[data-discard-confirm]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pid = Number(btn.dataset.discardConfirm);
        this.game.confirmEdgeDiscard(pid);
      });
    });
  }

  renderPeekDrawer(player, isCurrentTurn) {
    const resItems = RESOURCE_KEYS.map(k => {
      const count = player.resources[k] || 0;
      return `
        <div class="peek-res-chip ${count === 0 ? 'zero' : ''}">
          <span>${RESOURCES[k].emoji}</span>
          <strong>${count}</strong>
        </div>
      `;
    }).join('');

    let devSection = '';
    if (player.devCards.length > 0) {
      const badges = player.devCards
        .map(c => {
          const info = DEV_CARD_INFO[c.type];
          const isNew = c.boughtTurn === this.game.state.turnNumber && c.type !== 'vp';
          return `<span class="peek-dev-chip">${info.emoji} ${info.name}${isNew ? ' (new)' : ''}</span>`;
        })
        .join('');
      devSection = `<div class="peek-dev-list">${badges}</div>`;
    } else {
      devSection = `<div class="peek-dev-empty">No Dev Cards</div>`;
    }

    return `
      <div class="peek-drawer">
        <div class="peek-res-row">${resItems}</div>
        ${devSection}
      </div>
    `;
  }

  renderEdgeTradeBox(partner, hasPassed, edgeError) {
    const s = this.game.state;
    const activePlayer = this.game.getPlayer();
    const { give, want } = s.activeTrade;

    const giveStr = RESOURCE_KEYS.filter(k => give[k] > 0)
      .map(k => `${give[k]}${RESOURCES[k].emoji}`)
      .join(' ');
    const wantStr = RESOURCE_KEYS.filter(k => want[k] > 0)
      .map(k => `${want[k]}${RESOURCES[k].emoji}`)
      .join(' ');

    if (hasPassed) {
      return `
        <div class="edge-trade-banner passed">
          <span>❌ Passed on ${activePlayer.emoji}'s offer (${giveStr} → ${wantStr})</span>
          <button type="button" class="btn-edge-accept small" data-edge-accept="${partner.id}">Accept anyway</button>
        </div>
      `;
    }

    return `
      <div class="edge-trade-banner">
        <div class="edge-trade-terms">
          <span>${activePlayer.emoji} gives <strong>${giveStr}</strong></span>
          <span>for your <strong>${wantStr}</strong></span>
        </div>
        ${edgeError ? `<div class="edge-trade-error">⚠️ ${this.escapeHtml(edgeError)}</div>` : ''}
        <div class="edge-trade-actions">
          <button type="button" class="btn-edge-accept" data-edge-accept="${partner.id}">
            ✅ Accept
          </button>
          <button type="button" class="btn-edge-pass" data-edge-pass="${partner.id}">
            ❌ Pass
          </button>
        </div>
      </div>
    `;
  }

  renderEdgeDiscardBox(player, discardInfo) {
    const selectedTotal = RESOURCE_KEYS.reduce(
      (a, k) => a + (discardInfo.selected[k] || 0),
      0
    );
    const remaining = discardInfo.required - selectedTotal;

    const controls = RESOURCE_KEYS.filter(k => player.resources[k] > 0)
      .map(k => {
        const sel = discardInfo.selected[k] || 0;
        const have = player.resources[k];
        return `
          <div class="discard-chip">
            <span>${RESOURCES[k].emoji} <small>(${sel}/${have})</small></span>
            <div class="discard-stepper">
              <button type="button" data-player-id="${player.id}" data-res="${k}" data-discard-adj="-1" ${sel <= 0 ? 'disabled' : ''}>−</button>
              <button type="button" data-player-id="${player.id}" data-res="${k}" data-discard-adj="1" ${sel >= have || remaining <= 0 ? 'disabled' : ''}>+</button>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="edge-discard-box">
        <div class="edge-discard-title">
          🗑️ Rolled 7! Discard <strong>${discardInfo.required}</strong> cards (${remaining} more)
        </div>
        <div class="edge-discard-grid">${controls}</div>
        <button
          type="button"
          class="btn-confirm-discard"
          data-discard-confirm="${player.id}"
          ${remaining !== 0 ? 'disabled' : ''}
        >
          ✅ Confirm Discard (${selectedTotal}/${discardInfo.required})
        </button>
      </div>
    `;
  }

  // =========================================================================
  // NON-BLOCKING TABLETOP TRADE COMPOSER
  // =========================================================================

  renderTradeComposer() {
    const s = this.game.state;
    if (!s.activeTrade.isOpen || s.phase !== 'MAIN_TURN') {
      this.tradeComposerEl.classList.add('hidden');
      this.tradeComposerEl.innerHTML = '';
      return;
    }

    this.tradeComposerEl.classList.remove('hidden');
    const player = this.game.getPlayer();
    const { give, want, targetPlayerId } = s.activeTrade;
    const { rates } = this.game.getPlayerHarborRates(player.id);
    const bankEval = this.game.evaluateBankTrade();
    const isPlayerReady = this.game.isPlayerTradeOfferReady();

    const giveRow = RESOURCE_KEYS.map(k => {
      const have = player.resources[k];
      const val = give[k];
      const portRate = rates[k];
      return `
        <div class="trade-res-col">
          <div class="trade-res-header">
            <span class="trade-emoji">${RESOURCES[k].emoji}</span>
            <span class="trade-port-tag">${portRate}:1</span>
          </div>
          <div class="trade-have">Have: ${have}</div>
          <div class="trade-stepper">
            <button type="button" data-trade-side="give" data-res="${k}" data-delta="-1" ${val <= 0 ? 'disabled' : ''}>−</button>
            <span class="trade-val ${val > 0 ? 'active-val' : ''}">${val}</span>
            <button type="button" data-trade-side="give" data-res="${k}" data-delta="1" ${val >= have ? 'disabled' : ''}>+</button>
          </div>
        </div>
      `;
    }).join('');

    const wantRow = RESOURCE_KEYS.map(k => {
      const val = want[k];
      return `
        <div class="trade-res-col">
          <div class="trade-res-header">
            <span class="trade-emoji">${RESOURCES[k].emoji}</span>
          </div>
          <div class="trade- stepper-spacer"></div>
          <div class="trade-stepper">
            <button type="button" data-trade-side="want" data-res="${k}" data-delta="-1" ${val <= 0 ? 'disabled' : ''}>−</button>
            <span class="trade-val ${val > 0 ? 'active-val-want' : ''}">${val}</span>
            <button type="button" data-trade-side="want" data-res="${k}" data-delta="1">+</button>
          </div>
        </div>
      `;
    }).join('');

    const targetButtons = [
      `<button type="button" class="target-pill ${targetPlayerId === 'all' ? 'selected' : ''}" data-trade-target="all">🌐 All Players</button>`,
      ...s.players
        .filter(p => p.id !== player.id)
        .map(
          p => `
            <button type="button" class="target-pill ${targetPlayerId === p.id ? 'selected' : ''}" data-trade-target="${p.id}">
              ${p.emoji} ${this.escapeHtml(p.name)}
            </button>
          `
        )
    ].join('');

    this.tradeComposerEl.innerHTML = `
      <div class="trade-panel-header">
        <div class="trade-panel-title">
          <strong>🤝 Tabletop Trade</strong>
          <span class="trade-hint">
            ${
              isPlayerReady
                ? '🟢 Live on player edge cards! Partner taps ✅ Accept on their edge.'
                : 'Select resources below — or match your port rate for a 1-tap Bank Trade.'
            }
          </span>
        </div>
        <div class="trade-header-btns">
          <button type="button" class="btn-trade-clear" id="btn-trade-clear">Reset</button>
          <button type="button" class="btn-trade-close" id="btn-trade-close">✕</button>
        </div>
      </div>

      <div class="trade-columns-wrap">
        <div class="trade-side-box">
          <div class="trade-side-label">${player.emoji} I Give:</div>
          <div class="trade-res-grid">${giveRow}</div>
        </div>

        <div class="trade-arrow-divider">⇄</div>

        <div class="trade-side-box">
          <div class="trade-side-label">🎯 I Want:</div>
          <div class="trade-res-grid">${wantRow}</div>
        </div>
      </div>

      <div class="trade-footer-bar">
        <div class="trade-target-group">
          <span class="target-label">Send to Edge:</span>
          ${targetButtons}
        </div>
        <div class="trade-bank-group">
          <button
            type="button"
            class="btn-bank-trade ${bankEval.valid ? 'ready' : ''}"
            id="btn-exec-bank-trade"
            ${bankEval.valid ? '' : 'disabled'}
            title="${this.escapeHtml(bankEval.reason || '')}"
          >
            ${bankEval.valid ? bankEval.label : `🏦 Bank (${bankEval.reason})`}
          </button>
        </div>
      </div>
    `;

    // Bind events inside trade composer
    this.tradeComposerEl.querySelectorAll('[data-trade-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.game.adjustTradeAmount(
          btn.dataset.tradeSide,
          btn.dataset.res,
          Number(btn.dataset.delta)
        );
      });
    });

    this.tradeComposerEl.querySelectorAll('[data-trade-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.tradeTarget;
        this.game.setTradeTarget(raw === 'all' ? 'all' : Number(raw));
      });
    });

    document.getElementById('btn-trade-clear')?.addEventListener('click', () => {
      this.game.clearTradeSelection();
    });

    document.getElementById('btn-trade-close')?.addEventListener('click', () => {
      this.game.toggleTradePanel(false);
    });

    document.getElementById('btn-exec-bank-trade')?.addEventListener('click', () => {
      this.game.executeBankTrade();
    });
  }

  // =========================================================================
  // BOTTOM ACTION DOCK
  // =========================================================================

  renderActionBar() {
    const s = this.game.state;
    const player = this.game.getPlayer();

    if (s.phase === 'GAME_OVER') {
      const winner = s.players[s.winnerId];
      this.actionBarEl.innerHTML = `
        <div class="action-prompt-row">
          <span class="winner-announcement">🏆 ${winner.emoji} ${this.escapeHtml(winner.name)} Won the Game!</span>
          <button type="button" class="btn-primary-action" id="btn-play-again">🔄 Play Again</button>
        </div>
      `;
      document.getElementById('btn-play-again')?.addEventListener('click', () => {
        this.setupModalOpen = true;
        this.renderModal();
      });
      return;
    }

    if (s.phase === 'SETUP_SETTLEMENT' || s.phase === 'SETUP_ROAD') {
      const isRoad = s.phase === 'SETUP_ROAD';
      this.actionBarEl.innerHTML = `
        <div class="action-prompt-row">
          <span class="phase-instruction">
            ${player.emoji} <strong>${this.escapeHtml(player.name)}</strong>: Tap a glowing ${
        isRoad ? 'edge 🛣️ to place your Road' : 'intersection 🏠 to place your Settlement'
      }
          </span>
        </div>
      `;
      return;
    }

    if (s.phase === 'PRE_ROLL') {
      const playableDevs = player.devCards.filter(c =>
        this.game.canPlayDevCard(player.id, c)
      );
      this.actionBarEl.innerHTML = `
        <div class="action-dock-row">
          <button type="button" class="btn-roll-dice" id="btn-roll-dice">
            🎲 Roll Dice (${player.emoji} ${this.escapeHtml(player.name)})
          </button>
          ${
            playableDevs.length > 0
              ? `<button type="button" class="btn-dock" id="btn-open-devs">🃏 Play Dev Card (${playableDevs.length})</button>`
              : ''
          }
        </div>
      `;
      document.getElementById('btn-roll-dice')?.addEventListener('click', () => {
        this.game.rollDice();
      });
      document.getElementById('btn-open-devs')?.addEventListener('click', () => {
        this.devCardModalOpen = true;
        this.renderModal();
      });
      return;
    }

    if (s.phase === 'DISCARD_7') {
      const pendingPlayers = s.players.filter(
        p => s.discardState[p.id] && !s.discardState[p.id].done
      );
      this.actionBarEl.innerHTML = `
        <div class="action-prompt-row">
          <span class="phase-instruction">
            🗑️ Waiting for ${pendingPlayers.map(p => `${p.emoji} ${this.escapeHtml(p.name)}`).join(', ')} to discard half their cards on their edge card...
          </span>
        </div>
      `;
      return;
    }

    if (s.phase === 'MOVE_ROBBER') {
      this.actionBarEl.innerHTML = `
        <div class="action-prompt-row">
          <span class="phase-instruction">
            🏴‍☠️ ${player.emoji} <strong>${this.escapeHtml(player.name)}</strong>: Tap any highlighted hex on the board to move the Robber.
          </span>
        </div>
      `;
      return;
    }

    if (s.phase === 'STEAL_ROBBER') {
      const buttons = s.stealCandidates
        .map(cid => {
          const victim = s.players[cid];
          const count = this.game.getTotalResources(victim);
          return `
            <button type="button" class="btn-steal-target" data-steal-id="${victim.id}" style="border-color:${victim.color}">
              🏴‍☠️ Steal from ${victim.emoji} ${this.escapeHtml(victim.name)} (${count} 🃏)
            </button>
          `;
        })
        .join('');

      this.actionBarEl.innerHTML = `
        <div class="action-dock-row">
          <span class="phase-instruction">Choose who to steal 1 random card from:</span>
          ${buttons}
        </div>
      `;
      this.actionBarEl.querySelectorAll('[data-steal-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.game.chooseStealTarget(Number(btn.dataset.stealId));
        });
      });
      return;
    }

    if (s.phase === 'ROAD_BUILDING_DEV') {
      this.actionBarEl.innerHTML = `
        <div class="action-prompt-row">
          <span class="phase-instruction">
            🛣️ ${player.emoji} <strong>${this.escapeHtml(player.name)}</strong>: Tap a glowing edge to place ${s.freeRoadsRemaining} more free Road(s)
          </span>
        </div>
      `;
      return;
    }

    // MAIN_TURN
    const canRoad =
      this.game.canAfford(player.id, BUILD_COSTS.road) &&
      player.roadsLeft > 0 &&
      getValidRoadEdges(s.board, player.id, null).length > 0;

    const canSettle =
      this.game.canAfford(player.id, BUILD_COSTS.settlement) &&
      player.settlementsLeft > 0 &&
      getValidSettlementVertices(s.board, player.id, false).length > 0;

    const canCity =
      this.game.canAfford(player.id, BUILD_COSTS.city) &&
      player.citiesLeft > 0 &&
      getValidCityVertices(s.board, player.id).length > 0;

    const canBuyDev =
      this.game.canAfford(player.id, BUILD_COSTS.devCard) && s.devDeck.length > 0;

    const playableDevs = player.devCards.filter(c =>
      this.game.canPlayDevCard(player.id, c)
    );

    this.actionBarEl.innerHTML = `
      <div class="action-dock-row">
        <button
          type="button"
          class="btn-dock ${s.buildMode === 'road' ? 'active-mode' : ''}"
          id="btn-build-road"
          ${!canRoad ? 'disabled' : ''}
        >
          <span class="dock-main">🛣️ Road</span>
          <span class="dock-cost">1🌲 1🧱</span>
        </button>

        <button
          type="button"
          class="btn-dock ${s.buildMode === 'settlement' ? 'active-mode' : ''}"
          id="btn-build-settlement"
          ${!canSettle ? 'disabled' : ''}
        >
          <span class="dock-main">🏠 Settle</span>
          <span class="dock-cost">1🌲1🧱1🐑1🌾</span>
        </button>

        <button
          type="button"
          class="btn-dock ${s.buildMode === 'city' ? 'active-mode' : ''}"
          id="btn-build-city"
          ${!canCity ? 'disabled' : ''}
        >
          <span class="dock-main">🏛️ City</span>
          <span class="dock-cost">2🌾 3⛰️</span>
        </button>

        <button
          type="button"
          class="btn-dock"
          id="btn-buy-dev"
          ${!canBuyDev ? 'disabled' : ''}
        >
          <span class="dock-main">📜 Buy Dev (${s.devDeck.length})</span>
          <span class="dock-cost">1🐑 1🌾 1⛰️</span>
        </button>

        <button
          type="button"
          class="btn-dock ${playableDevs.length > 0 ? 'glow-dev' : ''}"
          id="btn-open-devs"
          ${player.devCards.length === 0 ? 'disabled' : ''}
        >
          <span class="dock-main">🃏 Dev Cards (${player.devCards.length})</span>
          <span class="dock-cost">${playableDevs.length > 0 ? `${playableDevs.length} Ready` : 'View / Play'}</span>
        </button>

        <button
          type="button"
          class="btn-dock btn-trade-toggle ${s.activeTrade.isOpen ? 'active-mode' : ''}"
          id="btn-toggle-trade"
        >
          <span class="dock-main">🤝 Trade</span>
          <span class="dock-cost">Players & Ports</span>
        </button>

        <button type="button" class="btn-end-turn" id="btn-end-turn">
          ⏭️ End Turn
        </button>
      </div>
    `;

    document.getElementById('btn-build-road')?.addEventListener('click', () => {
      this.game.setBuildMode('road');
    });
    document.getElementById('btn-build-settlement')?.addEventListener('click', () => {
      this.game.setBuildMode('settlement');
    });
    document.getElementById('btn-build-city')?.addEventListener('click', () => {
      this.game.setBuildMode('city');
    });
    document.getElementById('btn-buy-dev')?.addEventListener('click', () => {
      this.game.buyDevCard();
    });
    document.getElementById('btn-open-devs')?.addEventListener('click', () => {
      this.devCardModalOpen = true;
      this.renderModal();
    });
    document.getElementById('btn-toggle-trade')?.addEventListener('click', () => {
      this.game.toggleTradePanel();
    });
    document.getElementById('btn-end-turn')?.addEventListener('click', () => {
      this.game.endTurn();
    });
  }

  // =========================================================================
  // MODALS: DEV CARDS, DICE STATS & LOG, NEW GAME SETUP
  // =========================================================================

  renderModal() {
    if (!this.devCardModalOpen && !this.statsModalOpen && !this.setupModalOpen) {
      this.modalOverlayEl.classList.add('hidden');
      this.modalContentEl.innerHTML = '';
      return;
    }

    this.modalOverlayEl.classList.remove('hidden');

    if (this.devCardModalOpen) {
      this.renderDevCardModal();
    } else if (this.statsModalOpen) {
      this.renderStatsAndLogModal();
    } else if (this.setupModalOpen) {
      this.renderSetupModal();
    }
  }

  renderDevCardModal() {
    const s = this.game.state;
    const player = this.game.getPlayer();

    if (this.pendingDevCardAction) {
      const { cardId, type, picked } = this.pendingDevCardAction;
      const isYop = type === 'yearOfPlenty';

      const resourceBtns = RESOURCE_KEYS.map(
        k => `
          <button type="button" class="btn-res-picker" data-pick-res="${k}">
            <span class="big-emoji">${RESOURCES[k].emoji}</span>
            <span>${RESOURCES[k].name}</span>
          </button>
        `
      ).join('');

      this.modalContentEl.innerHTML = `
        <div class="modal-header">
          <h3>${isYop ? '🎁 Year of Plenty — Pick 2 Resources' : '👑 Monopoly — Pick 1 Resource to Claim'}</h3>
          <button type="button" class="btn-modal-close" id="btn-close-modal">✕</button>
        </div>
        <div class="modal-body">
          ${
            isYop
              ? `<p class="modal-sub">Selected (${picked.length}/2): ${
                  picked.map(k => RESOURCES[k].emoji).join(' + ') || 'None yet'
                }</p>`
              : `<p class="modal-sub">All other players will give you every card they hold of the chosen resource.</p>`
          }
          <div class="res-picker-grid">${resourceBtns}</div>
        </div>
      `;

      document.getElementById('btn-close-modal')?.addEventListener('click', () => {
        this.pendingDevCardAction = null;
        this.renderModal();
      });

      this.modalContentEl.querySelectorAll('[data-pick-res]').forEach(btn => {
        btn.addEventListener('click', () => {
          const resKey = btn.dataset.pickRes;
          if (isYop) {
            picked.push(resKey);
            if (picked.length === 2) {
              this.game.playYearOfPlentyCard(cardId, picked[0], picked[1]);
              this.closeModals();
            } else {
              this.renderModal();
            }
          } else {
            this.game.playMonopolyCard(cardId, resKey);
            this.closeModals();
          }
        });
      });
      return;
    }

    const cardsHtml =
      player.devCards.length === 0
        ? `<p class="empty-msg">You have no Development Cards.</p>`
        : player.devCards
            .map(c => {
              const info = DEV_CARD_INFO[c.type];
              const canPlay = this.game.canPlayDevCard(player.id, c);
              let statusNote = '';
              if (c.type === 'vp') {
                statusNote = 'Passive (+1 Secret VP)';
              } else if (c.boughtTurn === s.turnNumber) {
                statusNote = 'Bought this turn (playable next turn)';
              } else if (s.devCardPlayedThisTurn) {
                statusNote = 'Already played 1 Dev Card this turn';
              }

              return `
                <div class="dev-card-item">
                  <div class="dev-card-left">
                    <span class="dev-card-emoji">${info.emoji}</span>
                    <div>
                      <div class="dev-card-title">${info.name}</div>
                      <div class="dev-card-desc">${info.desc}</div>
                      ${statusNote ? `<div class="dev-card-note">${statusNote}</div>` : ''}
                    </div>
                  </div>
                  ${
                    canPlay
                      ? `<button type="button" class="btn-play-dev" data-play-dev-id="${c.id}" data-play-dev-type="${c.type}">▶ Play</button>`
                      : ''
                  }
                </div>
              `;
            })
            .join('');

    this.modalContentEl.innerHTML = `
      <div class="modal-header">
        <h3>🃏 ${player.emoji} ${this.escapeHtml(player.name)}'s Development Cards</h3>
        <button type="button" class="btn-modal-close" id="btn-close-modal">✕</button>
      </div>
      <div class="modal-body">
        <div class="dev-cards-list">${cardsHtml}</div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeModals();
    });

    this.modalContentEl.querySelectorAll('[data-play-dev-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.playDevId;
        const type = btn.dataset.playDevType;
        if (type === 'knight') {
          this.game.playKnightCard(cardId);
          this.closeModals();
        } else if (type === 'roadBuilding') {
          this.game.playRoadBuildingCard(cardId);
          this.closeModals();
        } else if (type === 'yearOfPlenty' || type === 'monopoly') {
          this.pendingDevCardAction = { cardId, type, picked: [] };
          this.renderModal();
        }
      });
    });
  }

  renderStatsAndLogModal() {
    const s = this.game.state;
    const maxCount = Math.max(1, ...Object.values(s.diceStats));

    const barsHtml = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .map(num => {
        const count = s.diceStats[num] || 0;
        const heightPct = Math.round((count / maxCount) * 100);
        const isRed = num === 6 || num === 8;
        const isSeven = num === 7;
        return `
          <div class="hist-col">
            <span class="hist-count">${count}</span>
            <div class="hist-bar-track">
              <div class="hist-bar-fill ${isRed ? 'bar-hot' : ''} ${isSeven ? 'bar-seven' : ''}" style="height:${heightPct}%"></div>
            </div>
            <span class="hist-label">${num}</span>
          </div>
        `;
      })
      .join('');

    const logHtml = s.log
      .map(item => `<div class="log-entry">${this.escapeHtml(item)}</div>`)
      .join('');

    this.modalContentEl.innerHTML = `
      <div class="modal-header">
        <h3>📊 Dice Statistics & Game Log</h3>
        <button type="button" class="btn-modal-close" id="btn-close-modal">✕</button>
      </div>
      <div class="modal-body">
        <h4>🎲 Dice Roll Distribution</h4>
        <div class="histogram-wrap">${barsHtml}</div>
        <h4>📜 Recent Game Log</h4>
        <div class="game-log-box">${logHtml}</div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeModals();
    });
  }

  renderSetupModal() {
    const s = this.game.state;
    const currentCount = s ? s.players.length : 4;

    this.modalContentEl.innerHTML = `
      <div class="modal-header">
        <h3>🏝️ New Catan Tabletop Game</h3>
        <button type="button" class="btn-modal-close" id="btn-close-modal">✕</button>
      </div>
      <div class="modal-body">
        <div class="setup-field">
          <label>Number of Human Players:</label>
          <div class="segmented-control" id="setup-player-count">
            <button type="button" data-pcount="2" class="${currentCount === 2 ? 'active' : ''}">2 Players</button>
            <button type="button" data-pcount="3" class="${currentCount === 3 ? 'active' : ''}">3 Players</button>
            <button type="button" data-pcount="4" class="${currentCount === 4 ? 'active' : ''}">4 Players</button>
          </div>
        </div>

        <div class="setup-field">
          <label>Player Names (Seated Around iPad):</label>
          <div class="setup-players-grid" id="setup-players-inputs">
            ${PLAYER_PRESETS.map((preset, idx) => {
              const existingName = s?.players[idx]?.name || preset.defaultName;
              return `
                <div class="setup-player-row" data-player-row="${idx}" style="${idx >= currentCount ? 'display:none' : ''}">
                  <span class="setup-p-badge">${preset.emoji}</span>
                  <input type="text" id="setup-pname-${idx}" value="${this.escapeHtml(existingName)}" maxlength="14" placeholder="${preset.defaultName}" />
                  <span class="setup-seat-hint">${preset.seat.toUpperCase()} EDGE</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="setup-field-row">
          <div class="setup-field">
            <label>Victory Points to Win:</label>
            <select id="setup-vp-target">
              <option value="8" ${s?.settings?.victoryTarget === 8 ? 'selected' : ''}>8 VP (Quick Game)</option>
              <option value="10" ${!s || s?.settings?.victoryTarget === 10 ? 'selected' : ''}>10 VP (Standard Catan)</option>
              <option value="12" ${s?.settings?.victoryTarget === 12 ? 'selected' : ''}>12 VP (Extended Game)</option>
            </select>
          </div>

          <div class="setup-field">
            <label>Dice Mode:</label>
            <select id="setup-dice-mode">
              <option value="random" ${!s || s?.settings?.diceMode === 'random' ? 'selected' : ''}>🎲 Standard Random 2d6</option>
              <option value="deck" ${s?.settings?.diceMode === 'deck' ? 'selected' : ''}>🃏 Balanced 36-Roll Deck</option>
            </select>
          </div>
        </div>

        <div class="setup-checkboxes">
          <label class="checkbox-row">
            <input type="checkbox" id="setup-balanced-nums" ${!s || s?.settings?.balancedNumbers ? 'checked' : ''} />
            <span>Balanced Red Numbers (No adjacent 6 & 8 tiles)</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" id="setup-rotate-cards" ${!s || s?.settings?.rotateEdgeCards ? 'checked' : ''} />
            <span>Tabletop Orientation (Rotate Left/Top/Right player cards toward table edges)</span>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-primary-action full-width" id="btn-start-game-confirm">
            🚀 Generate Island & Start Game
          </button>
        </div>
      </div>
    `;

    let selectedCount = currentCount;
    this.modalContentEl.querySelectorAll('[data-pcount]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCount = Number(btn.dataset.pcount);
        this.modalContentEl.querySelectorAll('[data-pcount]').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        this.modalContentEl.querySelectorAll('[data-player-row]').forEach(row => {
          const idx = Number(row.dataset.playerRow);
          row.style.display = idx < selectedCount ? '' : 'none';
        });
      });
    });

    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeModals();
    });

    document.getElementById('btn-start-game-confirm')?.addEventListener('click', () => {
      const playerConfigs = [];
      for (let i = 0; i < selectedCount; i++) {
        const input = document.getElementById(`setup-pname-${i}`);
        playerConfigs.push({
          name: input ? input.value : PLAYER_PRESETS[i].defaultName,
          presetId: i
        });
      }

      const victoryTarget = Number(document.getElementById('setup-vp-target').value) || 10;
      const diceMode = document.getElementById('setup-dice-mode').value || 'random';
      const balancedNumbers = document.getElementById('setup-balanced-nums').checked;
      const rotateEdgeCards = document.getElementById('setup-rotate-cards').checked;

      this.game.startNewGame({
        playerConfigs,
        balancedNumbers,
        diceMode,
        victoryTarget,
        rotateEdgeCards
      });
      this.closeModals();
    });
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
