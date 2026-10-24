// Binds a Composer to a SynthEngine on a Tone Transport. Used identically by
// live playback and offline rendering, so an export is the piece you heard.
//
// Each bar is generated one bar ahead and every note is placed on the
// Transport timeline with scheduleOnce, so stopping the Transport cancels
// everything still pending: no stuck notes, no orphaned events, and a
// regenerate never stacks a second set of callbacks on the first.

import type * as Tone from 'tone';
import { planSeconds, type BarPlan, type Composer } from '../music/composer';
import type { SynthEngine } from './engine';

type Transport = ReturnType<typeof Tone.getTransport>;

export interface SequencerHooks {
  /** called at the audio time each bar starts (live: use Tone.Draw for UI) */
  onBarStart?: (plan: BarPlan, time: number) => void;
  /** called when a bar is generated (before it plays) */
  onBarPlanned?: (plan: BarPlan) => void;
  /** smoothing 0..1 for arrangement fades */
  smoothing?: () => number;
  /** stop generating after this many bars */
  maxBars?: number;
  /** called at the time the final bar ends */
  onEnd?: (time: number) => void;
}

export class Sequencer {
  private repeatId: number | null = null;
  private onceIds: number[] = [];
  private generated = 0;
  private running = false;

  constructor(
    private readonly engine: SynthEngine,
    private readonly composer: Composer,
    private readonly transport: Transport,
    private readonly hooks: SequencerHooks = {},
  ) {}

  get isRunning() { return this.running; }

  /** Schedules from transport tick 0. Call before transport.start(). */
  start() {
    this.clear();
    this.running = true;
    this.ended = false;
    this.generated = 0;
    const tr = this.transport;
    const barTicks = () => this.composer.settings.beatsPerBar * tr.PPQ;
    this.scheduleNext(0);
    this.repeatId = tr.scheduleRepeat((time) => {
      if (!this.running) return;
      const tick = Math.round(tr.getTicksAtTime(time) / barTicks()) * barTicks();
      this.scheduleNext(tick + barTicks());
    }, '1m', 0);
  }

  private ended = false;

  private scheduleNext(startTick: number) {
    const max = this.hooks.maxBars;
    if (this.ended || (max != null && this.generated >= max)) return;
    const plan = this.composer.nextBar();
    this.generated++;
    this.hooks.onBarPlanned?.(plan);
    const tr = this.transport;
    const ppq = tr.PPQ;
    const beats = plan.beats;
    const spb = () => 60 / tr.bpm.value;
    this.onceIds.push(tr.scheduleOnce((t) => {
      const barSeconds = planSeconds(plan);
      if (plan.bpmEnd != null) {
        // a slowing ending: the tempo ramps across the bar, and the notes (placed in ticks) follow it
        tr.bpm.setValueAtTime(plan.bpm, t);
        tr.bpm.linearRampToValueAtTime(plan.bpmEnd, t + barSeconds);
      } else if (tr.bpm.value !== plan.bpm) tr.bpm.setValueAtTime(plan.bpm, t);
      this.engine.fadeBar(plan.fade?.[0] ?? 1, plan.fade?.[1] ?? 1, t, barSeconds);
      this.engine.applyLayers(plan.layers, t, barSeconds, this.hooks.smoothing?.() ?? 0.5);
      this.hooks.onBarStart?.(plan, t);
    }, `${startTick}i`));
    for (const e of plan.events) {
      const tick = Math.max(startTick, Math.round(startTick + e.beat * ppq));
      this.onceIds.push(tr.scheduleOnce((t) => this.engine.trigger(e, t, spb()), `${tick}i`));
    }
    if (plan.final || (max != null && this.generated >= max)) {
      // nothing is scheduled after the final bar: its notes ring out instead of a new bar starting and being cut
      this.ended = true;
      const endTick = startTick + beats * ppq;
      this.onceIds.push(tr.scheduleOnce((t) => this.hooks.onEnd?.(t), `${endTick}i`));
    }
    // forget ids of callbacks that have certainly fired (keeps the list short)
    if (this.onceIds.length > 4000) this.onceIds = this.onceIds.slice(-2000);
  }

  /** Cancels every pending callback this sequencer created. */
  clear() {
    this.running = false;
    const tr = this.transport;
    if (this.repeatId != null) tr.clear(this.repeatId);
    for (const id of this.onceIds) tr.clear(id);
    this.repeatId = null;
    this.onceIds = [];
  }
}
