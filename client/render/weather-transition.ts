export interface WeatherAppearance { rain: number; snow: number; darkness: number; snowMix: number; }
const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const approach = (value: number, target: number, seconds: number, dt: number) => value + (target - value) * -Math.expm1(-dt / seconds);
/** Presentation only. Retarget the current state; no timers, queued fades or particle resets. */
export class WeatherTransition {
  private time?: number;
  private temperature?: number;
  private intensity = 0;
  private snowMix = 0;
  private darkness = 0;
  reset(): void {
    this.time = this.temperature = undefined;
    this.intensity = this.snowMix = this.darkness = 0;
  }
  update(time: number, temperature: number, storm: boolean, outdoors = true): WeatherAppearance {
    if (!outdoors) { this.reset(); return { rain: 0, snow: 0, darkness: 0, snowMix: 0 }; }
    const dt = this.time === undefined ? 0 : Math.max(0, Math.min(.25, (time - this.time) / 1000));
    this.time = time;
    if (this.temperature === undefined) {
      this.temperature = temperature;
      this.snowMix = 1 - smoothstep(.22, .34, temperature);
    } else this.temperature = approach(this.temperature, temperature, 0.7, dt);//adattamento alla temperatura
    const snowTarget = 1 - smoothstep(.22, .34, this.temperature);
    this.snowMix = approach(this.snowMix, snowTarget, 1, dt); //pioggia-neve (+ basso + veloce)
    // Snowfall is still overcast. Its lighter shade changes independently of the particles.
    this.darkness = approach(this.darkness, storm ? .22 - .06 * this.snowMix : 0, 2, dt); //cambia il 2 filtro scuro
    // Clouds arrive first; precipitation stops sooner than the sky clears.
    const targetIntensity = storm ? smoothstep(.015, .06, this.darkness) : 0;
    this.intensity = approach(this.intensity, targetIntensity, 1.2, dt); //comparsa scomparsa precipitazioni 1.2
    return { rain: this.intensity * (1 - this.snowMix), snow: this.intensity * this.snowMix, darkness: this.darkness, snowMix: this.snowMix };
  }
}
