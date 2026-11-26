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
        screenDeath: document.getElementById('screenDeath'),
        screenClear: document.getElementById('screenClear'),
        screenVictory: document.getElementById('screenVictory'),
        stageGrid: document.getElementById('stageGrid'),
        titleProgressInfo: document.getElementById('titleProgressInfo'),
        deathReason: document.getElementById('deathReason'),
        clearStageTitle: document.getElementById('clearStageTitle'),
        clearRank: document.getElementById('clearRank'),
        clearTime: document.getElementById('clearTime'),
        clearParTime: document.getElementById('clearParTime'),
        clearParries: document.getElementById('clearParries'),
        clearMaxCombo: document.getElementById('clearMaxCombo'),
        clearDeaths: document.getElementById('clearDeaths'),
        btnNextStage: document.getElementById('btnNextStage'),
        victoryTotalTime: document.getElementById('victoryTotalTime'),
        victoryTotalParries: document.getElementById('victoryTotalParries'),
        victoryTotalDeaths: document.getElementById('victoryTotalDeaths'),
        victoryRank: document.getElementById('victoryRank')
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

    formatStageRoster(st) {
      if (st.isBoss) return 'FINAL BOSS · WARDEN';
      const counts = {};
      for (const e of st.enemies) {
        const label = (ENEMY_SPECS[e.type] && ENEMY_SPECS[e.type].label) || e.type.toUpperCase();
        counts[label] = (counts[label] || 0) + 1;
      }
      const entries = Object.entries(counts);
      const top = entries.slice(0, 2).map(([k, v]) => `${k}×${v}`).join(' · ');
      return entries.length > 2 ? `${top} +${entries.length - 2}` : top;
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
        const rosterText = this.formatStageRoster(st);

        btn.innerHTML = `
          <div class="st-head">
            <span class="st-code">${st.isBoss ? 'BOSS · ' : 'SECTOR '}${st.code}</span>
            ${rankHtml}
          </div>
          <div class="st-name">${st.titleKo}</div>
          <div class="st-en">${st.titleEn}</div>
          <div class="st-roster">${rosterText}</div>
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
      for (let i = 0; i < 42; i++) {
        this.ambientMotes.push({
          x: Math.random() * WORLD_W,
          y: Math.random() * WORLD_H,
          vx: (Math.random() - 0.5) * 28,
          vy: (Math.random() - 0.5) * 28,
          size: 1 + Math.random() * 2.2,
          alpha: 0.14 + Math.random() * 0.35
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

      ctx.translate(offsetX + sx, offsetY + sy);
      ctx.scale(scale, scale);

      this.renderArenaFloor(ctx);
      this.renderDecals(ctx);
      this.renderWalls(ctx);
      this.renderAfterimages(ctx);
      this.renderSniperLasers(ctx);
      this.renderEnemies(ctx);
      this.renderPlayer(ctx);
      this.renderSlashes(ctx);
      this.renderBullets(ctx);
      this.renderShockwaves(ctx);
      this.renderParticles(ctx);
      this.renderPopups(ctx);
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

    renderTitleBackdrop(ctx, w, h) {
      // Rich cyber-katana animated scene behind Title screen
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      bgGrad.addColorStop(0, '#0d1936');
      bgGrad.addColorStop(0.55, '#050a18');
      bgGrad.addColorStop(1, '#02040a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Slowly drifting tactical grid
      const gridSize = 54;
      const driftX = (this.globalClock * 12) % gridSize;
      const driftY = (this.globalClock * 8) % gridSize;
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

      // Twin counter-rotating radar/chrono telemetry rings
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5);

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.42, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.rotate(this.globalClock * 0.14);
      ctx.setLineDash([20, 14]);
      ctx.strokeStyle = 'rgba(255, 46, 85, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-this.globalClock * 0.09);
      ctx.setLineDash([6, 18]);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.restore();

      // Suspended slow-motion crimson & gold bullet tracers (tells the game's story visually!)
      const tracers = [
        { x: 0.12, y: 0.22, ang: 0.24, len: 120, color: '#ff2e55', spd: 14 },
        { x: 0.86, y: 0.18, ang: 2.86, len: 135, color: '#ff2e55', spd: 12 },
        { x: 0.09, y: 0.78, ang: -0.32, len: 140, color: '#ffd447', spd: 18 },
        { x: 0.88, y: 0.76, ang: -2.75, len: 130, color: '#00f0ff', spd: 16 },
        { x: 0.22, y: 0.88, ang: -0.18, len: 95, color: '#ff2ec4', spd: 11 },
        { x: 0.78, y: 0.11, ang: 2.95, len: 105, color: '#ffd447', spd: 15 }
      ];

      for (let i = 0; i < tracers.length; i++) {
        const tr = tracers[i];
        const drift = (this.globalClock * tr.spd) % 90;
        const bx = w * tr.x + Math.cos(tr.ang) * drift;
        const by = h * tr.y + Math.sin(tr.ang) * drift;
        const tx = bx - Math.cos(tr.ang) * tr.len;
        const ty = by - Math.sin(tr.ang) * tr.len;

        ctx.save();
        const grad = ctx.createLinearGradient(tx, ty, bx, by);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, tr.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.shadowColor = tr.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Subtle floating cyan sparks
      for (const m of this.ambientMotes) {
        const sx = (m.x / WORLD_W) * w;
        const sy = (m.y / WORLD_H) * h;
        ctx.fillStyle = `rgba(0, 240, 255, ${m.alpha * 0.85})`;
        ctx.fillRect(sx, sy, m.size, m.size);
      }
    }

    renderArenaFloor(ctx) {
      // Base floor tone reacts subtly to time dilation
      const flow = clamp((this.timeScale - MIN_TIME_SCALE) / (1 - MIN_TIME_SCALE), 0, 1);
      ctx.fillStyle = flow > 0.35 ? '#0a1020' : '#070c18';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      // Floor grid
      const cell = 60;
      ctx.strokeStyle = flow > 0.35 ? 'rgba(0, 240, 255, 0.085)' : 'rgba(0, 195, 255, 0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = WALL_T; x <= WORLD_W - WALL_T; x += cell) {
        ctx.moveTo(x, WALL_T);
        ctx.lineTo(x, WORLD_H - WALL_T);
      }
      for (let y = WALL_T; y <= WORLD_H - WALL_T; y += cell) {
        ctx.moveTo(WALL_T, y);
        ctx.lineTo(WORLD_W - WALL_T, y);
      }
      ctx.stroke();

      // Subtle holographic stage watermark & floor tutorial hint
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
      ctx.font = '900 124px "Consolas", monospace';
      ctx.fillText(this.stage.code, WORLD_W * 0.5, WORLD_H * 0.5 + 42);

      if (this.stage.floorHint) {
        ctx.fillStyle = 'rgba(170, 230, 255, 0.36)';
        ctx.font = '700 15px "Pretendard", "Malgun Gothic", sans-serif';
        ctx.fillText(this.stage.floorHint, WORLD_W * 0.5, WORLD_H - 48);
      }
      ctx.restore();

      // Ambient drifting dust motes
      for (const m of this.ambientMotes) {
        ctx.fillStyle = `rgba(120, 230, 255, ${m.alpha})`;
        ctx.fillRect(m.x, m.y, m.size, m.size);
      }
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
        } else if (d.type === 'kill') {
          ctx.translate(d.x, d.y);
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

    renderWalls(ctx) {
      for (const w of this.walls) {
        // Fill
        ctx.fillStyle = w.outer ? '#0f182c' : '#13203b';
        ctx.fillRect(w.x, w.y, w.w, w.h);

        // Crisp neon architectural border
        ctx.strokeStyle = w.outer ? 'rgba(0, 240, 255, 0.45)' : 'rgba(0, 225, 255, 0.55)';
        ctx.lineWidth = w.outer ? 2 : 1.8;
        ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);

        // Subtle inner highlight for interior cover blocks
        if (!w.outer) {
          ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
          ctx.fillRect(w.x + 4, w.y + 4, Math.max(0, w.w - 8), Math.max(0, w.h - 8));
        }
      }
    }

    renderAfterimages(ctx) {
      for (const a of this.afterimages) {
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
    }

    renderSniperLasers(ctx) {
      for (const e of this.enemies) {
        if (!e.alive) continue;

        if (e.type === 'sniper') {
          const hit = this.raycastWalls(e.x, e.y, e.angle, 1500);
          const locking = e.telegraphTimer > 0;
          ctx.save();
          ctx.strokeStyle = locking ? '#ffffff' : 'rgba(255, 46, 196, 0.42)';
          ctx.lineWidth = locking ? 2.6 : 1.3;
          if (!locking) ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(hit.x, hit.y);
          ctx.stroke();
          ctx.setLineDash([]);
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
        ctx.save();
        ctx.translate(e.x, e.y);

        // Telegraph warning halo right before firing
        if (e.telegraphTimer > 0 && e.type !== 'boss') {
          ctx.strokeStyle = '#ffd447';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, e.r + 8 + e.telegraphTimer * 18, 0, Math.PI * 2);
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
        } else if (e.type === 'burst') {
          // Square tactical trooper
          ctx.fillRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
          ctx.strokeRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
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
          // Glowing red blade
          ctx.strokeStyle = '#ff98cc';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(4, -10);
          ctx.lineTo(e.r + 14, -3);
          ctx.stroke();
        } else if (e.type === 'shield') {
          // Armored core + bright frontal energy arc
          this.drawPolygon(ctx, 5, e.r * 0.88);
          ctx.fill();
          ctx.stroke();
          ctx.shadowColor = '#00e5ff';
          ctx.shadowBlur = 18;
          ctx.strokeStyle = '#7cd7ff';
          ctx.lineWidth = 5;
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
          // Pistol Guard: sharp diamond
          ctx.beginPath();
          ctx.moveTo(e.r + 3, 0);
          ctx.lineTo(0, -e.r * 0.85);
          ctx.lineTo(-e.r * 0.9, 0);
          ctx.lineTo(0, e.r * 0.85);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    renderBossShape(ctx, b) {
      ctx.rotate(-b.angle); // Draw symmetric rotating core

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
          ctx.moveTo(b.r + 12, 0);
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

      // Inner eye
      ctx.fillStyle = b.bossPhase === 'stunned' ? '#ffffff' : '#ffd447';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
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

      // Subtle dash range preview line when frozen & dash ready
      if (p.dashCooldown <= 0 && this.mode === 'playing') {
        const ray = this.raycastWalls(p.x, p.y, p.angle, DASH_DISTANCE);
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.24)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ray.x, ray.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Focus ripple when right-click / Shift held
      if (this.mouse.rightDown || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 212, 71, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 12 + (this.globalClock * 40) % 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Dash cooldown ring around player
      const charge = clamp(1 - p.dashCooldown / DASH_COOLDOWN, 0, 1);
      ctx.save();
      ctx.strokeStyle = charge >= 0.999 ? 'rgba(0, 240, 255, 0.55)' : 'rgba(255, 212, 71, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 7, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * charge);
      ctx.stroke();
      ctx.restore();

      // Invulnerability shield shimmer after taking a shield hit
      if (p.invulnTimer > 0 && p.dashTimer <= 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.78)';
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

      // Katana blade glint held at right flank
      ctx.strokeStyle = '#e0fdff';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-4, 9);
      ctx.lineTo(p.r + 14, 14);
      ctx.stroke();
      ctx.restore();
    }

    renderSlashes(ctx) {
      for (const s of this.slashes) {
        const t = clamp(s.life / s.maxLife, 0, 1);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.globalAlpha = t;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 24;

        // Wide luminous katana arc
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 12 * t;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * (0.82 + 0.18 * (1 - t)), -1.18, 1.18);
        ctx.stroke();

        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 24 * t;
        ctx.globalAlpha = t * 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius * 0.88, -1.25, 1.25);
        ctx.stroke();
        ctx.restore();
      }
    }

    renderBullets(ctx) {
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
        ctx.lineWidth = b.r * 1.35;
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
        ctx.restore();
      }
    }

    renderShockwaves(ctx) {
      for (const sw of this.shockwaves) {
        const t = clamp(sw.life / sw.maxLife, 0, 1);
        ctx.save();
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 3.5 * t;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    renderParticles(ctx) {
      for (const pt of this.particles) {
        const t = clamp(pt.life / pt.maxLife, 0, 1);
        ctx.save();
        ctx.globalAlpha = t;
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.r * 0.5, pt.y - pt.r * 0.5, pt.r, pt.r);
        ctx.restore();
      }
    }

    renderPopups(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 16px "Pretendard", "Consolas", sans-serif';
      for (const pop of this.popups) {
        const t = clamp(pop.life / pop.maxLife, 0, 1);
        ctx.globalAlpha = t;
        ctx.shadowColor = pop.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x, pop.y);
      }
      ctx.restore();
    }

    renderCrosshair(ctx) {
      if (this.mode !== 'playing' || !this.mouse.active) return;
      const x = this.mouse.x;
      const y = this.mouse.y;
      const ready = this.player && this.player.dashCooldown <= 0;
      const color = ready ? '#00f0ff' : '#ffd447';

      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.arc(0, 0, ready ? 11 : 8, 0, Math.PI * 2);
      ctx.stroke();

      const gap = 5;
      const len = 16;
      ctx.beginPath();
      ctx.moveTo(-len, 0); ctx.lineTo(-gap, 0);
      ctx.moveTo(gap, 0); ctx.lineTo(len, 0);
      ctx.moveTo(0, -len); ctx.lineTo(0, -gap);
      ctx.moveTo(0, gap); ctx.lineTo(0, len);
      ctx.stroke();
      ctx.restore();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.ChronoSlashGame = new ChronoSlashGame();
  });
})();
