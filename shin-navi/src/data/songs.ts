// Demo song seed. Titles/artists/years are public metadata; lyrics are never included.
// energy, vibes (hypothesis tags), vocal ranges and "known" rates are demo estimates, not measured data.

export type Genre =
  | 'J-POP'
  | 'ロック'
  | 'アニメ'
  | 'ボカロ'
  | 'アイドル'
  | 'K-POP'
  | '洋楽'
  | '歌謡曲'
  | '演歌'
  | 'シティポップ'
  | 'ヒップホップ'
  | 'C-POP'

export type Vibe =
  | '盛り上がる'
  | 'しっとり'
  | 'エモい'
  | 'みんなで'
  | 'ノれる'
  | '泣ける'
  | '叫べる'
  | '懐かしい'
  | 'かっこいい'
  | 'かわいい'
  | 'デュエット'
  | 'ラスト向き'
  | '1曲目向き'

export type Lang = 'ja' | 'en' | 'ko' | 'zh'

export type Generation = 10 | 20 | 30 | 40 | 50

export type LocalTitles = { romaji?: string; en?: string; zhHant?: string; zhHans?: string; ko?: string }

export type Song = {
  id: string
  title: string
  artist: string
  year: number
  genre: Genre
  bpm: number
  tempo: 'slow' | 'mid' | 'fast'
  /** 0..1, how much the song lifts a room (hypothesis) */
  energy: number
  /** hypothesis tags (空気感). Evidence tags are genre/year/tempo/lang. */
  vibes: Vibe[]
  /** comfortable range estimate as MIDI note numbers (C4 = 60) */
  range: [number, number]
  /** share of each generation assumed to know the song, 0..100 (demo estimate) */
  known: Record<Generation, number>
  lang: Lang
  titles: LocalTitles
}

type Row = [
  id: string,
  title: string,
  artist: string,
  year: number,
  genre: Genre,
  bpm: number,
  energy: number,
  vibes: Vibe[],
  range: [number, number],
  known: [number, number, number, number, number],
  lang?: Lang,
  titles?: LocalTitles,
]

const ROWS: Row[] = [
  // --- 2020s J-POP / ロック
  ['yoru-ni-kakeru', '夜に駆ける', 'YOASOBI', 2019, 'J-POP', 130, 0.8, ['ノれる', 'エモい', 'みんなで'], [56, 75], [95, 92, 80, 60, 40], 'ja', { romaji: 'Yoru ni Kakeru', en: 'Into the Night', zhHant: '向夜晚奔去', zhHans: '向夜晚奔去', ko: '밤을 달리다' }],
  ['idol', 'アイドル', 'YOASOBI', 2023, 'アニメ', 166, 0.95, ['盛り上がる', 'かっこいい', '叫べる'], [57, 77], [97, 90, 72, 50, 30], 'ja', { romaji: 'Idol', en: 'Idol', zhHant: '偶像', zhHans: '偶像', ko: '아이돌' }],
  ['gunjou', '群青', 'YOASOBI', 2020, 'J-POP', 130, 0.75, ['エモい', 'みんなで'], [55, 74], [90, 85, 65, 45, 25], 'ja', { romaji: 'Gunjou', en: 'Blue', zhHant: '群青', zhHans: '群青', ko: '군청' }],
  ['kaibutsu', '怪物', 'YOASOBI', 2021, 'アニメ', 162, 0.9, ['かっこいい', 'ノれる'], [57, 76], [88, 80, 55, 35, 18], 'ja', { romaji: 'Kaibutsu', en: 'Monster', zhHant: '怪物', zhHans: '怪物', ko: '괴물' }],
  ['yuusha', '勇者', 'YOASOBI', 2023, 'アニメ', 148, 0.8, ['エモい', 'かっこいい'], [56, 75], [85, 74, 50, 30, 15], 'ja', { romaji: 'Yuusha', en: 'The Brave', zhHant: '勇者', zhHans: '勇者', ko: '용사' }],
  ['lemon', 'Lemon', '米津玄師', 2018, 'J-POP', 87, 0.4, ['しっとり', '泣ける', 'エモい'], [50, 69], [94, 95, 88, 75, 55], 'ja', { romaji: 'Lemon', en: 'Lemon', zhHant: 'Lemon', zhHans: 'Lemon', ko: 'Lemon' }],
  ['kick-back', 'KICK BACK', '米津玄師', 2022, 'アニメ', 186, 0.95, ['叫べる', 'かっこいい', '盛り上がる'], [50, 72], [85, 78, 55, 30, 12], 'ja', { romaji: 'KICK BACK', en: 'KICK BACK' }],
  ['kanden', '感電', '米津玄師', 2020, 'J-POP', 134, 0.8, ['ノれる', 'かっこいい'], [50, 69], [70, 72, 60, 40, 20], 'ja', { romaji: 'Kanden', en: 'Kanden' }],
  ['uchiage-hanabi', '打上花火', 'DAOKO×米津玄師', 2017, 'J-POP', 96, 0.45, ['エモい', 'デュエット', 'しっとり'], [53, 72], [85, 88, 72, 50, 30], 'ja', { romaji: 'Uchiage Hanabi', en: 'Fireworks' }],
  ['pretender', 'Pretender', 'Official髭男dism', 2019, 'J-POP', 92, 0.6, ['エモい', 'みんなで', '泣ける'], [53, 74], [92, 94, 88, 70, 45], 'ja', { romaji: 'Pretender', en: 'Pretender', zhHant: 'Pretender', zhHans: 'Pretender', ko: 'Pretender' }],
  ['subtitle', 'Subtitle', 'Official髭男dism', 2022, 'J-POP', 116, 0.55, ['エモい', '泣ける'], [53, 76], [85, 86, 70, 45, 25], 'ja', { romaji: 'Subtitle', en: 'Subtitle' }],
  ['mixed-nuts', 'ミックスナッツ', 'Official髭男dism', 2022, 'アニメ', 162, 0.85, ['ノれる', '盛り上がる'], [53, 74], [88, 80, 60, 38, 18], 'ja', { romaji: 'Mixed Nuts', en: 'Mixed Nuts' }],
  ['film-115', '115万キロのフィルム', 'Official髭男dism', 2018, 'J-POP', 130, 0.6, ['エモい', 'デュエット'], [53, 72], [70, 78, 55, 30, 12], 'ja', { romaji: '115 Man Kiro no Film' }],
  ['marigold', 'マリーゴールド', 'あいみょん', 2018, 'J-POP', 87, 0.5, ['エモい', 'みんなで', 'しっとり'], [53, 69], [90, 92, 85, 65, 40], 'ja', { romaji: 'Marigold', en: 'Marigold', zhHant: '萬壽菊', zhHans: '万寿菊', ko: '마리골드' }],
  ['kimi-rock', '君はロックを聴かない', 'あいみょん', 2017, 'J-POP', 76, 0.5, ['エモい', 'かっこいい'], [52, 69], [80, 84, 65, 40, 18], 'ja', { romaji: 'Kimi wa Rock wo Kikanai' }],
  ['hakujitsu', '白日', 'King Gnu', 2019, 'J-POP', 92, 0.5, ['エモい', 'しっとり', 'かっこいい'], [50, 76], [85, 90, 75, 50, 25], 'ja', { romaji: 'Hakujitsu', en: 'Hakujitsu' }],
  ['specialz', 'SPECIALZ', 'King Gnu', 2023, 'アニメ', 140, 0.85, ['かっこいい', '叫べる'], [50, 74], [80, 75, 50, 28, 10], 'ja', { romaji: 'SPECIALZ' }],
  ['ichizu', '一途', 'King Gnu', 2021, 'アニメ', 180, 0.9, ['叫べる', 'かっこいい'], [50, 74], [75, 72, 48, 25, 8], 'ja', { romaji: 'Ichizu' }],
  ['suiheisen', '水平線', 'back number', 2020, 'J-POP', 80, 0.4, ['泣ける', 'しっとり', 'エモい'], [52, 71], [85, 82, 60, 38, 18], 'ja', { romaji: 'Suiheisen' }],
  ['takane-hanako', '高嶺の花子さん', 'back number', 2013, 'J-POP', 128, 0.7, ['ノれる', 'みんなで'], [52, 71], [82, 88, 75, 45, 20], 'ja', { romaji: 'Takane no Hanako-san' }],
  ['neko', '猫', 'DISH//', 2017, 'J-POP', 72, 0.35, ['泣ける', 'しっとり'], [50, 69], [85, 86, 65, 40, 18], 'ja', { romaji: 'Neko', en: 'Cat' }],
  ['dry-flower', 'ドライフラワー', '優里', 2020, 'J-POP', 74, 0.35, ['泣ける', 'しっとり', 'エモい'], [50, 71], [88, 86, 62, 38, 16], 'ja', { romaji: 'Dry Flower', en: 'Dried Flower' }],
  ['betelgeuse', 'ベテルギウス', '優里', 2021, 'J-POP', 120, 0.55, ['エモい', 'みんなで'], [50, 72], [80, 76, 50, 28, 10], 'ja', { romaji: 'Betelgeuse' }],
  ['kousui', '香水', '瑛人', 2019, 'J-POP', 72, 0.3, ['しっとり', 'エモい'], [48, 66], [85, 88, 72, 48, 22], 'ja', { romaji: 'Kousui', en: 'Perfume' }],
  ['gurenge', '紅蓮華', 'LiSA', 2019, 'アニメ', 135, 0.95, ['叫べる', '盛り上がる', 'みんなで', '1曲目向き'], [55, 76], [96, 94, 82, 60, 35], 'ja', { romaji: 'Gurenge', en: 'Red Lotus', zhHant: '紅蓮華', zhHans: '红莲华', ko: '홍련화' }],
  ['homura', '炎', 'LiSA', 2020, 'アニメ', 96, 0.5, ['泣ける', 'エモい'], [55, 76], [85, 84, 66, 45, 22], 'ja', { romaji: 'Homura', zhHant: '炎', zhHans: '炎' }],
  ['zankyou-sanka', '残響散歌', 'Aimer', 2022, 'アニメ', 170, 0.9, ['かっこいい', '叫べる'], [53, 74], [88, 80, 55, 30, 12], 'ja', { romaji: 'Zankyou Sanka', en: 'Zankyosanka' }],
  ['shinjidai', '新時代', 'Ado', 2022, 'アニメ', 132, 0.9, ['盛り上がる', 'かっこいい', '叫べる'], [55, 79], [92, 85, 62, 40, 20], 'ja', { romaji: 'Shin Jidai', en: 'New Genesis', zhHant: '新時代', zhHans: '新时代', ko: '신시대' }],
  ['usseewa', 'うっせぇわ', 'Ado', 2020, 'J-POP', 178, 0.95, ['叫べる', '盛り上がる'], [53, 77], [92, 85, 60, 35, 15], 'ja', { romaji: 'Usseewa' }],
  ['watashi-saikyo', '私は最強', 'Ado', 2022, 'アニメ', 170, 0.85, ['盛り上がる', 'かっこいい'], [55, 77], [80, 70, 45, 25, 10], 'ja', { romaji: 'Watashi wa Saikyou', en: "I'm Invincible" }],
  ['bbbb', 'Bling-Bang-Bang-Born', 'Creepy Nuts', 2024, 'ヒップホップ', 160, 0.95, ['盛り上がる', 'ノれる', 'みんなで'], [50, 68], [95, 88, 60, 32, 12], 'ja', { romaji: 'Bling-Bang-Bang-Born', en: 'Bling-Bang-Bang-Born' }],
  ['otonoke', 'オトノケ', 'Creepy Nuts', 2024, 'ヒップホップ', 180, 0.9, ['かっこいい', 'ノれる'], [50, 67], [80, 70, 40, 20, 6], 'ja', { romaji: 'Otonoke' }],
  ['bansanka', '晩餐歌', 'tuki.', 2023, 'J-POP', 76, 0.35, ['しっとり', '泣ける'], [55, 74], [80, 62, 32, 15, 6], 'ja', { romaji: 'Bansanka' }],
  ['kaiju-hanauta', '怪獣の花唄', 'Vaundy', 2020, 'ロック', 186, 0.9, ['叫べる', '盛り上がる', 'ラスト向き'], [52, 72], [88, 82, 55, 28, 10], 'ja', { romaji: 'Kaiju no Hanauta' }],
  ['odoriko', '踊り子', 'Vaundy', 2021, 'J-POP', 128, 0.6, ['ノれる', 'エモい'], [52, 70], [78, 76, 48, 22, 8], 'ja', { romaji: 'Odoriko' }],
  ['cinderella-boy', 'シンデレラボーイ', 'Saucy Dog', 2021, 'ロック', 80, 0.45, ['エモい', 'しっとり'], [50, 71], [82, 76, 45, 20, 6], 'ja', { romaji: 'Cinderella Boy' }],
  ['que-sera', 'ケセラセラ', 'Mrs. GREEN APPLE', 2023, 'J-POP', 96, 0.75, ['みんなで', 'エモい', 'ラスト向き'], [55, 77], [92, 85, 62, 38, 15], 'ja', { romaji: 'Que Sera Sera' }],
  ['lilac', 'ライラック', 'Mrs. GREEN APPLE', 2024, 'アニメ', 128, 0.85, ['ノれる', 'エモい', 'みんなで'], [55, 77], [93, 84, 58, 30, 12], 'ja', { romaji: 'Lilac', en: 'Lilac' }],
  ['ao-to-natsu', '青と夏', 'Mrs. GREEN APPLE', 2018, 'J-POP', 176, 0.9, ['盛り上がる', 'みんなで', '1曲目向き'], [55, 76], [94, 86, 58, 30, 12], 'ja', { romaji: 'Ao to Natsu' }],
  ['overdose', 'Overdose', 'なとり', 2022, 'J-POP', 124, 0.6, ['ノれる', 'かっこいい'], [50, 69], [82, 70, 38, 16, 5], 'ja', { romaji: 'Overdose' }],
  ['mela', 'Mela!', '緑黄色社会', 2020, 'J-POP', 172, 0.9, ['盛り上がる', 'みんなで'], [57, 76], [80, 72, 45, 22, 8], 'ja', { romaji: 'Mela!' }],
  ['kaikai-kitan', '廻廻奇譚', 'Eve', 2020, 'アニメ', 186, 0.9, ['かっこいい', '叫べる'], [53, 72], [85, 76, 45, 20, 6], 'ja', { romaji: 'Kaikai Kitan', zhHant: '廻廻奇譚', zhHans: '廻廻奇谭' }],
  ['ao-no-sumika', '青のすみか', 'キタニタツヤ', 2023, 'アニメ', 104, 0.6, ['エモい', 'かっこいい'], [52, 72], [85, 75, 45, 22, 8], 'ja', { romaji: 'Ao no Sumika', en: 'Where Our Blue Is' }],
  ['kawaikute-gomen', '可愛くてごめん', 'HoneyWorks feat. かぴ', 2022, 'ボカロ', 200, 0.9, ['かわいい', '盛り上がる'], [58, 78], [90, 62, 28, 12, 4], 'ja', { romaji: 'Kawaikute Gomen' }],
  ['shukufuku', '祝福', 'YOASOBI', 2022, 'アニメ', 140, 0.85, ['かっこいい', 'エモい'], [56, 76], [80, 68, 40, 20, 8], 'ja', { romaji: 'Shukufuku', en: 'The Blessing' }],
  ['koi', '恋', '星野源', 2016, 'J-POP', 172, 0.9, ['みんなで', 'ノれる', '盛り上がる'], [52, 69], [90, 94, 92, 80, 55], 'ja', { romaji: 'Koi', en: 'Koi' }],
  ['sun', 'SUN', '星野源', 2015, 'J-POP', 130, 0.8, ['ノれる', 'みんなで', '1曲目向き'], [50, 67], [70, 85, 82, 65, 40], 'ja', { romaji: 'SUN' }],
  ['zenzenzense', '前前前世', 'RADWIMPS', 2016, 'ロック', 190, 0.95, ['叫べる', '盛り上がる', 'みんなで'], [52, 72], [92, 94, 85, 55, 25], 'ja', { romaji: 'Zenzenzense', en: 'Zenzenzense', zhHant: '前前前世', zhHans: '前前前世', ko: '전전전세' }],
  ['sparkle', 'スパークル', 'RADWIMPS', 2016, 'ロック', 136, 0.55, ['エモい', '泣ける'], [52, 72], [65, 75, 60, 35, 12], 'ja', { romaji: 'Sparkle' }],
  // --- 2000s-2010s
  ['tenkyu', '天体観測', 'BUMP OF CHICKEN', 2001, 'ロック', 158, 0.85, ['叫べる', 'みんなで', '懐かしい'], [52, 71], [70, 85, 94, 82, 50], 'ja', { romaji: 'Tentai Kansoku', en: 'Stargazing' }],
  ['chiisana-koi', '小さな恋のうた', 'MONGOL800', 2001, 'ロック', 188, 0.95, ['叫べる', 'みんなで', 'ラスト向き'], [52, 71], [85, 92, 95, 82, 50], 'ja', { romaji: 'Chiisana Koi no Uta', en: 'Little Love Song' }],
  ['aiuta', '愛唄', 'GReeeeN', 2007, 'J-POP', 84, 0.45, ['しっとり', 'エモい', 'みんなで'], [52, 72], [72, 86, 92, 72, 40], 'ja', { romaji: 'Ai Uta' }],
  ['kiseki', 'キセキ', 'GReeeeN', 2008, 'J-POP', 88, 0.55, ['みんなで', 'エモい'], [52, 72], [78, 90, 94, 75, 45], 'ja', { romaji: 'Kiseki', en: 'Miracle' }],
  ['hanamizuki', 'ハナミズキ', '一青窈', 2004, 'J-POP', 80, 0.3, ['しっとり', '泣ける'], [55, 72], [70, 82, 92, 88, 70], 'ja', { romaji: 'Hanamizuki', en: 'Dogwood' }],
  ['kanade', '奏(かなで)', 'スキマスイッチ', 2004, 'J-POP', 82, 0.4, ['泣ける', 'エモい'], [52, 72], [72, 84, 90, 78, 50], 'ja', { romaji: 'Kanade' }],
  ['zenryoku-shonen', '全力少年', 'スキマスイッチ', 2005, 'J-POP', 136, 0.8, ['みんなで', 'ノれる'], [52, 71], [60, 78, 88, 72, 42], 'ja', { romaji: 'Zenryoku Shounen' }],
  ['sekai-hana', '世界に一つだけの花', 'SMAP', 2003, 'J-POP', 94, 0.6, ['みんなで', '懐かしい', 'ラスト向き'], [52, 67], [85, 92, 96, 94, 85], 'ja', { romaji: 'Sekai ni Hitotsu Dake no Hana', en: 'The Only Flower in the World' }],
  ['fortune-cookie', '恋するフォーチュンクッキー', 'AKB48', 2013, 'アイドル', 120, 0.85, ['みんなで', '盛り上がる', 'ノれる'], [55, 70], [80, 90, 88, 70, 45], 'ja', { romaji: 'Koisuru Fortune Cookie' }],
  ['memeshikute', '女々しくて', 'ゴールデンボンバー', 2009, 'ロック', 162, 0.95, ['盛り上がる', '叫べる', 'みんなで'], [52, 72], [70, 88, 94, 82, 55], 'ja', { romaji: 'Memeshikute' }],
  ['kona-yuki', '粉雪', 'レミオロメン', 2005, 'ロック', 132, 0.7, ['叫べる', '泣ける'], [52, 74], [60, 76, 90, 75, 45], 'ja', { romaji: 'Konayuki', en: 'Powder Snow' }],
  ['sakuranbo', 'さくらんぼ', '大塚愛', 2003, 'J-POP', 180, 0.9, ['かわいい', '盛り上がる', 'みんなで'], [57, 74], [65, 82, 94, 82, 50], 'ja', { romaji: 'Sakuranbo', en: 'Cherries' }],
  ['kimi-shiranai', '君の知らない物語', 'supercell', 2009, 'アニメ', 140, 0.75, ['エモい', 'みんなで'], [55, 74], [70, 85, 88, 55, 20], 'ja', { romaji: 'Kimi no Shiranai Monogatari' }],
  ['hanabi-mrchildren', 'HANABI', 'Mr.Children', 2008, 'ロック', 128, 0.7, ['エモい', '叫べる'], [52, 72], [55, 75, 88, 85, 60], 'ja', { romaji: 'HANABI' }],
  ['suirenka', '睡蓮花', '湘南乃風', 2007, 'ヒップホップ', 150, 0.95, ['盛り上がる', '叫べる', 'みんなで'], [48, 67], [55, 78, 92, 80, 45], 'ja', { romaji: 'Suirenka' }],
  ['hero-namie', 'Hero', '安室奈美恵', 2016, 'J-POP', 146, 0.7, ['エモい', 'かっこいい'], [55, 74], [55, 72, 85, 85, 65], 'ja', { romaji: 'Hero' }],
  ['hanataba', '花束を君に', '宇多田ヒカル', 2016, 'J-POP', 92, 0.4, ['しっとり', '泣ける'], [52, 72], [60, 75, 85, 82, 65], 'ja', { romaji: 'Hanataba wo Kimi ni' }],
  // --- ボカロ
  ['senbonzakura', '千本桜', '黒うさP feat. 初音ミク', 2011, 'ボカロ', 154, 0.9, ['盛り上がる', 'かっこいい', 'みんなで'], [57, 76], [92, 90, 72, 40, 15], 'ja', { romaji: 'Senbonzakura', en: 'Senbonzakura', zhHant: '千本櫻', zhHans: '千本樱', ko: '센본자쿠라' }],
  ['charles', 'シャルル', 'バルーン', 2016, 'ボカロ', 162, 0.8, ['エモい', 'かっこいい'], [55, 74], [85, 78, 45, 18, 5], 'ja', { romaji: 'Charles' }],
  ['suna-no-wakusei', '砂の惑星', 'ハチ feat. 初音ミク', 2017, 'ボカロ', 180, 0.8, ['かっこいい', 'ノれる'], [55, 74], [78, 72, 42, 16, 4], 'ja', { romaji: 'Suna no Wakusei', en: 'DUNE' }],
  // --- アニメ定番
  ['zankoku', '残酷な天使のテーゼ', '高橋洋子', 1995, 'アニメ', 128, 0.9, ['盛り上がる', 'みんなで', '懐かしい', '1曲目向き'], [55, 74], [88, 94, 97, 92, 70], 'ja', { romaji: 'Zankoku na Tenshi no Teeze', en: "A Cruel Angel's Thesis", zhHant: '殘酷天使的行動綱領', zhHans: '残酷天使的行动纲领', ko: '잔혹한 천사의 테제' }],
  ['tamashii-refrain', '魂のルフラン', '高橋洋子', 1997, 'アニメ', 128, 0.75, ['エモい', '懐かしい'], [55, 74], [55, 70, 85, 80, 55], 'ja', { romaji: 'Tamashii no Refrain', en: 'Soul\'s Refrain' }],
  ['cha-la', 'CHA-LA HEAD-CHA-LA', '影山ヒロノブ', 1989, 'アニメ', 156, 0.95, ['盛り上がる', '叫べる', 'みんなで', '懐かしい'], [52, 72], [70, 85, 95, 94, 80], 'ja', { romaji: 'CHA-LA HEAD-CHA-LA', en: 'CHA-LA HEAD-CHA-LA', zhHant: 'CHA-LA HEAD-CHA-LA', zhHans: 'CHA-LA HEAD-CHA-LA', ko: 'CHA-LA HEAD-CHA-LA' }],
  ['god-knows', 'God knows...', '平野綾', 2006, 'アニメ', 172, 0.9, ['かっこいい', '叫べる'], [57, 76], [55, 80, 88, 55, 20], 'ja', { romaji: 'God knows...' }],
  ['only-my-railgun', 'only my railgun', 'fripSide', 2009, 'アニメ', 150, 0.9, ['盛り上がる', 'かっこいい'], [57, 76], [58, 82, 85, 50, 18], 'ja', { romaji: 'only my railgun' }],
  ['unravel', 'unravel', 'TK from 凛として時雨', 2014, 'アニメ', 136, 0.85, ['叫べる', 'かっこいい'], [55, 79], [75, 88, 82, 50, 18], 'ja', { romaji: 'unravel', en: 'unravel', zhHant: 'unravel', zhHans: 'unravel', ko: 'unravel' }],
  ['guren-no-yumiya', '紅蓮の弓矢', 'Linked Horizon', 2013, 'アニメ', 178, 0.95, ['叫べる', '盛り上がる', 'みんなで'], [52, 74], [80, 92, 85, 55, 20], 'ja', { romaji: 'Guren no Yumiya', en: 'Crimson Bow and Arrow', zhHant: '紅蓮的弓矢', zhHans: '红莲的弓矢', ko: '홍련의 화살' }],
  ['aquarion', '創聖のアクエリオン', 'AKINO', 2005, 'アニメ', 150, 0.8, ['盛り上がる', '懐かしい'], [57, 76], [55, 75, 88, 70, 35], 'ja', { romaji: 'Sousei no Aquarion' }],
  ['japari-park', 'ようこそジャパリパークへ', 'どうぶつビスケッツ×PPP', 2017, 'アニメ', 180, 0.95, ['かわいい', '盛り上がる', 'みんなで'], [57, 76], [70, 80, 70, 40, 12], 'ja', { romaji: 'Youkoso Japari Park e', en: 'Welcome to Japari Park' }],
  ['moonlight-densetsu', 'ムーンライト伝説', 'DALI', 1992, 'アニメ', 144, 0.75, ['懐かしい', 'かわいい', 'みんなで'], [57, 74], [65, 82, 92, 85, 55], 'ja', { romaji: 'Moonlight Densetsu', en: 'Moonlight Legend', zhHant: '月光傳說', zhHans: '月光传说', ko: '문라이트 전설' }],
  ['renai-circulation', '恋愛サーキュレーション', '花澤香菜', 2012, 'アニメ', 124, 0.7, ['かわいい', 'ノれる'], [57, 74], [70, 80, 72, 35, 10], 'ja', { romaji: 'Renai Circulation', en: 'Love Circulation' }],
  // --- 90s / 平成
  ['cherry', 'チェリー', 'スピッツ', 1996, 'ロック', 126, 0.6, ['みんなで', 'エモい', '懐かしい'], [52, 71], [72, 85, 94, 94, 75], 'ja', { romaji: 'Cherry' }],
  ['robinson', 'ロビンソン', 'スピッツ', 1995, 'ロック', 116, 0.5, ['エモい', '懐かしい'], [52, 71], [60, 75, 90, 94, 78], 'ja', { romaji: 'Robinson' }],
  ['first-love', 'First Love', '宇多田ヒカル', 1999, 'J-POP', 88, 0.3, ['泣ける', 'しっとり'], [53, 72], [70, 82, 94, 96, 85], 'ja', { romaji: 'First Love', en: 'First Love', zhHant: 'First Love', zhHans: 'First Love', ko: 'First Love' }],
  ['automatic', 'Automatic', '宇多田ヒカル', 1998, 'J-POP', 104, 0.5, ['かっこいい', '懐かしい'], [53, 70], [55, 72, 90, 94, 80], 'ja', { romaji: 'Automatic' }],
  ['marunouchi', '丸の内サディスティック', '椎名林檎', 1999, 'ロック', 92, 0.55, ['かっこいい', 'ノれる'], [53, 71], [70, 85, 90, 85, 60], 'ja', { romaji: 'Marunouchi Sadistic' }],
  ['kabutomushi', 'カブトムシ', 'aiko', 1999, 'J-POP', 76, 0.35, ['しっとり', 'エモい'], [55, 74], [60, 78, 92, 90, 65], 'ja', { romaji: 'Kabutomushi', en: 'Beetle' }],
  ['love-machine', 'LOVEマシーン', 'モーニング娘。', 1999, 'アイドル', 134, 0.95, ['盛り上がる', 'みんなで', '懐かしい'], [55, 72], [55, 75, 92, 96, 85], 'ja', { romaji: 'LOVE Machine' }],
  ['yozora-no-mukou', '夜空ノムコウ', 'SMAP', 1998, 'J-POP', 72, 0.35, ['しっとり', '懐かしい'], [50, 66], [45, 62, 85, 94, 88], 'ja', { romaji: 'Yozora no Mukou' }],
  ['innocent-world', 'innocent world', 'Mr.Children', 1994, 'ロック', 136, 0.7, ['みんなで', '懐かしい'], [52, 72], [40, 58, 85, 95, 85], 'ja', { romaji: 'innocent world' }],
  ['tsunami', 'TSUNAMI', 'サザンオールスターズ', 2000, 'J-POP', 76, 0.4, ['しっとり', '泣ける', '懐かしい'], [50, 69], [55, 72, 90, 96, 94], 'ja', { romaji: 'TSUNAMI' }],
  ['makenaide', '負けないで', 'ZARD', 1993, 'J-POP', 130, 0.75, ['みんなで', '懐かしい', 'ラスト向き'], [55, 72], [70, 82, 92, 96, 92], 'ja', { romaji: 'Makenaide', en: "Don't Give Up" }],
  ['love-love-love', 'LOVE LOVE LOVE', 'DREAMS COME TRUE', 1995, 'J-POP', 72, 0.35, ['しっとり', '泣ける', '懐かしい'], [55, 76], [50, 68, 88, 96, 92], 'ja', { romaji: 'LOVE LOVE LOVE' }],
  ['sekai-ga-owaru', '世界が終るまでは…', 'WANDS', 1994, 'アニメ', 118, 0.7, ['懐かしい', 'エモい'], [52, 72], [60, 75, 90, 95, 85], 'ja', { romaji: 'Sekai ga Owaru made wa' }],
  ['kurenai', '紅', 'X JAPAN', 1989, 'ロック', 196, 0.95, ['叫べる', 'かっこいい', '盛り上がる'], [55, 79], [50, 65, 82, 94, 90], 'ja', { romaji: 'Kurenai', en: 'Crimson' }],
  ['can-you-celebrate', 'CAN YOU CELEBRATE?', '安室奈美恵', 1997, 'J-POP', 76, 0.35, ['しっとり', '懐かしい'], [55, 74], [45, 62, 88, 96, 90], 'ja', { romaji: 'CAN YOU CELEBRATE?' }],
  ['ultra-soul', 'ultra soul', "B'z", 2001, 'ロック', 136, 0.95, ['叫べる', '盛り上がる', 'みんなで'], [52, 76], [70, 85, 94, 96, 88], 'ja', { romaji: 'ultra soul' }],
  ['koishisa', '恋しさと せつなさと 心強さと', '篠原涼子 with t.komuro', 1994, 'J-POP', 136, 0.75, ['叫べる', '懐かしい'], [57, 77], [45, 62, 86, 95, 88], 'ja', { romaji: 'Koishisa to Setsunasa to Kokorozuyosa to' }],
  ['natsumatsuri', '夏祭り', 'Whiteberry', 2000, 'J-POP', 166, 0.85, ['みんなで', '懐かしい', 'エモい'], [55, 74], [72, 85, 92, 80, 55], 'ja', { romaji: 'Natsu Matsuri', en: 'Summer Festival' }],
  ['itoh', '糸', '中島みゆき', 1992, 'J-POP', 72, 0.3, ['泣ける', 'しっとり', 'ラスト向き'], [52, 70], [70, 82, 90, 94, 95], 'ja', { romaji: 'Ito', en: 'Thread' }],
  // --- 昭和・シティポップ・演歌
  ['mayonaka-no-door', '真夜中のドア〜stay with me', '松原みき', 1979, 'シティポップ', 110, 0.55, ['エモい', 'ノれる', '懐かしい'], [55, 74], [55, 60, 65, 75, 88], 'ja', { romaji: 'Mayonaka no Door', en: 'Stay With Me' }],
  ['plastic-love', 'プラスティック・ラブ', '竹内まりや', 1984, 'シティポップ', 104, 0.55, ['ノれる', 'かっこいい', '懐かしい'], [53, 72], [50, 55, 62, 75, 88], 'ja', { romaji: 'Plastic Love', en: 'Plastic Love', zhHant: 'Plastic Love', zhHans: 'Plastic Love', ko: 'Plastic Love' }],
  ['ue-wo-muite', '上を向いて歩こう', '坂本九', 1961, '歌謡曲', 124, 0.5, ['みんなで', '懐かしい'], [52, 67], [70, 72, 80, 90, 97], 'ja', { romaji: 'Ue wo Muite Arukou', en: 'Sukiyaki' }],
  ['kawa-no-nagare', '川の流れのように', '美空ひばり', 1989, '歌謡曲', 70, 0.3, ['しっとり', '泣ける', 'ラスト向き'], [50, 67], [45, 58, 75, 90, 97], 'ja', { romaji: 'Kawa no Nagare no You ni', en: 'Like the Flow of the River' }],
  ['amagi-goe', '天城越え', '石川さゆり', 1986, '演歌', 78, 0.6, ['叫べる', '懐かしい'], [53, 72], [30, 42, 62, 82, 95], 'ja', { romaji: 'Amagi Goe' }],
  ['tsugaru', '津軽海峡・冬景色', '石川さゆり', 1977, '演歌', 80, 0.5, ['懐かしい', 'しっとり'], [53, 71], [28, 40, 58, 80, 95], 'ja', { romaji: 'Tsugaru Kaikyo Fuyugeshiki' }],
  ['ruby-no-yubiwa', 'ルビーの指環', '寺尾聰', 1981, '歌謡曲', 104, 0.4, ['かっこいい', '懐かしい'], [45, 62], [20, 30, 55, 80, 92], 'ja', { romaji: 'Ruby no Yubiwa' }],
  ['akai-sweet-pea', '赤いスイートピー', '松田聖子', 1982, '歌謡曲', 84, 0.35, ['しっとり', '懐かしい'], [55, 72], [35, 48, 70, 88, 95], 'ja', { romaji: 'Akai Sweet Pea', en: 'Red Sweet Pea' }],
  ['ihoujin', '異邦人', '久保田早紀', 1979, '歌謡曲', 120, 0.45, ['エモい', '懐かしい'], [55, 72], [35, 45, 62, 85, 95], 'ja', { romaji: 'Ihoujin', en: 'Stranger' }],
  ['katte-ni-sinbad', '勝手にシンドバッド', 'サザンオールスターズ', 1978, 'ロック', 150, 0.9, ['盛り上がる', '懐かしい'], [50, 69], [40, 55, 72, 90, 95], 'ja', { romaji: 'Katte ni Sinbad' }],
  ['gakuen-tengoku', '学園天国', 'フィンガー5', 1974, '歌謡曲', 150, 0.95, ['盛り上がる', 'みんなで', '1曲目向き'], [55, 72], [60, 70, 82, 90, 95], 'ja', { romaji: 'Gakuen Tengoku', en: 'School Paradise' }],
  ['ai-wa-katsu', '愛は勝つ', 'KAN', 1990, 'J-POP', 128, 0.75, ['みんなで', '懐かしい', 'ラスト向き'], [52, 70], [40, 55, 80, 92, 90], 'ja', { romaji: 'Ai wa Katsu', en: 'Love Wins' }],
  // --- K-POP
  ['dynamite', 'Dynamite', 'BTS', 2020, 'K-POP', 114, 0.9, ['ノれる', '盛り上がる', 'みんなで'], [55, 74], [92, 90, 75, 50, 25], 'en', { romaji: 'Dynamite', en: 'Dynamite', ko: 'Dynamite', zhHant: 'Dynamite', zhHans: 'Dynamite' }],
  ['butter', 'Butter', 'BTS', 2021, 'K-POP', 110, 0.85, ['ノれる', 'かっこいい'], [55, 74], [85, 82, 62, 38, 15], 'en', { romaji: 'Butter', en: 'Butter', ko: 'Butter' }],
  ['super-shy', 'Super Shy', 'NewJeans', 2023, 'K-POP', 150, 0.8, ['かわいい', 'ノれる'], [57, 74], [88, 75, 45, 20, 6], 'en', { romaji: 'Super Shy', en: 'Super Shy', ko: 'Super Shy' }],
  ['ditto', 'Ditto', 'NewJeans', 2022, 'K-POP', 134, 0.5, ['エモい', 'しっとり'], [57, 72], [85, 70, 40, 16, 5], 'ko', { romaji: 'Ditto', en: 'Ditto', ko: 'Ditto' }],
  ['tt', 'TT', 'TWICE', 2016, 'K-POP', 130, 0.85, ['かわいい', 'みんなで', '盛り上がる'], [57, 74], [90, 88, 60, 30, 10], 'ko', { romaji: 'TT', en: 'TT', ko: 'TT' }],
  ['gee', 'Gee', '少女時代', 2009, 'K-POP', 150, 0.9, ['かわいい', '盛り上がる', '懐かしい'], [57, 76], [55, 82, 85, 55, 20], 'ko', { romaji: 'Gee', en: 'Gee', ko: 'Gee', zhHant: 'Gee', zhHans: 'Gee' }],
  ['gangnam', 'Gangnam Style', 'PSY', 2012, 'K-POP', 132, 0.95, ['盛り上がる', 'みんなで'], [48, 67], [70, 85, 88, 72, 40], 'ko', { romaji: 'Gangnam Style', en: 'Gangnam Style', ko: '강남스타일', zhHant: '江南Style', zhHans: '江南Style' }],
  ['next-level', 'Next Level', 'aespa', 2021, 'K-POP', 110, 0.85, ['かっこいい', 'ノれる'], [57, 76], [80, 68, 38, 15, 5], 'ko', { romaji: 'Next Level', en: 'Next Level', ko: 'Next Level' }],
  ['love-dive', 'LOVE DIVE', 'IVE', 2022, 'K-POP', 118, 0.8, ['かっこいい', 'かわいい'], [57, 74], [85, 70, 40, 16, 5], 'ko', { romaji: 'LOVE DIVE', en: 'LOVE DIVE', ko: 'LOVE DIVE' }],
  ['magnetic', 'Magnetic', 'ILLIT', 2024, 'K-POP', 136, 0.8, ['かわいい', 'ノれる'], [57, 74], [88, 65, 32, 12, 4], 'en', { romaji: 'Magnetic', en: 'Magnetic', ko: 'Magnetic' }],
  // --- 洋楽
  ['let-it-go', 'Let It Go', 'Idina Menzel', 2013, '洋楽', 137, 0.8, ['叫べる', 'みんなで', 'エモい'], [55, 77], [90, 92, 88, 72, 50], 'en', { romaji: 'Let It Go', en: 'Let It Go', zhHant: '放開手', zhHans: '随它吧', ko: 'Let It Go' }],
  ['shake-it-off', 'Shake It Off', 'Taylor Swift', 2014, '洋楽', 160, 0.9, ['ノれる', '盛り上がる'], [55, 72], [70, 82, 72, 45, 20], 'en', { en: 'Shake It Off' }],
  ['bohemian', 'Bohemian Rhapsody', 'Queen', 1975, '洋楽', 72, 0.7, ['叫べる', 'エモい', 'みんなで'], [50, 76], [60, 72, 80, 85, 82], 'en', { en: 'Bohemian Rhapsody' }],
  ['we-will-rock-you', 'We Will Rock You', 'Queen', 1977, '洋楽', 81, 0.9, ['盛り上がる', 'みんなで', '1曲目向き'], [52, 67], [75, 82, 85, 88, 85], 'en', { en: 'We Will Rock You' }],
  ['i-want-it', 'I Want It That Way', 'Backstreet Boys', 1999, '洋楽', 99, 0.6, ['エモい', '懐かしい'], [52, 72], [40, 60, 82, 80, 50], 'en', { en: 'I Want It That Way' }],
  ['uptown-funk', 'Uptown Funk', 'Mark Ronson ft. Bruno Mars', 2014, '洋楽', 115, 0.95, ['ノれる', '盛り上がる'], [52, 72], [65, 80, 75, 50, 22], 'en', { en: 'Uptown Funk' }],
  ['dancing-queen', 'Dancing Queen', 'ABBA', 1976, '洋楽', 100, 0.8, ['ノれる', 'みんなで', '懐かしい'], [55, 74], [50, 62, 72, 82, 88], 'en', { en: 'Dancing Queen' }],
  ['take-on-me', 'Take On Me', 'a-ha', 1984, '洋楽', 169, 0.85, ['ノれる', '叫べる', '懐かしい'], [52, 81], [45, 60, 72, 85, 82], 'en', { en: 'Take On Me' }],
  ['my-heart', 'My Heart Will Go On', 'Céline Dion', 1997, '洋楽', 99, 0.45, ['泣ける', '叫べる'], [55, 77], [50, 65, 85, 92, 85], 'en', { en: 'My Heart Will Go On', zhHant: '我心永恆', zhHans: '我心永恒' }],
  ['flowers', 'Flowers', 'Miley Cyrus', 2023, '洋楽', 118, 0.6, ['かっこいい', 'ノれる'], [52, 69], [78, 72, 48, 22, 8], 'en', { en: 'Flowers' }],
  // --- C-POP
  ['yueliang', '月亮代表我的心', '鄧麗君', 1977, 'C-POP', 68, 0.25, ['しっとり', '懐かしい'], [55, 70], [20, 28, 40, 60, 78], 'zh', { romaji: 'Yueliang Daibiao Wo De Xin', en: 'The Moon Represents My Heart', zhHant: '月亮代表我的心', zhHans: '月亮代表我的心' }],
  ['toki-no-nagare', '時の流れに身をまかせ', 'テレサ・テン', 1986, '歌謡曲', 76, 0.3, ['しっとり', '懐かしい'], [55, 72], [25, 35, 55, 82, 94], 'ja', { romaji: 'Toki no Nagare ni Mi wo Makase', zhHant: '我只在乎你', zhHans: '我只在乎你' }],
  ['qingtian', '晴天', '周杰倫', 2003, 'C-POP', 69, 0.4, ['エモい', 'しっとり'], [50, 67], [30, 38, 40, 30, 15], 'zh', { romaji: 'Qing Tian', en: 'Sunny Day', zhHant: '晴天', zhHans: '晴天' }],
  ['xiao-xing-yun', '小幸運', '田馥甄', 2015, 'C-POP', 80, 0.35, ['エモい', '泣ける'], [55, 72], [28, 35, 30, 20, 8], 'zh', { romaji: 'Xiao Xing Yun', en: 'A Little Happiness', zhHant: '小幸運', zhHans: '小幸运' }],
]

const tempoOf = (bpm: number): Song['tempo'] => (bpm < 95 ? 'slow' : bpm <= 135 ? 'mid' : 'fast')

export const SONGS: Song[] = ROWS.map(([id, title, artist, year, genre, bpm, energy, vibes, range, k, lang = 'ja', titles = {}]) => ({
  id,
  title,
  artist,
  year,
  genre,
  bpm,
  tempo: tempoOf(bpm),
  energy,
  vibes,
  range,
  known: { 10: k[0], 20: k[1], 30: k[2], 40: k[3], 50: k[4] },
  lang,
  titles,
}))

export const SONG_BY_ID: Record<string, Song> = Object.fromEntries(SONGS.map(s => [s.id, s]))

export const decadeOf = (s: Song) => `${Math.floor(s.year / 10) * 10}s`
