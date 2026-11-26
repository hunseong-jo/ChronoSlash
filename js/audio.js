(function () {
  'use strict';

  class ChronoAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.noiseBuffer = null;
      this.droneOsc = null;
      this.droneFilter = null;
      this.droneGain = null;
      this.initialized = false;
    }

    init() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      try {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.42;
        this.master.connect(this.ctx.destination);

        // Pre-generate white noise buffer (1 second)
        const length = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        // Subtle ambient cyber drone that reacts to timeScale
        this.droneOsc = this.ctx.createOscillator();
        this.droneOsc.type = 'sawtooth';
        this.droneOsc.frequency.value = 55;

        const subOsc = this.ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.value = 110;

        this.droneFilter = this.ctx.createBiquadFilter();
        this.droneFilter.type = 'lowpass';
        this.droneFilter.frequency.value = 130;
        this.droneFilter.Q.value = 3.2;

        this.droneGain = this.ctx.createGain();
        this.droneGain.gain.value = 0.055;

        this.droneOsc.connect(this.droneFilter);
        subOsc.connect(this.droneFilter);
        this.droneFilter.connect(this.droneGain);
        this.droneGain.connect(this.master);

        this.droneOsc.start();
        subOsc.start();
        this.initialized = true;
      } catch (_) {
        // Gracefully degrade if Web Audio is unavailable
      }
    }

    unlock() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    setMuted(flag) {
      this.muted = !!flag;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.ctx.currentTime, 0.02);
      }
    }

    toggleMute() {
      this.setMuted(!this.muted);
      return this.muted;
    }

    isMuted() {
      return this.muted;
    }

    updateTimeScale(ts, inGameplay) {
      if (!this.initialized || !this.ctx || !this.droneFilter || !this.droneGain) return;
      const now = this.ctx.currentTime;
      const targetGain = inGameplay ? (0.04 + ts * 0.045) : 0.025;
      const targetFreq = inGameplay ? (110 + ts * 460) : 140;
      const targetPitch = inGameplay ? (48 + ts * 14) : 55;
      this.droneGain.gain.setTargetAtTime(targetGain, now, 0.08);
      this.droneFilter.frequency.setTargetAtTime(targetFreq, now, 0.07);
      this.droneOsc.frequency.setTargetAtTime(targetPitch, now, 0.08);
    }

    _playNoise(duration, filterType, startFreq, endFreq, peakGain, q = 1.5) {
      if (!this.initialized || !this.ctx || !this.noiseBuffer || this.muted) return;
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(startFreq, now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      src.start(now);
      src.stop(now + duration + 0.01);
    }

    _playTone(type, startFreq, endFreq, duration, peakGain, delay = 0) {
      if (!this.initialized || !this.ctx || this.muted) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now);
      if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
      }

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(peakGain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.master);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    playSlash() {
      this.unlock();
      // Crisp katana air-slice + high metallic ring
      this._playNoise(0.14, 'bandpass', 2800, 420, 0.42, 1.8);
      this._playTone('triangle', 980, 260, 0.11, 0.22);
    }

    playKill(combo = 1) {
      this.unlock();
      const pitchBoost = Math.min(combo - 1, 8) * 55;
      // Sub thump + crisp neon shatter chime
      this._playTone('sine', 150, 38, 0.16, 0.45);
      this._playNoise(0.12, 'highpass', 1800, 700, 0.28, 1.2);
      this._playTone('triangle', 520 + pitchBoost, 860 + pitchBoost, 0.13, 0.22, 0.015);
    }

    playParry(chain = 1) {
      this.unlock();
      const mult = 1 + Math.min(chain - 1, 6) * 0.09;
      // Iconic katana metallic clang!
      this._playTone('square', 1120 * mult, 1680 * mult, 0.07, 0.26);
      this._playTone('sine', 2240 * mult, 1480 * mult, 0.22, 0.34);
      this._playTone('triangle', 1650 * mult, 920 * mult, 0.18, 0.24, 0.01);
      this._playNoise(0.08, 'bandpass', 4200, 1900, 0.3, 3.0);
    }

    playBlock() {
      this.unlock();
      this._playTone('square', 240, 140, 0.11, 0.24);
      this._playNoise(0.07, 'bandpass', 1200, 500, 0.22, 2.2);
    }

    playEnemyFire(type) {
      if (!this.initialized || this.muted) return;
      switch (type) {
        case 'shotgun':
          this._playNoise(0.19, 'lowpass', 1800, 180, 0.38, 0.9);
          this._playTone('sawtooth', 170, 52, 0.14, 0.24);
          break;
        case 'sniper':
          this._playTone('sawtooth', 1400, 180, 0.2, 0.3);
          this._playNoise(0.15, 'highpass', 2400, 600, 0.3, 1.5);
          break;
        case 'turret':
        case 'boss':
          this._playTone('square', 360, 130, 0.1, 0.18);
          break;
        case 'burst':
          this._playTone('triangle', 540, 210, 0.07, 0.16);
          break;
        default: // pistol
          this._playNoise(0.08, 'bandpass', 1900, 480, 0.22, 1.4);
          this._playTone('triangle', 420, 140, 0.08, 0.16);
      }
    }

    playSniperLock() {
      if (!this.initialized || this.muted) return;
      this._playTone('sine', 1320, 1760, 0.09, 0.12);
    }

    playBossHit() {
      this.unlock();
      this._playTone('sawtooth', 260, 48, 0.34, 0.42);
      this._playTone('sine', 880, 1320, 0.18, 0.28, 0.03);
      this._playNoise(0.26, 'bandpass', 1600, 240, 0.42, 1.2);
    }

    playDeath() {
      this.unlock();
      this._playTone('sawtooth', 220, 42, 0.38, 0.42);
      this._playNoise(0.32, 'lowpass', 2200, 140, 0.46, 1.0);
    }

    playRewind() {
      this.unlock();
      this._playTone('sine', 240, 760, 0.11, 0.18);
      this._playNoise(0.1, 'bandpass', 700, 3200, 0.18, 2.0);
    }

    playStageClear() {
      this.unlock();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        this._playTone('triangle', f, f, 0.36, 0.2, idx * 0.075);
      });
    }

    playUiClick() {
      this.unlock();
      this._playTone('sine', 720, 980, 0.05, 0.14);
    }
  }

  window.ChronoSlashAudio = new ChronoAudio();
})();
