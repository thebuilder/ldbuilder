/**
 * A requestAnimationFrame loop that can be started, stopped and thrown away.
 *
 * Both flows need exactly this and neither needs anything more: a monotonic
 * delta, a ceiling on it so a backgrounded tab does not resume with one
 * enormous step, and a floor because a frame timestamp is not guaranteed to be
 * later than the wall-clock reading that started the loop. A negative delta
 * turns every damped follow in the app into a divergent one, which is a bug
 * worth having in one place rather than two.
 */
export class RenderLoop {
  private handle = 0;
  private lastTime = 0;
  private disposed = false;
  private readonly onFrame: (dt: number) => void;

  /** Longest step the solver is asked to take, in seconds. */
  private static readonly MAX_STEP = 0.1;

  constructor(onFrame: (dt: number) => void) {
    this.onFrame = onFrame;
  }

  start(): void {
    if (this.handle !== 0 || this.disposed) {
      return;
    }
    this.lastTime = performance.now();
    const tick = (now: number) => {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: set true in dispose(); Biome infers the literal false from the initialiser
      if (this.disposed) {
        return;
      }
      this.handle = requestAnimationFrame(tick);
      const dt = Math.min(
        Math.max((now - this.lastTime) / 1000, 0),
        RenderLoop.MAX_STEP
      );
      this.lastTime = now;
      this.onFrame(dt);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.handle !== 0) {
      cancelAnimationFrame(this.handle);
    }
    this.handle = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
