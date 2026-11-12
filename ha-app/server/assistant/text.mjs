export const width = (text) =>
  [...text].reduce((totalWidth, character) => totalWidth + (character.codePointAt(0) < 128 ? 0.6 : 1), 0);
/** Zero lines clears the hint; one to four lines fit the display without filling unused space. */
export const MAX_WIDTH = 52;
export const MIN_LINES = 0;
export const MAX_LINES = 4;
/** Temperature ranges in the panel's one form, 0～7 °C, whatever separator or unit the model chose. */
export const tidy = (text) =>
  text.replace(/(-?\d+(?:\.\d+)?)\s*(?:°C|℃|°|度)?\s*[-–—~～至到]\s*(-?\d+(?:\.\d+)?)\s*(?:°C|℃|°|度)/g, '$1～$2 °C');
export function checkLines(value) {
  const errors = [];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'lines' ||
    !Array.isArray(value.lines)
  )
    return ['json 只能包含 lines 数组'];
  const lines = value.lines;
  if (lines.length < MIN_LINES || lines.length > MAX_LINES) errors.push(`lines 须为 ${MIN_LINES}～${MAX_LINES} 行`);
  lines.forEach((line, i) => {
    const key = `第 ${i + 1} 行`;
    const text = typeof line === 'string' ? line.trim() : '';
    if (!text) {
      errors.push(`${key}为空`);
      return;
    }
    if (width(text) > MAX_WIDTH + 1e-8) errors.push(`${key}超长（${width(text).toFixed(1)}）`);
    if (
      /[·\r\n*#`_<>\[\]（）()“”‘’"'！!？?,;]/u.test(text) ||
      /[\p{Cc}\p{Extended_Pictographic}\u200d\ufe0f]/u.test(text)
    )
      errors.push(`${key}含不允许的符号`);
    if (!text.endsWith('。') || text.slice(0, -1).includes('。')) errors.push(`${key}必须是以句号结尾的一句话`);
    if (!/\p{Script=Han}/u.test(text)) errors.push(`${key}须用中文`);
  });
  if (new Set(lines.map((x) => (typeof x === 'string' ? x.trim() : x))).size !== lines.length)
    errors.push('各行不能相同');
  return errors;
}
/** HA's text as panel lines: one to four non-empty lines (newline-separated, or the writer's json). */
export function readLines(text) {
  if (typeof text !== 'string' || ['unknown', 'unavailable'].includes(text)) return [];
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value?.lines)) text = value.lines.join('\n');
  } catch {}
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.length <= MAX_LINES ? lines : lines.slice(0, MAX_LINES);
}
