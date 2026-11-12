// Builds android/assets/almanac.bin from the vendored 6tail lunar library, so the
// RP1 computes the calendar offline with exactly the server's historical results.
// Record (13 bytes per day from 1900-12-01): lunar month (int8, negative = leap),
// lunar day, term index (255 = none), day/month/year ganzhi index, jianchu index,
// chong zodiac index, sha direction index, yi list id (u16), ji list id (u16).
import { writeFileSync } from 'node:fs';
import lunar from '../ha-app/server/vendor/chinese_calendar.mjs';

const GANZHI = [];
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
for (let i = 0; i < 60; i++) GANZHI.push(STEMS[i % 10] + BRANCHES[i % 12]);
const TERMS = [
  '小寒',
  '大寒',
  '立春',
  '雨水',
  '惊蛰',
  '春分',
  '清明',
  '谷雨',
  '立夏',
  '小满',
  '芒种',
  '夏至',
  '小暑',
  '大暑',
  '立秋',
  '处暑',
  '白露',
  '秋分',
  '寒露',
  '霜降',
  '立冬',
  '小雪',
  '大雪',
  '冬至',
];
const JIANCHU = '建除满平定执破危成收开闭';
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const SHA = '东南西北';
const DAY_MS = 86400000;
const FIRST = Date.UTC(1900, 11, 1);
const LAST = Date.UTC(2100, 0, 31);
const RECORD = 13;
const lists = new Map([['', 0]]);
const listId = (words) => {
  const key = words.join(' ');
  if (!lists.has(key)) lists.set(key, lists.size);
  return lists.get(key);
};
const index = (table, value, what) => {
  const i = table.indexOf(value);
  if (i < 0) throw new Error(`Unknown ${what}: ${value}`);
  return i;
};
const days = (LAST - FIRST) / DAY_MS + 1;
const records = Buffer.alloc(days * RECORD);
for (let n = 0; n < days; n++) {
  const date = new Date(FIRST + n * DAY_MS);
  const lunarDay = lunar.Solar.fromYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()).getLunar();
  const term = lunarDay.getJieQi();
  const recordOffset = n * RECORD;
  records.writeInt8(lunarDay.getMonth(), recordOffset);
  records.writeUInt8(lunarDay.getDay(), recordOffset + 1);
  records.writeUInt8(term ? index(TERMS, term, 'term') : 255, recordOffset + 2);
  records.writeUInt8(index(GANZHI, lunarDay.getDayInGanZhi(), 'day ganzhi'), recordOffset + 3);
  records.writeUInt8(index(GANZHI, lunarDay.getMonthInGanZhi(), 'month ganzhi'), recordOffset + 4);
  records.writeUInt8(index(GANZHI, lunarDay.getYearInGanZhiByLiChun(), 'year ganzhi'), recordOffset + 5);
  records.writeUInt8(index(JIANCHU, lunarDay.getZhiXing(), 'jianchu'), recordOffset + 6);
  records.writeUInt8(index(ZODIAC, lunarDay.getDayChongShengXiao(), 'chong'), recordOffset + 7);
  records.writeUInt8(index(SHA, lunarDay.getDaySha(), 'sha'), recordOffset + 8);
  records.writeUInt16BE(listId(lunarDay.getDayYi()), recordOffset + 9);
  records.writeUInt16BE(listId(lunarDay.getDayJi()), recordOffset + 11);
}
const target = new URL('../android/assets/', import.meta.url);
writeFileSync(new URL('almanac.bin', target), records);
writeFileSync(new URL('almanac-lists.txt', target), [...lists.keys()].join('\n') + '\n');
console.log(`almanac: ${days} days, ${lists.size} yi/ji lists, ${records.length} bytes`);
