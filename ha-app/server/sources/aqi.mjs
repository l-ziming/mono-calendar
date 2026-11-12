// EPA 2024 PM breakpoints. Never reinterpret a Chinese composite AQI as a US index.
// https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html
const INDEX = [
  [0, 50],
  [51, 100],
  [101, 150],
  [151, 200],
  [201, 300],
  [301, 500],
];
const EPA = {
  pm25: [
    [0, 9],
    [9.1, 35.4],
    [35.5, 55.4],
    [55.5, 125.4],
    [125.5, 225.4],
    [225.5, 325.4],
  ],
  pm10: [
    [0, 54],
    [55, 154],
    [155, 254],
    [255, 354],
    [355, 424],
    [425, 604],
  ],
};
const CN2012 = { pm25: [0, 35, 75, 115, 150, 250, 350, 500], pm10: [0, 50, 150, 250, 350, 420, 500, 600] };
// HJ 633—2026 table 3, effective 2026-03-01. Its realtime report is 1-hour,
// which must not be reinterpreted as the EPA 24-hour particulate average.
// https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/202602/W020260225366493492011.pdf
const CN2026 = { pm25: [0, 35, 60, 115, 150, 250, 350, 500], pm10: [0, 50, 120, 250, 350, 420, 500, 600] };
const CN_INDEX = [0, 50, 100, 150, 200, 300, 400, 500];
const numeric = (x) =>
  x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null;
function interpolate(value, inputLow, inputHigh, outputLow, outputHigh) {
  return outputLow + ((value - inputLow) / (inputHigh - inputLow)) * (outputHigh - outputLow);
}
export function particulateAQI(value, pollutant) {
  let concentration = numeric(value);
  if (concentration === null || !EPA[pollutant]) {
    return null;
  }
  concentration = pollutant === 'pm25' ? Math.floor((concentration + 1e-10) * 10) / 10 : Math.floor(concentration);
  const bandIndex = EPA[pollutant].findIndex(
    ([concentrationLow, concentrationHigh]) => concentration >= concentrationLow && concentration <= concentrationHigh,
  );
  if (bandIndex < 0) {
    return concentration > EPA[pollutant].at(-1)[1] ? 501 : null;
  }
  const [concentrationLow, concentrationHigh] = EPA[pollutant][bandIndex];
  const [indexLow, indexHigh] = INDEX[bandIndex];
  return Math.round(interpolate(concentration, concentrationLow, concentrationHigh, indexLow, indexHigh));
}
export function cnPrimaryEstimate(value, primary, period, standard) {
  const index = numeric(value);
  const normalizedPrimary = String(primary || '')
    .toLowerCase()
    .replace(/[.\s]/g, '');
  let pollutant = null;
  if (normalizedPrimary === 'pm25' || normalizedPrimary === 'pm10') {
    pollutant = normalizedPrimary;
  }
  // A rounded composite index loses information. Only offer an explicit estimate
  // with a confirmed PM basis, matching average period and source-table version.
  let table = null;
  if (standard === 'CN2012') {
    table = CN2012;
  } else if (standard === 'CN2026') {
    table = CN2026;
  }
  if (index === null || index > 500 || !pollutant || period !== '24h' || !table) {
    return null;
  }
  const bandIndex = CN_INDEX.findIndex((x) => x >= index);
  if (bandIndex === 0) {
    return 0;
  }
  const [indexLow, indexHigh] = [CN_INDEX[bandIndex - 1], CN_INDEX[bandIndex]];
  const concentrations = table[pollutant];
  const concentration = interpolate(
    index,
    indexLow,
    indexHigh,
    concentrations[bandIndex - 1],
    concentrations[bandIndex],
  );
  return particulateAQI(concentration, pollutant);
}
export function outdoorAQI({ value, standard = 'US', pm25, pm10, primary, period }) {
  if (standard === 'US') {
    return { value: numeric(value), estimated: false, method: 'direct' };
  }
  const indices = [particulateAQI(pm25, 'pm25'), particulateAQI(pm10, 'pm10')].filter((x) => x !== null);
  if (indices.length) {
    return { value: Math.max(...indices), estimated: true, method: 'particulate_24h' };
  }
  const estimate = cnPrimaryEstimate(value, primary, period, standard);
  if (estimate !== null) {
    return { value: estimate, estimated: true, method: standard.toLowerCase() + '_primary' };
  }
  return { value: null, estimated: false, method: 'needs_concentration' };
}
