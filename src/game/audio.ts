export class GameAudio {
  private context: AudioContext | null = null;
  private muted = false;

  get isMuted(): boolean {
    return this.muted;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  unlock(): void {
    if (this.muted) return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  shoot(): void {
    this.tone(180, 0.055, 'triangle', 0.035, 70);
  }

  rim(): void {
    this.tone(740, 0.07, 'square', 0.028, -240);
  }

  swish(): void {
    this.noise(0.18, 0.04);
    this.tone(520, 0.12, 'sine', 0.025, 120);
  }

  green(): void {
    this.tone(1120, 0.045, 'triangle', 0.045, 260);
    window.setTimeout(() => this.tone(1680, 0.075, 'sine', 0.038, 320), 42);
    window.setTimeout(() => this.tone(2280, 0.055, 'sine', 0.022, -180), 94);
  }

  crowd(made: boolean): void {
    this.noise(made ? 0.34 : 0.16, made ? 0.045 : 0.018);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number, sweep = 0): void {
    if (this.muted) return;
    this.unlock();
    if (!this.context) return;

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + sweep), now + duration);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  private noise(duration: number, gainValue: number): void {
    if (this.muted) return;
    this.unlock();
    if (!this.context) return;

    const sampleCount = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / sampleCount);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = gainValue;
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    source.start();
  }
}
