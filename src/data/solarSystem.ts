import type { CelestialBodyDef } from '../types';

/**
 * The Sun and the eight planets.
 *
 * Sources (retrieved 2026-10-28):
 *  [H] JPL Horizons object data pages (physical data blocks for 10, 199 … 899)
 *      https://ssd.jpl.nasa.gov/horizons/
 *  [A] JPL Astrodynamic Parameters (system GM values from DE440, Park et al. 2021)
 *      https://ssd.jpl.nasa.gov/astro_par.html
 *  [K] JPL "Approximate Positions of the Planets", Table 1 (elements at J2000, 1800–2050 AD)
 *      https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *  [S] Sidereal orbital periods from [H].
 *  Saturn ring extent (C ring inner edge → A ring outer edge): NASA Saturn fact sheet,
 *      https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html
 *
 * Textures: Solar System Scope (https://www.solarsystemscope.com/textures/), CC BY 4.0,
 * compiled from NASA mission imagery. Uranus and Neptune maps are near-featureless because
 * the real planets show little resolvable detail at this scale.
 */
export const SOLAR_SYSTEM: CelestialBodyDef[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', color: '#f2c46b', texture: 'textures/2k_sun.jpg',
    physical: { massKg: 1.98841e30, gmKm3s2: 132712440041.93938, meanRadiusKm: 695700, equatorialRadiusKm: 695700, meanDensityGcm3: 1.408, siderealRotationHours: 25.38 * 24, obliquityDeg: 7.25 },
    dynamics: { horizonsId: '10', horizonsName: 'Sun', gmKm3s2: 132712440041.93938 },
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'terrestrial', color: '#a8a39b', texture: 'textures/2k_mercury.jpg',
    physical: { massKg: 3.302e23, gmKm3s2: 22031.86855, meanRadiusKm: 2439.4, equatorialRadiusKm: 2440.53, meanDensityGcm3: 5.427, siderealRotationHours: 58.6463 * 24, obliquityDeg: 2.11 / 60, geometricAlbedo: 0.106 },
    orbit: { semiMajorAxisAu: 0.38709927, eccentricity: 0.20563593, inclinationDeg: 7.00497902, siderealPeriodDays: 87.969257 },
    dynamics: { horizonsId: '199', horizonsName: 'Mercury', gmKm3s2: 22031.86855 },
  },
  {
    id: 'venus', name: 'Venus', kind: 'terrestrial', color: '#d9c08c', texture: 'textures/2k_venus_atmosphere.jpg',
    physical: { massKg: 48.685e23, gmKm3s2: 324858.592, meanRadiusKm: 6051.84, equatorialRadiusKm: 6051.893, meanDensityGcm3: 5.204, siderealRotationHours: -243.018484 * 24, obliquityDeg: 177.3, geometricAlbedo: 0.65 },
    orbit: { semiMajorAxisAu: 0.72333566, eccentricity: 0.00677672, inclinationDeg: 3.39467605, siderealPeriodDays: 224.70079922 },
    dynamics: { horizonsId: '299', horizonsName: 'Venus', gmKm3s2: 324858.592 },
  },
  {
    id: 'earth', name: 'Earth', kind: 'terrestrial', color: '#6f9fd8', texture: 'textures/2k_earth_daymap.jpg',
    physical: { massKg: 5.97219e24, gmKm3s2: 398600.435436, meanRadiusKm: 6371.01, equatorialRadiusKm: 6378.137, meanDensityGcm3: 5.51, siderealRotationHours: 23.9344695944, obliquityDeg: 23.4392911, geometricAlbedo: 0.367 },
    orbit: { semiMajorAxisAu: 1.00000261, eccentricity: 0.01671123, inclinationDeg: -0.00001531, siderealPeriodDays: 365.25636 },
    dynamics: {
      horizonsId: '3', horizonsName: 'Earth-Moon Barycenter', gmKm3s2: 398600.435436 + 4902.800118,
      note: 'Modelled as the Earth–Moon barycentre with Earth + Moon GM. The Moon is not a separate body yet; Earth’s centre lies ≈4 670 km from this point.',
    },
  },
  {
    id: 'mars', name: 'Mars', kind: 'terrestrial', color: '#c8724a', texture: 'textures/2k_mars.jpg',
    physical: { massKg: 6.4171e23, gmKm3s2: 42828.375662, meanRadiusKm: 3389.92, equatorialRadiusKm: 3396.19, meanDensityGcm3: 3.933, siderealRotationHours: 24.622962, obliquityDeg: 25.19, geometricAlbedo: 0.15 },
    orbit: { semiMajorAxisAu: 1.52371034, eccentricity: 0.0933941, inclinationDeg: 1.84969142, siderealPeriodDays: 686.98 },
    dynamics: { horizonsId: '4', horizonsName: 'Mars Barycenter', gmKm3s2: 42828.375816, note: 'System barycentre (includes Phobos and Deimos).' },
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'gas-giant', color: '#d3a77c', texture: 'textures/2k_jupiter.jpg',
    physical: { massKg: 18.9819e26, gmKm3s2: 126686531.9, meanRadiusKm: 69911, equatorialRadiusKm: 71492, meanDensityGcm3: 1.3262, siderealRotationHours: 9 + 55 / 60 + 29.711 / 3600, obliquityDeg: 3.13, geometricAlbedo: 0.52 },
    orbit: { semiMajorAxisAu: 5.202887, eccentricity: 0.04838624, inclinationDeg: 1.30439695, siderealPeriodDays: 4332.589 },
    dynamics: { horizonsId: '5', horizonsName: 'Jupiter Barycenter', gmKm3s2: 126712764.1, note: 'System barycentre (includes the Galilean moons).' },
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'gas-giant', color: '#e0c890', texture: 'textures/2k_saturn.jpg',
    physical: { massKg: 5.6834e26, gmKm3s2: 37931206.234, meanRadiusKm: 58232, equatorialRadiusKm: 60268, meanDensityGcm3: 0.687, siderealRotationHours: 10 + 39 / 60 + 22.4 / 3600, obliquityDeg: 26.73, geometricAlbedo: 0.47 },
    orbit: { semiMajorAxisAu: 9.53667594, eccentricity: 0.05386179, inclinationDeg: 2.48599187, siderealPeriodDays: 10755.698 },
    dynamics: { horizonsId: '6', horizonsName: 'Saturn Barycenter', gmKm3s2: 37940584.8418, note: 'System barycentre (includes Titan and the other moons).' },
    rings: { innerKm: 74658, outerKm: 136775, texture: 'textures/2k_saturn_ring_alpha.png' },
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'ice-giant', color: '#9fd3dc', texture: 'textures/2k_uranus.jpg',
    physical: { massKg: 86.813e24, gmKm3s2: 5793950.6103, meanRadiusKm: 25362, equatorialRadiusKm: 25559, meanDensityGcm3: 1.271, siderealRotationHours: -17.24, obliquityDeg: 97.77, geometricAlbedo: 0.51 },
    orbit: { semiMajorAxisAu: 19.18916464, eccentricity: 0.04725744, inclinationDeg: 0.77263783, siderealPeriodDays: 30685.4 },
    dynamics: { horizonsId: '7', horizonsName: 'Uranus Barycenter', gmKm3s2: 5794556.4, note: 'System barycentre (includes its moons).' },
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'ice-giant', color: '#5b7fd6', texture: 'textures/2k_neptune.jpg',
    physical: { massKg: 102.409e24, gmKm3s2: 6835099.97, meanRadiusKm: 24624, equatorialRadiusKm: 24766, meanDensityGcm3: 1.638, siderealRotationHours: 16.11, obliquityDeg: 28.32, geometricAlbedo: 0.41 },
    orbit: { semiMajorAxisAu: 30.06992276, eccentricity: 0.00859048, inclinationDeg: 1.77004347, siderealPeriodDays: 60189 },
    dynamics: { horizonsId: '8', horizonsName: 'Neptune Barycenter', gmKm3s2: 6836527.10058, note: 'System barycentre (includes Triton).' },
  },
];
