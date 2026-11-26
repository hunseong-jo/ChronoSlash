(function () {
  'use strict';

  const Audio = window.ChronoSlashAudio;
  const Levels = window.ChronoSlashLevels;
  const WORLD_W = Levels.WORLD_W;
  const WORLD_H = Levels.WORLD_H;
  const WALL_T = Levels.WALL_THICKNESS;
  const SAVE_KEY = 'chrono_slash_save_v1';

  const MIN_TIME_SCALE = 0.018;
  const PLAYER_RADIUS = 13;
  const PLAYER_SPEED = 345;
  const DASH_DURATION = 0.135;
  const DASH_DISTANCE = 225;
  const DASH_COOLDOWN = 0.36;
  const DASH_RESET_COOLDOWN = 0.05;
  const SLASH_RADIUS = 102;
  const PARRY_RADIUS = 120;

  // Math / Geometry Utilities
  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function distSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  function distPointToSegmentSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return distSq(px, py, x1, y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
    return distSq(px, py, x1 + dx * t, y1 + dy * t);
  }

  // Liang-Barsky segment-vs-AABB intersection returning hit t in [0, 1] or null
  function segmentRectHitT(x1, y1, x2, y2, r) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-8) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return null;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return null;
          if (t < t1) t1 = t;
        }
      }
    }
    return t0 <= t1 ? t0 : null;
  }

  function resolveCircleRect(ent, rect) {
    const cx = clamp(ent.x, rect.x, rect.x + rect.w);
    const cy = clamp(ent.y, rect.y, rect.y + rect.h);
    const dx = ent.x - cx;
    const dy = ent.y - cy;
    const dSq = dx * dx + dy * dy;
    if (dSq >= ent.r * ent.r) return false;

    if (dSq > 1e-6) {
      const d = Math.sqrt(dSq);
      const push = ent.r - d;
      ent.x += (dx / d) * push;
      ent.y += (dy / d) * push;
    } else {
      // Center is inside rect — push out along shallowest axis
      const left = ent.x - rect.x;
      const right = rect.x + rect.w - ent.x;
      const top = ent.y - rect.y;
      const bottom = rect.y + rect.h - ent.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) ent.x = rect.x - ent.r;
      else if (m === right) ent.x = rect.x + rect.w + ent.r;
      else if (m === top) ent.y = rect.y - ent.r;
      else ent.y = rect.y + rect.h + ent.r;
    }
    return true;
  }

  // Enemy Archetype Definitions (Tuned for readable, empowering, fun parry gameplay!)
  const ENEMY_SPECS = {
    pistol: {
      r: 16, speed: 78, color: '#ff335c', glow: 'rgba(255, 51, 92, 0.55)',
      fireRate: 2.15, telegraph: 0.42, bulletSpeed: 315, preferredDist: 260, hp: 1, label: 'GUARD'
    },
    shotgun: {
      r: 18, speed: 66, color: '#ff7b29', glow: 'rgba(255, 123, 41, 0.55)',
      fireRate: 2.65, telegraph: 0.48, bulletSpeed: 285, preferredDist: 220, hp: 1, label: 'HEAVY'
    },
    sniper: {
      r: 16, speed: 50, color: '#ff2ec4', glow: 'rgba(255, 46, 196, 0.6)',
      fireRate: 3.1, telegraph: 0.78, bulletSpeed: 620, preferredDist: 440, hp: 1, label: 'SNIPER'
    },
    burst: {
      r: 16, speed: 86, color: '#ffb830', glow: 'rgba(255, 184, 48, 0.55)',
      fireRate: 2.45, telegraph: 0.38, bulletSpeed: 345, preferredDist: 280, hp: 1, label: 'BURST'
    },
    rusher: {
      r: 15, speed: 175, color: '#ff3b9a', glow: 'rgba(255, 59, 154, 0.65)',
      fireRate: 99, telegraph: 0, bulletSpeed: 0, preferredDist: 0, hp: 1, label: 'BLADE'
    },
    shield: {
      r: 18, speed: 70, color: '#4ea8ff', glow: 'rgba(78, 168, 255, 0.55)',
      fireRate: 2.45, telegraph: 0.44, bulletSpeed: 310, preferredDist: 180, hp: 1, label: 'SHIELD'
    },
    turret: {
      r: 20, speed: 0, color: '#ff5252', glow: 'rgba(255, 82, 82, 0.6)',
      fireRate: 1.35, telegraph: 0.3, bulletSpeed: 280, preferredDist: 0, hp: 1, label: 'TURRET'
    },
    boss: {
      r: 32, speed: 96, color: '#ff2356', glow: 'rgba(255, 35, 86, 0.78)',
      fireRate: 2.0, telegraph: 0.6, bulletSpeed: 290, preferredDist: 300, hp: 4, label: 'CHRONOS WARDEN'
    }
  };

  class ChronoSlashGame {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');

      // DOM References
      this.dom = {
        vignette: document.getElementById('vignetteOverlay'),
        visorCorners: document.getElementById('visorCorners'),
        hud: document.getElementById('hud'),
        hudStageNum: document.getElementById('hudStageNum'),
        hudStageName: document.getElementById('hudStageName'),
        hudDiffTag: document.getElementById('hudDiffTag'),
        hudTimePill: document.getElementById('hudTimePill'),
        hudTimeState: document.getElementById('hudTimeState'),
        hudTimeRate: document.getElementById('hudTimeRate'),
        hudTimeBarFill: document.getElementById('hudTimeBarFill'),
        hudBossBar: document.getElementById('hudBossBar'),
        hudBossName: document.getElementById('hudBossName'),
        hudBossHpText: document.getElementById('hudBossHpText'),
        hudBossHpFill: document.getElementById('hudBossHpFill'),
        hudBossSegments: document.getElementById('hudBossSegments'),
        hudEnemies: document.getElementById('hudEnemies'),
        hudParries: document.getElementById('hudParries'),
        hudTime: document.getElementById('hudTime'),
        hudCombo: document.getElementById('hudCombo'),
        hudComboValue: document.getElementById('hudComboValue'),
        hudComboBar: document.getElementById('hudComboBar'),
        hudHpModule: document.getElementById('hudHpModule'),
        hudDashModule: document.getElementById('hudDashModule'),
        hudDashFill: document.getElementById('hudDashFill'),
        hudDashLabel: document.getElementById('hudDashLabel'),
        hudHpLabel: document.getElementById('hudHpLabel'),
        hudHpPips: document.getElementById('hudHpPips'),
        btnDiffNormal: document.getElementById('btnDiffNormal'),
        btnDiffHardcore: document.getElementById('btnDiffHardcore'),
        btnMute: document.getElementById('btnMute'),
        iconSoundOn: document.getElementById('iconSoundOn'),
        iconSoundOff: document.getElementById('iconSoundOff'),
        btnPause: document.getElementById('btnPause'),
        btnRestartHud: document.getElementById('btnRestartHud'),
        stageIntroBanner: document.getElementById('stageIntroBanner'),
        introStageCode: document.getElementById('introStageCode'),
        introStageTitle: document.getElementById('introStageTitle'),
        archiveClearedText: document.getElementById('archiveClearedText'),
        archiveSRankText: document.getElementById('archiveSRankText'),
        archiveProgressFill: document.getElementById('archiveProgressFill'),
        screenTitle: document.getElementById('screenTitle'),
        screenStageSelect: document.getElementById('screenStageSelect'),
        screenPause: document.getElementById('screenPause'),
        pauseStageLabel: document.getElementById('pauseStageLabel'),
        screenDeath: document.getElementById('screenDeath'),
        screenClear: document.getElementById('screenClear'),
        screenVictory: document.getElementById('screenVictory'),
        stageGrid: document.getElementById('stageGrid'),
        titleProgressInfo: document.getElementById('titleProgressInfo'),
        deathReason: document.getElementById('deathReason'),
        clearStageTitle: document.getElementById('clearStageTitle'),
        clearRank: document.getElementById('clearRank'),
        clearRankRing: document.getElementById('clearRankRing'),
        clearTime: document.getElementById('clearTime'),
        clearParTime: document.getElementById('clearParTime'),
        clearParries: document.getElementById('clearParries'),
        clearMaxCombo: document.getElementById('clearMaxCombo'),
        clearDeaths: document.getElementById('clearDeaths'),
        btnNextStage: document.getElementById('btnNextStage'),
        victoryTotalTime: document.getElementById('victoryTotalTime'),
        victoryTotalParries: document.getElementById('victoryTotalParries'),
        victoryTotalDeaths: document.getElementById('victoryTotalDeaths'),
        victoryRank: document.getElementById('victoryRank'),
        victoryRankStamp: document.getElementById('victoryRankStamp')
      };

      // Viewport transform
      this.view = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1, width: 1280, height: 720 };

      // Core Game State
      this.mode = 'title'; // 'title' | 'playing' | 'paused' | 'dead' | 'clearing' | 'clear' | 'victory'
      this.difficulty = 'normal'; // 'normal' (3 HP Chrono Shield) | 'hardcore' (1 HP)
      this.stageIndex = 0;
      this.stage = Levels.STAGES[0];
      this.timeScale = MIN_TIME_SCALE;
      this.hitstop = 0;
      this.shakeMag = 0;
      this.flashAlpha = 0;
      this.flashColor = '#ffffff';
      this.rewindFlash = 0;
      this.clearSlowMoTimer = 0;
      this.elapsedReal = 0;
      this.stageEntryGrace = 0;
      this.globalClock = 0;

      // Run & Stage Metrics
      this.stageTime = 0;
      this.stageParries = 0;
      this.stageDeaths = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.maxCombo = 0;
      this.parryChain = 0;

      // Campaign session totals
      this.sessionTime = 0;
      this.sessionParries = 0;
      this.sessionDeaths = 0;

      // Entities & FX
      this.walls = [];
      this.player = null;
      this.enemies = [];
      this.bullets = [];
      this.slashes = [];
      this.particles = [];
      this.afterimages = [];
      this.shockwaves = [];
      this.decals = [];
      this.popups = [];
      this.ambientMotes = [];
      this.titleShards = [];

      // Visual Caches
      this.glowSprites = {};
      this.arenaCache = null;
      this.dotPattern = null;

      // Inputs
      this.keys = new Set();
      this.mouse = { x: WORLD_W * 0.5, y: WORLD_H * 0.5, leftDown: false, rightDown: false, active: false };

      // Persistent Save Data
      this.save = this.loadSave();

      this.initAmbientMotes();
      this.bindEvents();
      this.handleResize();
      this.updateTitleProgress();
      this.buildStageSelectGrid();

      this.lastFrameTime = performance.now();
      this._rafId = requestAnimationFrame((t) => this.loop(t));
    }

    // =========================================================================
    // Save / Load
    // =========================================================================
    loadSave() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.stages === 'object') return parsed;
        }
      } catch (_) {}
      return { stages: {} };
    }

    persistSave() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
      } catch (_) {}
    }

    recordStageClear(stageId, time, rank) {
      const prev = this.save.stages[stageId];
      const rankOrder = { S: 3, A: 2, B: 1 };
      const bestRank = prev && rankOrder[prev.bestRank] > rankOrder[rank] ? prev.bestRank : rank;
      const bestTime = prev && prev.bestTime < time ? prev.bestTime : time;
      this.save.stages[stageId] = { cleared: true, bestTime, bestRank };
      this.persistSave();
      this.updateTitleProgress();
      this.buildStageSelectGrid();
    }

    updateTitleProgress() {
      let cleared = 0;
      for (const s of Levels.STAGES) {
        if (this.save.stages[s.id] && this.save.stages[s.id].cleared) cleared++;
      }
      const padded = String(cleared).padStart(2, '0');
      this.dom.titleProgressInfo.textContent = `CLEARED ${padded} / ${Levels.STAGES.length}`;
    }

    formatStageRosterChips(st) {
      if (st.isBoss) {
        return `<span class="roster-chip"><span class="roster-dot" style="background:#ff2e55;box-shadow:0 0 6px #ff2e55"></span>WARDEN ×1</span>`
          + `<span class="roster-chip"><span class="roster-dot" style="background:#ff335c"></span>GUARD ×2</span>`;
      }
      const counts = {};
      const colors = {};
      for (const e of st.enemies) {
        const spec = ENEMY_SPECS[e.type];
        const label = (spec && spec.label) || e.type.toUpperCase();
        counts[label] = (counts[label] || 0) + 1;
        colors[label] = (spec && spec.color) || '#ff335c';
      }
      const entries = Object.entries(counts);
      const shown = entries.slice(0, 3).map(([k, v]) =>
        `<span class="roster-chip"><span class="roster-dot" style="background:${colors[k]}"></span>${k}×${v}</span>`
      ).join('');
      const extra = entries.length > 3
        ? `<span class="roster-chip">+${entries.length - 3}</span>`
        : '';
      return shown + extra;
    }

    createStageMinimapSvg(st) {
      const accent = st.isBoss ? '#ff2e55' : '#00f0ff';
      const wallFill = st.isBoss ? 'rgba(255,46,85,0.28)' : 'rgba(0,240,255,0.22)';
      const wallStroke = st.isBoss ? 'rgba(255,95,126,0.78)' : 'rgba(0,240,255,0.72)';
      const gridStroke = st.isBoss ? 'rgba(255,46,85,0.12)' : 'rgba(0,240,255,0.11)';

      let grid = '';
      for (let x = 240; x < WORLD_W; x += 240) {
        grid += `<line x1="${x}" y1="28" x2="${x}" y2="${WORLD_H - 28}" stroke="${gridStroke}" stroke-width="6"/>`;
      }
      for (let y = 180; y < WORLD_H; y += 180) {
        grid += `<line x1="28" y1="${y}" x2="${WORLD_W - 28}" y2="${y}" stroke="${gridStroke}" stroke-width="6"/>`;
      }

      const wallsSvg = st.walls.map((w) =>
        `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="${wallFill}" stroke="${wallStroke}" stroke-width="8"/>`
      ).join('');

      const enemiesSvg = st.enemies.map((e) => {
        const spec = ENEMY_SPECS[e.type];
        const col = (spec && spec.color) || '#ff335c';
        if (e.type === 'boss') {
          return `<circle cx="${e.x}" cy="${e.y}" r="66" fill="none" stroke="${col}" stroke-width="10" stroke-dasharray="28 18" opacity="0.8"/>`
            + `<circle cx="${e.x}" cy="${e.y}" r="38" fill="${col}" stroke="#ffffff" stroke-width="10"/>`;
        }
        return `<circle cx="${e.x}" cy="${e.y}" r="22" fill="${col}" stroke="#ffffff" stroke-width="5"/>`;
      }).join('');

      const px = st.player.x;
      const py = st.player.y;
      const playerSvg = `<circle cx="${px}" cy="${py}" r="42" fill="none" stroke="#00f0ff" stroke-width="8" opacity="0.45"/>`
        + `<circle cx="${px}" cy="${py}" r="22" fill="#00f0ff" stroke="#ffffff" stroke-width="6"/>`;

      return `<svg viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
        + `<rect x="24" y="24" width="${WORLD_W - 48}" height="${WORLD_H - 48}" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="12"/>`
        + grid
        + wallsSvg
        + enemiesSvg
        + playerSvg
        + `</svg>`;
    }

    buildStageSelectGrid() {
      const grid = this.dom.stageGrid;
      grid.innerHTML = '';
      let clearedCount = 0;
      let sRankCount = 0;

      Levels.STAGES.forEach((st, idx) => {
        const rec = this.save.stages[st.id];
        if (rec && rec.cleared) clearedCount++;
        if (rec && rec.bestRank === 'S') sRankCount++;

        const btn = document.createElement('button');
        btn.className = 'stage-tile'
          + (rec && rec.cleared ? ' cleared' : '')
          + (rec && rec.bestRank === 'S' ? ' rank-gold' : '')
          + (st.isBoss ? ' boss-tile' : '');
        const rankHtml = rec && rec.bestRank
          ? `<span class="st-rank rank-${rec.bestRank}">${rec.bestRank}</span>`
          : `<span>--</span>`;
        const timeHtml = rec && typeof rec.bestTime === 'number'
          ? `${rec.bestTime.toFixed(1)}s`
          : `목표 ${st.parTime.toFixed(0)}s`;
        const rosterHtml = this.formatStageRosterChips(st);
        const minimapSvg = this.createStageMinimapSvg(st);

        btn.innerHTML = `
          <div class="st-head">
            <span class="st-code">${st.isBoss ? 'BOSS · ' : 'SECTOR '}${st.code}</span>
            ${rankHtml}
          </div>
          <div class="st-minimap">${minimapSvg}</div>
          <div class="st-name">${st.titleKo}</div>
          <div class="st-en">${st.titleEn}</div>
          <div class="st-roster-chips">${rosterHtml}</div>
          <div class="st-meta">
            <span>${timeHtml}</span>
            <span>적 ${st.enemies.length}</span>
          </div>
        `;
        btn.addEventListener('click', () => {
          Audio.playUiClick();
          this.hideAllScreens();
          this.startStage(idx, true);
        });
        grid.appendChild(btn);
      });

      this.dom.archiveClearedText.textContent = `${clearedCount} / ${Levels.STAGES.length}`;
      this.dom.archiveSRankText.textContent = String(sRankCount);
      this.dom.archiveProgressFill.style.width = `${(clearedCount / Levels.STAGES.length) * 100}%`;
    }

    // =========================================================================
    // Initialization & Events
    // =========================================================================
    initAmbientMotes() {
      this.ambientMotes = [];
      for (let i = 0; i < 48; i++) {
        this.ambientMotes.push({
          x: Math.random() * WORLD_W,
          y: Math.random() * WORLD_H,
          vx: (Math.random() - 0.5) * 28,
          vy: (Math.random() - 0.5) * 28,
          size: 1 + Math.random() * 2.2,
          alpha: 0.14 + Math.random() * 0.35
        });
      }

      const shardPalette = ['#00f0ff', '#ff2e55', '#ffd447', '#ff4fd8'];
      this.titleShards = [];
      for (let i = 0; i < 24; i++) {
        this.titleShards.push({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 10,
          vy: -4 - Math.random() * 10,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.45,
          size: 7 + Math.random() * 13,
          color: shardPalette[i % shardPalette.length]
        });
      }
    }

    bindEvents() {
      window.addEventListener('resize', () => this.handleResize());
      window.addEventListener('blur', () => {
        this.keys.clear();
        this.mouse.leftDown = false;
        this.mouse.rightDown = false;
      });

      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        this.mouse.x = (cx - this.view.offsetX) / this.view.scale;
        this.mouse.y = (cy - this.view.offsetY) / this.view.scale;
        this.mouse.active = true;
      });

      this.canvas.addEventListener('mousedown', (e) => {
        Audio.unlock();
        if (e.button === 0) {
          this.mouse.leftDown = true;
          if (this.mode === 'playing') {
            this.tryPlayerDashSlash();
          }
        } else if (e.button === 2) {
          this.mouse.rightDown = true;
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.mouse.leftDown = false;
        if (e.button === 2) this.mouse.rightDown = false;
      });

      window.addEventListener('keydown', (e) => {
        const code = e.code;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
          e.preventDefault();
        }
        Audio.unlock();

        if (code === 'KeyM') {
          this.toggleMute();
          return;
        }

        if (code === 'Escape') {
          if (this.mode === 'playing') {
            this.pauseGame();
          } else if (this.mode === 'paused') {
            this.resumeGame();
          } else if (!this.dom.screenStageSelect.classList.contains('hidden')) {
            this.closeStageSelect();
          }
          return;
        }

        if (code === 'KeyR') {
          if (this.mode === 'playing' || this.mode === 'dead' || this.mode === 'paused' || this.mode === 'clear') {
            Audio.playRewind();
            this.hideAllScreens();
            this.startStage(this.stageIndex, false);
          }
          return;
        }

        if (code === 'Space' || code === 'Enter') {
          if (this.mode === 'dead') {
            Audio.playRewind();
            this.hideAllScreens();
            this.startStage(this.stageIndex, false);
            return;
          }
          if (this.mode === 'clear') {
            this.goNextStage();
            return;
          }
          if (this.mode === 'playing' && code === 'Space') {
            this.tryPlayerDashSlash();
          }
        }

        this.keys.add(code);
      });

      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
      });

      // UI Button Bindings
      document.getElementById('btnPlay').addEventListener('click', () => {
        Audio.playUiClick();
        this.sessionTime = 0;
        this.sessionParries = 0;
        this.sessionDeaths = 0;
        this.hideAllScreens();
        this.startStage(0, true);
      });

      document.getElementById('btnStageSelect').addEventListener('click', () => {
        Audio.playUiClick();
        this.openStageSelect();
      });

      this.dom.btnDiffNormal.addEventListener('click', () => {
        Audio.playUiClick();
        this.setDifficulty('normal');
      });

      this.dom.btnDiffHardcore.addEventListener('click', () => {
        Audio.playUiClick();
        this.setDifficulty('hardcore');
      });

      document.getElementById('btnCloseStageSelect').addEventListener('click', () => {
        Audio.playUiClick();
        this.closeStageSelect();
      });

      this.dom.btnMute.addEventListener('click', () => this.toggleMute());
      this.dom.btnPause.addEventListener('click', () => {
        Audio.playUiClick();
        if (this.mode === 'playing') this.pauseGame();
      });
      this.dom.btnRestartHud.addEventListener('click', () => {
        Audio.playRewind();
        this.hideAllScreens();
        this.startStage(this.stageIndex, false);
      });

      document.getElementById('btnResume').addEventListener('click', () => {
        Audio.playUiClick();
        this.resumeGame();
      });
      document.getElementById('btnPauseRestart').addEventListener('click', () => {
        Audio.playRewind();
        this.hideAllScreens();
        this.startStage(this.stageIndex, false);
      });
      document.getElementById('btnPauseStages').addEventListener('click', () => {
        Audio.playUiClick();
        this.openStageSelect();
      });
      document.getElementById('btnPauseTitle').addEventListener('click', () => {
        Audio.playUiClick();
        this.showTitle();
      });

      document.getElementById('btnDeathRetry').addEventListener('click', () => {
        Audio.playRewind();
        this.hideAllScreens();
        this.startStage(this.stageIndex, false);
      });
      document.getElementById('btnDeathStages').addEventListener('click', () => {
        Audio.playUiClick();
        this.openStageSelect();
      });

      this.dom.btnNextStage.addEventListener('click', () => {
        Audio.playUiClick();
        this.goNextStage();
      });
      document.getElementById('btnClearRetry').addEventListener('click', () => {
        Audio.playRewind();
        this.hideAllScreens();
        this.startStage(this.stageIndex, true);
      });
      document.getElementById('btnClearStages').addEventListener('click', () => {
        Audio.playUiClick();
        this.openStageSelect();
      });

      document.getElementById('btnVictoryReplay').addEventListener('click', () => {
        Audio.playUiClick();
        this.sessionTime = 0;
        this.sessionParries = 0;
        this.sessionDeaths = 0;
        this.hideAllScreens();
        this.startStage(0, true);
      });
      document.getElementById('btnVictoryStages').addEventListener('click', () => {
        Audio.playUiClick();
        this.openStageSelect();
      });
      document.getElementById('btnVictoryTitle').addEventListener('click', () => {
        Audio.playUiClick();
        this.showTitle();
      });
    }

    handleResize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;

      // Reserve padding so top HUD (including Boss bar) & bottom HUD never overlap arena border
      const padX = 24;
      const padTop = 104;
      const padBottom = 82;
      const availW = Math.max(320, w - padX * 2);
      const availH = Math.max(240, h - padTop - padBottom);
      const scale = Math.min(availW / WORLD_W, availH / WORLD_H);

      this.view = {
        dpr,
        width: w,
        height: h,
        scale,
        offsetX: (w - WORLD_W * scale) * 0.5,
        offsetY: padTop + (availH - WORLD_H * scale) * 0.5
      };
    }

    toggleMute() {
      const muted = Audio.toggleMute();
      this.dom.iconSoundOn.classList.toggle('hidden', muted);
      this.dom.iconSoundOff.classList.toggle('hidden', !muted);
      this.dom.btnMute.classList.toggle('muted', muted);
    }

    triggerStageIntro() {
      const el = this.dom.stageIntroBanner;
      this.dom.introStageCode.textContent = this.stage.isBoss ? 'FINAL BOSS' : `SECTOR ${this.stage.code}`;
      this.dom.introStageTitle.textContent = `${this.stage.titleKo} · ${this.stage.titleEn}`;
      el.classList.remove('hidden');
      // Force CSS animation restart cleanly
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      clearTimeout(this._introHideTimer);
      this._introHideTimer = setTimeout(() => {
        el.classList.add('hidden');
      }, 1480);
    }

    setDifficulty(mode) {
      this.difficulty = mode === 'hardcore' ? 'hardcore' : 'normal';
      this.dom.btnDiffNormal.classList.toggle('active', this.difficulty === 'normal');
      this.dom.btnDiffHardcore.classList.toggle('active', this.difficulty === 'hardcore');
      this.dom.btnDiffHardcore.classList.toggle('hardcore', this.difficulty === 'hardcore');
    }

    // =========================================================================
    // Screen Flow & Stage Setup
    // =========================================================================
    hideAllScreens() {
      this.dom.screenTitle.classList.add('hidden');
      this.dom.screenStageSelect.classList.add('hidden');
      this.dom.screenPause.classList.add('hidden');
      this.dom.screenDeath.classList.add('hidden');
      this.dom.screenClear.classList.add('hidden');
      this.dom.screenVictory.classList.add('hidden');
    }

    showTitle() {
      this.hideAllScreens();
      this.dom.hud.classList.add('hidden');
      this.dom.screenTitle.classList.remove('hidden');
      this.mode = 'title';
      this.keys.clear();
      this.updateTitleProgress();
    }

    openStageSelect() {
      this.buildStageSelectGrid();
      this.hideAllScreens();
      this.dom.screenStageSelect.classList.remove('hidden');
      if (this.mode === 'playing') this.mode = 'paused';
    }

    closeStageSelect() {
      this.dom.screenStageSelect.classList.add('hidden');
      if (this.mode === 'title') {
        this.dom.screenTitle.classList.remove('hidden');
      } else if (this.mode === 'paused') {
        this.dom.screenPause.classList.remove('hidden');
      } else if (this.mode === 'dead') {
        this.dom.screenDeath.classList.remove('hidden');
      } else if (this.mode === 'clear') {
        this.dom.screenClear.classList.remove('hidden');
      } else if (this.mode === 'victory') {
        this.dom.screenVictory.classList.remove('hidden');
      }
    }

    pauseGame() {
      if (this.mode !== 'playing') return;
      this.mode = 'paused';
      this.keys.clear();
      this.mouse.leftDown = false;
      this.mouse.rightDown = false;
      if (this.dom.pauseStageLabel && this.stage) {
        const prefix = this.stage.isBoss ? 'FINAL BOSS' : `SECTOR ${this.stage.code}`;
        this.dom.pauseStageLabel.textContent = `${prefix} // ${this.stage.titleKo} · ${this.stage.titleEn}`;
      }
      this.dom.screenPause.classList.remove('hidden');
    }

    resumeGame() {
      if (this.mode !== 'paused') return;
      this.hideAllScreens();
      this.mode = 'playing';
    }

    goNextStage() {
      this.hideAllScreens();
      if (this.stageIndex + 1 < Levels.STAGES.length) {
        this.startStage(this.stageIndex + 1, true);
      } else {
        this.showVictory();
      }
    }

    startStage(idx, resetDeaths) {
      this.stageIndex = clamp(idx, 0, Levels.STAGES.length - 1);
      this.stage = Levels.STAGES[this.stageIndex];
      this.mode = 'playing';

      if (resetDeaths) {
        this.stageDeaths = 0;
      }

      this.stageTime = 0;
      this.stageParries = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.maxCombo = 0;
      this.parryChain = 0;
      this.timeScale = MIN_TIME_SCALE;
      this.hitstop = 0;
      this.shakeMag = 0;
      this.flashAlpha = 0;
      this.rewindFlash = resetDeaths ? 0 : 0.32;
      this.stageEntryGrace = 0.78;
      this.clearSlowMoTimer = 0;

      // Build outer border walls (non-overlapping corners) + stage interior walls
      this.walls = [
        { x: 0, y: 0, w: WORLD_W, h: WALL_T, outer: true },
        { x: 0, y: WORLD_H - WALL_T, w: WORLD_W, h: WALL_T, outer: true },
        { x: 0, y: WALL_T, w: WALL_T, h: WORLD_H - WALL_T * 2, outer: true },
        { x: WORLD_W - WALL_T, y: WALL_T, w: WALL_T, h: WORLD_H - WALL_T * 2, outer: true },
        ...this.stage.walls.map((w) => ({ ...w, outer: false }))
      ];

      const maxHp = this.difficulty === 'hardcore' ? 1 : 3;
      this.player = {
        x: this.stage.player.x,
        y: this.stage.player.y,
        r: PLAYER_RADIUS,
        hp: maxHp,
        maxHp,
        vx: 0,
        vy: 0,
        angle: 0,
        dashTimer: 0,
        dashCooldown: 0,
        dashDirX: 1,
        dashDirY: 0,
        dashStartX: this.stage.player.x,
        dashStartY: this.stage.player.y,
        invulnTimer: 0,
        slashHitIds: new Set(),
        alive: true
      };

      this.enemies = this.stage.enemies.map((e, i) => this.createEnemy(e, i + 1));
      this.bullets = [];
      this.slashes = [];
      this.particles = [];
      this.afterimages = [];
      this.shockwaves = [];
      this.decals = [];
      this.popups = [];

      // Update HUD
      this.dom.hud.classList.remove('hidden');
      this.dom.hudStageNum.textContent = `STAGE ${this.stage.code} / ${String(Levels.STAGES.length).padStart(2, '0')}`;
      this.dom.hudStageName.textContent = `${this.stage.titleKo} · ${this.stage.titleEn}`;
      this.dom.hudDiffTag.textContent = this.difficulty === 'hardcore' ? '1-HIT HC' : 'SHIELD 3';
      this.dom.hudDiffTag.classList.toggle('hardcore', this.difficulty === 'hardcore');
      this.dom.hudCombo.classList.add('hidden');
      if (resetDeaths) {
        this.triggerStageIntro();
      } else {
        this.dom.stageIntroBanner.classList.add('hidden');
      }
      this.updateBossHud();
      this.updateHud();
    }

    createEnemy(def, id) {
      const spec = ENEMY_SPECS[def.type] || ENEMY_SPECS.pistol;
      const angle = Math.atan2(this.player.y - def.y, this.player.x - def.x);
      return {
        id,
        type: def.type,
        x: def.x,
        y: def.y,
        r: spec.r,
        hp: spec.hp,
        maxHp: spec.hp,
        angle,
        vx: 0,
        vy: 0,
        fireCooldown: 0.95 + Math.random() * 0.75,
        telegraphTimer: 0,
        burstRemaining: 0,
        burstDelay: 0,
        strafeDir: Math.random() < 0.5 ? -1 : 1,
        strafeTimer: 1.2 + Math.random() * 1.4,
        hitFlash: 0,
        hitCooldown: 0,
        alive: true,
        // Boss specific state
        bossPhase: 'idle', // 'idle' | 'ring' | 'snipers' | 'charge_windup' | 'charging' | 'stunned'
        bossTimer: 0.9,
        bossPatternIdx: 0,
        bossChargeDirX: 0,
        bossChargeDirY: 0,
        bossSpawnedWave1: false,
        bossSpawnedWave2: false,
        spinAngle: 0
      };
    }

    // =========================================================================
    // Raycasting & Spatial Queries
    // =========================================================================
    hasLineOfSight(x1, y1, x2, y2) {
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i];
        if (w.outer) continue;
        if (segmentRectHitT(x1, y1, x2, y2, w) !== null) return false;
      }
      return true;
    }

    raycastWalls(x, y, angle, maxDist = 1500) {
      const x2 = x + Math.cos(angle) * maxDist;
      const y2 = y + Math.sin(angle) * maxDist;
      let bestT = 1;
      for (let i = 0; i < this.walls.length; i++) {
        const t = segmentRectHitT(x, y, x2, y2, this.walls[i]);
        if (t !== null && t < bestT) bestT = t;
      }
      return {
        x: x + (x2 - x) * bestT,
        y: y + (y2 - y) * bestT,
        dist: maxDist * bestT
      };
    }

    // =========================================================================
    // Player Actions: Dash Slash & Bullet Parry
    // =========================================================================
    tryPlayerDashSlash() {
      const p = this.player;
      if (!p || !p.alive || p.dashCooldown > 0 || p.dashTimer > 0) return;

      const aimAngle = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      p.angle = aimAngle;
      p.dashDirX = Math.cos(aimAngle);
      p.dashDirY = Math.sin(aimAngle);
      p.dashStartX = p.x;
      p.dashStartY = p.y;
      p.dashTimer = DASH_DURATION;
      p.dashCooldown = DASH_COOLDOWN;
      p.invulnTimer = Math.max(p.invulnTimer, DASH_DURATION + 0.14);
      p.slashHitIds.clear();

      // Immediate time burst for responsive slash feel
      this.timeScale = Math.max(this.timeScale, 0.85);
      Audio.playSlash();

      // Spawn katana crescent VFX
      this.slashes.push({
        x: p.x + p.dashDirX * 26,
        y: p.y + p.dashDirY * 26,
        angle: aimAngle,
        radius: SLASH_RADIUS,
        life: 0.22,
        maxLife: 0.22,
        color: '#00f0ff'
      });

      // Floor slash burn decal
      this.decals.push({
        type: 'slash',
        x1: p.x - p.dashDirX * 12,
        y1: p.y - p.dashDirY * 12,
        x2: p.x + p.dashDirX * (DASH_DISTANCE * 0.72),
        y2: p.y + p.dashDirY * (DASH_DISTANCE * 0.72),
        alpha: 0.34,
        color: '#00f0ff'
      });

      // Perform immediate parry/slash sweep at launch position too
      this.evaluateSlashHits(p.x, p.y, p.x + p.dashDirX * 36, p.y + p.dashDirY * 36, aimAngle);
    }

    evaluateSlashHits(x1, y1, x2, y2, slashAngle) {
      const p = this.player;
      let parriedAny = false;

      // 1. Bullet Parry check (generous radius along dash path!)
      for (let i = 0; i < this.bullets.length; i++) {
        const b = this.bullets[i];
        if (!b.alive || b.friendly) continue;
        const d2 = distPointToSegmentSq(b.x, b.y, x1, y1, x2, y2);
        if (d2 <= (PARRY_RADIUS + b.r) * (PARRY_RADIUS + b.r)) {
          this.parryBullet(b, slashAngle);
          parriedAny = true;
        }
      }

      if (parriedAny) {
        p.dashCooldown = Math.min(p.dashCooldown, DASH_RESET_COOLDOWN);
      }

      // 2. Enemy Slice check along dash corridor
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.alive || p.slashHitIds.has(e.id)) continue;

        const reach = (e.type === 'boss' ? 68 : 58) + e.r;
        const d2 = distPointToSegmentSq(e.x, e.y, x1, y1, x2, y2);
        if (d2 <= reach * reach) {
          p.slashHitIds.add(e.id);
          this.handlePlayerSlashOnEnemy(e, slashAngle);
        }
      }
    }

    parryBullet(b, slashAngle) {
      b.friendly = true;
      b.parried = true;
      b.color = '#ffe66d';
      b.pierce = b.isSniper ? 2 : 1;

      // Smart aim assist: reflect toward mouse cursor; if near an enemy along that cone, cleanly lock on!
      let targetAngle = Math.atan2(this.mouse.y - b.y, this.mouse.x - b.x);
      let bestSnapDiff = 0.44; // ~25 deg empowering aim assist
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (!this.hasLineOfSight(b.x, b.y, e.x, e.y)) continue;
        const angToEnemy = Math.atan2(e.y - b.y, e.x - b.x);
        const diff = Math.abs(angleDiff(targetAngle, angToEnemy));
        if (diff < bestSnapDiff) {
          bestSnapDiff = diff;
          targetAngle = angToEnemy;
        }
      }

      const newSpeed = Math.max(Math.hypot(b.vx, b.vy) * 1.85, 820);
      b.vx = Math.cos(targetAngle) * newSpeed;
      b.vy = Math.sin(targetAngle) * newSpeed;
      b.prevX = b.x;
      b.prevY = b.y;
      b.life = 2.5;

      this.stageParries++;
      this.parryChain++;
      this.hitstop = Math.max(this.hitstop, 0.072);
      this.shakeMag = Math.max(this.shakeMag, 9);
      this.flashColor = '#ffd447';
      this.flashAlpha = 0.16;

      Audio.playParry(this.parryChain);
      this.spawnShockwave(b.x, b.y, 12, 85, '#ffd447', 0.26);
      this.spawnParticles(b.x, b.y, '#ffd447', 16, 260, 460);
      this.spawnPopup(b.x, b.y - 20, this.parryChain > 1 ? `PARRY x${this.parryChain}!` : 'PARRY!', '#ffd447');
    }

    handlePlayerSlashOnEnemy(e, slashAngle) {
      const p = this.player;

      // Shield Enemy front block check
      if (e.type === 'shield') {
        const angleFromEnemyToPlayer = Math.atan2(p.dashStartY - e.y, p.dashStartX - e.x);
        const frontDiff = Math.abs(angleDiff(e.angle, angleFromEnemyToPlayer));
        if (frontDiff < 1.15) {
          // Blocked by shield! Push player safely back and spark
          Audio.playBlock();
          this.hitstop = Math.max(this.hitstop, 0.045);
          this.shakeMag = Math.max(this.shakeMag, 6);
          this.spawnParticles(e.x + Math.cos(e.angle) * 20, e.y + Math.sin(e.angle) * 20, '#4ea8ff', 14, 150, 340);
          this.spawnPopup(e.x, e.y - 26, 'BLOCKED! 뒤로 돌아라', '#76c1ff');
          p.dashTimer = 0;
          const pushAng = Math.atan2(p.y - e.y, p.x - e.x);
          p.x += Math.cos(pushAng) * 18;
          p.y += Math.sin(pushAng) * 18;
          return;
        }
      }

      // Boss melee check: can slash Boss during 'stunned' phase OR right after dodging charge!
      if (e.type === 'boss') {
        if (e.bossPhase === 'stunned') {
          this.damageEnemy(e, 1, slashAngle, 'slash');
          p.dashCooldown = Math.min(p.dashCooldown, DASH_RESET_COOLDOWN);
        } else {
          Audio.playBlock();
          this.hitstop = Math.max(this.hitstop, 0.04);
          this.shakeMag = Math.max(this.shakeMag, 6);
          this.spawnParticles(e.x, e.y, '#ff6b88', 12, 160, 320);
          this.spawnPopup(e.x, e.y - 38, '장갑 보호! 패링 또는 경직 노려라', '#ff9db0');
        }
        return;
      }

      // Standard lethal slice!
      this.damageEnemy(e, 1, slashAngle, 'slash');
      p.dashCooldown = Math.min(p.dashCooldown, DASH_RESET_COOLDOWN);
    }

    damageEnemy(e, amount, hitAngle, source) {
      if (!e.alive || e.hitCooldown > 0) return;
      e.hp -= amount;
      e.hitFlash = 0.22;

      if (e.type === 'boss' && e.hp > 0) {
        e.hitCooldown = 0.36;
        Audio.playBossHit();
        this.hitstop = Math.max(this.hitstop, 0.085);
        this.shakeMag = Math.max(this.shakeMag, 14);
        this.flashColor = '#00f0ff';
        this.flashAlpha = 0.2;
        this.spawnShockwave(e.x, e.y, 26, 160, '#ff335c', 0.36);
        this.spawnParticles(e.x, e.y, '#ffd447', 26, 180, 480);
        this.spawnPopup(e.x, e.y - 44, `CORE CRACK! (${e.hp}/${e.maxHp})`, '#00f0ff');

        // Break out of stun cleanly after taking melee hit
        if (e.bossPhase === 'stunned') {
          e.bossPhase = 'idle';
          e.bossTimer = 0.55;
        }
        this.maybeSpawnBossReinforcements(e);
        this.updateBossHud();
        return;
      }

      // Enemy Kill!
      e.alive = false;
      this.combo++;
      this.comboTimer = 2.6;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      const isBossKill = e.type === 'boss';
      this.hitstop = Math.max(this.hitstop, isBossKill ? 0.14 : 0.058);
      this.shakeMag = Math.max(this.shakeMag, isBossKill ? 22 : 10);
      this.flashColor = source === 'parry' ? '#ffd447' : '#00f0ff';
      this.flashAlpha = isBossKill ? 0.32 : 0.12;

      Audio.playKill(this.combo);

      const spec = ENEMY_SPECS[e.type];
      const count = isBossKill ? 55 : 22;
      this.spawnParticles(e.x, e.y, spec.color, count, 140, isBossKill ? 560 : 420);
      this.spawnParticles(e.x, e.y, '#ffffff', Math.floor(count * 0.4), 100, 300);
      this.spawnShockwave(e.x, e.y, 10, isBossKill ? 220 : 72, spec.color, isBossKill ? 0.45 : 0.24);

      // Persistent split-decal & scorch on arena floor
      this.decals.push({
        type: 'kill',
        x: e.x,
        y: e.y,
        angle: hitAngle,
        r: e.r,
        color: spec.color,
        alpha: 0.42
      });

      const label = isBossKill
        ? 'WARDEN DESTROYED!'
        : source === 'parry'
          ? 'DEFLECT KILL!'
          : this.combo >= 3
            ? `${this.combo}x CHAIN!`
            : this.combo === 2
              ? 'DOUBLE!'
              : 'SLASH!';
      this.spawnPopup(e.x, e.y - 22, label, source === 'parry' ? '#ffd447' : '#00f0ff');

      if (isBossKill) {
        // Boss destruction also destroys any remaining minions for cinematic climax
        for (const other of this.enemies) {
          if (other.alive) {
            other.alive = false;
            this.spawnParticles(other.x, other.y, '#ff335c', 14, 120, 320);
          }
        }
        this.updateBossHud();
      }

      this.checkStageClear();
    }

    maybeSpawnBossReinforcements(boss) {
      const aliveMinions = this.enemies.filter((e) => e.alive && e.type !== 'boss').length;
      if (aliveMinions >= 2) return;
      if (boss.hp === 3 && !boss.bossSpawnedWave1) {
        boss.bossSpawnedWave1 = true;
        this.spawnReinforcement('rusher', 1050, 120);
      } else if (boss.hp === 1 && !boss.bossSpawnedWave2) {
        boss.bossSpawnedWave2 = true;
        this.spawnReinforcement('pistol', 1050, 600);
      }
    }

    spawnReinforcement(type, x, y) {
      // Pick opposite side if player is too close
      let sx = x;
      let sy = y;
      if (distSq(sx, sy, this.player.x, this.player.y) < 200 * 200) {
        sx = WORLD_W - x;
        sy = WORLD_H - y;
      }
      const nextId = this.enemies.length + 100;
      const minion = this.createEnemy({ type, x: sx, y: sy }, nextId);
      minion.fireCooldown = 0.85;
      this.enemies.push(minion);
      this.spawnShockwave(sx, sy, 8, 70, '#ff2e55', 0.35);
      this.spawnPopup(sx, sy - 24, '증원 투입!', '#ff6b88');
    }

    damagePlayer(reason) {
      const p = this.player;
      if (!p || !p.alive || this.mode !== 'playing' || p.invulnTimer > 0) return;

      if (p.hp > 1) {
        p.hp--;
        p.invulnTimer = 1.05;
        this.hitstop = Math.max(this.hitstop, 0.08);
        this.shakeMag = Math.max(this.shakeMag, 12);
        this.flashColor = '#00f0ff';
        this.flashAlpha = 0.24;

        // Chrono Shield EMP pulse clears nearby enemy bullets so player gets fair breathing room!
        const clearR = 175;
        for (const b of this.bullets) {
          if (b.alive && !b.friendly && distSq(b.x, b.y, p.x, p.y) <= clearR * clearR) {
            b.alive = false;
            this.spawnParticles(b.x, b.y, '#00f0ff', 5, 80, 220);
          }
        }

        Audio.playBlock();
        this.spawnShockwave(p.x, p.y, 14, clearR, '#00f0ff', 0.34);
        this.spawnParticles(p.x, p.y, '#00f0ff', 22, 120, 360);
        this.spawnPopup(p.x, p.y - 26, `SHIELD! (${p.hp}/${p.maxHp})`, '#00f0ff');
        this.updateHud();
        return;
      }

      p.hp = 0;
      this.updateHud();
      this.killPlayer(reason);
    }

    killPlayer(reason) {
      if (!this.player.alive || this.mode !== 'playing') return;
      this.player.alive = false;
      this.mode = 'dead';
      this.stageDeaths++;
      this.sessionDeaths++;
      this.hitstop = 0.1;
      this.shakeMag = 18;
      this.flashColor = '#ff2e55';
      this.flashAlpha = 0.36;

      Audio.playDeath();
      this.spawnParticles(this.player.x, this.player.y, '#00f0ff', 36, 120, 440);
      this.spawnParticles(this.player.x, this.player.y, '#ff2e55', 18, 80, 320);
      this.spawnShockwave(this.player.x, this.player.y, 10, 130, '#ff2e55', 0.35);

      this.dom.deathReason.textContent = reason;
      this.dom.screenDeath.classList.remove('hidden');
    }

    checkStageClear() {
      const remaining = this.enemies.filter((e) => e.alive).length;
      if (remaining === 0 && this.mode === 'playing') {
        this.mode = 'clearing';
        this.clearSlowMoTimer = 0.65;
        this.bullets = []; // Clear residual enemy shots so player never dies post-clear
        Audio.playStageClear();
      }
    }

    finishStageClear() {
      this.mode = 'clear';
      const par = this.stage.parTime;
      let rank = 'B';
      if (this.stageDeaths === 0 && (this.stageTime <= par || (this.stageTime <= par * 1.18 && this.stageParries >= 2))) {
        rank = 'S';
      } else if (this.stageTime <= par * 1.7 && this.stageDeaths <= 2) {
        rank = 'A';
      }

      this.sessionTime += this.stageTime;
      this.sessionParries += this.stageParries;
      this.recordStageClear(this.stage.id, this.stageTime, rank);

      this.dom.clearStageTitle.textContent = `STAGE ${this.stage.code} · ${this.stage.titleKo} CLEAR`;
      this.dom.clearRank.textContent = rank;
      this.dom.clearRank.className = `rank-stamp stamp-${rank}`;
      if (this.dom.clearRankRing) {
        this.dom.clearRankRing.classList.toggle('rank-ring-gold', rank === 'S');
      }
      this.dom.clearTime.textContent = `${this.stageTime.toFixed(2)}s`;
      this.dom.clearParTime.textContent = `S 랭크 목표: ${par.toFixed(1)}s · 무사망`;
      this.dom.clearParries.textContent = String(this.stageParries);
      this.dom.clearMaxCombo.textContent = `${Math.max(1, this.maxCombo)}x`;
      this.dom.clearDeaths.textContent = String(this.stageDeaths);

      const isFinal = this.stageIndex + 1 >= Levels.STAGES.length;
      this.dom.btnNextStage.innerHTML = isFinal
        ? `최종 결과 확인 <kbd>SPACE</kbd>`
        : `다음 스테이지 <kbd>SPACE</kbd>`;

      this.dom.screenClear.classList.remove('hidden');
    }

    showVictory() {
      this.mode = 'victory';
      this.hideAllScreens();
      const overallRank = this.sessionDeaths <= 3 ? 'S' : this.sessionDeaths <= 10 ? 'A' : 'B';
      this.dom.victoryTotalTime.textContent = `${this.sessionTime.toFixed(1)}s`;
      this.dom.victoryTotalParries.textContent = String(this.sessionParries);
      this.dom.victoryTotalDeaths.textContent = String(this.sessionDeaths);
      this.dom.victoryRank.textContent = overallRank;
      this.dom.victoryRank.className = 'cs-val ' + (overallRank === 'S' ? 'accent-gold' : overallRank === 'A' ? 'accent-cyan' : '');
      if (this.dom.victoryRankStamp) {
        this.dom.victoryRankStamp.textContent = overallRank;
        this.dom.victoryRankStamp.className = `rank-stamp stamp-${overallRank}`;
      }
      this.dom.screenVictory.classList.remove('hidden');
    }

    // =========================================================================
    // Main Simulation Loop
    // =========================================================================
    loop(now) {
      const realDt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
      this.lastFrameTime = now;
      this.globalClock += realDt;

      this.update(realDt);
      this.render();

      this._rafId = requestAnimationFrame((t) => this.loop(t));
    }

    update(realDt) {
      // Visual decay timers run in real time
      this.flashAlpha = Math.max(0, this.flashAlpha - realDt * 1.8);
      this.rewindFlash = Math.max(0, this.rewindFlash - realDt * 2.4);
      this.shakeMag = Math.max(0, this.shakeMag - realDt * 42);

      // Ambient motes
      const moteScale = this.mode === 'playing' ? this.timeScale : 0.35;
      for (const m of this.ambientMotes) {
        m.x = (m.x + m.vx * realDt * moteScale + WORLD_W) % WORLD_W;
        m.y = (m.y + m.vy * realDt * moteScale + WORLD_H) % WORLD_H;
      }

      if (this.mode === 'title' || this.mode === 'paused' || this.mode === 'clear' || this.mode === 'victory') {
        Audio.updateTimeScale(0.15, false);
        return;
      }

      // Hitstop freeze frame for juicy impacts
      if (this.hitstop > 0) {
        this.hitstop -= realDt;
        this.updateEffects(realDt * 0.25);
        return;
      }

      if (this.mode === 'dead') {
        this.timeScale = lerp(this.timeScale, 0.08, 1 - Math.exp(-8 * realDt));
        this.updateEffects(realDt * 0.45);
        Audio.updateTimeScale(0.05, false);
        return;
      }

      if (this.mode === 'clearing') {
        this.timeScale = lerp(this.timeScale, 0.14, 1 - Math.exp(-10 * realDt));
        this.clearSlowMoTimer -= realDt;
        this.updateEffects(realDt * 0.5);
        Audio.updateTimeScale(0.25, true);
        if (this.clearSlowMoTimer <= 0) {
          this.finishStageClear();
        }
        return;
      }

      // --- PLAYING MODE ---
      const p = this.player;
      let moveX = 0;
      let moveY = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

      const isMoving = moveX !== 0 || moveY !== 0;
      const isFocusing = this.mouse.rightDown || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const isDashing = p.dashTimer > 0;

      // CORE SUPERHOT RULE: Time flows when you move, dash, or hold Focus!
      const targetScale = (isMoving || isDashing || isFocusing) ? 1.0 : MIN_TIME_SCALE;
      const lerpSpeed = targetScale > this.timeScale ? 16 : 11;
      this.timeScale = lerp(this.timeScale, targetScale, 1 - Math.exp(-lerpSpeed * realDt));

      const simDt = realDt * this.timeScale;
      this.stageTime += simDt;
      this.stageEntryGrace = Math.max(0, this.stageEntryGrace - simDt);

      Audio.updateTimeScale(this.timeScale, true);

      // Combo decay in simulation time
      if (this.combo > 0) {
        this.comboTimer -= simDt;
        if (this.comboTimer <= 0) {
          this.combo = 0;
          this.parryChain = 0;
        }
      }

      // Update Player
      this.updatePlayer(p, moveX, moveY, realDt, simDt);

      // Update Enemies
      this.updateEnemies(simDt);

      // Update Bullets
      this.updateBullets(simDt);

      // Update FX (visual particles run partially on realDt so frozen explosions still look alive!)
      this.updateEffects(realDt * (0.22 + 0.78 * this.timeScale));

      this.updateHud();
    }

    updatePlayer(p, moveX, moveY, realDt, simDt) {
      if (!p.alive) return;

      p.angle = Math.atan2(this.mouse.y - p.y, this.mouse.x - p.x);
      p.dashCooldown = Math.max(0, p.dashCooldown - simDt);
      p.invulnTimer = Math.max(0, p.invulnTimer - realDt);

      if (p.dashTimer > 0) {
        // Sub-stepped swept dash so fast dashes NEVER clip through walls or miss bullets
        const stepDt = Math.min(realDt, p.dashTimer);
        p.dashTimer = Math.max(0, p.dashTimer - realDt);
        const speed = DASH_DISTANCE / DASH_DURATION;
        const totalMove = speed * stepDt;
        const subSteps = 8;
        const prevX = p.x;
        const prevY = p.y;

        for (let s = 0; s < subSteps; s++) {
          p.x += p.dashDirX * (totalMove / subSteps);
          p.y += p.dashDirY * (totalMove / subSteps);
          for (let i = 0; i < this.walls.length; i++) {
            resolveCircleRect(p, this.walls[i]);
          }
        }

        // Cyan afterimage trail
        this.afterimages.push({
          x: p.x,
          y: p.y,
          angle: p.angle,
          r: p.r,
          color: '#00f0ff',
          alpha: 0.55
        });

        this.evaluateSlashHits(prevX, prevY, p.x, p.y, Math.atan2(p.dashDirY, p.dashDirX));
      } else {
        // Normal movement
        if (moveX !== 0 || moveY !== 0) {
          const len = Math.hypot(moveX, moveY);
          p.vx = (moveX / len) * PLAYER_SPEED;
          p.vy = (moveY / len) * PLAYER_SPEED;
          p.x += p.vx * simDt;
          p.y += p.vy * simDt;
        } else {
          p.vx = 0;
          p.vy = 0;
        }

        for (let i = 0; i < this.walls.length; i++) {
          resolveCircleRect(p, this.walls[i]);
        }
      }
    }

    updateEnemies(simDt) {
      const p = this.player;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.alive) continue;

        e.hitFlash = Math.max(0, e.hitFlash - simDt * 3);
        e.hitCooldown = Math.max(0, e.hitCooldown - simDt);

        if (e.type === 'boss') {
          this.updateBoss(e, simDt);
          continue;
        }

        const spec = ENEMY_SPECS[e.type];
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirToPlayer = Math.atan2(dy, dx);
        const seesPlayer = this.hasLineOfSight(e.x, e.y, p.x, p.y);

        // Smooth facing rotation (Shield & Sniper turn slightly slower so flanking works!)
        const turnSpeed = e.type === 'shield' ? 3.2 : e.type === 'sniper' ? 3.8 : 7.5;
        if (seesPlayer || e.type === 'rusher') {
          const diff = angleDiff(e.angle, dirToPlayer);
          e.angle += clamp(diff, -turnSpeed * simDt, turnSpeed * simDt);
        } else if (e.type === 'turret') {
          e.angle += 0.9 * simDt;
        }

        // Movement AI
        if (e.type === 'turret') {
          e.spinAngle += 1.4 * simDt;
        } else if (e.type === 'rusher') {
          // Aggressive flank / pursuit
          const moveAng = seesPlayer ? dirToPlayer : dirToPlayer + Math.sin(this.stageTime * 2 + e.id) * 0.65;
          e.x += Math.cos(moveAng) * spec.speed * simDt;
          e.y += Math.sin(moveAng) * spec.speed * simDt;

          if (Math.random() < simDt * 18) {
            this.afterimages.push({ x: e.x, y: e.y, angle: e.angle, r: e.r * 0.85, color: '#ff3b9a', alpha: 0.32 });
          }

          // Lethal melee contact with player (unless player has dash i-frames!)
          if (dist < e.r + p.r - 3 && p.invulnTimer <= 0) {
            this.damagePlayer('블레이드 암살자의 기습에 당했습니다');
            return;
          }
        } else {
          // Ranged unit spacing & strafing
          e.strafeTimer -= simDt;
          if (e.strafeTimer <= 0) {
            e.strafeDir *= -1;
            e.strafeTimer = 1.2 + Math.random() * 1.5;
          }

          if (seesPlayer) {
            let moveRadial = 0;
            if (dist > spec.preferredDist + 45) moveRadial = 1;
            else if (dist < spec.preferredDist - 55) moveRadial = -0.75;

            const strafeFactor = e.type === 'sniper' ? 0.25 : 0.65;
            const vx = (Math.cos(dirToPlayer) * moveRadial - Math.sin(dirToPlayer) * strafeFactor * e.strafeDir) * spec.speed;
            const vy = (Math.sin(dirToPlayer) * moveRadial + Math.cos(dirToPlayer) * strafeFactor * e.strafeDir) * spec.speed;
            e.x += vx * simDt;
            e.y += vy * simDt;
          } else {
            // Gently advance toward player if obscured
            e.x += Math.cos(dirToPlayer) * spec.speed * 0.55 * simDt;
            e.y += Math.sin(dirToPlayer) * spec.speed * 0.55 * simDt;
          }
        }

        // Resolve wall & enemy-enemy separation
        for (let w = 0; w < this.walls.length; w++) {
          resolveCircleRect(e, this.walls[w]);
        }
        for (let j = i + 1; j < this.enemies.length; j++) {
          const o = this.enemies[j];
          if (!o.alive) continue;
          const odx = e.x - o.x;
          const ody = e.y - o.y;
          const minD = e.r + o.r + 4;
          const d2 = odx * odx + ody * ody;
          if (d2 > 0.01 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const push = (minD - d) * 0.5;
            if (e.type !== 'turret' && e.type !== 'boss') {
              e.x += (odx / d) * push;
              e.y += (ody / d) * push;
            }
            if (o.type !== 'turret' && o.type !== 'boss') {
              o.x -= (odx / d) * push;
              o.y -= (ody / d) * push;
            }
          }
        }

        // Firing logic
        if (e.type === 'rusher' || this.stageEntryGrace > 0) continue;

        if (e.burstRemaining > 0) {
          e.burstDelay -= simDt;
          if (e.burstDelay <= 0) {
            this.fireEnemyWeapon(e);
            e.burstRemaining--;
            e.burstDelay = 0.13;
          }
          continue;
        }

        if (e.telegraphTimer > 0) {
          e.telegraphTimer -= simDt;
          if (e.telegraphTimer <= 0) {
            if (e.type === 'burst') {
              e.burstRemaining = 2;
              e.burstDelay = 0.13;
            }
            this.fireEnemyWeapon(e);
            e.fireCooldown = spec.fireRate * (0.88 + Math.random() * 0.24);
          }
        } else {
          e.fireCooldown -= simDt;
          if (e.fireCooldown <= 0 && seesPlayer) {
            e.telegraphTimer = spec.telegraph;
            if (e.type === 'sniper') {
              Audio.playSniperLock();
            }
          }
        }
      }
    }

    updateBoss(b, simDt) {
      const p = this.player;
      b.spinAngle += 1.6 * simDt;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dirToPlayer = Math.atan2(dy, dx);

      if (this.stageEntryGrace > 0) {
        b.angle = dirToPlayer;
        return;
      }

      b.bossTimer -= simDt;

      switch (b.bossPhase) {
        case 'idle': {
          b.angle = dirToPlayer;
          // Orbit slowly around arena center / player
          const orbitAng = dirToPlayer + Math.PI * 0.5;
          b.x += Math.cos(orbitAng) * 75 * simDt;
          b.y += Math.sin(orbitAng) * 75 * simDt;
          if (b.bossTimer <= 0) {
            const patterns = ['ring', 'snipers', 'charge_windup'];
            b.bossPhase = patterns[b.bossPatternIdx % patterns.length];
            b.bossPatternIdx++;
            if (b.bossPhase === 'ring') {
              b.bossTimer = 0.45;
            } else if (b.bossPhase === 'snipers') {
              b.bossTimer = 0.78;
              Audio.playSniperLock();
            } else {
              b.bossTimer = 0.65;
              b.bossChargeDirX = Math.cos(dirToPlayer);
              b.bossChargeDirY = Math.sin(dirToPlayer);
              b.angle = dirToPlayer;
              Audio.playSniperLock();
            }
          }
          break;
        }
        case 'ring': {
          b.angle += 3.2 * simDt;
          if (b.bossTimer <= 0) {
            const count = b.hp <= 2 ? 9 : 7;
            const base = dirToPlayer;
            for (let k = 0; k < count; k++) {
              const a = base + (k / count) * Math.PI * 2;
              this.spawnBullet(b.x + Math.cos(a) * (b.r + 6), b.y + Math.sin(a) * (b.r + 6), a, 275, '#ff335c', 6, false);
            }
            Audio.playEnemyFire('boss');
            this.shakeMag = Math.max(this.shakeMag, 5);
            b.bossPhase = 'idle';
            b.bossTimer = 1.15;
          }
          break;
        }
        case 'snipers': {
          // Track player gently during lock-on so player can read & parry/dodge
          const diff = angleDiff(b.angle, dirToPlayer);
          b.angle += clamp(diff, -1.2 * simDt, 1.2 * simDt);
          if (b.bossTimer <= 0) {
            const offsets = [-0.24, 0, 0.24];
            for (const off of offsets) {
              const a = b.angle + off;
              this.spawnBullet(b.x + Math.cos(a) * (b.r + 6), b.y + Math.sin(a) * (b.r + 6), a, 540, '#ff2ec4', 5.5, true);
            }
            Audio.playEnemyFire('sniper');
            this.shakeMag = Math.max(this.shakeMag, 7);
            b.bossPhase = 'idle';
            b.bossTimer = 1.25;
          }
          break;
        }
        case 'charge_windup': {
          // Lock aim during first half of windup, then hold steady for fair dodge
          if (b.bossTimer > 0.35) {
            b.bossChargeDirX = Math.cos(dirToPlayer);
            b.bossChargeDirY = Math.sin(dirToPlayer);
            b.angle = dirToPlayer;
          }
          if (b.bossTimer <= 0) {
            b.bossPhase = 'charging';
            b.bossTimer = 0.48;
            Audio.playSlash();
          }
          break;
        }
        case 'charging': {
          const chargeSpeed = 580;
          b.x += b.bossChargeDirX * chargeSpeed * simDt;
          b.y += b.bossChargeDirY * chargeSpeed * simDt;
          this.afterimages.push({ x: b.x, y: b.y, angle: b.angle, r: b.r, color: '#ff2356', alpha: 0.4 });

          if (dist < b.r + p.r - 4 && p.invulnTimer <= 0) {
            this.damagePlayer('크로노스 워든의 고속 돌진에 분쇄되었습니다');
            return;
          }

          let hitWall = false;
          for (let w = 0; w < this.walls.length; w++) {
            if (resolveCircleRect(b, this.walls[w])) hitWall = true;
          }
          if (hitWall || b.bossTimer <= 0) {
            b.bossPhase = 'stunned';
            b.bossTimer = 1.85;
            this.shakeMag = Math.max(this.shakeMag, 9);
            this.spawnShockwave(b.x, b.y, 20, 110, '#ffd447', 0.35);
            this.spawnPopup(b.x, b.y - 46, '경직! 지금 베어라!', '#00f0ff');
          }
          break;
        }
        case 'stunned': {
          if (b.bossTimer <= 0) {
            b.bossPhase = 'idle';
            b.bossTimer = 0.7;
          }
          break;
        }
      }

      for (let w = 0; w < this.walls.length; w++) {
        resolveCircleRect(b, this.walls[w]);
      }
    }

    fireEnemyWeapon(e) {
      const spec = ENEMY_SPECS[e.type];
      const muzzleX = e.x + Math.cos(e.angle) * (e.r + 8);
      const muzzleY = e.y + Math.sin(e.angle) * (e.r + 8);
      Audio.playEnemyFire(e.type);

      if (e.type === 'shotgun') {
        const pellets = 5;
        const spread = 0.42;
        for (let i = 0; i < pellets; i++) {
          const offset = -spread * 0.5 + (spread / (pellets - 1)) * i;
          this.spawnBullet(muzzleX, muzzleY, e.angle + offset, spec.bulletSpeed, '#ff7b29', 5, false);
        }
      } else if (e.type === 'sniper') {
        this.spawnBullet(muzzleX, muzzleY, e.angle, spec.bulletSpeed, '#ff2ec4', 5.5, true);
      } else if (e.type === 'turret') {
        this.spawnBullet(muzzleX, muzzleY, e.angle - 0.14, spec.bulletSpeed, '#ff5252', 5.5, false);
        this.spawnBullet(muzzleX, muzzleY, e.angle + 0.14, spec.bulletSpeed, '#ff5252', 5.5, false);
      } else {
        this.spawnBullet(muzzleX, muzzleY, e.angle, spec.bulletSpeed, spec.color, 5, false);
      }

      this.spawnParticles(muzzleX, muzzleY, '#ffe08a', 5, 60, 170);
    }

    spawnBullet(x, y, angle, speed, color, r, isSniper) {
      this.bullets.push({
        x,
        y,
        prevX: x,
        prevY: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r,
        color,
        isSniper,
        friendly: false,
        parried: false,
        pierce: 1,
        life: 3.4,
        alive: true
      });
    }

    updateBullets(simDt) {
      const p = this.player;
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        if (!b.alive) {
          this.bullets.splice(i, 1);
          continue;
        }

        b.prevX = b.x;
        b.prevY = b.y;
        b.x += b.vx * simDt;
        b.y += b.vy * simDt;
        b.life -= simDt;

        if (b.life <= 0) {
          b.alive = false;
          continue;
        }

        // Wall collision via segment sweep
        let wallHit = false;
        for (let w = 0; w < this.walls.length; w++) {
          const t = segmentRectHitT(b.prevX, b.prevY, b.x, b.y, this.walls[w]);
          if (t !== null) {
            const hx = lerp(b.prevX, b.x, t);
            const hy = lerp(b.prevY, b.y, t);
            this.spawnParticles(hx, hy, b.color, 6, 60, 200);
            b.alive = false;
            wallHit = true;
            break;
          }
        }
        if (wallHit) continue;

        if (b.friendly) {
          // Check hits against enemies!
          for (let j = 0; j < this.enemies.length; j++) {
            const e = this.enemies[j];
            if (!e.alive) continue;
            const hitR = e.r + b.r + 3;
            if (distPointToSegmentSq(e.x, e.y, b.prevX, b.prevY, b.x, b.y) <= hitR * hitR) {
              // Shield blocks parried bullets from front too, unless aimed behind them!
              if (e.type === 'shield') {
                const incomingFrom = Math.atan2(b.prevY - e.y, b.prevX - e.x);
                if (Math.abs(angleDiff(e.angle, incomingFrom)) < 1.1) {
                  Audio.playBlock();
                  this.spawnParticles(b.x, b.y, '#4ea8ff', 10, 120, 260);
                  this.spawnPopup(e.x, e.y - 24, 'SHIELD BLOCK', '#76c1ff');
                  b.alive = false;
                  break;
                }
              }

              this.damageEnemy(e, 1, Math.atan2(b.vy, b.vx), 'parry');
              b.pierce--;
              if (b.pierce <= 0) {
                b.alive = false;
                break;
              }
            }
          }
        } else {
          // Enemy bullet vs Player
          if (p.alive && p.invulnTimer <= 0) {
            const hitR = p.r + b.r - 4; // Forgiving player hurtbox
            if (distPointToSegmentSq(p.x, p.y, b.prevX, b.prevY, b.x, b.y) <= hitR * hitR) {
              b.alive = false;
              this.damagePlayer(b.isSniper ? '저격 레일건에 관통당했습니다' : '적의 에너지 탄환에 피격되었습니다');
              return;
            }
          }
        }
      }
    }

    // =========================================================================
    // Visual FX Updates
    // =========================================================================
    spawnParticles(x, y, color, count, minSpeed, maxSpeed) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = minSpeed + Math.random() * (maxSpeed - minSpeed);
        const life = 0.22 + Math.random() * 0.36;
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          r: 1.5 + Math.random() * 3.2,
          color,
          life,
          maxLife: life
        });
      }
    }

    spawnShockwave(x, y, startR, endR, color, duration) {
      this.shockwaves.push({ x, y, r: startR, startR, endR, color, life: duration, maxLife: duration });
    }

    spawnPopup(x, y, text, color) {
      this.popups.push({ x, y, vy: -46, text, color, life: 0.85, maxLife: 0.85 });
    }

    updateEffects(dt) {
      for (let i = this.slashes.length - 1; i >= 0; i--) {
        const s = this.slashes[i];
        s.life -= dt;
        if (s.life <= 0) this.slashes.splice(i, 1);
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= Math.pow(0.06, dt);
        pt.vy *= Math.pow(0.06, dt);
        pt.life -= dt;
        if (pt.life <= 0) this.particles.splice(i, 1);
      }
      for (let i = this.afterimages.length - 1; i >= 0; i--) {
        const a = this.afterimages[i];
        a.alpha -= dt * 2.3;
        if (a.alpha <= 0) this.afterimages.splice(i, 1);
      }
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.life -= dt;
        const prog = 1 - clamp(sw.life / sw.maxLife, 0, 1);
        sw.r = lerp(sw.startR, sw.endR, 1 - Math.pow(1 - prog, 3));
        if (sw.life <= 0) this.shockwaves.splice(i, 1);
      }
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const pop = this.popups[i];
        pop.y += pop.vy * dt;
        pop.life -= dt;
        if (pop.life <= 0) this.popups.splice(i, 1);
      }
    }

    // =========================================================================
    // HUD Updates
    // =========================================================================
    updateBossHud() {
      const boss = this.enemies.find((e) => e.type === 'boss');
      if (boss && this.mode !== 'title') {
        this.dom.hudBossBar.classList.remove('hidden');
        const hp = Math.max(0, boss.hp);
        this.dom.hudBossHpText.textContent = `${hp} / ${boss.maxHp}`;
        this.dom.hudBossHpFill.style.width = `${(hp / boss.maxHp) * 100}%`;

        if (this.dom.hudBossSegments.children.length !== boss.maxHp) {
          this.dom.hudBossSegments.innerHTML = '';
          for (let i = 0; i < boss.maxHp; i++) {
            const seg = document.createElement('span');
            seg.className = 'boss-seg';
            this.dom.hudBossSegments.appendChild(seg);
          }
        }
        for (let i = 0; i < boss.maxHp; i++) {
          this.dom.hudBossSegments.children[i].classList.toggle('active', i < hp);
        }
      } else {
        this.dom.hudBossBar.classList.add('hidden');
      }
    }

    updateHud() {
      const aliveCount = this.enemies.filter((e) => e.alive).length;
      this.dom.hudEnemies.textContent = String(aliveCount).padStart(2, '0');
      this.dom.hudParries.textContent = String(this.stageParries);
      this.dom.hudTime.textContent = `${this.stageTime.toFixed(2)}s`;

      const flowing = this.timeScale > 0.28;
      this.dom.hudTimeState.textContent = flowing ? 'TIME FLOW' : 'TIME FROZEN';
      this.dom.hudTimeRate.textContent = `${this.timeScale.toFixed(2)}x`;
      this.dom.hudTimePill.classList.toggle('active', flowing);
      this.dom.hudTimeBarFill.style.width = `${Math.max(4, this.timeScale * 100)}%`;

      this.dom.vignette.className = flowing ? 'vignette-active' : 'vignette-frozen';
      if (this.dom.visorCorners) {
        this.dom.visorCorners.classList.toggle('flowing', flowing);
      }

      if (this.player) {
        const pct = clamp(1 - this.player.dashCooldown / DASH_COOLDOWN, 0, 1);
        this.dom.hudDashFill.style.width = `${pct * 100}%`;
        const isReady = pct >= 0.999;
        this.dom.hudDashModule.classList.toggle('cooling', !isReady);
        if (isReady) {
          this.dom.hudDashLabel.textContent = 'READY';
          this.dom.hudDashLabel.className = 'dash-ready';
        } else {
          this.dom.hudDashLabel.textContent = `${Math.round(pct * 100)}%`;
          this.dom.hudDashLabel.className = 'dash-cooling';
        }

        // Update Chrono Shield HP pips
        this.dom.hudHpLabel.textContent = `${this.player.hp} / ${this.player.maxHp}`;
        this.dom.hudHpLabel.className = this.player.hp <= 1 ? 'accent-red' : 'dash-ready';
        if (this.dom.hudHpModule) {
          this.dom.hudHpModule.classList.toggle('critical', this.player.hp <= 1);
        }
        if (this.dom.hudHpPips.children.length !== this.player.maxHp) {
          this.dom.hudHpPips.innerHTML = '';
          for (let i = 0; i < this.player.maxHp; i++) {
            const pip = document.createElement('span');
            pip.className = 'hp-pip';
            this.dom.hudHpPips.appendChild(pip);
          }
        }
        for (let i = 0; i < this.player.maxHp; i++) {
          const pip = this.dom.hudHpPips.children[i];
          const active = i < this.player.hp;
          pip.className = 'hp-pip' + (active ? (this.player.hp === 1 ? ' low' : ' active') : '');
        }
      }

      if (this.combo >= 2) {
        this.dom.hudCombo.classList.remove('hidden');
        this.dom.hudComboValue.textContent = `${this.combo}x`;
        this.dom.hudComboBar.style.width = `${clamp((this.comboTimer / 2.6) * 100, 0, 100)}%`;
      } else {
        this.dom.hudCombo.classList.add('hidden');
      }
    }

    // =========================================================================
    // Canvas 2D Neon Renderer
    // =========================================================================
    getFlow() {
      return clamp((this.timeScale - MIN_TIME_SCALE) / (1 - MIN_TIME_SCALE), 0, 1);
    }

    // Cached soft radial glow sprite per color (fast additive light pools)
    getGlowSprite(color) {
      const key = /^#[0-9a-f]{6}$/i.test(color) ? color : '#00f0ff';
      let spr = this.glowSprites[key];
      if (spr) return spr;
      spr = document.createElement('canvas');
      spr.width = 128;
      spr.height = 128;
      const g = spr.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, key);
      grad.addColorStop(0.32, key + '66');
      grad.addColorStop(1, key + '00');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this.glowSprites[key] = spr;
      return spr;
    }

    render() {
      const ctx = this.ctx;
      const { dpr, width, height, scale, offsetX, offsetY } = this.view;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (this.mode === 'title') {
        this.renderTitleBackdrop(ctx, width, height);
        ctx.restore();
        return;
      }

      // Camera screen shake
      const sx = this.shakeMag > 0.2 ? (Math.random() - 0.5) * this.shakeMag * 2 : 0;
      const sy = this.shakeMag > 0.2 ? (Math.random() - 0.5) * this.shakeMag * 2 : 0;

      this.renderScreenBackdrop(ctx, width, height, sx, sy);

      ctx.translate(offsetX + sx, offsetY + sy);
      ctx.scale(scale, scale);

      this.ensureArenaCache();
      ctx.drawImage(this.arenaCache.floor, 0, 0, WORLD_W, WORLD_H);
      this.renderArenaDynamic(ctx);
      this.renderDecals(ctx);
      ctx.drawImage(this.arenaCache.walls, 0, 0, WORLD_W, WORLD_H);
      this.renderAfterimages(ctx);
      this.renderSniperLasers(ctx);
      this.renderEnemies(ctx);
      this.renderPlayer(ctx);
      this.renderSlashes(ctx);
      this.renderBullets(ctx);
      this.renderShockwaves(ctx);
      this.renderParticles(ctx);
      this.renderPopups(ctx);
      this.renderTimeOverlay(ctx);
      this.renderCrosshair(ctx);

      // Impact / Rewind screen flash
      if (this.flashAlpha > 0.005) {
        ctx.fillStyle = this.flashColor;
        ctx.globalAlpha = this.flashAlpha;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.globalAlpha = 1;
      }
      if (this.rewindFlash > 0.005) {
        ctx.fillStyle = '#00f0ff';
        ctx.globalAlpha = this.rewindFlash * 0.35;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Screen-space backdrop around the arena (halo + time-dilation rails)
    // -------------------------------------------------------------------------
    renderScreenBackdrop(ctx, w, h, shakeX, shakeY) {
      const flow = this.getFlow();
      const boss = !!this.stage.isBoss;

      const bg = ctx.createRadialGradient(w * 0.5, h * 0.52, 80, w * 0.5, h * 0.52, Math.max(w, h) * 0.78);
      bg.addColorStop(0, boss ? '#1d0b1f' : '#0e1936');
      bg.addColorStop(0.6, boss ? '#0c0511' : '#060c1c');
      bg.addColorStop(1, '#020409');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (!this.dotPattern) {
        const pc = document.createElement('canvas');
        pc.width = 22;
        pc.height = 22;
        const pg = pc.getContext('2d');
        pg.fillStyle = 'rgba(0, 240, 255, 0.12)';
        pg.fillRect(10, 10, 1.4, 1.4);
        this.dotPattern = ctx.createPattern(pc, 'repeat');
      }
      ctx.fillStyle = this.dotPattern;
      ctx.fillRect(0, 0, w, h);

      const { scale, offsetX, offsetY } = this.view;
      const ax = offsetX + shakeX;
      const ay = offsetY + shakeY;
      const aw = WORLD_W * scale;
      const ah = WORLD_H * scale;

      // Arena halo: cool cyan (or crimson for Boss) -> hot crimson while time flows
      const cr = Math.round(lerp(boss ? 210 : 0, 255, flow));
      const cg = Math.round(lerp(boss ? 42 : 195, 46, flow));
      const cb = Math.round(lerp(boss ? 82 : 255, 85, flow));
      ctx.save();
      ctx.shadowColor = `rgba(${cr}, ${cg}, ${cb}, ${0.26 + flow * 0.16})`;
      ctx.shadowBlur = 74;
      ctx.fillStyle = '#04070f';
      ctx.fillRect(ax, ay, aw, ah);
      ctx.restore();

      // Side telemetry rails: indicator always maps icy cyan (frozen) -> crimson (flowing)
      const mr = Math.round(lerp(0, 255, flow));
      const mg = Math.round(lerp(220, 46, flow));
      const mb = Math.round(lerp(255, 85, flow));
      const col = `rgb(${mr}, ${mg}, ${mb})`;
      const gap = 14;
      ctx.save();
      ctx.strokeStyle = boss ? 'rgba(255, 70, 105, 0.25)' : 'rgba(0, 240, 255, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0, y = 0; y <= ah; y += 12, i++) {
        const len = i % 5 === 0 ? 10 : 4;
        ctx.moveTo(ax - gap, ay + y);
        ctx.lineTo(ax - gap - len, ay + y);
        ctx.moveTo(ax + aw + gap, ay + y);
        ctx.lineTo(ax + aw + gap + len, ay + y);
      }
      ctx.stroke();

      const my = ay + ah * (1 - flow);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax - gap + 1, my);
      ctx.lineTo(ax - gap + 1, ay + ah);
      ctx.moveTo(ax + aw + gap - 1, my);
      ctx.lineTo(ax + aw + gap - 1, ay + ah);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      for (const side of [-1, 1]) {
        const tipX = side < 0 ? ax - gap + 3 : ax + aw + gap - 3;
        const baseX = side < 0 ? tipX - 13 : tipX + 13;
        ctx.beginPath();
        ctx.moveTo(tipX, my);
        ctx.lineTo(baseX, my - 6);
        ctx.lineTo(baseX, my + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      if (ax > 70) {
        ctx.font = '700 10px "Cascadia Code", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.translate(ax - gap - 28, ay + ah * 0.5);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = flow > 0.4 ? 'rgba(255, 110, 138, 0.52)' : 'rgba(0, 240, 255, 0.44)';
        ctx.fillText(`TIME DILATION  ·  ${this.timeScale.toFixed(2)}x`, 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(ax + aw + gap + 28, ay + ah * 0.5);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = boss ? 'rgba(255, 100, 130, 0.52)' : 'rgba(0, 240, 255, 0.44)';
        ctx.fillText(`${boss ? 'FINAL BOSS' : 'SECTOR ' + this.stage.code}  ·  ${this.stage.titleEn}`, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Static arena layers cached per stage / resolution (floor + walls)
    // -------------------------------------------------------------------------
    ensureArenaCache() {
      const { scale, dpr } = this.view;
      const key = `${this.stage.id}|${scale.toFixed(4)}|${dpr}`;
      if (this.arenaCache && this.arenaCache.key === key) return;
      const res = scale * dpr;
      const make = () => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(WORLD_W * res));
        c.height = Math.max(1, Math.ceil(WORLD_H * res));
        const g = c.getContext('2d');
        g.scale(c.width / WORLD_W, c.height / WORLD_H);
        return [c, g];
      };
      const [floor, fctx] = make();
      this.paintFloor(fctx);
      const [walls, wctx] = make();
      this.paintWalls(wctx);
      this.arenaCache = { key, floor, walls };
    }

    paintFloor(ctx) {
      const boss = !!this.stage.isBoss;
      const A = boss ? '255, 46, 85' : '0, 240, 255';
      const x0 = WALL_T;
      const y0 = WALL_T;
      const x1 = WORLD_W - WALL_T;
      const y1 = WORLD_H - WALL_T;

      const base = ctx.createRadialGradient(WORLD_W * 0.5, WORLD_H * 0.5, 30, WORLD_W * 0.5, WORLD_H * 0.5, WORLD_W * 0.62);
      base.addColorStop(0, boss ? '#1b0c22' : '#0f1b38');
      base.addColorStop(1, boss ? '#08040d' : '#060a17');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      // Checker floor panels with micro bevel
      const cell = 60;
      for (let gx = 0, x = x0; x < x1; x += cell, gx++) {
        for (let gy = 0, y = y0; y < y1; y += cell, gy++) {
          const cw = Math.min(cell, x1 - x);
          const ch = Math.min(cell, y1 - y);
          if ((gx + gy) % 2 === 0) {
            ctx.fillStyle = `rgba(${A}, 0.025)`;
            ctx.fillRect(x, y, cw, ch);
          }
          ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
          ctx.fillRect(x + 1, y + 1, cw - 2, 1);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
          ctx.fillRect(x + 1, y + ch - 2, cw - 2, 1);
        }
      }

      // Minor + major grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${A}, 0.065)`;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += cell) { ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); }
      for (let y = y0; y <= y1; y += cell) { ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); }
      ctx.stroke();

      ctx.strokeStyle = `rgba(${A}, 0.12)`;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += cell * 4) { ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); }
      for (let y = y0; y <= y1; y += cell * 4) { ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); }
      ctx.stroke();

      // Crosshair marks at major intersections
      ctx.strokeStyle = `rgba(${A}, 0.36)`;
      ctx.beginPath();
      for (let x = x0 + cell * 2; x < x1; x += cell * 2) {
        for (let y = y0 + cell * 2; y < y1; y += cell * 2) {
          ctx.moveTo(x - 4, y + 0.5); ctx.lineTo(x + 5, y + 0.5);
          ctx.moveTo(x + 0.5, y - 4); ctx.lineTo(x + 0.5, y + 5);
        }
      }
      ctx.stroke();

      // Inner edge glow
      const eg = 52;
      let g = ctx.createLinearGradient(0, y0, 0, y0 + eg);
      g.addColorStop(0, `rgba(${A}, 0.11)`);
      g.addColorStop(1, `rgba(${A}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, eg);
      g = ctx.createLinearGradient(0, y1, 0, y1 - eg);
      g.addColorStop(0, `rgba(${A}, 0.11)`);
      g.addColorStop(1, `rgba(${A}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y1 - eg, x1 - x0, eg);
      g = ctx.createLinearGradient(x0, 0, x0 + eg, 0);
      g.addColorStop(0, `rgba(${A}, 0.11)`);
      g.addColorStop(1, `rgba(${A}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, eg, y1 - y0);
      g = ctx.createLinearGradient(x1, 0, x1 - eg, 0);
      g.addColorStop(0, `rgba(${A}, 0.11)`);
      g.addColorStop(1, `rgba(${A}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x1 - eg, y0, eg, y1 - y0);

      // Corner floor brackets
      const ins = 14;
      const len = 34;
      ctx.strokeStyle = `rgba(${A}, 0.48)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 + ins, y0 + ins + len); ctx.lineTo(x0 + ins, y0 + ins); ctx.lineTo(x0 + ins + len, y0 + ins);
      ctx.moveTo(x1 - ins - len, y0 + ins); ctx.lineTo(x1 - ins, y0 + ins); ctx.lineTo(x1 - ins, y0 + ins + len);
      ctx.moveTo(x0 + ins, y1 - ins - len); ctx.lineTo(x0 + ins, y1 - ins); ctx.lineTo(x0 + ins + len, y1 - ins);
      ctx.moveTo(x1 - ins - len, y1 - ins); ctx.lineTo(x1 - ins, y1 - ins); ctx.lineTo(x1 - ins, y1 - ins - len);
      ctx.stroke();

      // Deploy pad under player spawn
      const sp = this.stage.player;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI * 0.5;
        ctx.moveTo(Math.cos(a) * 44, Math.sin(a) * 44);
        ctx.lineTo(Math.cos(a) * 52, Math.sin(a) * 52);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 240, 255, 0.42)';
      ctx.font = '700 9px "Cascadia Code", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DEPLOY', 0, 64);
      ctx.restore();
    }

    paintWalls(ctx) {
      const boss = !!this.stage.isBoss;
      const A = boss ? '255, 46, 85' : '0, 240, 255';
      const accent = boss ? '#ff2e55' : '#00e8ff';
      const inner = this.walls.filter((w) => !w.outer);
      const outer = this.walls.filter((w) => w.outer);
      const x0 = WALL_T;
      const y0 = WALL_T;
      const x1 = WORLD_W - WALL_T;
      const y1 = WORLD_H - WALL_T;

      // 1) Soft cast shadows (interior blocks + outer frame lip)
      ctx.save();
      ctx.filter = 'blur(6px)';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      for (const w of inner) ctx.fillRect(w.x + 6, w.y + 9, w.w, w.h);
      ctx.restore();
      const sh = 22;
      let g = ctx.createLinearGradient(0, y0, 0, y0 + sh);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, sh);
      g = ctx.createLinearGradient(x0, 0, x0 + sh, 0);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, sh, y1 - y0);

      // 2) Outer armored frame with hazard hatching
      for (const w of outer) {
        const fg = ctx.createLinearGradient(w.x, w.y, w.x + w.w, w.y + w.h);
        fg.addColorStop(0, boss ? '#1d0c1a' : '#0c152b');
        fg.addColorStop(1, boss ? '#120610' : '#101d38');
        ctx.fillStyle = fg;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(w.x, w.y, w.w, w.h);
        ctx.clip();
        ctx.strokeStyle = `rgba(${A}, 0.075)`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let d = -WORLD_H; d < WORLD_W + WORLD_H; d += 16) {
          ctx.moveTo(d, 0);
          ctx.lineTo(d + WORLD_H, WORLD_H);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Ruler ticks along the inner edge
      ctx.strokeStyle = `rgba(${A}, 0.36)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0, x = x0; x <= x1; x += 30, i++) {
        const l = i % 5 === 0 ? 10 : 5;
        ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y0 - l);
        ctx.moveTo(x + 0.5, y1); ctx.lineTo(x + 0.5, y1 + l);
      }
      for (let i = 0, y = y0; y <= y1; y += 30, i++) {
        const l = i % 5 === 0 ? 10 : 5;
        ctx.moveTo(x0, y + 0.5); ctx.lineTo(x0 - l, y + 0.5);
        ctx.moveTo(x1, y + 0.5); ctx.lineTo(x1 + l, y + 0.5);
      }
      ctx.stroke();

      // Neon frame lines
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = `rgba(${A}, 0.85)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
      ctx.restore();
      ctx.strokeStyle = `rgba(${A}, 0.36)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);

      // Corner caps
      const corners = [[0, 0], [WORLD_W - WALL_T, 0], [0, WORLD_H - WALL_T], [WORLD_W - WALL_T, WORLD_H - WALL_T]];
      for (const [cx, cy] of corners) {
        ctx.fillStyle = `rgba(${A}, 0.16)`;
        ctx.fillRect(cx + 4, cy + 4, WALL_T - 8, WALL_T - 8);
        ctx.strokeStyle = `rgba(${A}, 0.65)`;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx + 4.5, cy + 4.5, WALL_T - 9, WALL_T - 9);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx + WALL_T / 2, cy + WALL_T / 2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Frame label plates
      ctx.save();
      ctx.font = '700 11px "Cascadia Code", "Consolas", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const label = `${boss ? 'FINAL BOSS' : 'SECTOR ' + this.stage.code}  //  ${this.stage.titleEn}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = boss ? '#1c0813' : '#081020';
      ctx.fillRect(60, 6, tw + 26, WALL_T - 12);
      ctx.fillStyle = accent;
      ctx.fillRect(60, 6, 3, WALL_T - 12);
      ctx.fillStyle = `rgba(${A}, 0.84)`;
      ctx.fillText(label, 72, WALL_T / 2 + 0.5);
      ctx.textAlign = 'right';
      const foot = 'CHRONO.OS // TACTICAL GRID 1200x720';
      const fw = ctx.measureText(foot).width;
      ctx.fillStyle = boss ? '#1c0813' : '#081020';
      ctx.fillRect(WORLD_W - 72 - fw, WORLD_H - WALL_T + 6, fw + 24, WALL_T - 12);
      ctx.fillStyle = `rgba(${A}, 0.55)`;
      ctx.fillText(foot, WORLD_W - 60, WORLD_H - WALL_T / 2 + 0.5);
      ctx.restore();

      // 3) Interior cover blocks: beveled 3/4 extrusion (collision footprint unchanged)
      for (const w of inner) {
        const depth = Math.min(7, w.h * 0.25);
        const topH = w.h - depth;
        const tg = ctx.createLinearGradient(w.x, w.y, w.x, w.y + topH);
        tg.addColorStop(0, boss ? '#3f1633' : '#213a66');
        tg.addColorStop(1, boss ? '#260d20' : '#142444');
        ctx.fillStyle = tg;
        ctx.fillRect(w.x, w.y, w.w, topH);
        ctx.fillStyle = boss ? '#12060f' : '#0a1326';
        ctx.fillRect(w.x, w.y + topH, w.w, depth);

        // Hazard stripes on the south face
        ctx.save();
        ctx.beginPath();
        ctx.rect(w.x, w.y + topH, w.w, depth);
        ctx.clip();
        ctx.strokeStyle = `rgba(${A}, 0.22)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let d = w.x - depth; d < w.x + w.w; d += 8) {
          ctx.moveTo(d, w.y + w.h);
          ctx.lineTo(d + depth, w.y + topH);
        }
        ctx.stroke();
        ctx.restore();

        // Inset plate
        if (w.w > 22 && topH > 22) {
          ctx.strokeStyle = `rgba(${A}, 0.22)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(w.x + 5.5, w.y + 5.5, w.w - 11, topH - 11);
        }

        // Circuit trace with nodes
        if (w.w >= 60 || topH >= 60) {
          ctx.strokeStyle = `rgba(${A}, 0.36)`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          let n1;
          let n2;
          if (w.w >= topH) {
            const yy = w.y + topH * 0.5;
            const ax1 = w.x + 12;
            const ax2 = w.x + w.w - 12;
            const mid = w.x + w.w * 0.42;
            ctx.moveTo(ax1, yy + 3);
            ctx.lineTo(mid, yy + 3);
            ctx.lineTo(mid + 6, yy - 3);
            ctx.lineTo(ax2, yy - 3);
            n1 = [ax1, yy + 3];
            n2 = [ax2, yy - 3];
          } else {
            const xx = w.x + w.w * 0.5;
            const ay1 = w.y + 12;
            const ay2 = w.y + topH - 12;
            const mid = w.y + topH * 0.42;
            ctx.moveTo(xx - 3, ay1);
            ctx.lineTo(xx - 3, mid);
            ctx.lineTo(xx + 3, mid + 6);
            ctx.lineTo(xx + 3, ay2);
            n1 = [xx - 3, ay1];
            n2 = [xx + 3, ay2];
          }
          ctx.stroke();
          ctx.fillStyle = `rgba(${A}, 0.74)`;
          ctx.beginPath();
          ctx.arc(n1[0], n1[1], 2.1, 0, Math.PI * 2);
          ctx.arc(n2[0], n2[1], 2.1, 0, Math.PI * 2);
          ctx.fill();
        }

        // Neon rim + highlights
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = 11;
        ctx.strokeStyle = `rgba(${A}, 0.84)`;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(w.x + 0.8, w.y + 0.8, w.w - 1.6, w.h - 1.6);
        ctx.restore();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
        ctx.fillRect(w.x + 2, w.y + 1.5, w.w - 4, 1);
        ctx.fillStyle = `rgba(${A}, 0.48)`;
        ctx.fillRect(w.x + 1, w.y + topH, w.w - 2, 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillRect(w.x + 3, w.y + 3, 2, 2);
        ctx.fillRect(w.x + w.w - 5, w.y + 3, 2, 2);
        if (topH > 12) {
          ctx.fillRect(w.x + 3, w.y + topH - 5, 2, 2);
          ctx.fillRect(w.x + w.w - 5, w.y + topH - 5, 2, 2);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Dynamic floor layer: sim-time chrono dial, watermark, hint plate, motes
    // -------------------------------------------------------------------------
    renderArenaDynamic(ctx) {
      const flow = this.getFlow();
      const boss = !!this.stage.isBoss;
      const A = boss ? '255, 46, 85' : '0, 240, 255';
      const cx = WORLD_W * 0.5;
      const cy = WORLD_H * 0.5;

      if (flow > 0.01) {
        ctx.fillStyle = `rgba(255, 46, 85, ${flow * 0.04})`;
        ctx.fillRect(WALL_T, WALL_T, WORLD_W - WALL_T * 2, WORLD_H - WALL_T * 2);
      }

      // Central chrono dial - hand & gear ring freeze when you stand still
      const R = 168;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${A}, 0.08)`;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R - 26, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const r0 = i % 5 === 0 ? R - 18 : R - 8;
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2));
      }
      ctx.strokeStyle = `rgba(${A}, ${0.1 + flow * 0.07})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      ctx.rotate(this.stageTime * 0.35);
      ctx.setLineDash([26, 18]);
      ctx.strokeStyle = `rgba(${A}, 0.075)`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, R + 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const handA = -Math.PI / 2 + this.stageTime * (Math.PI * 2 / 6);
      if (ctx.createConicGradient) {
        const span = 1.4 / (Math.PI * 2);
        const cgr = ctx.createConicGradient(handA - 1.4, 0, 0);
        cgr.addColorStop(0, `rgba(${A}, 0)`);
        cgr.addColorStop(span, `rgba(${A}, ${0.08 + flow * 0.08})`);
        cgr.addColorStop(span + 0.0005, `rgba(${A}, 0)`);
        cgr.addColorStop(1, `rgba(${A}, 0)`);
        ctx.fillStyle = cgr;
        ctx.beginPath();
        ctx.arc(0, 0, R - 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${A}, ${0.2 + flow * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(handA) * (R - 6), Math.sin(handA) * (R - 6));
      ctx.stroke();
      ctx.fillStyle = `rgba(${A}, 0.32)`;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Holographic stage watermark
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${A}, 0.065)`;
      ctx.font = '900 120px "Bahnschrift", "Consolas", monospace';
      ctx.fillText(this.stage.code, cx, cy + 4);
      ctx.restore();

      // Floor tutorial hint on a chamfered plate
      if (this.stage.floorHint) {
        ctx.save();
        ctx.font = '700 13.5px "Pretendard", "Malgun Gothic", sans-serif';
        const tw = ctx.measureText(this.stage.floorHint).width;
        const pw = tw + 44;
        const ph = 28;
        const px = cx - pw / 2;
        const py = WORLD_H - WALL_T - 16 - ph;
        ctx.beginPath();
        ctx.moveTo(px + 10, py);
        ctx.lineTo(px + pw, py);
        ctx.lineTo(px + pw, py + ph - 10);
        ctx.lineTo(px + pw - 10, py + ph);
        ctx.lineTo(px, py + ph);
        ctx.lineTo(px, py + 10);
        ctx.closePath();
        ctx.fillStyle = 'rgba(4, 10, 22, 0.72)';
        ctx.fill();
        ctx.strokeStyle = `rgba(${A}, 0.3)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = `rgba(${A}, 0.8)`;
        ctx.save();
        ctx.translate(px + 15, py + ph / 2);
        ctx.rotate(Math.PI * 0.25);
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
        ctx.fillStyle = 'rgba(198, 240, 255, 0.74)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.stage.floorHint, cx + 8, py + ph / 2 + 1);
        ctx.restore();
      }

      for (const m of this.ambientMotes) {
        ctx.fillStyle = `rgba(120, 230, 255, ${m.alpha})`;
        ctx.fillRect(m.x, m.y, m.size, m.size);
      }
    }

    // Stasis scanline when frozen + kinetic speed streaks when moving fast
    renderTimeOverlay(ctx) {
      if (this.mode !== 'playing' && this.mode !== 'paused') return;
      const flow = this.getFlow();
      const frozen = 1 - flow;

      ctx.save();
      ctx.beginPath();
      ctx.rect(WALL_T, WALL_T, WORLD_W - WALL_T * 2, WORLD_H - WALL_T * 2);
      ctx.clip();

      if (frozen > 0.08) {
        const span = WORLD_H + 200;
        const y = ((this.globalClock * 70) % span) - 100;
        const g = ctx.createLinearGradient(0, y - 70, 0, y + 70);
        g.addColorStop(0, 'rgba(0, 240, 255, 0)');
        g.addColorStop(0.5, `rgba(0, 240, 255, ${0.045 * frozen})`);
        g.addColorStop(1, 'rgba(0, 240, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y - 70, WORLD_W, 140);
        ctx.fillStyle = `rgba(160, 250, 255, ${0.14 * frozen})`;
        ctx.fillRect(0, y, WORLD_W, 1);
      }

      if (flow > 0.55) {
        const intensity = (flow - 0.55) / 0.45;
        ctx.strokeStyle = `rgba(255, 80, 118, ${0.14 * intensity})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + Math.floor(this.globalClock * 18) * 0.17;
          const r1 = 560;
          const r2 = 660;
          ctx.moveTo(WORLD_W * 0.5 + Math.cos(a) * r1, WORLD_H * 0.5 + Math.sin(a) * r1);
          ctx.lineTo(WORLD_W * 0.5 + Math.cos(a) * r2, WORLD_H * 0.5 + Math.sin(a) * r2);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    renderTitleBackdrop(ctx, w, h) {
      const t = this.globalClock;

      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      bgGrad.addColorStop(0, '#12234b');
      bgGrad.addColorStop(0.55, '#070e22');
      bgGrad.addColorStop(1, '#02040a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Slowly drifting tactical grid
      const gridSize = 54;
      const driftX = (t * 12) % gridSize;
      const driftY = (t * 8) % gridSize;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.065)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -gridSize + driftX; x < w + gridSize; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = -gridSize + driftY; y < h + gridSize; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Giant chrono dial with a hesitating second hand
      const cx = w * 0.5;
      const cy = h * 0.47;
      const R = Math.max(w, h) * 0.38;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.26)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 0, R - 40, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const r0 = i % 5 === 0 ? R - 26 : R - 11;
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3));
      }
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.34)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 240, 255, 0.3)';
      ctx.font = '800 22px "Bahnschrift", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const numerals = ['XII', 'III', 'VI', 'IX'];
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 2;
        ctx.fillText(numerals[k], Math.cos(a) * (R - 62), Math.sin(a) * (R - 62));
      }

      const secT = t * 0.9;
      const whole = Math.floor(secT);
      const frac = secT - whole;
      const ease = frac < 0.18 ? 1 - Math.pow(1 - frac / 0.18, 3) : 1;
      const secA = -Math.PI / 2 + (whole + ease) * (Math.PI * 2 / 60);
      const minA = -Math.PI / 2 + 1.1 + t * 0.012;
      const hourA = -Math.PI / 2 + 3.4 + t * 0.001;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(hourA) * R * 0.5, Math.sin(hourA) * R * 0.5);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(minA) * R * 0.78, Math.sin(minA) * R * 0.78);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 46, 85, 0.75)';
      ctx.lineWidth = 2.8;
      ctx.shadowColor = '#ff2e55';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(secA) * R * 0.14, -Math.sin(secA) * R * 0.14);
      ctx.lineTo(Math.cos(secA) * R * 0.94, Math.sin(secA) * R * 0.94);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.save();
      ctx.rotate(t * 0.14);
      ctx.setLineDash([20, 14]);
      ctx.strokeStyle = 'rgba(255, 46, 85, 0.34)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, R + 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-t * 0.09);
      ctx.setLineDash([6, 18]);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.restore();

      // Synthwave perspective floor
      const horizon = h * 0.72;
      const fg = ctx.createLinearGradient(0, horizon, 0, h);
      fg.addColorStop(0, 'rgba(0, 45, 85, 0.04)');
      fg.addColorStop(1, 'rgba(0, 110, 155, 0.32)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, horizon, w, h - horizon);
      const hg = ctx.createLinearGradient(0, horizon - 120, 0, horizon + 4);
      hg.addColorStop(0, 'rgba(255, 46, 85, 0)');
      hg.addColorStop(1, 'rgba(255, 46, 85, 0.2)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, horizon - 120, w, 124);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, horizon, w, h - horizon);
      ctx.clip();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.24)';
      ctx.beginPath();
      const vpx = w * 0.5;
      const spacing = w / 12;
      for (let i = -24; i <= 24; i++) {
        ctx.moveTo(vpx + i * spacing * 0.08, horizon);
        ctx.lineTo(vpx + i * spacing, h);
      }
      ctx.stroke();
      const rows = 14;
      const phase = (t * 0.22) % 1;
      for (let k = 0; k < rows; k++) {
        const z = (k + phase) / rows;
        const y = horizon + (h - horizon) * z * z;
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.06 + z * 0.32})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      const hl = ctx.createLinearGradient(0, 0, w, 0);
      hl.addColorStop(0, 'rgba(0, 240, 255, 0)');
      hl.addColorStop(0.28, 'rgba(0, 240, 255, 0.72)');
      hl.addColorStop(0.5, 'rgba(255, 255, 255, 0.92)');
      hl.addColorStop(0.72, 'rgba(255, 46, 85, 0.72)');
      hl.addColorStop(1, 'rgba(255, 46, 85, 0)');
      ctx.fillStyle = hl;
      ctx.fillRect(0, horizon - 1, w, 2);

      // Suspended slow-motion crimson & gold bullet tracers
      const tracers = [
        { x: 0.11, y: 0.20, ang: 0.22, len: 140, color: '#ff2e55', spd: 14 },
        { x: 0.87, y: 0.17, ang: 2.86, len: 150, color: '#ff2e55', spd: 12 },
        { x: 0.08, y: 0.77, ang: -0.32, len: 155, color: '#ffd447', spd: 18 },
        { x: 0.90, y: 0.76, ang: -2.75, len: 145, color: '#00f0ff', spd: 16 },
        { x: 0.20, y: 0.88, ang: -0.18, len: 115, color: '#ff4fd8', spd: 11 },
        { x: 0.79, y: 0.11, ang: 2.95, len: 120, color: '#ffd447', spd: 15 },
        { x: 0.15, y: 0.50, ang: 0.08, len: 125, color: '#00f0ff', spd: 13 },
        { x: 0.85, y: 0.52, ang: 3.04, len: 130, color: '#ff2e55', spd: 14 }
      ];
      for (let i = 0; i < tracers.length; i++) {
        const tr = tracers[i];
        const drift = (t * tr.spd) % 90;
        const bx = w * tr.x + Math.cos(tr.ang) * drift;
        const by = h * tr.y + Math.sin(tr.ang) * drift;
        const tx = bx - Math.cos(tr.ang) * tr.len;
        const ty = by - Math.sin(tr.ang) * tr.len;

        ctx.save();
        const grad = ctx.createLinearGradient(tx, ty, bx, by);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, tr.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.globalAlpha = 0.45 + Math.sin(t * 3 + i) * 0.18;
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, by, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.shadowColor = tr.color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Floating frozen geometric crystal shards
      if (this.titleShards) {
        ctx.save();
        ctx.lineWidth = 1.3;
        for (const s of this.titleShards) {
          const px = ((s.x * w + t * s.vx) % (w + 60) + (w + 60)) % (w + 60) - 30;
          const py = ((s.y * h + t * s.vy) % (h + 60) + (h + 60)) % (h + 60) - 30;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(s.rot + t * s.vr);
          ctx.globalAlpha = 0.45;
          ctx.strokeStyle = s.color;
          ctx.fillStyle = s.color + '28';
          ctx.beginPath();
          ctx.moveTo(s.size, 0);
          ctx.lineTo(-s.size * 0.6, -s.size * 0.5);
          ctx.lineTo(-s.size * 0.3, s.size * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }

      for (const m of this.ambientMotes) {
        const mx = (m.x / WORLD_W) * w;
        const my = (m.y / WORLD_H) * h;
        ctx.fillStyle = `rgba(0, 240, 255, ${m.alpha * 0.95})`;
        ctx.fillRect(mx, my, m.size, m.size);
      }

      // Periodic full-screen luminous katana slash streak
      const period = 6.2;
      const ph = (t + 4.8) % period;
      if (ph < 0.78) {
        const grow = clamp(ph / 0.16, 0, 1);
        const fade = ph < 0.16 ? 1 : 1 - (ph - 0.16) / 0.62;
        const x1 = -w * 0.05;
        const y1 = h * 0.84;
        const x2 = w * 1.05;
        const y2 = h * 0.16;
        const k = 1 - Math.pow(1 - grow, 3);
        const ex = lerp(x1, x2, k);
        const ey = lerp(y1, y2, k);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.globalAlpha = fade * 0.5;
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 18 * fade + 2;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 32;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (grow < 1) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(ex, ey, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Soft edge vignette
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.38, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.52)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    renderDecals(ctx) {
      for (const d of this.decals) {
        ctx.save();
        ctx.globalAlpha = d.alpha;
        if (d.type === 'slash') {
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y1);
          ctx.lineTo(d.x2, d.y2);
          ctx.stroke();
          ctx.globalAlpha = d.alpha * 0.28;
          ctx.lineWidth = 11;
          ctx.stroke();
        } else if (d.type === 'kill') {
          ctx.translate(d.x, d.y);
          ctx.globalAlpha = d.alpha * 0.38;
          ctx.drawImage(this.getGlowSprite(d.color), -d.r * 2.2, -d.r * 2.2, d.r * 4.4, d.r * 4.4);
          ctx.globalAlpha = d.alpha;
          ctx.rotate(d.angle);
          ctx.fillStyle = d.color;
          // Two split neon shards left on the floor
          ctx.beginPath();
          ctx.moveTo(-d.r, -4);
          ctx.lineTo(d.r * 0.8, -10);
          ctx.lineTo(d.r * 0.3, -2);
          ctx.closePath();
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(-d.r * 0.7, 5);
          ctx.lineTo(d.r, 11);
          ctx.lineTo(d.r * 0.2, 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }

    renderAfterimages(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const a of this.afterimages) {
        // Subtle crimson chromatic echo behind the cyan dash ghost
        ctx.save();
        ctx.globalAlpha = a.alpha * 0.42;
        ctx.translate(a.x - Math.cos(a.angle) * 5, a.y - Math.sin(a.angle) * 5);
        ctx.rotate(a.angle);
        ctx.fillStyle = '#ff2e55';
        ctx.beginPath();
        ctx.moveTo(a.r + 4, 0);
        ctx.lineTo(-a.r * 0.85, -a.r * 0.75);
        ctx.lineTo(-a.r * 0.45, 0);
        ctx.lineTo(-a.r * 0.85, a.r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = a.alpha;
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.moveTo(a.r + 4, 0);
        ctx.lineTo(-a.r * 0.85, -a.r * 0.75);
        ctx.lineTo(-a.r * 0.45, 0);
        ctx.lineTo(-a.r * 0.85, a.r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    renderSniperLasers(ctx) {
      for (const e of this.enemies) {
        if (!e.alive) continue;

        if (e.type === 'sniper') {
          const hit = this.raycastWalls(e.x, e.y, e.angle, 1500);
          const locking = e.telegraphTimer > 0;
          ctx.save();
          if (locking) {
            ctx.strokeStyle = 'rgba(255, 46, 196, 0.3)';
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(hit.x, hit.y);
            ctx.stroke();
          }
          ctx.strokeStyle = locking ? '#ffffff' : 'rgba(255, 46, 196, 0.46)';
          ctx.lineWidth = locking ? 2.6 : 1.3;
          if (!locking) ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(hit.x, hit.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = locking ? '#ffffff' : 'rgba(255, 46, 196, 0.7)';
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, locking ? 4.2 : 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (e.type === 'boss' && e.bossPhase === 'snipers') {
          const offsets = [-0.22, 0, 0.22];
          const flash = e.bossTimer < 0.2;
          for (const off of offsets) {
            const hit = this.raycastWalls(e.x, e.y, e.angle + off, 1500);
            ctx.save();
            ctx.strokeStyle = flash ? '#ffffff' : 'rgba(255, 46, 196, 0.65)';
            ctx.lineWidth = flash ? 3 : 1.6;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(hit.x, hit.y);
            ctx.stroke();
            ctx.restore();
          }
        } else if (e.type === 'boss' && e.bossPhase === 'charge_windup') {
          const hit = this.raycastWalls(e.x, e.y, Math.atan2(e.bossChargeDirY, e.bossChargeDirX), 900);
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 50, 90, 0.55)';
          ctx.lineWidth = 22;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(hit.x, hit.y);
          ctx.stroke();
          ctx.strokeStyle = '#ffd447';
          ctx.lineWidth = 2;
          ctx.setLineDash([12, 8]);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(hit.x, hit.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    renderEnemies(ctx) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const spec = ENEMY_SPECS[e.type];

        // Ground light pool (additive sprite)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.type === 'boss' ? 0.46 : 0.32;
        const gr = e.r * (e.type === 'boss' ? 3.5 : 2.75);
        ctx.drawImage(this.getGlowSprite(spec.color), e.x - gr, e.y - gr, gr * 2, gr * 2);
        ctx.restore();

        ctx.save();
        ctx.translate(e.x, e.y);

        // Rotating target-lock ring (turns with simulated time only)
        if (e.type !== 'boss') {
          ctx.save();
          ctx.rotate(this.stageTime * 1.6 + e.id);
          ctx.strokeStyle = spec.color;
          ctx.globalAlpha = 0.42;
          ctx.lineWidth = 1.3;
          ctx.setLineDash([5, 7]);
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Telegraph warning halo + closing countdown arc right before firing
        if (e.telegraphTimer > 0 && e.type !== 'boss') {
          ctx.strokeStyle = '#ffd447';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 8 + e.telegraphTimer * 18, 0, Math.PI * 2);
          ctx.stroke();
          const prog = clamp(1 - e.telegraphTimer / (spec.telegraph || 0.4), 0, 1);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
          ctx.stroke();
        }

        ctx.rotate(e.angle);
        ctx.shadowColor = spec.glow;
        ctx.shadowBlur = 16;
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : spec.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;

        if (e.type === 'boss') {
          this.renderBossShape(ctx, e);
        } else if (e.type === 'shotgun') {
          // Bold hexagon heavy
          this.drawPolygon(ctx, 6, e.r);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(20, 6, 0, 0.45)';
          this.drawPolygon(ctx, 6, e.r * 0.5);
          ctx.fill();
          // Twin barrel stub
          ctx.fillStyle = '#ffe0c2';
          ctx.fillRect(e.r * 0.4, -5, 11, 3.5);
          ctx.fillRect(e.r * 0.4, 1.5, 11, 3.5);
        } else if (e.type === 'sniper') {
          // Sleek long dart
          ctx.beginPath();
          ctx.moveTo(e.r + 7, 0);
          ctx.lineTo(-e.r, -e.r * 0.72);
          ctx.lineTo(-e.r * 0.45, 0);
          ctx.lineTo(-e.r, e.r * 0.72);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(e.r * 0.25, 0, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (e.type === 'burst') {
          // Square tactical trooper
          ctx.fillRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
          ctx.strokeRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(40, 20, 0, 0.45)';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(-e.r * 0.42, -e.r * 0.42, e.r * 0.84, e.r * 0.84);
          ctx.fillStyle = '#fff5cc';
          ctx.fillRect(e.r * 0.5, -2.5, 10, 5);
        } else if (e.type === 'rusher') {
          // Sharp twin-blade assassin
          ctx.beginPath();
          ctx.moveTo(e.r + 5, 0);
          ctx.lineTo(-e.r * 0.8, -e.r * 0.9);
          ctx.lineTo(-e.r * 0.25, 0);
          ctx.lineTo(-e.r * 0.8, e.r * 0.9);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Twin glowing plasma blades
          ctx.strokeStyle = '#ff98cc';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(4, -10);
          ctx.lineTo(e.r + 14, -3);
          ctx.moveTo(4, 10);
          ctx.lineTo(e.r + 11, 5);
          ctx.stroke();
        } else if (e.type === 'shield') {
          // Armored core + double-layered frontal holographic shield arc
          this.drawPolygon(ctx, 5, e.r * 0.88);
          ctx.fill();
          ctx.stroke();
          ctx.shadowColor = '#00e5ff';
          ctx.shadowBlur = 18;
          ctx.strokeStyle = 'rgba(124, 215, 255, 0.35)';
          ctx.lineWidth = 11;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 7, -1.08, 1.08);
          ctx.stroke();
          ctx.strokeStyle = '#8ee4ff';
          ctx.lineWidth = 4.6;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 7, -1.08, 1.08);
          ctx.stroke();
        } else if (e.type === 'turret') {
          // Stationary octagon mount
          ctx.rotate(-e.angle);
          ctx.fillStyle = '#241828';
          ctx.strokeStyle = '#ff5252';
          ctx.lineWidth = 2;
          this.drawPolygon(ctx, 8, e.r);
          ctx.fill();
          ctx.stroke();
          ctx.rotate(e.angle);
          ctx.fillStyle = '#ff5252';
          ctx.fillRect(0, -6, e.r + 7, 4);
          ctx.fillRect(0, 2, e.r + 7, 4);
          ctx.beginPath();
          ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Pistol Guard: sharp diamond with dark core
          ctx.beginPath();
          ctx.moveTo(e.r + 3, 0);
          ctx.lineTo(0, -e.r * 0.85);
          ctx.lineTo(-e.r * 0.9, 0);
          ctx.lineTo(0, e.r * 0.85);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(30, 0, 10, 0.45)';
          ctx.beginPath();
          ctx.moveTo(e.r * 0.35, 0);
          ctx.lineTo(0, -e.r * 0.35);
          ctx.lineTo(-e.r * 0.38, 0);
          ctx.lineTo(0, e.r * 0.35);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
      }
    }

    renderBossShape(ctx, b) {
      ctx.rotate(-b.angle); // Draw symmetric rotating core

      // Outer rune clock ring (turns with simulated time)
      ctx.save();
      ctx.rotate(-this.stageTime * 0.6);
      ctx.strokeStyle = b.bossPhase === 'stunned' ? 'rgba(0, 240, 255, 0.62)' : 'rgba(255, 46, 85, 0.56)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r1 = b.r + 27;
        const r2 = b.r + (i % 2 ? 32 : 39);
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      }
      ctx.stroke();
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, b.r + 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Vulnerable cyan pulsing ring when stunned
      if (b.bossPhase === 'stunned') {
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3.5;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, b.r + 18 + Math.sin(this.globalClock * 16) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Rotating armor petals (one per remaining HP!)
      ctx.save();
      ctx.rotate(b.spinAngle);
      for (let i = 0; i < b.maxHp; i++) {
        const a = (i / b.maxHp) * Math.PI * 2;
        if (i < b.hp) {
          ctx.save();
          ctx.rotate(a);
          ctx.fillStyle = b.bossPhase === 'stunned' ? '#ffd447' : '#ff2356';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(b.r + 13, 0);
          ctx.lineTo(b.r - 5, -12);
          ctx.lineTo(b.r - 5, 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();

      // Central core
      ctx.fillStyle = b.hitFlash > 0 ? '#ffffff' : b.bossPhase === 'stunned' ? '#00f0ff' : '#350a1b';
      ctx.strokeStyle = b.bossPhase === 'stunned' ? '#ffffff' : '#ff4d79';
      ctx.lineWidth = 3;
      this.drawPolygon(ctx, 8, b.r - 4);
      ctx.fill();
      ctx.stroke();

      // Inner circuitry ring
      ctx.strokeStyle = b.bossPhase === 'stunned' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 77, 121, 0.58)';
      ctx.lineWidth = 1.2;
      this.drawPolygon(ctx, 8, b.r - 13);
      ctx.stroke();

      // Inner eye with pupil tracking player direction
      const pulse = 1 + Math.sin(this.globalClock * 5) * 0.12;
      ctx.fillStyle = b.bossPhase === 'stunned' ? '#ffffff' : '#ffd447';
      ctx.beginPath();
      ctx.arc(0, 0, 9.2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      const px = Math.cos(b.angle) * 2.6;
      const py = Math.sin(b.angle) * 2.6;
      ctx.fillStyle = b.bossPhase === 'stunned' ? '#00a8c8' : '#3a0a12';
      ctx.beginPath();
      ctx.arc(px, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPolygon(ctx, sides, r) {
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    renderPlayer(ctx) {
      const p = this.player;
      if (!p || !p.alive) return;
      const frozen = 1 - this.getFlow();

      // Motion ribbon trail (visual only)
      if (!p.trail) p.trail = [];
      const lastPt = p.trail[p.trail.length - 1];
      if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) > 4) {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 16) p.trail.shift();
      } else if (p.trail.length > 1 && this.mode === 'playing') {
        p.trail.shift();
      }
      if (p.trail.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 1; i < p.trail.length; i++) {
          const k = i / p.trail.length;
          ctx.strokeStyle = `rgba(0, 240, 255, ${k * 0.34})`;
          ctx.lineWidth = 2 + k * 7;
          ctx.beginPath();
          ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
          ctx.lineTo(p.trail[i].x, p.trail[i].y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Ground light pool
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28 + frozen * 0.12;
      ctx.drawImage(this.getGlowSprite('#00f0ff'), p.x - 48, p.y - 48, 96, 96);
      ctx.restore();

      // Dash range preview line + tactical target/parry intercept highlight
      if (p.dashCooldown <= 0 && this.mode === 'playing') {
        const ray = this.raycastWalls(p.x, p.y, p.angle, DASH_DISTANCE);
        let lockType = null;
        let lockX = 0;
        let lockY = 0;
        for (const b of this.bullets) {
          if (!b.alive || b.friendly) continue;
          if (distPointToSegmentSq(b.x, b.y, p.x, p.y, ray.x, ray.y) <= (PARRY_RADIUS * 0.72) ** 2) {
            lockType = 'parry';
            lockX = b.x;
            lockY = b.y;
            break;
          }
        }
        if (!lockType) {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const reach = (e.type === 'boss' ? 68 : 58) + e.r;
            if (distPointToSegmentSq(e.x, e.y, p.x, p.y, ray.x, ray.y) <= reach * reach) {
              lockType = 'kill';
              lockX = e.x;
              lockY = e.y;
              break;
            }
          }
        }

        const lineCol = lockType === 'parry'
          ? 'rgba(255, 212, 71, 0.52)'
          : lockType === 'kill'
            ? 'rgba(0, 240, 255, 0.48)'
            : 'rgba(0, 240, 255, 0.26)';

        ctx.save();
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = lockType ? 2 : 1.6;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ray.x, ray.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = lockType === 'parry' ? '#ffd447' : 'rgba(0, 240, 255, 0.55)';
        ctx.save();
        ctx.translate(ray.x, ray.y);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (lockType) {
          const lc = lockType === 'parry' ? '#ffd447' : '#00f0ff';
          ctx.translate(lockX, lockY);
          ctx.rotate(Math.PI * 0.25 + this.globalClock * 1.4);
          ctx.strokeStyle = lc;
          ctx.lineWidth = 1.6;
          ctx.shadowColor = lc;
          ctx.shadowBlur = 10;
          const sz = lockType === 'parry' ? 11 : 17;
          ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
        }
        ctx.restore();
      }

      // Focus ripple when right-click / Shift held
      if (this.mouse.rightDown || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 212, 71, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 12 + (this.globalClock * 40) % 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Chrono halo ticks (rotate with simulated time)
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(this.stageTime * 0.8);
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.18 + frozen * 0.2})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r1 = p.r + 16;
        const r2 = p.r + (i % 3 === 0 ? 23 : 19);
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      }
      ctx.stroke();
      ctx.restore();

      // Dash cooldown ring around player
      const charge = clamp(1 - p.dashCooldown / DASH_COOLDOWN, 0, 1);
      ctx.save();
      ctx.strokeStyle = charge >= 0.999 ? 'rgba(0, 240, 255, 0.6)' : 'rgba(255, 212, 71, 0.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 7, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * charge);
      ctx.stroke();
      ctx.restore();

      // Invulnerability shield shimmer after taking a shield hit
      if (p.invulnTimer > 0 && p.dashTimer <= 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.82)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 13, this.globalClock * 6, this.globalClock * 6 + Math.PI * 1.8);
        ctx.stroke();
        ctx.restore();
      }

      // Player sleek cyber-katana silhouette
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = p.dashTimer > 0 ? '#ffffff' : '#00f0ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;

      ctx.beginPath();
      ctx.moveTo(p.r + 5, 0);
      ctx.lineTo(-p.r * 0.85, -p.r * 0.82);
      ctx.lineTo(-p.r * 0.35, 0);
      ctx.lineTo(-p.r * 0.85, p.r * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Visor core
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(3, 22, 34, 0.78)';
      ctx.beginPath();
      ctx.moveTo(p.r * 0.6, 0);
      ctx.lineTo(-p.r * 0.25, -p.r * 0.32);
      ctx.lineTo(-p.r * 0.08, 0);
      ctx.lineTo(-p.r * 0.25, p.r * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.r * 0.18, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Katana blade glint held at right flank + gold tsuba
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 11;
      ctx.strokeStyle = '#e6feff';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-4, 9);
      ctx.lineTo(p.r + 15, 14);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd447';
      ctx.fillRect(-6, 7.5, 3, 3.5);
      ctx.restore();
    }

    renderSlashes(ctx) {
      for (const s of this.slashes) {
        const t = clamp(s.life / s.maxLife, 0, 1);
        const rr = s.radius * (0.82 + 0.18 * (1 - t));
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;

        // Wide luminous katana arc
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 12 * t;
        ctx.beginPath();
        ctx.arc(0, 0, rr, -1.18, 1.18);
        ctx.stroke();

        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 26 * t;
        ctx.globalAlpha = t * 0.48;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * 0.88, -1.25, 1.25);
        ctx.stroke();

        // Razor leading edge
        ctx.shadowBlur = 0;
        ctx.globalAlpha = t;
        ctx.strokeStyle = '#e8feff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, rr + 9 * t, -0.95, 0.95);
        ctx.stroke();
        ctx.restore();
      }
    }

    renderBullets(ctx) {
      const frozen = 1 - this.getFlow();
      for (const b of this.bullets) {
        if (!b.alive) continue;
        const angle = Math.atan2(b.vy, b.vx);
        const speed = Math.hypot(b.vx, b.vy);
        const trailLen = clamp(speed * 0.048, 18, 56);

        ctx.save();
        // Glowing bullet trail (super readable when time is frozen!)
        const tx = b.x - Math.cos(angle) * trailLen;
        const ty = b.y - Math.sin(angle) * trailLen;
        const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(1, b.friendly ? '#ffd447' : b.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = b.r * 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Bullet head
        ctx.shadowColor = b.friendly ? '#ffd447' : b.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.78, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = b.friendly ? '#00f0ff' : b.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();

        // 4-point star flare on deflected golden bullets
        if (b.friendly) {
          ctx.strokeStyle = '#fff5b8';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(b.x - b.r * 2.2, b.y);
          ctx.lineTo(b.x + b.r * 2.2, b.y);
          ctx.moveTo(b.x, b.y - b.r * 2.2);
          ctx.lineTo(b.x, b.y + b.r * 2.2);
          ctx.stroke();
        } else if (frozen > 0.05) {
          // Stasis ring: shows enemy round suspended in frozen time
          ctx.shadowBlur = 0;
          ctx.globalAlpha = frozen * 0.48;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 5 + Math.sin(this.globalClock * 5 + b.x * 0.05) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    renderShockwaves(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const sw of this.shockwaves) {
        const t = clamp(sw.life / sw.maxLife, 0, 1);
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = t * 0.28;
        ctx.lineWidth = 12 * t;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r * 0.94, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = t * 0.88;
        ctx.lineWidth = 3.5 * t;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    renderParticles(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const pt of this.particles) {
        const t = clamp(pt.life / pt.maxLife, 0, 1);
        const sp = Math.hypot(pt.vx, pt.vy);
        ctx.globalAlpha = t;
        if (sp > 20) {
          const len = Math.min(18, sp * 0.032) + pt.r * 0.5;
          ctx.strokeStyle = pt.color;
          ctx.lineWidth = Math.max(1, pt.r * 0.85);
          ctx.beginPath();
          ctx.moveTo(pt.x - (pt.vx / sp) * len, pt.y - (pt.vy / sp) * len);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = pt.color;
          ctx.fillRect(pt.x - pt.r * 0.5, pt.y - pt.r * 0.5, pt.r, pt.r);
        }
      }
      ctx.restore();
    }

    renderPopups(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = '900 16px "Bahnschrift", "Pretendard", "Malgun Gothic", sans-serif';
      for (const pop of this.popups) {
        const t = clamp(pop.life / pop.maxLife, 0, 1);
        const age = pop.maxLife - pop.life;
        const s = age < 0.12 ? 1.45 - (age / 0.12) * 0.45 : 1;
        ctx.save();
        ctx.translate(pop.x, pop.y);
        ctx.scale(s, s);
        ctx.globalAlpha = t;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(2, 6, 14, 0.88)';
        ctx.strokeText(pop.text, 0, 0);
        ctx.shadowColor = pop.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    renderCrosshair(ctx) {
      if (this.mode !== 'playing' || !this.mouse.active) return;
      const x = this.mouse.x;
      const y = this.mouse.y;
      const p = this.player;
      const charge = p ? clamp(1 - p.dashCooldown / DASH_COOLDOWN, 0, 1) : 1;
      const ready = charge >= 0.999;
      const color = ready ? '#00f0ff' : '#ffd447';

      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 1.8;

      // Rotating 4-arc bracket
      ctx.save();
      ctx.rotate(this.globalClock * (ready ? 1.2 : 3.5));
      const br = ready ? 14 : 11;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, br, a - 0.42, a + 0.42);
        ctx.stroke();
      }
      ctx.restore();

      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-22, 0); ctx.lineTo(-8, 0);
      ctx.moveTo(8, 0); ctx.lineTo(22, 0);
      ctx.moveTo(0, -22); ctx.lineTo(0, -8);
      ctx.moveTo(0, 8); ctx.lineTo(0, 22);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();

      if (!ready) {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.ChronoSlashGame = new ChronoSlashGame();
  });
})();
