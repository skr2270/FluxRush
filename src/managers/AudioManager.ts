export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Background Music nodes
  private bgmOscs: OscillatorNode[] = [];
  private bgmGain: GainNode | null = null;
  private isBgmPlaying = false;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  public init(): void {
    if (this.ctx) return;

    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime); // Master Volume
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

  public startBgm(): void {
    if (this.isBgmPlaying || !this.resume() || !this.ctx || !this.masterGain) return;
    this.isBgmPlaying = true;

    // Ambient space drone using two detuned low-pass saw/triangle waves
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    this.bgmGain.connect(this.masterGain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, this.ctx.currentTime);
    filter.connect(this.bgmGain);

    const freqs = [55, 55.3, 82.5]; // low A and detuned fifth
    freqs.forEach((freq) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      
      // Detuning modulation
      osc.frequency.linearRampToValueAtTime(freq + 0.5, this.ctx.currentTime + 3.0);
      
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

    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
  }
}
