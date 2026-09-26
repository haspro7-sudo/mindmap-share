/**
 * Frozen word list for kana 合言葉 (docs/SPEC.md §4.3). One word per byte value: 5 words = 40 bits.
 *
 * FROZEN AFTER RELEASE. The index of each word is part of every published kana code, so never
 * reorder, replace, add or remove entries. kana.test.ts pins the list with a SHA-256 snapshot.
 *
 * Rules (all enforced by kana.test.ts):
 * - exactly 256 unique words, each exactly 3 basic hiragana (dakuten/handakuten allowed);
 *   no small kana, ゐ, ゑ, を, ぢ, づ, ゔ or ー, so every word is a fixed point of normalizeKana;
 * - no two words share the same form once dakuten/handakuten are removed (かき/かぎ-style pairs);
 * - no two words differ in exactly one character, so a single-character typo never turns one
 *   valid word into another (it is reported as an unknown word instead);
 * - common, SFW, concrete nouns (nature, weather, animals, plants, food, everyday objects, places),
 *   chosen to avoid crude, sexual, violent or unlucky connotations and slang double meanings;
 * - includes the demo words ほたる, かえで, つばめ, こだま, すずめ;
 * - sorted by UTF-16 code unit (gojūon order), which makes the list easy to scan.
 */
export const KANA_WORDS: readonly string[] = Object.freeze([
  'あおば', 'あかね', 'あけび', 'あげは', 'あさひ', 'あしか', 'あずき', 'あひる',
  'あられ', 'あんず', 'いかだ', 'いずみ', 'いそべ', 'いたち', 'いちご', 'いなり',
  'いるか', 'いわし', 'うさぎ', 'うしお', 'うずら', 'うちわ', 'うどん', 'うみべ',
  'えのぐ', 'えほん', 'おいも', 'おかゆ', 'おがわ', 'おこげ', 'おさら', 'おしろ',
  'おちば', 'おでん', 'おはぎ', 'おまけ', 'おもち', 'おやつ', 'かいろ', 'かえで',
  'かきね', 'かざり', 'かしわ', 'かじき', 'かすみ', 'かつお', 'かばん', 'かぶと',
  'かぼす', 'かまど', 'かめら', 'かもめ', 'からし', 'かるた', 'かれい', 'かんな',
  'きつね', 'きなこ', 'きもの', 'きりん', 'ぎんが', 'くじら', 'くつや', 'くぬぎ',
  'くまで', 'くらげ', 'くるみ', 'けいと', 'けむり', 'けやき', 'こあら', 'こいぬ',
  'こうや', 'こかげ', 'こがも', 'ここあ', 'こさめ', 'こじか', 'こずえ', 'こたつ',
  'こだま', 'ことり', 'こねこ', 'こはる', 'こぶね', 'こみち', 'こむぎ', 'こよみ',
  'こりす', 'こんぶ', 'ごはん', 'さいふ', 'さかき', 'さくら', 'さざえ', 'さとう',
  'さらだ', 'さんま', 'ざしき', 'しおり', 'しぐれ', 'しじみ', 'しずく', 'しばふ',
  'しみず', 'しめじ', 'しらす', 'しるこ', 'すいか', 'すすき', 'すずめ', 'すだち',
  'すなば', 'すばる', 'すみれ', 'すもも', 'ずきん', 'せいざ', 'せろり', 'せんす',
  'ぞうり', 'たいこ', 'たおる', 'たから', 'たきび', 'たたみ', 'たぬき', 'たまご',
  'たらい', 'たると', 'だがし', 'だるま', 'ちまき', 'つきよ', 'つくえ', 'つつみ',
  'つばめ', 'つみき', 'つらら', 'つりば', 'てがみ', 'てさげ', 'てまり', 'てれび',
  'でんわ', 'とうふ', 'とけい', 'とだな', 'とびら', 'とまと', 'とんぼ', 'どてら',
  'どなべ', 'どびん', 'なぎさ', 'なずな', 'なつめ', 'にしん', 'にもつ', 'ぬりえ',
  'のうか', 'のぎく', 'のはら', 'のぼり', 'のやま', 'のれん', 'はがき', 'はさみ',
  'はしご', 'はたけ', 'はとば', 'はなび', 'はにわ', 'はまべ', 'はやし', 'ばけつ',
  'ぱすた', 'ぱずる', 'ぱせり', 'ぱんだ', 'ひかり', 'ひがさ', 'ひぐま', 'ひざし',
  'ひすい', 'ひつじ', 'ひとで', 'ひなた', 'ひのき', 'ひよこ', 'ひらめ', 'ひろば',
  'ぴあの', 'ふくろ', 'ふすま', 'ふぶき', 'ふもと', 'ふろく', 'ぶどう', 'ほうき',
  'ほくと', 'ほこら', 'ほたる', 'ほんや', 'ぼうし', 'ぼたん', 'ぽすと', 'ぽぷら',
  'まきば', 'まつり', 'まどべ', 'みかん', 'みこし', 'みさき', 'みずべ', 'みぞれ',
  'みつば', 'みどり', 'みなと', 'みやこ', 'むすび', 'めがね', 'めじろ', 'めだか',
  'めのう', 'めろん', 'もえぎ', 'もぐら', 'もなか', 'もみじ', 'やおや', 'やたい',
  'やまめ', 'やもり', 'ゆうひ', 'ゆかた', 'ゆのみ', 'ゆびわ', 'よあけ', 'よぞら',
  'よもぎ', 'らいち', 'らくだ', 'らじお', 'らむね', 'らんぷ', 'りぼん', 'りんご',
  'れたす', 'れもん', 'れんげ', 'わかめ', 'わさび', 'わしつ', 'わたげ', 'わらじ',
]);
