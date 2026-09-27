// Song search in any script (SPEC L/M8 #1, G-4, 5-1). One query is tried against the original
// title, the artist, romaji, English, Traditional/Simplified Chinese and Korean titles, plus a
// small table of well-known artist names in Latin / Hangul / Chinese. Kana queries are also
// read as romaji ("ざんこく" → "zankoku"), Latin queries also loosely ("yusha" ≈ "Yuusha"),
// Hangul also as jamo ("잔혹하" while the IME is still composing "잔혹한"). Ranking:
// exact > prefix > word prefix > substring > loose > in-order characters > one typo,
// with a small bonus for covering more of the field and a popularity tie-break.
import type { SearchFilters } from '../../core/types'
import { SONGS, decadeOf, type Song, type Vibe } from '../../data/songs'
import { editDistance, hasHangul, hasKana, isLatin, jamo, kanaToRomaji, looseLatin, normalize, normalizeMapped, normalizeWords } from './normalize'

export type SearchHit = { song: Song; score: number; matched: 'title' | 'artist' | 'romaji' | 'en' | 'zhHant' | 'zhHans' | 'ko' }
export type MatchField = SearchHit['matched']

/** Artist names as people type them abroad (only well-established spellings). */
export const ARTIST_ALIASES: Record<string, string[]> = {
  YOASOBI: ['요아소비'],
  米津玄師: ['Kenshi Yonezu', 'Yonezu Kenshi', '요네즈 켄시', '米津玄师'],
  'DAOKO×米津玄師': ['DAOKO Kenshi Yonezu', 'Yonezu Kenshi'],
  Official髭男dism: ['Official Hige Dandism', 'Higedan'],
  あいみょん: ['Aimyon', '아이묭'],
  優里: ['Yuuri'],
  瑛人: ['Eito'],
  LiSA: ['리사'],
  Ado: ['아도'],
  キタニタツヤ: ['Tatsuya Kitani', 'Kitani Tatsuya'],
  'HoneyWorks feat. かぴ': ['HoneyWorks feat. Kapi'],
  星野源: ['Gen Hoshino', 'Hoshino Gen'],
  一青窈: ['Yo Hitoto', 'Hitoto Yo'],
  スキマスイッチ: ['Sukima Switch'],
  ゴールデンボンバー: ['Golden Bomber'],
  レミオロメン: ['Remioromen'],
  大塚愛: ['Ai Otsuka', 'Otsuka Ai'],
  湘南乃風: ['Shonan no Kaze'],
  宇多田ヒカル: ['Hikaru Utada', 'Utada Hikaru', '우타다 히카루', '宇多田光'],
  '黒うさP feat. 初音ミク': ['Kurousa-P feat. Hatsune Miku', 'Hatsune Miku'],
  バルーン: ['Balloon'],
  高橋洋子: ['Yoko Takahashi', 'Takahashi Yoko'],
  影山ヒロノブ: ['Hironobu Kageyama'],
  'TK from 凛として時雨': ['TK from Ling tosite sigure'],
  'どうぶつビスケッツ×PPP': ['Doubutsu Biscuits PPP'],
  花澤香菜: ['Kana Hanazawa'],
  スピッツ: ['Spitz'],
  椎名林檎: ['Ringo Sheena', 'Shiina Ringo'],
  'モーニング娘。': ['Morning Musume'],
  サザンオールスターズ: ['Southern All Stars'],
  安室奈美恵: ['Namie Amuro'],
  中島みゆき: ['Miyuki Nakajima'],
  松原みき: ['Miki Matsubara'],
  竹内まりや: ['Mariya Takeuchi'],
  坂本九: ['Kyu Sakamoto'],
  美空ひばり: ['Hibari Misora'],
  石川さゆり: ['Sayuri Ishikawa'],
  寺尾聰: ['Akira Terao'],
  松田聖子: ['Seiko Matsuda'],
  久保田早紀: ['Saki Kubota'],
  BTS: ['방탄소년단', '防弾少年団'],
  NewJeans: ['뉴진스'],
  TWICE: ['트와이스'],
  少女時代: ["Girls' Generation", 'SNSD', '소녀시대', '少女时代'],
  PSY: ['싸이'],
  aespa: ['에스파'],
  IVE: ['아이브'],
  ILLIT: ['아일릿'],
  鄧麗君: ['Teresa Teng', '邓丽君', '테레사 텡'],
  'テレサ・テン': ['Teresa Teng', '鄧麗君', '邓丽君'],
  周杰倫: ['Jay Chou', '周杰伦'],
  田馥甄: ['Hebe Tien'],
}

type Field = {
  f: MatchField
  n: string
  starts: number[]
  latin: boolean
  loose?: string
  looseStarts?: number[]
  jamo?: string
  penalty: number
}
type Prepared = { song: Song; fields: Field[]; pop: number }

let INDEX: Prepared[] | null = null

function field(f: MatchField, raw: string | undefined, penalty = 0): Field | null {
  if (!raw) return null
  const { n, starts } = normalizeWords(raw)
  if (!n) return null
  const latin = isLatin(n)
  const out: Field = { f, n, starts, latin, penalty }
  if (latin) {
    // loose key per word so that word starts survive the folding
    const words = raw.split(/[\s\p{P}\p{S}]+/u).map(w => looseLatin(normalize(w))).filter(Boolean)
    out.looseStarts = []
    let acc = ''
    for (const w of words) {
      out.looseStarts.push(acc.length)
      acc += w
    }
    out.loose = acc
  }
  if (hasHangul(n)) out.jamo = jamo(n)
  return out
}

/** Popularity 0..1 (known by people in their 20s–30s), used only to break ties. */
export const popularity = (s: Song): number => (s.knownRate[20] * 0.6 + s.knownRate[30] * 0.4) / 100

function index(): Prepared[] {
  if (INDEX) return INDEX
  INDEX = SONGS.map(song => {
    const t = song.inboundTitle
    const fields = [
      field('title', song.title),
      field('romaji', t.romaji),
      field('en', t.en),
      field('ko', t.ko),
      field('zhHant', t.zhHant),
      field('zhHans', t.zhHans),
      field('artist', song.artist, 6),
      ...(ARTIST_ALIASES[song.artist] ?? []).map(a => field('artist', a, 7)),
    ].filter((x): x is Field => !!x)
    return { song, fields, pop: popularity(song) }
  })
  return INDEX
}

/** Characters of q appear in order in v, not spread out too far (e.g. 残酷天使 in 残酷な天使). */
function inOrder(q: string, v: string): boolean {
  if (q.length < 2) return false
  let start = -1
  let j = 0
  for (let i = 0; i < v.length && j < q.length; i++) {
    if (v[i] === q[j]) {
      if (j === 0) start = i
      j++
      if (j === q.length) return i - start + 1 <= Math.ceil(q.length * 1.6) + 1
    }
  }
  return false
}

type Query = { n: string; romaji: string | null; loose: string | null; jamo: string | null }

function prepareQuery(q: string): Query {
  const n = normalize(q)
  const romaji = hasKana(n) ? kanaToRomaji(n) : null
  const latinForm = romaji ?? n
  return {
    n,
    romaji: romaji && isLatin(romaji) ? romaji : null,
    loose: isLatin(latinForm) ? looseLatin(latinForm) : null,
    jamo: hasHangul(n) ? jamo(n) : null,
  }
}

function base(q: string, fl: Field): number {
  if (fl.n === q) return 100
  if (fl.n.startsWith(q)) return 85
  // a single Latin letter only counts at the start of a word (otherwise it matches everything)
  if (q.length === 1 && fl.latin) return fl.starts.some(st => fl.n[st] === q) ? 66 : 0
  const i = fl.n.indexOf(q)
  if (i > 0) return fl.starts.includes(i) ? 70 : 55
  return 0
}

function scoreField(q: Query, fl: Field): number {
  let s = base(q.n, fl)
  let len = q.n.length
  if (!s && q.romaji && fl.latin) {
    s = base(q.romaji, fl) - 2
    len = q.romaji.length
  }
  if (s <= 0 && q.jamo && fl.jamo) {
    if (fl.jamo.startsWith(q.jamo)) s = 78
    else if (fl.jamo.includes(q.jamo)) s = 56
  }
  if (s <= 0 && q.loose && q.loose.length >= 2 && fl.loose) {
    const i = fl.loose.indexOf(q.loose)
    if (i === 0) s = 62
    else if (i > 0) s = fl.looseStarts?.includes(i) ? 56 : 46
    len = q.loose.length
  }
  if (s <= 0 && inOrder(q.n, fl.n)) s = 30
  if (s <= 0 && q.loose && fl.loose && q.loose.length >= 4) {
    // one typo against the start of any word ("gurenga", "zankuku")
    for (const st of fl.looseStarts ?? [0]) {
      for (const d of [0, -1, 1]) {
        const part = fl.loose.slice(st, st + q.loose.length + d)
        if (part.length >= 3 && editDistance(q.loose, part, 1) <= 1) {
          s = 26
          break
        }
      }
      if (s > 0) break
    }
  }
  if (s <= 0) return 0
  return s + 12 * Math.min(1, len / fl.n.length) - fl.penalty
}

export function passesFilters(song: Song, f?: SearchFilters): boolean {
  if (!f) return true
  if (f.genre && song.genre !== f.genre) return false
  if (f.tempo && song.tempo !== f.tempo) return false
  if (f.decade && decadeOf(song) !== f.decade) return false
  if (f.lang && song.lang !== f.lang) return false
  if (f.vibe && !song.tags.hypothesis.includes(f.vibe)) return false
  return true
}

/**
 * Search every script at once. An empty query lists the filtered songs, best known first.
 * Results are sorted by score, then popularity; `limit` defaults to 30.
 */
export function searchSongs(q: string, o: { filters?: SearchFilters; limit?: number } = {}): SearchHit[] {
  const limit = o.limit ?? 30
  const qq = prepareQuery(q)
  const out: (SearchHit & { pop: number })[] = []
  for (const p of index()) {
    if (!passesFilters(p.song, o.filters)) continue
    if (!qq.n) {
      out.push({ song: p.song, score: 0, matched: 'title', pop: p.pop })
      continue
    }
    let best = 0
    let matched: MatchField = 'title'
    for (const fl of p.fields) {
      const s = scoreField(qq, fl)
      if (s > best) {
        best = s
        matched = fl.f
      }
    }
    if (best > 0) out.push({ song: p.song, score: best + 3 * p.pop, matched, pop: p.pop })
  }
  out.sort((a, b) => b.score - a.score || b.pop - a.pop)
  return out.slice(0, limit).map(({ song, score, matched }) => ({ song, score, matched }))
}

/** The text of a song for a match field (artist aliases resolve to the alias that matched). */
export function fieldText(song: Song, f: MatchField, q = ''): string | null {
  const t = song.inboundTitle
  switch (f) {
    case 'title':
      return song.title
    case 'romaji':
      return t.romaji ?? null
    case 'en':
      return t.en ?? null
    case 'ko':
      return t.ko ?? null
    case 'zhHant':
      return t.zhHant ?? null
    case 'zhHans':
      return t.zhHans ?? null
    case 'artist': {
      if (!q) return song.artist
      const qq = prepareQuery(q)
      const all = [song.artist, ...(ARTIST_ALIASES[song.artist] ?? [])]
      let best = song.artist
      let bestS = 0
      for (const a of all) {
        const fl = field('artist', a)
        const s = fl ? scoreField(qq, fl) : 0
        if (s > bestS) {
          bestS = s
          best = a
        }
      }
      return best
    }
  }
}

/** [start, end) of the query inside `text` (in source characters), or null when it is not a plain run. */
export function matchRange(text: string, q: string): [number, number] | null {
  const qq = prepareQuery(q)
  if (!qq.n || !text) return null
  const { n, map } = normalizeMapped(text)
  const tryFind = (needle: string | null): [number, number] | null => {
    if (!needle) return null
    const i = n.indexOf(needle)
    if (i < 0) return null
    const a = map[i]
    const lastSrc = map[i + needle.length - 1]
    // extend to the end of the last source character (surrogates, NFKC expansions)
    let b = lastSrc + 1
    while (b < text.length && map.indexOf(b) < 0 && /[\uDC00-\uDFFF]/.test(text[b])) b++
    return [a, b]
  }
  return tryFind(qq.n) ?? tryFind(qq.romaji)
}

/**
 * Example queries in five scripts (not UI text: they are what people abroad actually type).
 * The search bar cycles through them; the sheet offers them as one-tap tries.
 */
export const TRY_QUERIES: readonly string[] = ['zankoku', '잔혹한', '紅蓮', 'よるにかける', 'Into the Night', '米津']

/** Hypothesis tags ("ナビの見立て") in the order the filter row shows them. */
export const VIBE_ORDER: readonly Vibe[] = ['盛り上がる', 'しっとり', 'みんなで', 'エモい', 'ノれる', '泣ける', '叫べる', '懐かしい', 'かっこいい', 'かわいい', 'デュエット', '1曲目向き', 'ラスト向き']
export const TEMPO_ORDER: readonly Song['tempo'][] = ['fast', 'mid', 'slow']
export const LANG_ORDER: readonly Song['lang'][] = ['ja', 'en', 'ko', 'zh']
/** Decades present in the catalogue, newest first ("2020s" …). */
export const DECADES: readonly string[] = [...new Set(SONGS.map(s => decadeOf(s)))].sort().reverse()

/** Songs in one ball area (tempo × genre), for the gap arrival banner. */
export function songsInArea(tempo: Song['tempo'], genre: Song['genre']): Song[] {
  return SONGS.filter(s => s.tempo === tempo && s.genre === genre)
}
