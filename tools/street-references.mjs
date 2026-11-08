// Hand-recorded observations from street-level reference (Kakao Roadview, June 2026).
// Only facts are recorded here: shop names, sign colours, floor counts. No imagery is used.
// x/z are scene metres: +x east, +z south of the Yonsei main gate.

/** Sign colours per brand keyword. Text only: logos are not reproduced. */
export const BRAND_STYLES = [
  [/스타벅스|starbucks/i, '#00704a', '#ffffff'], [/맥도날드|mcdonald/i, '#c8201a', '#ffc72c'],
  [/버거킹|burger king/i, '#b5121b', '#f5e6c8'], [/빽다방/, '#ffd400', '#2a1a10'],
  [/gs25/i, '#0a7bc4', '#ffffff'], [/^cu$/i, '#652d90', '#b6d433'], [/이마트24/, '#f8c200', '#2b2b2b'],
  [/올리브영|olive young/i, '#9bc53d', '#ffffff'], [/컴포즈/, '#ffd200', '#1b2a5b'], [/메가/, '#ffd700', '#40281a'],
  [/투썸/, '#3a1f1a', '#ffffff'], [/할리스|hollys/i, '#b5121b', '#ffffff'], [/엔제리너스/, '#5a2a1c', '#ffffff'],
  [/커피빈/, '#4b2a7b', '#ffffff'], [/이디야/, '#1b2f6b', '#ffffff'], [/설빙/, '#f4f4f0', '#d0314e'],
  [/파리바게/, '#123a7a', '#ffffff'], [/공차/, '#b3122d', '#ffffff'], [/baskin|배스킨/i, '#f0468c', '#1c55a6'],
  [/써브웨이|subway/i, '#00823b', '#ffc20e'], [/타코벨|taco bell/i, '#6a2c91', '#ffffff'], [/KB/, '#ffbc00', '#5a524a'],
  [/새마을금고/, '#0a5bab', '#ffffff'], [/LG유플러스/, '#e6007e', '#ffffff'], [/SK텔레콤/, '#ea002c', '#ffffff'],
  [/유니클로/, '#e60012', '#ffffff'], [/알라딘/, '#3ab0c9', '#ffffff'], [/홍익문고/, '#14482f', '#ffffff'],
  [/약국|chemist/i, '#ffffff', '#d3202a'], [/의원|치과|병원|피부과|안과/, '#f5f8fb', '#17609b'],
];

export const CATEGORY_STYLES = {
  cafe: ['#4b3425', '#f6e7cf'], restaurant: ['#a8321e', '#fff4d6'], fast_food: ['#c9301c', '#ffffff'],
  pub: ['#20262e', '#ffcf4a'], bar: ['#20262e', '#ffcf4a'], hairdresser: ['#26272c', '#ffffff'], beauty: ['#f3c6d3', '#50233a'],
  clothes: ['#f6f4ef', '#1d1d1f'], shoes: ['#1d1d1f', '#ffffff'], cosmetics: ['#f7d6df', '#7a1f45'], karaoke_box: ['#5d1f8c', '#ffe45e'],
  internet_cafe: ['#0d3b75', '#7ee3ff'], fitness_centre: ['#101820', '#f5d21f'], doctors: ['#f5f8fb', '#17609b'], dentist: ['#f5f8fb', '#17609b'],
  bakery: ['#f3e3c7', '#6b3a1e'], convenience: ['#127a55', '#ffffff'], books: ['#1f4a38', '#ffffff'], bank: ['#14457f', '#ffffff'],
  mobile_phone: ['#d3002c', '#ffffff'], games: ['#ef6c1a', '#ffffff'],
};

/** Signs legible in the reference that OSM does not list, or need the observed colours. */
export const OBSERVED_SHOPS = [
  { n: '대학약국', x: 0, z: 154, floor: 0, bg: '#1f55b0', fg: '#ffe14a', replace: /대학약국/ },
  { n: '세란약국', x: -3, z: 144, floor: 0, bg: '#c81f2c', fg: '#ffffff', replace: /세란약국/ },
  { n: 'Let me Alone', x: -13, z: 140, floor: 1, bg: '#3d4145', fg: '#ffffff', replace: /let me alone/i },
  { n: '아크 PC', x: 39, z: 191, floor: 2, bg: '#24303d', fg: '#ffffff', replace: /아크 ?pc/i },
  { n: '독수리약국', x: 32, z: 184, floor: 0, bg: '#7a5a3c', fg: '#ffffff', replace: /독수리약국/ },
  { n: 'GACHA', x: 23, z: 304, floor: 0, bg: '#d3127c', fg: '#ffffff' },
  { n: '24h Caffeine', x: 24, z: 326, floor: 2, bg: '#f1eee4', fg: '#2e6a4f' },
  { n: 'CHAGEE', x: -6, z: 334, floor: 0, bg: '#4a2d20', fg: '#f1dfc0' },
  { n: 'PILATES GARDEN', x: -6, z: 334, floor: 2, bg: '#262626', fg: '#ffffff' },
  { n: 'M PLAYGROUND', x: 23, z: 471, floor: 0, bg: '#1466c1', fg: '#ffffff', replace: /엠플레이그라운드/ },
  { n: '보드게임카페 레드버튼', x: 25, z: 472, floor: 4, bg: '#34363b', fg: '#ffffff', replace: /레드버튼/ },
  { n: '박승철헤어스투디오', x: 21, z: 471, floor: 1, bg: '#efe9dc', fg: '#a2252b', replace: /박승철/ },
  { n: 'HAIR RUAV', x: 18, z: 480, floor: 1, bg: '#f2f1ec', fg: '#46677c', replace: /헤어루아브/ },
  { n: '역전우동', x: 18, z: 491, floor: 2, bg: '#6b4228', fg: '#ffffff', replace: /역전우동/ },
  { n: 'Lee', x: 17, z: 497, floor: 0, bg: '#efefe8', fg: '#333333' },
  { n: 'BONG GUN', x: 17, z: 506, floor: 0, bg: '#e01a6e', fg: '#ffffff' },
  { n: '으뜸50안경', x: 18, z: 503, floor: 3, bg: '#e01a6e', fg: '#ffffff' },
  { n: '보드게임 카페', x: 26, z: 445, floor: 1, bg: '#1c1f3a', fg: '#ffd400' },
];

/** Floor counts and materials seen in the reference. `at` picks the footprint. */
export const OBSERVED_BUILDINGS = [
  { at: [0, 154], floors: 1, height: 6, tint: '#e4e1d8' },
  { at: [-13, 140], floors: 4, tint: '#7f8488', style: 'curtain' },
  { at: [-5, 175], floors: 4, tint: '#cdbfa9' },
  { at: [25, 135], floors: 3, tint: '#ece9e1' },
  { at: [39, 191], floors: 6, tint: '#86a79f', style: 'curtain' },
  { at: [-5, 292], floors: 4, tint: '#d9d7d0' },
  { at: [-6, 334], floors: 5, tint: '#6f7a7c', style: 'curtain' },
  { at: [24, 326], floors: 4, tint: '#f0eee7' },
  { at: [22, 430], floors: 3, tint: '#a8b4b6', style: 'curtain' },
  { at: [-17, 409], floors: 13, tint: '#3f9fd0', style: 'blueglass' },
  { at: [25, 472], floors: 5, tint: '#55565b' },
  { at: [18, 480], floors: 4, tint: '#efeee8' },
  { at: [18, 491], floors: 4, tint: '#8d5a3c', style: 'brick' },
  { at: [22, 506], floors: 5, tint: '#e8c84a' },
];
