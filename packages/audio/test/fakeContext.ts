/** A minimal fake AudioContext for node tests. Records what was created so tests can assert on the graph. */
import type { AudioContextLike } from '../src/index.js';

export class FakeParam {
  constructor(public value: number) {}
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  cancelScheduledValues(): this { return this; }
}

export class FakeNode {
  connections: unknown[] = [];
  connect(n: unknown): unknown { this.connections.push(n); return n; }
  disconnect(): void { this.connections = []; }
}
export class FakeGain extends FakeNode { gain = new FakeParam(1); }
export class FakeOscillator extends FakeNode {
  type = 'sine'; frequency = new FakeParam(440); detune = new FakeParam(0);
  startedAt: number | null = null; stoppedAt: number | null = null;
  start(t = 0): void { this.startedAt = t; }
  stop(t = 0): void { this.stoppedAt = t; }
}
export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null; loop = false; playbackRate = new FakeParam(1);
  startedAt: number | null = null; stoppedAt: number | null = null;
  start(t = 0): void { this.startedAt = t; }
  stop(t = 0): void { this.stoppedAt = t; }
}
export class FakeBiquad extends FakeNode { type = 'lowpass'; frequency = new FakeParam(350); Q = new FakeParam(1); gain = new FakeParam(0); }
export class FakeDelay extends FakeNode { delayTime = new FakeParam(0); }
export class FakeBuffer {
  private data: Float32Array;
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) { this.data = new Float32Array(length); }
  getChannelData(): Float32Array { return this.data; }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  created = { gain: 0, oscillator: 0, bufferSource: 0, biquad: 0, delay: 0, buffer: 0 };
  nodes: FakeNode[] = [];
  createGain(): FakeGain { this.created.gain++; const n = new FakeGain(); this.nodes.push(n); return n; }
  createOscillator(): FakeOscillator { this.created.oscillator++; const n = new FakeOscillator(); this.nodes.push(n); return n; }
  createBufferSource(): FakeBufferSource { this.created.bufferSource++; const n = new FakeBufferSource(); this.nodes.push(n); return n; }
  createBiquadFilter(): FakeBiquad { this.created.biquad++; const n = new FakeBiquad(); this.nodes.push(n); return n; }
  createDelay(): FakeDelay { this.created.delay++; const n = new FakeDelay(); this.nodes.push(n); return n; }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer { this.created.buffer++; return new FakeBuffer(channels, length, sampleRate); }
  async resume(): Promise<void> { this.state = 'running'; }
  async suspend(): Promise<void> { this.state = 'suspended'; }
  async close(): Promise<void> { this.state = 'closed'; }
  /** Total sound-producing sources created so far. */
  get sources(): number { return this.created.oscillator + this.created.bufferSource; }
  asContext(): AudioContextLike { return this as unknown as AudioContextLike; }
}
