/**
 * Unit system for the physics engine.
 *
 *   length: astronomical unit (au), IAU 2012 Resolution B2: 1 au = 149 597 870.700 km (exact)
 *   time:   day = 86 400 s of TDB
 *   mass:   expressed through gravitational parameters GM (au^3/day^2), so G and kg are never
 *           multiplied together in the integrator. GM values are known far more precisely than
 *           G or individual masses (JPL DE440, Park et al. 2021).
 *
 * Check: GM_sun in these units is the square of the Gaussian gravitational constant,
 * k^2 = 0.01720209895^2 ≈ 2.9591220828e-4 au^3/day^2.
 */
export const AU_KM = 149_597_870.7;
export const DAY_S = 86_400;
/** CODATA 2018, m^3 kg^-1 s^-2. Used only to derive display quantities, never in the integrator. */
export const G_SI = 6.6743e-11;

/** km^3/s^2 → au^3/day^2 */
export function gmToAuDay(gmKm3s2: number): number {
  return (gmKm3s2 * DAY_S * DAY_S) / (AU_KM * AU_KM * AU_KM);
}

/** au/day → km/s */
export const auPerDayToKmPerS = (v: number) => (v * AU_KM) / DAY_S;
