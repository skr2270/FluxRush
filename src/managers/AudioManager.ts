export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Background Music nodes
  private bgmOscs: OscillatorNode[] = [];
  private bgmGain: GainNode | null = null;
  private isBgmPlaying = false;
  private lfoNode: OscillatorNode | null = null;

  private volume = 0.3;
  private isMuted = false;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  public init(): void {
    if (this.ctx) return;

    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.updateMasterVolume();
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('WebAudio API is not supported in this browser.', e);
    }
  }

  private resume(): boolean {
    this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return true;
  }

  public setVolume(volPct: number): void {
    this.volume = Math.max(0, Math.min(volPct / 100, 1));
    this.updateMasterVolume();
  }

  public getVolume(): number {
    return Math.round(this.volume * 100);
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.updateMasterVolume();
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  private updateMasterVolume(): void {
    if (!this.masterGain || !this.ctx) return;
    const targetGain = this.isMuted ? 0 : this.volume;
    this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
  }

  public playCollect(): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Sweet high-pitch coin/energy collection blip
    osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(1174.66, this.ctx.currentTime + 0.12); // D6

    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
  }

  public playCombo(multiplier: number): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    // Arpeggiates/scales pitch based on combo multiplier
    const baseFreq = 440; // A4
    const freq = baseFreq * Math.pow(1.059463, Math.min(multiplier * 2, 24)); // scale chromatically
    
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.16);
  }

  public playHit(): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    // Synthesize low punchy explosion noise
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(10, this.ctx.currentTime + 0.45);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, this.ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(30, this.ctx.currentTime + 0.45);

    gain.gain.setValueAtTime(0.6, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.46);
  }

  public playShieldActivate(): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.35);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2000, this.ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.36);
  }

  public playShieldExpire(): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.4);

    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.41);
  }

  public playEmpPulse(): void {
    if (!this.resume() || !this.ctx || !this.masterGain) return;

    // A loud, static/noise-based explosion pulse
    const bufferSize = this.ctx.sampleRate * 0.5; // 0.5 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.45);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.46);
  }

  public startBgm(): void {
    if (this.isBgmPlaying || !this.resume() || !this.ctx || !this.masterGain) return;
    this.isBgmPlaying = true;

    // Ambient space drone using detuned low-pass saw/triangle waves
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    this.bgmGain.connect(this.masterGain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, this.ctx.currentTime);
    filter.connect(this.bgmGain);

    // Continuous slow detuning wave (LFO)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.25; // 0.25Hz slow modulation
    
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.8; // range of +/- 0.8Hz
    
    lfo.connect(lfoGain);
    lfo.start();
    this.lfoNode = lfo;

    const freqs = [55, 55.3, 82.5]; // low A and detuned fifth
    freqs.forEach((freq) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      
      // Connect LFO modulation to osc frequency param
      lfoGain.connect(osc.frequency);
      
      osc.connect(filter);
      osc.start();
      this.bgmOscs.push(osc);
    });
  }

  public stopBgm(): void {
    if (!this.isBgmPlaying) return;
    this.isBgmPlaying = false;

    this.bgmOscs.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    });
    this.bgmOscs = [];

    if (this.lfoNode) {
      try {
        this.lfoNode.stop();
      } catch {}
      this.lfoNode = null;
    }

    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
  }
}
