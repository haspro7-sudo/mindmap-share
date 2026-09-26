# しおり帳 (Shiori-chō), "Shiori Companion": Final v1 Product and Technical Spec

> **Implementation notes (read first).** This spec came out of a judge-panel design workflow. The code differs from the original text in a few places. Every difference is listed here; the sections below have been corrected where the fix is a simple fact (a file name, a config value, a privacy claim):
> - The app lives in `shiori-cho/` inside this repo. All paths below are relative to it, except the CI workflow, which is `.github/workflows/shiori-cho.yml` at the repo root (not `pages.yml`). It runs `npm ci` → `gen-licenses --check` → typecheck → `npm run lint` → test → build → `check:dist`, and deploys to Pages only on a manual run with `deploy` checked.
> - Linting uses **oxlint** (`.oxlintrc.json`, `npm run lint` = `oxlint src scripts`, `react/no-danger: error`) instead of ESLint. The rule that `src/core` stays pure is enforced by `src/core/boundary.test.ts`. `no-restricted-properties` is not enabled in `.oxlintrc.json`; instead the raw-HTML ban of F5 AC6 is enforced by `scripts/check-dist.ts` (next item).
> - `scripts/check-dist.ts` (§7.2) does two things. (1) It fails if any text file in `dist/` names an http(s) host outside an allowlist: `www.dlsite.com` (store links), `www.w3.org` (SVG namespaces), `react.dev` (React's error-decoder text), `localhost` (creator-kit default), `example.invalid` (placeholders), plus `json-schema.org` in any `dist/assets/*.js` chunk (zod's `$schema` identifiers) and `bit.ly` in the workbox chunk. None of them is ever fetched (CSP `connect-src 'self'`). (2) It scans **`src/`**, not `dist/`, for `dangerouslySetInnerHTML`, `.innerHTML`, `.outerHTML`, `insertAdjacentHTML` and `document.write` (test files excepted); React's own bundle uses `innerHTML` internally, so `dist/` cannot be scanned for it.
> - PWA registration (§7.3): `injectRegister: false`. The service worker is registered by the `useRegisterSW` hook from `virtual:pwa-register/react` in `src/ui/shell/UpdatePrompt.tsx` (bundled into the app, so it is CSP-safe); there is no `registerSW.js`.
> - UI copy is written inline in the components. There is no `src/ui/strings/ja.ts`. `APP_NAME_JA` / `APP_NAME_EN` are in `src/core/constants.ts`, but 「しおり帳」 also appears in many UI and kit strings (see §9 Naming for what a rename touches).
> - Onboarding (§6) asks the 自動ロック question only when a PIN was set, so without a PIN it has two questions (the counter shows 1 / 2).
> - Privacy fixes from the review (F1–F3, F11): 「PINを忘れた」 → 全データを消して初期化 deletes **both** `shiori` and `shiori-studio` (the PIN guards the whole app; §5.3's "keep studio data" applies only to 設定 → 全データを消す, which keeps its separate checkbox), then reloads at `#/`. Deep links `#/u/…` are moved out of the address bar **before** any gate, lock or camouflage and processed once the app is open. 隠す/Escape hide in one step even while a sheet, dialog or envelope is open; toasts and dialogs never appear over the camouflage; the camouflage survives a reload of the same tab. Settings' 「いまのPIN」 check shares the lock screen's failure counter and cooldown, and the cooldown is capped at 30 s from now. An error boundary keeps 隠す working if a screen crashes.
> - Data fixes from the review: `ShioriRepo` has two more members. `putRedemptionCache(workId, goalId, canonical, cache | undefined)` refreshes a cached master only; it never creates a row and does **not** count toward `changesSinceBackup` (like `updateSettings`). `deleteHint(workId, goalId)` counts. Sealed evaluation (§5.2) also runs after a backup restore/merge (`restoreBackup` retries pending codes across all works, then evaluates every work), after attaching a file, and as a safety net when a work page opens. A creator `shiori.json` can be **attached** to an existing 記録だけ / かんたんしおり work from the work page or 作品設定 (`previewAttach` / `attachManifest`); a manifest whose `work.id` belongs to another local work is refused. `work.lastPlayedAt` is recomputed from the remaining ended sessions when a session is edited or deleted. Player-added goal ids are never reused.
> - Merge rules (§5.5) amended: for a work matched on both sides, the newer `updatedAt` wins the record's own fields, but `manifestKey` / `manifestWorkId` / `newGoalIds` come from the side that (in order) has an existing manifest record, has a creator file rather than a player file, or has the later `ManifestRecord.importedAt` (ties → the `updatedAt` winner). After a merge at most one session stays open app-wide (this device's open session if any, else the latest start); the others are ended at their own start with 0 minutes.
> - Hint tiers (F8 AC2) are named by position — 1 = 示唆, 2 = 方向, 3 = 答え — and only the third tier (答え) needs the confirmation. A goal with fewer than three hints has no 答え tier.
> - Studio fixes (F16): 「サンプルを開く」 and 「複製 → 別の作品のひな形」 give the copy a new work id, no salt and fresh codes; 点検 refuses the bundled demos' ids, salts and published codes (app layer, so the demo build still passes core lint) and warns when another project shares a work id, salt or code. Draft schemas are lenient so any editor state round-trips through the project backup (strictness lives in lint/build). The project backup is named `shiori-studio-project-YYYYMMDD.json`. A letter's `from` signature is a soft secret: appearing in public text is a warning, not a leak error. The no-spoil guard also matches normalized spellings of codes (full-width, other separators, katakana). `codes.csv` prefixes cells that start with `= + - @` with an apostrophe. Without an absolute http(s) app URL the kit has no QR PNGs and no 解放URL column values.
> - Storage (§9 Privacy): besides IndexedDB, the app keeps a few tab-scoped entries in `sessionStorage` (keys start with `shiori.`): the one-shot code hand-off from `#/u/…` to `#/code` (expires after 5 minutes), a stashed deep link while a gate or lock is shown (30 minutes), the library filter/sort, and the camouflage flag. They vanish when the tab closes, and 全データを消す clears them too.
> - Deep links `#/u/<manifestWorkId>/<code>` carry the manifest's `work.id`. The editor proposes an opaque `w-…` id, but the creator can change it to a readable slug (the demos use `demo-hoshiyomi` and `demo-amaoto`), so help texts call it 「作品のID（作者が付けた識別子）」, not a meaningless number.
> - Third-party notices (§6 このアプリについて): `scripts/gen-licenses.ts` collects the copyright and license texts of every package whose code ships in `dist/` (the runtime dependencies and their dependencies, plus the Workbox service-worker modules and the small runtime helpers of Vite and vite-plugin-pwa) into `public/licenses.txt`. The file is committed, checked for staleness in CI and by `scripts/gen-licenses.test.ts`, and linked from ヘルプ →「このアプリについて」. URLs in it lose their `http(s)://` prefix so that `check:dist` keeps passing.
> - **Contract files are the source of truth for signatures:** `src/core/types.ts`, `src/storage/repo.ts`, plus the `declare`-style stubs in every module. `ShioriRepo` also has `listManifests(workId?)`. `UnlockOutcome.status` also includes `'pending'`, and the `ImportPreview` update variant also carries `stats`.
> - Shared zod helpers and the post-decrypt payload schemas are in `src/core/manifest/payloadSchemas.ts`.
> - The golden vectors in §4.3 and the demo codes in §4.6 have been checked independently with Node WebCrypto. They are correct.
> - Tests run in the `node` environment by default. UI tests opt in with a `// @vitest-environment jsdom` docblock.


Client-only PWA built with Vite, React and TypeScript. It has no backend, all data stays on the device, and the UI is in Japanese. It is unofficial and not affiliated with DLsite.

This spec builds on the judges' consensus winner ("feasibility"). It adds these ideas from the other proposals:
- From bridge: a per-work KDF with lookup tags, allOf keys enforced by the crypto, typed sealed payloads with an envelope reveal, return codes (返し合言葉), and the `/demo-pc` simulator.
- From creator: a checksum character, kana word codes, standard-camera deep links with pending codes, and a plugin-free kit with a store-description template.
- From player: the quick pack (かんたんしおり), per-work spoiler tolerance, the ノーヒント badge, missable warnings, the 次にやること line and the task-switcher veil.

Contract items are marked **CONTRACT**. Every module owner must implement them exactly as written. Changing one needs sign-off from all owners.

---

## 1. Name & one-liner

- **Japanese name:** しおり帳 (しおりちょう). **English alias:** Shiori Companion.
- **Creator file:** `shiori.json` (UI name: しおりファイル). Schema id: `shiori/1`.
- **One-liner (JA):** 作品に「しおり」を一枚はさむだけ。ネタバレしない段階ヒント、実績チェック、合言葉で開く「封印おまけ」が手元のスマホに届く。記録はすべて端末の中だけ。
- **One-liner (EN):** A circle slips one "bookmark" file into its work. The player's phone then gets spoiler-safe tiered hints, completion tracking, and sealed extras that open only with a code shown in the game. No server, no account, and discreet by design.

---

## 2. Core concept & why it raises experience value

### Player side (the buyer, 18+)
1. **Continuity (前回の続き).** Doujin games get played in short bursts. The app starts sessions and ends them with a one-line "where I was / what's next" note and an optional chapter checkpoint. On return it shows 「前回の続き（3日ぶり）」 first. This works even for works without a shiori file.
2. **Completing a work without spoilers.** Endings are masked (「END 3」「？？？」) until reached. Hints open one tier at a time (示唆 → 方向 → 答え) with press-and-hold, and the answer tier needs a confirmation. Missable items warn before the point of no return without saying what is behind it. Goals completed without hints get a ノーヒント badge.
3. **Rewards on the second screen.** At an ending the game shows an 合言葉 (a 9-character code or 5 hiragana words) or a QR code. The phone vibrates, an envelope (封筒) opens, and a letter from a character, an afterword, a short story or a return code (返し合言葉) appears. The extras live in a personal, PIN-lockable place that survives reinstalls and lost saves.
4. **Discretion.** Neutral name and icon, alias-only titles by default, an instant 隠す button that switches to a plain notes screen, a veil over the task-switcher preview, a PIN screen lock, and zero network traffic.
5. **Day-one usefulness without a creator file.** かんたんしおり turns counts ("5 endings, 40 CG, 6 tracks") into a checklist in seconds.

### Creator side (the circle, 1–3 people)
1. **Engine-agnostic add-on (アド).** The integration is "show one string (or a QR PNG) in the work." This works in RPG Maker MV/MZ, Tyrano, Wolf RPG, Ren'Py and Unity, in voice works (spoken at the end of a bonus track or printed in the 台本 PDF) and in CG collections (last page). It can be added to works already on sale through a normal update.
2. **Spoiler-proof by construction.** `shiori.json` can ship openly in the zip. Ending names, extras and codes are sealed with keys derived from the codes (salted, stretched SHA-256 via PBKDF2/HMAC/HKDF), so opening the file reveals none of them. Hints are public by design and the editor warns about that.
3. **A "クリア特典" selling point at no cost.** There is no server, no accounts and no personal data. The editor (サークル工房) makes the codes, self-tests everything, and exports a ready kit: the public file, private code sheet, QR PNGs, はじめに.txt, a store-description line and per-engine snippets.
4. **Fewer "攻略ありますか？" questions.** The circle's own tiered hints replace an all-spoiling walkthrough txt.
5. **Cross-sell.** A sealed extra can carry a store link card (by RJ code) to the circle's next work.

---

## 3. v1 feature list (must-have only) with acceptance criteria

Each feature has a UI name in parentheses. **AC** = acceptance criteria.

**F1. Age gate (年齢確認)**
- AC1: On first launch (`settings.ageConfirmedAt` unset) only the gate renders. No work data is read or shown.
- AC2: 「はい、18歳以上です」 stores `ageConfirmedAt = now` and proceeds to onboarding. 「いいえ」 shows 「このアプリはご利用いただけません」 with no way forward, and a reload shows the gate again.
- AC3: 設定 → 「年齢確認を取り消す」 clears the flag and returns to the gate.
- AC4: The gate copy is neutral and non-explicit: 「このアプリは18歳以上の方を対象とする作品の記録にも使われます。あなたは18歳以上ですか？」. Help states that the check is self-declared.

**F2. Discreet mode (おしのびモード)**
- AC1: `document.title` is always 「しおり帳」 (「メモ」 while camouflaged). The web manifest `name` and `short_name` are 「しおり帳」 and the icon is a plain bookmark. No work title or manifest id ever appears in the title, the URL hash (only local UUIDs, numeric indices and the deep-link code), notifications (there are none) or download filenames.
- AC2: `discreet.aliasOnly` (default ON) makes lists, the resume card and headers show `alias` (default 「作品A」「作品B」…, or `manifest.work.safeTitle`). The real title appears only in 作品設定 behind 「本当のタイトルを表示」, which reveals it for that view only.
- AC3: A 「隠す」 button sits in the header of every screen, and the `Escape` key does the same on desktop. Either one swaps to the camouflage screen (a plain editable 「メモ」 notepad backed by `settings.camouflageText`, empty by default) within one frame. Returning requires a 1-second long-press on the 「メモ」 heading, or the PIN if one is set.
- AC4: When `discreet.blurOnHide` is on (default ON), an opaque neutral veil covers the app on `visibilitychange → hidden` so task-switcher snapshots show nothing.
- AC5: `discreet.hideStoreLinks` (default ON) hides every DLsite link. `discreet.blurExtras` (default OFF) blurs the body of sealed extras until tapped.
- AC6: At runtime there are zero requests except same-origin app assets. This is enforced by the CSP (§7) and by `scripts/check-dist.ts` (§8).

**F3. Screen lock (画面ロック)**
- AC1: The PIN is 4–8 digits and is stored only as PBKDF2-SHA256 (200,000 iterations, 16-byte salt). The UI says 「画面ロックです。保存データそのものは暗号化されません」.
- AC2: `autoLockSec` can be 0 (すぐ), 30, 60 (default) or 300. The app locks on cold start and when it becomes visible after being hidden for at least `autoLockSec`.
- AC3: After 5 wrong PINs there is a 30-second cooldown, persisted in `pinCooldownUntil`.
- AC4: 「PINを忘れた」 offers only 「全データを消して初期化」, with a double confirmation and advice to back up.

**F4. Library (本棚)**
- AC1: Adding a work takes a title (required, ≤100), an alias (default from `nextAlias`), an optional store code and a kind (ゲーム/音声/CG集/漫画/その他). The store code accepts `RJ`/`VJ`/`BJ` plus 6 or 8 digits, in full-width or lowercase; invalid input gives 「作品コードの形式が違います（例: RJ01234567）」.
- AC2: A work's status is one of 積み/プレイ中/クリア/コンプ/保留. Filter chips cover すべて plus each status. Sort options are 最近遊んだ順 (default), 追加順 and 名前順.
- AC3: A work card shows an emoji tile on a chosen color, the alias or title, a status chip, a progress bar with % (if the work has a manifest) and 「N日前」 for the last session.
- AC4: The top of the library shows a 「続きから」 card for the work of the most recent ended session that has resume info, with a 「続きを始める」 button.
- AC5: A banner shows 「保留中の合言葉があります（N件）」 when `pending` is non-empty.

**F5. Importing a shiori file (しおりを読み込む)**
- AC1: Import works by file picker (`accept=".json,application/json"`), by drag and drop (desktop) and by pasted text.
- AC2: Input larger than 512 KiB is rejected before parsing. A JSON syntax error gives a Japanese message with the position. Schema errors are listed as `path` plus `messageJa`, at most 20.
- AC3: The preview shows the title, circle, version, counts (目標 N・合言葉 M・おまけ K), warnings, and the author's claim as 「作成者の申告：サークル／プレイヤー」. It is never shown as verified.
- AC4: If `work.id` matches an existing work, the import becomes an update: 「『作品A』の更新として読み込みます：追加3・削除1」. Progress carries over by goal id, removed goals are archived (not deleted), and added goals get a NEW badge until viewed. If the key matches the stored manifest exactly, the message is 「読み込み済みです」.
- AC5: After any import, pending codes are tried against the new manifest automatically.
- AC6: Manifest strings render only as React text nodes. `dangerouslySetInnerHTML` is banned by oxlint (`react/no-danger: error`), and `check:dist` fails on `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` anywhere in `src/` (see the implementation notes).

**F6. Quick shiori (かんたんしおり)**
- AC1: The form takes counts for エンディング (0–50), 回想・CG (0–200), 実績 (0–200), トラック (0–100) and 章 (0–30). At least one must be greater than 0.
- AC2: It generates a player-authored manifest (`author.kind: 'player'`, no `kdf`) with labels 「END 1…」「CG 1…」「実績 1…」「Track 1…」 and checkpoints 「第1章…」.
- AC3: For player-owned manifests, the goal sheet has 「名前を変える」, the work page has 「項目を追加」, and 「項目を削除」 asks for confirmation if the goal has progress.
- AC4: 作品設定 → 「しおりファイルとして書き出す」 downloads the manifest as `shiori.json`.

**F7. Progress checklist (進捗)**
- AC1: The work page shows overall and per-group done/total with the percentage floored. Archived goals are excluded. An empty manifest gives 0%, never NaN.
- AC2: A manual goal toggles with one tap, with an undo toast for 5 s.
- AC3: A code goal shows 🔒 and its public `label` until redeemed, then its decrypted `secret.title`.
- AC4: The overflow item 「合言葉なしで達成にする」 marks a code goal done with `via: 'manual'`. It counts toward progress, but the title stays masked and sealed items that need it cannot open; the UI explains this.
- AC5: At 100%, a one-time prompt offers to set the status to コンプ.

**F8. Spoiler shield & tiered hints (ネタバレ防止・段階ヒント)**
- AC1: `spoilerTolerance` is set per work, 0–3, default 1. Any public text (non-hidden label, teaser, missable warning) whose goal `spoiler` is greater than the tolerance renders as a blurred placeholder 「ネタバレを含むかもしれません（タップで表示）」. A tap reveals it for the current view only.
- AC2: Tier n+1 is enabled only after tier n. Revealing a tier takes a 600 ms press-and-hold with a progress ring. Keyboard or assistive activation opens a confirm dialog instead. The last tier (答え) always requires 「答えを表示します。よろしいですか？」.
- AC3: The revealed tier is persisted, and dots show tiers used.
- AC4: A goal completed while its hint tier was 0 shows a 「ノーヒント」 badge. The badge never appears if any tier was revealed before completion.

**F9. Current checkpoint & missable warnings (現在地・取り返し注意)**
- AC1: If the manifest has checkpoints, the work page shows 「いまどこ？」 (a select), which can also be set on the session-end sheet.
- AC2: Missable alerts follow `missableAlerts()` (§5). `soon` alerts are pinned at the top as 「この先に進む前に確認を」 plus the warning text (spoiler-gated).
- AC3: There is no alert for done goals, or once the current checkpoint is at or past `missable.before`.

**F10. Code entry (合言葉を入れる)**
- AC1: Input accepts Base32 codes in any width, case or separators, and kana codes in hiragana, katakana or half-width katakana, with or without separators.
- AC2: A Base32 input with a bad checksum is rejected instantly (「入力ミスがあるようです。1文字違っているかもしれません」) without running PBKDF2. An unknown kana word gives 「3語目『〇〇』が見つかりません」.
- AC3: A valid code costs at most one PBKDF2 per candidate manifest, and the hinted work is tried first. The whole flow should take under 1 s on a mid-range phone with 5 or fewer candidate manifests.
- AC4: On a match the goal is marked done (`via: 'code'`), the `unlockMessage` shows, `navigator.vibrate?.(30)` runs, and newly satisfied sealed items open and queue for the envelope animation.
- AC5: If the code was already redeemed: 「この合言葉は入力済みです」. With no match inside a work: 「この作品の合言葉ではないようです」. With no match globally: 「一致するしおりがありません」 plus 「保留にする」.
- AC6: A 「貼り付け」 button reads the clipboard. A pasted deep-link URL has its code extracted.

**F11. Deep-link unlock (QR / URL)**
- AC1: `#/u/<manifestWorkId>/<code>` is handled on load. The app then calls `history.replaceState` to `#/w/<localId>` (or `#/code` on failure), so the code does not stay in the address bar.
- AC2: If the manifest is not imported, the code is stored as pending (with the work-id hint) and the app shows instructions.
- AC3: On iOS Safari outside standalone mode, the app also shows 「ホーム画面のしおり帳で使う場合：合言葉をコピー → しおり帳の『合言葉』で貼り付け」 with a copy button.
- AC4: Deep links work offline after the first load.

**F12. Sealed extras (封印おまけ)**
- AC1: The おまけ tab lists each item with its label, teaser (spoiler-gated), kind icon and condition progress, for example 「2/4」 for allOf or 「いずれか1つ」 for anyOf.
- AC2: The first open plays the envelope animation (at most 1.5 s, tap to skip; with `prefers-reduced-motion` it becomes a 200 ms fade), then the reader opens.
- AC3: The reader renders `body` as text with `white-space: pre-wrap`, and a `from` signature for letters. `returnCode` shows a large monospace code, a コピー button and the instruction. `storeLink` shows a button, hidden when `hideStoreLinks` is on and opened only after a confirm dialog.
- AC4: Decrypted payloads are never persisted. They are decrypted again from cached masters on every view.

**F13. Play sessions & resume (プレイ記録・前回の続き)**
- AC1: 「始める」/「終える」 control sessions. Only one session can be open app-wide; starting another asks to end the current one first.
- AC2: The end sheet has minutes (prefilled from the wall clock, capped at 720, editable), 現在地, 「どこまで進んだ？」 (≤100) and 「次にやること」 (≤100). Every field is optional.
- AC3: The resume card reads 「前回の続き（今日／昨日／N日ぶり）」 using calendar days in the device's time zone.
- AC4: The 記録 tab shows 累計時間, 最終プレイ日 and a list of sessions that can be edited or deleted.

**F14. Notes (メモ)**
- AC1: Notes attach to a work or to a goal, up to 5,000 characters.
- AC2: `||…||` spans render blurred until tapped. An unclosed `||` is shown literally. Rendering is plain text.

**F15. Backup & restore (バックアップ)**
- AC1: Export writes `shiori-backup-YYYYMMDD.json` (a neutral name). With an optional passphrase (at least 8 characters) the file is encrypted.
- AC2: Import detects an encrypted file and asks for the passphrase. The user chooses 置き換え or まとめる (merge), and a preview shows counts. Merge follows §5.
- AC3: The PIN, `ageConfirmedAt` and cached masters are never exported.
- AC4: `navigator.storage.persist()` is requested at the end of onboarding and from a 設定 button, and the result is shown.
- AC5: A reminder banner appears when `changesSinceBackup ≥ 20` or when `lastBackupAt` is more than 30 days old and data exists. It can be snoozed for 7 days.
- AC6: 全データを消す needs a double confirmation. It deletes the IndexedDB database `shiori`. The creator database `shiori-studio` is deleted only if a separate box is checked.

**F16. Circle editor (サークル工房)**
- AC1: Projects can be created, edited, duplicated and deleted. They are stored only in `shiori-studio`, and a persistent banner says 「工房のデータには合言葉などの秘密が含まれます」.
- AC2: Codes are generated per code goal (Base32 by default, or kana), can be regenerated, and are unique within a project. Regenerating after the first export triggers 「発売済みの作品では合言葉を変えないでください」.
- AC3: 点検 (self-test) runs build, validate, self-test and lint. Export is enabled only when there are no errors; warnings need an explicit acknowledgement.
- AC4: The no-spoil guard: the exported JSON must contain no plaintext code, secret title (unless identical to its public label), description, unlock message, payload title or body, or return code. A leak is a hard error.
- AC5: 「プレイヤー画面で試す」 opens the real player UI on an in-memory repo seeded with the built manifest.
- AC6: The kit export produces a zip with the exact file list in §4.4. QR PNGs are 512×600 with error-correction level M and the code printed under the QR.
- AC7: Projects can be exported and imported (`shiori-studio-project/1`) with a secret warning.

**F17. Bundled SFW demo & PC screen simulator (サンプル・PC画面シミュレータ)**
- AC1: 「サンプルを試す」 imports 「星読みの図書館」 (alias サンプルA) and 「雨音と読書の時間」 (alias サンプルB).
- AC2: ヘルプ →「サンプルの合言葉」 lists the demo codes (§4.6).
- AC3: `#/demo-pc` is a click-through fake game screen. Each ending shows its code and a QR, and a 「この端末で入力する」 button opens the deep link on the same device. A 「扉の合言葉」 field accepts ほしあかり and shows a bonus scene.
- AC4: All demo text is SFW and fictional. The demos have no store codes.

**F18. PWA, offline & hosting**
- AC1: The app is installable. After the first load every route and both demos work offline. A 「新しいバージョンがあります」 prompt handles updates.
- AC2: It works under a GitHub Pages subpath (relative `base` plus hash routing).
- AC3: At 360 px width there is no horizontal scroll, gutters are 16 px, tap targets are at least 44 px, and light and dark themes are both supported.

**F19. Help & disclosures (ヘルプ)**
- AC1: Help pages cover 使い方, サンプルの合言葉, iOSでの注意 (separate storage for Safari and the home-screen app, eviction), サークル向けガイド (steps plus per-engine snippets), プライバシー, and 「しおり帳はDLsite及び各サークルとは関係のない非公式ツールです」.

### Later (explicitly out of v1)
- Import by URL (needs a CSP `connect-src` exception and a warning that the host sees the user's IP).
- Share link carrying a compressed manifest in the URL fragment.
- In-app camera scanner.
- Shipped engine plugins: `ShioriCode.js`, Tyrano macro files.
- Time-delayed letters.
- Image payloads.
- Audio player, sleep timer and SE-variant switching.
- 今夜の一本 backlog suggestions.
- Reviews and yearly summary.
- Fogged branch list.
- Signed manifests.
- N-of-M threshold unlocks.
- Share cards.
- Cross-work rewards.
- English UI.
- Play statistics.

---

## 4. Add-on mechanism: `shiori.json` (schema `shiori/1`)

### 4.1 Types (CONTRACT, `src/core/types.ts`)

```ts
/** base64url (RFC 4648 §5), NO padding */
export type B64u = string;
export type SpoilerLevel = 0 | 1 | 2 | 3;
export type WorkKind = 'game' | 'voice' | 'cg' | 'comic' | 'other';
export type Engine = 'rpgmaker-mz' | 'rpgmaker-mv' | 'tyrano' | 'wolf' | 'renpy' | 'unity' | 'other';
export type CodeKind = 'b32' | 'kana';
export type SealedKind = 'letter' | 'afterword' | 'story' | 'profile' | 'returnCode';

export interface EncBox { iv: B64u /* exactly 12 bytes */; ct: B64u /* 16..65552 bytes: ciphertext||GCM tag */ }
export interface KdfParams { alg: 'PBKDF2-SHA256'; iterations: number; salt: B64u /* exactly 16 bytes */ }

export interface ManifestWork {
  id: string;            // /^[a-z0-9][a-z0-9-]{3,39}$/ ; editor generates opaque "w-" + 10 lowercase base32 chars
  title: string;         // 1..100
  safeTitle?: string;    // 1..40 — default alias on import
  circle?: string;       // 0..60
  storeCode?: string;    // /^(RJ|VJ|BJ)(\d{6}|\d{8})$/ (already normalized)
  kind: WorkKind;
  engine?: Engine;
  version: string;       // /^[0-9A-Za-z.+-]{1,20}$/ (semver recommended)
}
export interface Checkpoint { id: string; label: string /* 1..40 */ }   // array order = story order
export interface Group { id: string; label: string /* 1..20 */ }

export interface GoalCommon {
  id: string;            // /^[a-z0-9][a-z0-9_-]{0,39}$/ (goal/group/checkpoint/sealed ids share this pattern)
  group: string;         // -> Group.id
  label: string;         // 1..60, PUBLIC ("END 3", "？？？", "全ての書架を調べた")
  teaser?: string;       // 1..120, PUBLIC
  spoiler: SpoilerLevel; // spoiler level of this goal's PUBLIC text; file default 0
  hints: string[];       // 0..3 tiers, each 1..200, PUBLIC; tier order = 示唆, 方向, 答え
  missable?: { before: string /* -> Checkpoint.id */; warn: string /* 1..120, PUBLIC */ };
}
export interface ManualGoal extends GoalCommon { unlock: { type: 'manual' } }
export interface CodeGoal extends GoalCommon {
  unlock: { type: 'code'; codeKind: CodeKind; tag: B64u /* exactly 16 bytes */ };
  secret: EncBox;        // AES-GCM(JSON(GoalSecret))
}
export type Goal = ManualGoal | CodeGoal;

/** Decrypted content of CodeGoal.secret */
export interface GoalSecret { title: string /*1..60*/; description?: string /*≤500*/; unlockMessage?: string /*≤300*/ }

export type SealedUnlock =
  | { mode: 'allOf'; goals: string[] /* 1..50 code-goal ids, unique */ }
  | { mode: 'anyOf'; goals: string[] /* 1..50 code-goal ids, unique */;
      wraps: { goal: string; iv: B64u; ct: B64u /* 48 bytes: wrapped 32-byte CEK + tag */ }[] /* exactly one per goal */ };

export interface SealedItem {
  id: string;
  label: string;         // 1..40 PUBLIC ("あとがき")
  teaser?: string;       // 1..120 PUBLIC ("全てのエンディングで開きます")
  kind: SealedKind;      // PUBLIC (icon/animation)
  unlock: SealedUnlock;
  box: EncBox;           // AES-GCM(JSON(SealedPayload))
}
/** Decrypted content of SealedItem.box (TEXT ONLY in v1) */
export interface SealedPayload {
  title: string;         // 1..60
  body: string;          // 0..20000, '\n' newlines, rendered as plain text
  from?: string;         // ≤40 (letter signature, e.g. "司書ミナより")
  returnCode?: { code: string /*1..40*/; instruction: string /*1..200*/ };  // kind 'returnCode'
  storeLink?: { storeCode: string /* RJ/VJ/BJ */; caption: string /*1..60*/ };
}
export interface ChangelogEntry { version: string; date: string /* YYYY-MM-DD */; notes: string /* ≤500 */ }

export interface ShioriManifestV1 {
  schema: 'shiori/1';
  work: ManifestWork;
  author: { kind: 'creator' | 'player'; name?: string /*≤60*/ };   // a CLAIM, never verified
  kdf?: KdfParams;             // REQUIRED iff any CodeGoal or SealedItem exists
  checkpoints: Checkpoint[];   // file-optional, default []; ≤50
  groups: Group[];             // 1..20
  goals: Goal[];               // 0..500
  sealed: SealedItem[];        // file-optional, default []; ≤50
  changelog: ChangelogEntry[]; // file-optional, default []; ≤100
}
```

### 4.2 Validation rules (`validateManifest`, implemented with zod 4)
- The file is 512 KiB or smaller. `schema` must be exactly `'shiori/1'`. Any other `shiori/*` value gives the error 「新しいバージョンのしおり帳が必要です」.
- Unknown keys are stripped (zod default). Strings must not contain control characters other than `\n` in `body` and `description`, and must not contain bidi overrides U+202A–202E or U+2066–2069.
- IDs are unique within each of checkpoints, groups, goals and sealed. Every `goal.group` exists. Every `missable.before` exists.
- `kdf.iterations` is an integer from 100,000 to 2,000,000 (default 200,000). The salt decodes to 16 bytes, each IV to 12 bytes and each tag to 16 bytes.
- Tags are unique across goals. A duplicate means two goals share a code, which is an error.
- `sealed[].unlock.goals` must reference **code** goals. For `anyOf`, the goals in `wraps` must equal `unlock.goals` as a set.
- Errors carry `{ path: 'goals[3].hints[1]', code, messageJa, severity: 'error' }`. Warnings, such as iterations below 150k or a group with no goals, use `severity: 'warning'`.

### 4.3 How codes are stored so the file spoils nothing (CONTRACT, `src/core/crypto/shiori.ts`)

**Code formats** (`src/core/codes/`):
- **Base32 (`b32`).** Uses the Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. A code is 8 random symbols (40 bits) followed by 1 check symbol, computed with **Luhn mod 32**. Every single-character substitution is detected, and about 99.8% of adjacent transpositions.
  - Display form: `XXX-XXX-XXX`, for example `K7Q-M2X-RAP`. Canonical form: `"b32:" + 9 chars`.
  - Normalization: apply NFKC, then uppercase, then remove whitespace and `- ‐ ‑ ‒ – — ― ー ｰ − _ ・ .`, then map `O→0` and `I→1`, `L→1`. The result must be 9 alphabet characters (`U` gives a charset error) and must pass the Luhn check.
  - Check symbol: walk the data symbols right to left with a factor starting at 2 and alternating 2,1. For each, add `floor(f*v/32) + (f*v % 32)`. The check value is `(32 - sum % 32) % 32`. To validate the full 9 symbols, start the factor at 1; the sum must be ≡ 0 (mod 32).
- **Kana (`kana`), for voice works and CG collections.** Five words from a frozen list of 256 words (40 bits). Display form: `ほたる・かえで・つばめ・こだま・すずめ`. Canonical form: `"kana:" + the 15 concatenated hiragana`.
  - Normalization: apply NFKC, convert katakana U+30A1–30F6 to hiragana (−0x60), map small kana to full size, and map `ぢ→じ`, `づ→ず`, `を→お`. If separators (whitespace, `、。・,./-` and dashes) are present, split on them and expect 5 tokens. Otherwise split the string into 3-character chunks. Every word must be in the list.
  - Word list rules (`kanaWords.ts`, owned by one engineer):
    - Exactly 256 unique words, each exactly 3 characters.
    - Only basic hiragana with dakuten or handakuten allowed. No small kana, ゐ, ゑ, を, ぢ, づ, ゔ or ー.
    - Common SFW concrete nouns.
    - Avoid pairs that differ only by dakuten.
    - Must include ほたる, かえで, つばめ, こだま, すずめ.
    - Fixed length makes segmentation unambiguous. The list is frozen after release; a snapshot test guards it.
- The input kind is detected automatically: if the NFKC form contains any hiragana or katakana it is kana, otherwise b32.

**Derivations.** WebCrypto only. `utf8` is UTF-8 encoding, and `salt` is the 16 bytes decoded from `kdf.salt`.
```
master       = PBKDF2-HMAC-SHA256(password = utf8(canonical), salt, kdf.iterations, 32 bytes)
tag          = HMAC-SHA256(key = master, utf8("shiori/1|tag|" + work.id))[0..16]      // stored in goal.unlock.tag
goalKey(g)   = HKDF-SHA256(ikm = master_g, salt, info = utf8("shiori/1|goal|" + g))   // AES-GCM-256
  goal.secret = AES-GCM(goalKey, iv = random 12B, pt = utf8(JSON.stringify(GoalSecret)),
                        aad = utf8("shiori/1|" + work.id + "|goal|" + g))
allOf seal   : K = HKDF-SHA256(ikm = concat(master_g for g in goals sorted ascending by code-unit order),
                               salt, info = utf8("shiori/1|seal|" + sealedId))
               box = AES-GCM(K, random iv, JSON(SealedPayload), aad = "shiori/1|" + work.id + "|sealed|" + sealedId)
anyOf seal   : CEK = random 32B; box = AES-GCM(CEK, random iv, JSON(payload), same aad as above)
               for each g: W_g = HKDF-SHA256(master_g, salt, "shiori/1|wrap|" + sealedId + "|" + g)
                           wrap_g = AES-GCM(W_g, random iv, CEK, aad = "shiori/1|" + work.id + "|wrap|" + sealedId + "|" + g)
```
- **Verification.** The player types a code. The app parses it (no KDF is run if the checksum or word list fails), derives `master` once per candidate manifest, computes `tag`, and looks it up among `goals[].unlock.tag`.
- **Why this counts as salted SHA-256.** The file stores only a truncated HMAC-SHA256 of a per-work salted, PBKDF2-stretched SHA-256 key. A plain `sha256(salt‖code)` over a 40-bit space could be exhausted on a GPU in minutes, so stretching is required. At 200k iterations, a single high-end GPU needs roughly a year to exhaust one work's code space, or about two weeks to find *some* code in a work with 20 codes.
- **What this is and is not.** This is **spoiler protection, not DRM**. The UI and docs say so.
- **What allOf and anyOf guarantee.** allOf rewards cannot be decrypted without every prerequisite code, because the crypto enforces it. anyOf rewards open with any listed code, by design.
- **PUBLIC fields:** work meta, checkpoint and group labels, goal `label`, `teaser`, `hints`, `missable.warn`, and sealed `label`, `teaser`, `kind` and conditions. **SEALED:** real goal titles, descriptions, unlock messages, all extras, and the codes themselves. Hints are public because the player needs them before unlocking. The editor lints hints that contain the goal's secret title.

**Golden vectors (CONTRACT, used by `shiori.test.ts`).** The inputs are salt `AAECAwQFBgcICQoLDA0ODw` (bytes 00..0f), 100,000 iterations and `work.id = "demo-vector"`.
- `K7Q-M2X-RAP` gives canonical `b32:K7QM2XRAP`:
  - `master = a2e05a107253dc586092bd006c0bf95e5030fbec9ed48e45bd2a86682f961cba`
  - `tag = uJk22A2jIIW5X8pomdRjfQ`
- `goalKey("end-a") = 3ee47f55d091917e2278b87bc734012fbcf576e6bd3f3ddc6f6887f411fe0fbd`
- AES-GCM with `iv = AAECAwQFBgcICQoL`, aad `shiori/1|demo-vector|goal|end-a` and pt `{"title":"星図の果て"}` gives `ct = KdmEUu8aoGAckWBHhF2aLbH8Z0eGqhQEe9-sizNMZ0rTG7FUOOahg6sEZg`.
- `ほたる・かえで・つばめ・こだま・すずめ` gives canonical `kana:ほたるかえでつばめこだますずめ`:
  - `master = d71a2dee8fa5a9da411c45d39ab8889cc5c72a48c0e9f571e44f71a987836315`
  - `tag = A81l68U1lJh5E23amVDweQ`
- allOf key for sealed `afterword` over `{ "end-a": master(b32), "voice-1": master(kana) }`, sorted as `end-a` < `voice-1`: `8986c15f93dda206636cb2016d13b700579e2bd98d95611824788f4dff5e7046`.

**Illustrative file** (values shortened):
```json
{
  "schema": "shiori/1",
  "work": { "id": "demo-hoshiyomi", "title": "星読みの図書館", "safeTitle": "サンプルA",
            "circle": "サンプル工房（架空）", "kind": "game", "engine": "rpgmaker-mz", "version": "1.0.0" },
  "author": { "kind": "creator", "name": "サンプル工房（架空）" },
  "kdf": { "alg": "PBKDF2-SHA256", "iterations": 200000, "salt": "…16B…" },
  "checkpoints": [ { "id": "ch1", "label": "第1章" }, { "id": "ch4", "label": "第4章" } ],
  "groups": [ { "id": "endings", "label": "エンディング" }, { "id": "ach", "label": "実績" } ],
  "goals": [
    { "id": "end-true", "group": "endings", "label": "END 4", "teaser": "図書館のいちばん上で", "spoiler": 1,
      "hints": ["夜の図書館には、昼とは違う顔がある", "第3章の夜、屋上の天文台へ", "天文台の望遠鏡を3回調べる"],
      "missable": { "before": "ch4", "warn": "この先に進む前に、図書館の中をもう一度見て回ろう" },
      "unlock": { "type": "code", "codeKind": "b32", "tag": "…16B…" }, "secret": { "iv": "…", "ct": "…" } },
    { "id": "ach-cat", "group": "ach", "label": "図書館の猫と3回話した", "spoiler": 0, "hints": [],
      "unlock": { "type": "manual" } }
  ],
  "sealed": [
    { "id": "afterword", "label": "あとがき", "teaser": "全てのエンディングで開きます", "kind": "afterword",
      "unlock": { "mode": "allOf", "goals": ["end-a", "end-b", "end-c", "end-true"] }, "box": { "iv": "…", "ct": "…" } }
  ],
  "changelog": [ { "version": "1.0.0", "date": "2026-10-01", "notes": "初版" } ]
}
```

### 4.4 How a circle attaches it (creator workflow)
1. In サークル工房, enter the work info, checkpoints, groups and goals. Code goals get auto-generated codes. Add hints and sealed extras.
2. Run 点検 until it is green, then use 書き出し to get `shiori-kit-<work.id>.zip`:
   ```
   同梱用_PUBLIC/shiori.json                  ← ship in the work's zip
   同梱用_PUBLIC/はじめに.txt                  ← how to use + 非公式表記 + app URL (optional)
   非公開_ゲームに埋め込む/codes.csv            ← goalId,表示名,秘密タイトル,種類,合言葉,解放URL (CSV-escaped)
   非公開_ゲームに埋め込む/qr/<goalId>.png      ← 512×600 QR of https://<app>/#/u/<work.id>/<code> + code text
   非公開_ゲームに埋め込む/エンジン別の表示例.txt
   非公開_控え/project.shiori-studio.json      ← full project backup (contains secrets)
   告知文テンプレート.txt
   README_最初に読んでください.txt              ← what to ship vs never ship (checklist)
   ```
3. Show each code where the player earns it. No plugin is needed. The snippets are included in the kit:
   - **RPG Maker MV/MZ:** a Show Text line such as `しおり帳の合言葉：\C[3]ST4-RMA-P1X\C[0]`, and optionally Show Picture `img/pictures/shiori_end-a.png`.
   - **Tyrano:** `しおり帳の合言葉：ST4-RMA-P1X[p]` or `[image layer=1 storage="shiori_end-a.png"]`.
   - **Wolf RPG:** a 文章表示 command with `\c[2]`.
   - **Ren'Py:** `"しおり帳の合言葉：{b}ST4-RMA-P1X{/b}"`.
   - **Unity:** one text element.
   - **Voice works:** a read-aloud line such as 「しおり帳の合言葉は、ほたる、かえで、つばめ、こだま、すずめ、です」, or printed on the last page of the 台本.
   - **CG collections:** the last page.
4. **Distribution.**
   - **(a) Primary:** include `shiori.json` and `はじめに.txt` in the work's zip, in a new release or through a DLsite update of an existing work. The player imports it from Files or Drive on the phone, or pastes its text.
   - **(b) Circle's own URL** (Ci-en, a GitHub Pages site, a free distribution page): in v1 the player downloads the file in the browser and imports it. Direct URL fetch is "Later".
   - **(c) Paste:** the circle posts the JSON text and players paste it. The file is safe to publish because it is sealed.
5. **Store-description template:** 「【クリア特典】作中の“合言葉”を無料のスマホ用Webアプリ「しおり帳」に入れると、あとがき・後日談が読めます（ネタバレ防止ヒント・実績チェック付き／アカウント不要）」. The kit README tells circles to check DLsite's work-registration rules about mentioning external tools or URLs. `shiori.json` works without any URL in the game.
6. **Return codes (返し合言葉).** A `kind: 'returnCode'` extra reveals a code that the player types into the game. The game checks it with its own features: a name-input or `[edit]` prompt plus a variable comparison. Optionally, `エンジン別の表示例.txt` also gives `sha256hex("shiori-return|" + salt + "|" + NFKC(code))` so the game does not need to store the plaintext.

### 4.5 Optional tiny engine helpers (idea only; the text goes in the kit README, and shipping them as files is "Later")
- **RPG Maker MZ `ShioriCode.js`** (about 60 lines):
  - Plugin command `ShowCode(code, qrPicture?)` opens a centered window with 「しおり帳の合言葉」 and the code at 40 px, shows the QR picture above it, and closes on OK or Cancel.
  - Plugin command `AskReturnCode(answer, switchId)` uses a name-input-style prompt, compares the normalized input to `answer`, and turns the switch ON on a match.
  - It never touches save data.
- **TyranoScript macro:** `[macro name="shiori_code"][layopt layer=1 visible=true][image layer=1 storage=%qr x=440 y=120][ptext layer=1 text=%code size=40 x=440 y=560][l][freeimage layer=1][endmacro]`, used as `[shiori_code code="ST4-RMA-P1X" qr="shiori_end-a.png"]`.

### 4.6 Bundled SFW demo content (fictional)
- **「星読みの図書館」** (`demo-hoshiyomi`, RPG Maker MZ, alias サンプルA):
  - Checkpoints: 第1章–第4章 and 終章.
  - Goals: 4 code-gated endings, plus 4 manual achievements (全ての書架を調べた, 図書館の猫と3回話した, 星図を3枚集めた with a missable before ch3, 閉館後に誰にも見つからずに第2章を終えた).
  - Sealed: 「司書ミナからの手紙」 (letter, anyOf over all endings), 「あとがき」 (afterword, allOf over all four), 「図書館の扉の合言葉」 (returnCode ほしあかり, allOf [end-true]).
  - Codes:

    | Goal | Code |
    |---|---|
    | END 1 | `ST4-RMA-P1X` |
    | END 2 | `M00-NDE-SKR` |
    | END 3 | `NEK-0T0-M0E` |
    | END 4 | `SK1-ES0-NGM` |

- **「雨音と読書の時間」** (`demo-amaoto`, voice, alias サンプルB):
  - Goals: 6 manual track goals, plus code goal `bonus-talk` (kana `ほたる・かえで・つばめ・こだま・すずめ`, spoken at the end of Track 6) and `script-page` (`AMA-0T0-N1J`, the "last page of the 台本").
  - Sealed: 「アフタートーク（文字版）」 (story, allOf [bonus-talk]) and 「登場人物紹介」 (profile, allOf [script-page]).

---

## 5. Player data model (local only), persistence and backup

### 5.1 Player types (CONTRACT, `src/core/types.ts`, continued)
```ts
export type WorkStatus = 'backlog' | 'playing' | 'cleared' | 'completed' | 'paused';
export type CoverColor = 'paper' | 'sky' | 'leaf' | 'sun' | 'rose' | 'plum' | 'slate';
export type ManifestSource = 'bundled' | 'file' | 'paste' | 'quick' | 'player-edit';

export interface WorkRecord {
  id: string;                     // crypto.randomUUID()
  title: string;                  // real title 1..100
  alias: string;                  // 1..40
  storeCode?: string;             // normalized RJ/VJ/BJ
  kind: WorkKind;
  status: WorkStatus;             // default 'backlog'
  coverEmoji: string;             // default '📘'
  coverColor: CoverColor;         // default 'paper'
  spoilerTolerance: SpoilerLevel; // default 1
  manifestKey?: string;           // -> ManifestRecord.key (absent = "記録だけ")
  manifestWorkId?: string;        // copy of manifest.work.id
  currentCheckpointId?: string;
  newGoalIds: string[];           // NEW badges after manifest update
  createdAt: number; updatedAt: number; lastPlayedAt?: number;   // epoch ms
}
export interface ManifestRecord {
  key: string;                    // b64u(SHA-256(utf8(JSON.stringify(manifest)))) of the *validated* object
  workId: string; manifest: ShioriManifestV1; source: ManifestSource; importedAt: number;
}
export interface GoalProgress {   // exists only when done
  workId: string; goalId: string; via: 'manual' | 'code'; doneAt: number;
  hintTierAtDone: 0 | 1 | 2 | 3; archived: boolean;
}
export interface Redemption {
  workId: string; goalId: string; canonical: string; redeemedAt: number;
  master?: B64u; masterSalt?: B64u;   // cache; valid only while masterSalt === manifest.kdf.salt; never exported
}
export interface HintReveal { workId: string; goalId: string; tier: 1 | 2 | 3; updatedAt: number }
export interface Session {
  id: string; workId: string; startedAt: number; endedAt?: number; minutes?: number;
  checkpointId?: string; whereNote?: string; nextTodo?: string;
}
export interface Note { id: string; workId: string; goalId?: string; text: string; createdAt: number; updatedAt: number }
export interface PendingCode { id: string; canonical: string; manifestWorkIdHint?: string; receivedAt: number }
export interface SealedOpen { workId: string; sealedId: string; firstOpenedAt: number; seen: boolean }

export interface Settings {
  schemaVersion: 1;
  ageConfirmedAt?: number; onboardedAt?: number;
  discreet: { aliasOnly: boolean; blurOnHide: boolean; hideStoreLinks: boolean; blurExtras: boolean };
  camouflageText: string;
  pin?: { salt: B64u; iterations: number; hash: B64u };
  autoLockSec: 0 | 30 | 60 | 300;
  pinFailures: number; pinCooldownUntil?: number;
  lastBackupAt?: number; changesSinceBackup: number; backupReminderSnoozedUntil?: number;
  persist?: { requestedAt: number; granted: boolean };
  completionPromptedWorkIds: string[];
}
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: false },
  camouflageText: '', autoLockSec: 60, pinFailures: 0, changesSinceBackup: 0, completionPromptedWorkIds: [],
};

/** Creator drafts (DB 'shiori-studio'); also the export file format */
export interface DraftGoal extends GoalCommon {
  unlockType: 'manual' | 'code';
  codeKind?: CodeKind; code?: string /* display form */; secret?: GoalSecret;   // required when 'code'
}
export interface DraftSealed {
  id: string; label: string; teaser?: string; kind: SealedKind;
  mode: 'allOf' | 'anyOf'; goals: string[]; payload: SealedPayload;
}
export interface StudioProject {
  format: 'shiori-studio-project'; version: 1;
  id: string; createdAt: number; updatedAt: number; lastExportedAt?: number;
  appUrl: string;                 // https URL (or http://localhost) used in QR/はじめに.txt
  work: ManifestWork; authorName?: string;
  kdfIterations: number;          // default 200000
  kdfSalt?: B64u;                 // generated at first build, then kept stable
  checkpoints: Checkpoint[]; groups: Group[]; goals: DraftGoal[]; sealed: DraftSealed[]; changelog: ChangelogEntry[];
}
```

### 5.2 Key pure-logic semantics
- `computeProgress(m, progress)` returns `{ total, done, pct, byGroup[] }`. Archived progress and goals missing from `m` are excluded. `pct = total ? floor(100*done/total) : 0`.
- `missableAlerts(m, progress, currentCheckpointId?)`:
  - Let `c` be the index of the current checkpoint, or −1 if unset, and `b` the index of `missable.before`.
  - Emit an alert only for not-done goals where `c < b`.
  - The level is `'soon'` if `b − c === 1`, otherwise `'ahead'`.
- `sessionMinutes(start, end) = min(round((end−start)/60000), 720)`. `daysSince(ts, now)` counts local calendar days. `resumeInfo(sessions)` returns the latest ended session that has a checkpoint, `whereNote` or `nextTodo`.
- `upgradeProgress(oldM, newM, progress)`:
  - Returns `{ progress, newGoalIds, archivedGoalIds }`.
  - Progress for goals that are gone becomes `archived: true`. Goals that reappear are un-archived.
  - `newGoalIds` lists goals that are in `newM` but not in `oldM`.
  - If `kdf.salt` changed, the service re-derives masters from `Redemption.canonical`. A redemption that no longer matches keeps its canonical form and loses its master.
- Sealed evaluation runs after each redemption, import or pending pass. It collects the goal ids of redemptions with a valid master and applies `satisfiedSealed(m, ids)` minus items already opened. The app decrypts each, then calls `putSealedOpen({ seen: false })`. The UI animates items with `seen === false`, then sets `seen = true`.

### 5.3 IndexedDB layout (`idb` library)
- **DB `shiori`, version 1:**
  - `works` (keyPath `id`, index `manifestWorkId`)
  - `manifests` (keyPath `key`, index `workId`)
  - `progress` (keyPath `['workId','goalId']`, index `workId`)
  - `redemptions` (same key, index `workId`)
  - `hints` (same key)
  - `sessions` (keyPath `id`, indexes `workId` and `startedAt`)
  - `notes` (keyPath `id`, index `workId`)
  - `pending` (keyPath `id`)
  - `sealedOpens` (keyPath `['workId','sealedId']`)
  - `meta` (keyPath `key`; the record `{ key: 'settings', value: Settings }`)
- **DB `shiori-studio`, version 1:** `projects` (keyPath `id`). It is kept separate so that wiping player data never destroys a creator's secrets, and the other way round.
- Upgrades use `switch (oldVersion)` with fall-through. Each future version adds a case, and never edits an old one.
- Every mutating repo call except `updateSettings` and `putPending` increments `settings.changesSinceBackup` in the same transaction.

### 5.4 Repository interface (CONTRACT, `src/storage/repo.ts`)
```ts
export interface ShioriRepo {
  subscribe(listener: () => void): () => void;           // fired after every committed mutation
  getSettings(): Promise<Settings>;                       // returns DEFAULT_SETTINGS merged if absent
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  listWorks(): Promise<WorkRecord[]>;
  getWork(id: string): Promise<WorkRecord | undefined>;
  findWorkByManifestWorkId(manifestWorkId: string): Promise<WorkRecord | undefined>;
  putWork(w: WorkRecord): Promise<void>;
  deleteWork(id: string): Promise<void>;                  // cascades to all child stores + manifests
  getManifest(key: string): Promise<ManifestRecord | undefined>;
  putManifest(m: ManifestRecord): Promise<void>;
  deleteManifest(key: string): Promise<void>;
  listProgress(workId: string): Promise<GoalProgress[]>;
  putProgress(p: GoalProgress): Promise<void>;
  deleteProgress(workId: string, goalId: string): Promise<void>;
  listRedemptions(workId?: string): Promise<Redemption[]>;
  putRedemption(r: Redemption): Promise<void>;
  listHints(workId: string): Promise<HintReveal[]>;
  putHint(h: HintReveal): Promise<void>;
  listSessions(workId?: string): Promise<Session[]>;      // sorted startedAt desc
  putSession(s: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getOpenSession(): Promise<Session | undefined>;
  listNotes(workId: string): Promise<Note[]>;
  putNote(n: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  listPending(): Promise<PendingCode[]>;
  putPending(p: PendingCode): Promise<void>;
  deletePending(id: string): Promise<void>;
  listSealedOpens(workId: string): Promise<SealedOpen[]>;
  putSealedOpen(o: SealedOpen): Promise<void>;
  exportAll(): Promise<BackupDataV1>;                     // strips Redemption.master/masterSalt
  replaceAll(data: BackupDataV1): Promise<void>;          // preserves pin, ageConfirmedAt, onboardedAt
  clearAll(): Promise<void>;
}
export interface StudioRepo {
  list(): Promise<StudioProject[]>; get(id: string): Promise<StudioProject | undefined>;
  put(p: StudioProject): Promise<void>; delete(id: string): Promise<void>;
}
```

### 5.5 Backup format (CONTRACT, `src/core/backup/`)
```ts
export interface BackupDataV1 {
  works: WorkRecord[]; manifests: ManifestRecord[]; progress: GoalProgress[]; redemptions: Redemption[];
  hints: HintReveal[]; sessions: Session[]; notes: Note[]; pending: PendingCode[]; sealedOpens: SealedOpen[];
  settings: { discreet: Settings['discreet']; autoLockSec: Settings['autoLockSec']; camouflageText: string };
}
export type BackupFileV1 =
  | { format: 'shiori-backup'; version: 1; exportedAt: number; appVersion: string; encrypted: false; data: BackupDataV1 }
  | { format: 'shiori-backup'; version: 1; exportedAt: number; appVersion: string; encrypted: true;
      enc: { kdf: KdfParams /* iterations 600000 */; iv: B64u; ct: B64u /* AES-GCM(utf8(JSON(data))), aad "shiori-backup/1" */ } };
```
- `parseBackup(text, passphrase?)` returns `{ ok: true, data }` or `{ ok: false, error: 'json' | 'format' | 'version' | 'passphraseRequired' | 'passphrase' | 'schema' }`. `migrateBackup(raw)` maps older versions to V1. A version above 1 gives `'version'`, shown as 「新しいバージョンのバックアップです」.
- **Merge rules** (`mergeBackup(local, incoming)`):
  - **works:** matched by `id`. If there is no id match but `manifestWorkId` matches a local work, the incoming id is remapped to the local one in all child records. For matched pairs the newer `updatedAt` wins, and so does its `manifestKey`.
  - **manifests:** union by key.
  - **progress:** union. The earliest `doneAt` is kept. `'code'` beats `'manual'`. `archived` is the AND of both. `hintTierAtDone` takes the minimum.
  - **redemptions:** union, keeping the earliest.
  - **hints:** maximum tier.
  - **sessions:** union by id. When both have the same id, the ended one wins, otherwise the newer.
  - **notes:** newer `updatedAt` wins.
  - **pending:** deduplicated by `canonical`.
  - **sealedOpens:** earliest `firstOpenedAt`, and `seen` is OR-ed.
  - **settings:** kept local on merge, taken from the incoming file on replace.
- Other versioned formats: the manifest (`schema: 'shiori/1'`; additive fields are stripped by older apps, and a breaking change becomes `shiori/2`) and the studio project (`shiori-studio-project/1`).

---

## 6. Screens & navigation (mobile-first)

**Layout and theme**
- Minimum width 360 px, 16 px gutters, `env(safe-area-inset-*)`.
- Bottom nav with 3 items: 本棚 (`#/`), 合言葉 (`#/code`), 設定 (`#/settings`).
- A header on every screen with the title 「しおり帳」 and a 「隠す」 button.
- System font stack (`system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`) with no web fonts. Paper-tone tokens in `theme.css`, with dark mode through `prefers-color-scheme`.

**Overlay layers** (rendered above the router in this order; each is state, never a route):
1. `AgeGate` (F1)
2. `Onboarding`, up to three questions:
   - 「人前で使うことがありますか？」 → `aliasOnly`
   - 「PINを設定しますか？」
   - 「自動ロックまでの時間」 (asked only when a PIN was set)
   It then explains the long-press-to-return gesture and calls `persist()`.
3. `LockScreen`: a PIN pad.
4. `Camouflage`: the 「メモ」 notepad.
5. `PrivacyVeil`: shown while `document.hidden`.
6. `EnvelopeReveal` queue.
7. Toasts and dialogs.

**Routes** (CONTRACT, `src/core/route.ts`; the hash holds only local UUIDs, numeric indices, or deep-link segments):

| Hash | Screen |
|---|---|
| `#/` | 本棚: banners (backup reminder, pending codes), 続きから card, status filter chips, work cards, FAB 「＋ 追加」 |
| `#/add` | 作品を追加: 「しおりファイルを読み込む」 (file, drop, paste → ImportPreview), 「かんたんしおりを作る」, 「記録だけ付ける」, 「サンプルを試す」 |
| `#/w/<id>?tab=progress\|extras\|log\|notes&sheet=g<n>\|x<n>` | 作品ページ. Tabs: 進捗 (resume card, いまどこ？, missable alerts, overall ring, per-group lists with 🔒/✓, NEW and ノーヒント badges, hint dots), おまけ (envelope cards with condition progress), 記録 (totals, session list), メモ. Sticky bottom session bar 「▶ 始める」 / 「■ 終える 00:42」. `sheet=g<n>` is the goal sheet: label or decrypted title, teaser, description, hint tiers (HoldToReveal), 「合言葉を入れる」, overflow 「合言葉なしで達成にする」, goal note, and 「名前を変える」 for player manifests. `sheet=x<n>` is the sealed reader. |
| `#/w/<id>/edit` | 作品設定: alias, real title (tap to reveal), emoji, color, status, store code with an 「作品ページを開く」 button (hidden by `hideStoreLinks`, confirm before opening), spoiler tolerance 0–3 with a plain explanation, manifest info (version, author claim), 「更新を読み込む」, 「しおりファイルとして書き出す」 (player manifests), 「この作品を削除」 |
| `#/code?w=<id>` | 合言葉: large input, 「貼り付け」, 「確かめる」, live format feedback, optional work selector 「どの作品？（おまかせ）」, pending list |
| `#/u/<manifestWorkId>/<code>` | UnlockLanding: processes the code, then `replaceState` (F11) |
| `#/settings` | 設定: おしのび switches and camouflage text, 画面ロック, データ (export with optional passphrase, import with replace or merge, storage status, delete all), サークル向け → 工房, ヘルプ, このアプリについて (disclaimer, version, licenses; the full third-party notices are `public/licenses.txt`, linked from ヘルプ →「このアプリについて」), 年齢確認の取り消し |
| `#/studio` | 工房 list: new, 「サンプルを開く」, import project, secret banner |
| `#/studio/<pid>?tab=work\|structure\|goals\|extras\|check\|export` | 工房 editor. Tabs: 作品 (incl. work.id, appUrl, advanced iterations), 章・グループ (reorder with up/down buttons), 目標 (list plus form; unlock 手動/合言葉 with 英数字/ひらがな5語, code display, 「作り直す」), おまけ (condition すべて/どれか plus a multi-select of code goals, payload fields), 点検 (report plus 「プレイヤー画面で試す」 → `#/studio/<pid>/preview`), 書き出し (ship/don't-ship checklist, kit zip, shiori.json only, project backup, store template with a copy button) |
| `#/studio/<pid>/preview` | Player WorkScreen mounted on a MemoryRepo seeded from the build |
| `#/demo-pc` | PC画面シミュレータ: 16:9 fake game window, click-through scenes, ending screens with code, QR and 「この端末で入力する」, title-screen 「扉の合言葉」 |
| `#/help` | ヘルプ (F19) |

**Spoiler protection in the UI**
- `SpoilerText` wraps every public string that carries a spoiler level.
- `HoldToReveal` gates the hint tiers.
- Sealed bodies are blurred when `blurExtras` is on.
- Notes support `||…||`.
- The real titles of code goals are shown only after decryption.

---

## 7. Architecture (Vite + React + TypeScript, no backend)

### 7.1 Dependencies
- Runtime: `react`, `react-dom` (19), `zod` (4), `idb`, `fflate` (zip), `qrcode-generator`. `workbox-window` (a dev dependency used by `virtual:pwa-register`) is bundled too.
- Dev: `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `typescript` (strict, `noUncheckedIndexedAccess`), `vitest`, `@testing-library/react`, `jsdom`, `fake-indexeddb`, `tsx`, `oxlint`.
- No router library (a custom hash router), no CSS framework, no CDN.

### 7.2 Module map (owners can work in parallel against the CONTRACT files)
```
index.html                      lang="ja", <title>しおり帳</title>, <meta name="referrer" content="no-referrer">, <meta name="robots" content="noindex">
vite.config.ts                  base: process.env.VITE_BASE ?? './'; react(); VitePWA(...); cspPlugin (build only)
vitest.config.ts                environment 'node' default; setupFiles src/test/setup.ts; process.env.TZ='Asia/Tokyo'
.oxlintrc.json                  react/no-danger error (the src/core purity rule is src/core/boundary.test.ts)
public/icons/                   icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, favicon.svg (bookmark)
scripts/build-demo.ts           src/demo/*.project.json → buildManifest → src/demo/*.shiori.json (committed)
scripts/check-dist.ts           fails if dist names an http(s) host outside its allowlist, or src uses a raw-HTML API (see the implementation notes)
scripts/gen-licenses.ts         node_modules LICENSE texts of everything bundled → public/licenses.txt (committed; --check for CI)
../.github/workflows/shiori-cho.yml  npm ci → gen-licenses --check → typecheck → lint → test → build → check:dist → deploy-pages (manual)
src/core/                       PURE (no React/DOM; only globalThis.crypto, TextEncoder/Decoder)
  types.ts  constants.ts (domain strings, limits)  errors.ts (ShioriError{code,messageJa})
  encoding.ts        utf8/fromUtf8, b64uEncode/Decode, concatBytes, randomBytes, bytesEqual, sha256
  codes/crockford.ts normalizeB32, luhn32Check, luhn32Valid, generateB32, formatB32
  codes/kana.ts      normalizeKana, splitKanaWords, generateKana
  codes/kanaWords.ts KANA_WORDS: readonly string[256]  (frozen)
  codes/index.ts     parseCode(input): ParsedCode; generateCode(kind, rng?); codeErrorMessageJa(e)
  crypto/primitives.ts pbkdf2Sha256, hmacSha256, hkdfSha256, aesGcmEncrypt, aesGcmDecrypt
  crypto/shiori.ts   deriveMaster, lookupTag, sealGoalSecret, openGoalSecret, sealItem, openItem
  crypto/pin.ts      hashPin, verifyPin
  crypto/backupCrypto.ts encryptJson, decryptJson (passphrase)
  manifest/schema.ts zod schemas (+ GoalSecret/SealedPayload schemas for post-decrypt validation)
  manifest/messagesJa.ts issue → Japanese message
  manifest/validate.ts parseManifestText(text), validateManifest(obj)
  manifest/build.ts  buildManifest(project) → { manifest, json, codes: CodeRow[], salt }
  manifest/selftest.ts selfTest(manifest, codes) → SelfTestReport
  manifest/lint.ts   lintProject(project) → ValidationIssue[]
  manifest/noSpoil.ts findLeaks(json, secrets) → string[]
  manifest/quick.ts  buildQuickManifest(title, counts, kind, workId)
  manifest/upgrade.ts diffManifests, upgradeProgress
  redeem.ts          redeem(input, candidates, {preferWorkId}) → RedeemResult; satisfiedSealed(m, goalIds)
  progress.ts        computeProgress, missableAlerts, isNoHint, visibility(spoiler, tolerance)
  session.ts         sessionMinutes, daysSince, resumeInfo, totalMinutes
  backup/format.ts   exportBackup(data,{passphrase?,appVersion,now}) → string; parseBackup(text, pass?)
  backup/merge.ts    mergeBackup(local, incoming) → { merged, stats }
  backup/migrate.ts  migrateBackup(raw)
  storeCode.ts       parseStoreCode(input) → StoreCode|null; buildStoreUrl(code,{touch})
  route.ts           parseHashRoute(hash) → Route; buildHash(route); buildUnlockUrl(appUrl, workId, canonical); extractUnlockFromText(text)
  alias.ts           nextAlias(existing) ("作品A"…"作品Z","作品AA"…)
  notes.ts           parseSpoilerSpans(text) → {text, spoiler}[]
  kit.ts             buildKitTextFiles({project, json, codes, appUrl}) → {path, content}[]
src/storage/  repo.ts (CONTRACT) memoryRepo.ts idbRepo.ts studioRepo.ts (idb + memory) repoContract.ts (shared test suite)
src/app/      (services, no React; take a repo)
  library.ts   previewImport, commitImport, createWork, importBundledDemos, updatePlayerManifest, exportPlayerManifest
  unlock.ts    submitCode(repo, input, ctx) → UnlockOutcome; processPending; decryptGoalSecrets; readSealed; markDoneWithoutCode
  sessions.ts  startSession, endSession, editSession
  backup.ts    exportBackupFile, readBackupFile, applyBackup(repo, data, mode)
  studio.ts    buildAndCheck(project), withBuildSalt, exportKitZip(project, build, renderQrPng) (QR PNGs via ui/studio/qrPng.ts)
  platform.ts  vibrate, readClipboard, writeClipboard, requestPersist, isIosSafariNotStandalone, download(name, blob)
src/ui/  App.tsx, router.ts (useHashRoute), theme.css (copy is inline in the components; tone-reviewed, non-explicit),
         shell/ (AgeGate, Onboarding, LockScreen, Camouflage, PrivacyVeil, Header, BottomNav, UpdatePrompt),
         components/ (HoldToReveal, SpoilerText, ProgressBar, EnvelopeReveal, Sheet, Toast, ConfirmDialog, CodeInput, EmojiCover),
         screens/ (Home, AddWork, ImportPreview, QuickPackForm, work/*, CodeEntry, UnlockLanding, Settings, Help, DemoPc),
         studio/ (StudioList, StudioProject, tabs/*, Preview, qrPng.ts)
src/demo/ hoshiyomi.project.json, hoshiyomi.shiori.json, amaoto.project.json, amaoto.shiori.json, pcScenes.ts, demoCodes.ts
src/test/setup.ts  polyfill globalThis.crypto = node:crypto webcrypto if missing (jsdom); fake-indexeddb/auto for idb tests
```

Key service signatures (CONTRACT for the UI):
```ts
type RedeemResult =
  | { status: 'invalid'; error: CodeError }
  | { status: 'matched'; manifestKey: string; goalId: string; canonical: string; master: Uint8Array }
  | { status: 'noMatch'; canonical: string };
interface UnlockOutcome {
  status: 'unlocked' | 'already' | 'noMatch' | 'invalid';
  workId?: string; goalId?: string; secret?: GoalSecret; openedSealedIds: string[]; canonical?: string; error?: CodeError;
}
type ImportPreview =
  | { kind: 'invalid'; errors: ValidationIssue[] }
  | { kind: 'new'; manifest: ShioriManifestV1; warnings: ValidationIssue[]; stats: { goals: number; codeGoals: number; sealed: number } }
  | { kind: 'update'; manifest: ShioriManifestV1; warnings: ValidationIssue[]; existing: WorkRecord;
      diff: { added: string[]; removed: string[]; kdfChanged: boolean }; alreadyImported: boolean };
```

State in React: a `RepoContext` (IdbRepo in the app, MemoryRepo in preview and tests), a `SettingsContext`, and a `useRepoQuery(fn, deps)` hook that re-runs on `repo.subscribe`. There is no global store library.

### 7.3 PWA, hosting and security headers
- `vite-plugin-pwa`:
  - `generateSW`, `registerType: 'prompt'`, `injectRegister: false`: `src/ui/shell/UpdatePrompt.tsx` registers the worker with `useRegisterSW` from `virtual:pwa-register/react` (bundled, compatible with the CSP).
  - `workbox.globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}']`, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`.
  - Manifest: `{ name: 'しおり帳', short_name: 'しおり帳', lang: 'ja', start_url: './', scope: './', id: './', display: 'standalone', background_color: '#f7f3ea', theme_color: '#f7f3ea', icons: [192, 512, maskable 512] }`. The name is neutral from day one because it cannot change after install.
- CSP (injected only in the build, through `transformIndexHtml`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- External links (DLsite only) use `target="_blank" rel="noopener noreferrer"` and open only after a confirm dialog.
- Store URLs (`storeCode.ts`, one central table):
  - `RJ` → `https://www.dlsite.com/maniax[-touch]/work/=/product_id/<code>.html`
  - `VJ` → `pro[-touch]`
  - `BJ` → `books[-touch]`
  - The touch variant is chosen when `(pointer: coarse)` matches. DLsite may redirect between floors; verify the paths before release.
- Deploy: GitHub Pages through the workflow. `VITE_APP_URL` (optional) sets the default `appUrl` for 工房; otherwise the app uses `location.origin + location.pathname`.

### 7.4 How the demo is bundled
- `src/demo/*.project.json` are `StudioProject` files. They hold plaintext and fixed demo codes, which are public anyway, plus a fixed `kdfSalt` so tags stay stable across runs.
- `npm run demo:build` (`tsx scripts/build-demo.ts`) runs the same `buildManifest` used by the app on Node 22 WebCrypto and writes `*.shiori.json`. That output is committed.
- The app imports both `.shiori.json` files statically, so they sit in the JS bundle and the precache. 「サンプルを試す」 calls `importBundledDemos` with `source: 'bundled'`. 工房 「サンプルを開く」 loads `hoshiyomi.project.json`.
- `demo.test.ts` guarantees that the committed output matches the project files.

---

## 8. Test plan (vitest)

Core tests run in the `node` environment, UI tests in `jsdom`, `TZ=Asia/Tokyo`, and production KDF iterations are used wherever a manifest is validated. Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build && npm run check:dist`.

| File | Cases |
|---|---|
| `encoding.test.ts` | b64u round trip for 0–100 random lengths; no padding; rejects `+/=` and invalid characters; UTF-8 round trip including emoji and kana; `bytesEqual` |
| `crockford.test.ts` | `luhn32Check`: `K7QM2XRA→P`, `00000000→0`, `ZZZZZZZZ→8`, and all demo codes (§4.6). Every single-symbol substitution of 200 random codes is rejected (exhaustive over 9 positions × 31 symbols). Adjacent transpositions are detected at ≥99%. Normalization: `ｋ７ｑｍ－２ｘｒａ－ｐ`, `k7q m2x rap` and `K7Q‐M2X—RAP` all give `b32:K7QM2XRAP`; `MOO-NDE-SKR` gives `M00NDESKR`; `I` and `L` map to `1`; `U` gives a charset error; 8 or 10 characters give a length error. `generate` × 1000: every result valid and correctly formatted. |
| `kana.test.ts` | Katakana, half-width katakana and mixed separators (`、・ /`) normalize to the same canonical form. Input without separators is chunked. `づ→ず`, `を→お`, small kana are enlarged. An unknown word reports the right index. Wrong word counts. Word-list invariants: 256 entries, unique, 3 characters, allowed character set only, demo words present, and a snapshot hash of the list. |
| `parseCode.test.ts` | Kind detection; empty input; mixed ASCII and kana input gives a `mixed` error; Japanese messages for each error |
| `primitives.test.ts` | PBKDF2 RFC 7914 vector (`passwd`/`salt`/1/64 B → `55ac046e…d3a19783`); HKDF RFC 5869 case 1 (→ `3cb25f25…5865`); AES-GCM round trip; a flipped ciphertext bit throws; wrong AAD throws |
| `shiori.test.ts` | All golden vectors in §4.3. The tag changes when `work.id` or the salt changes. Goal secret round trip. allOf opens with every master, returns null or fails with any strict subset, and does not depend on the order of the masters map. anyOf opens with each listed goal and fails with an unlisted one. Moving a box between sealed ids or works fails because of the AAD binding. A payload that fails its schema after decryption is rejected. |
| `validate.test.ts` | The committed demo manifests pass. Errors: bad `schema`, `shiori/2`, missing `kdf` when code goals exist, duplicate ids, dangling group or checkpoint references, sealed referencing a manual or unknown goal, `wraps` mismatch, iterations of 99,999, IV of 11 bytes, tag of 15 bytes, 4 hints, over-long strings, a bidi override character, a file over 512 KiB, invalid JSON (Japanese message with position). Unknown keys are stripped. Paths are correct. |
| `build_selftest.test.ts` | Build a fixture project with 3 code goals (b32 and kana), 2 manual goals, allOf and anyOf items and a returnCode → the result validates and `selfTest` is all green. `findLeaks` finds no code, secret or body in the JSON. Injecting a secret into a public field is caught. The salt stays stable across rebuilds. |
| `lint.test.ts` | A code goal without hints; tier 1 equal to or containing tier 3; a hint containing the secret title; a missable before the first checkpoint; an empty group; duplicate codes |
| `redeem.test.ts` | Correct goal matched; code from another work gives noMatch; a checksum error never calls PBKDF2 (spy on `deriveMaster`); `preferWorkId` is tried first; `satisfiedSealed` for allOf and anyOf |
| `progress.test.ts` | Counts, per-group values, archived goals excluded, empty manifest gives 0; `missableAlerts` for current unset, soon, ahead and passed; `isNoHint` |
| `upgrade.test.ts` | Added, removed and kept goals; archive and un-archive; progress preserved; `kdfChanged` flag |
| `session.test.ts` | Minutes rounding and the 720 cap; `daysSince` across local midnight (today, yesterday, N days); `resumeInfo` picks the latest ended session with info |
| `backup.test.ts` | Plain and encrypted round trips; wrong passphrase; a future version gives the `'version'` error; PIN, age flag and masters are absent from the export; every merge rule in §5.5, including work remapping by `manifestWorkId`; replace mode |
| `storeCode.test.ts`, `route.test.ts`, `alias.test.ts`, `notes.test.ts`, `quick.test.ts`, `kit.test.ts` | `rj01667536` and `ＲＪ０１６６７５３６` normalize to `RJ01667536`; 7 digits is invalid; VJ and BJ URLs for touch and desktop. Route build/parse round trip for every route; unknown input gives notFound; a kana deep link is percent-encoded; `extractUnlockFromText` finds a URL inside prose. `作品Z → 作品AA`. Spoiler spans, including an unclosed `||`. Quick counts produce the right ids and labels, groups with count 0 are omitted, and the result validates. The kit has the exact path list, CSV escaping, no codes in `はじめに.txt`, and contains the disclaimer. |
| `demo.test.ts` | The committed demo manifests validate. Every documented demo code unlocks its goal, and every sealed item opens with its documented codes. The demo contains no store codes. |
| `repoContract.ts` (run against memoryRepo and idbRepo with fake-indexeddb) | CRUD for every store; cascade on `deleteWork`; `getOpenSession`; `exportAll` / `replaceAll` round trip; `changesSinceBackup` increments; `subscribe` fires |
| `unlockService.test.ts` (MemoryRepo) | End to end: import the demo, submit 4 codes, the letter opens after the first and the afterword after the fourth; a pending code is redeemed after import; `already` status; `markDoneWithoutCode` does not open seals |
| UI (`jsdom`, limited set) | AgeGate blocks the app and 「いいえ」 is a dead end; Escape and 「隠す」 show the camouflage screen and no work title remains in the DOM; CodeInput shows the checksum error without an async KDF call; the answer tier requires the confirm dialog; the envelope honors reduced motion |

---

## 9. Risks, ToS, legal & privacy

**DLsite relationship and ToS**
- The app never contacts dlsite.com. It does no scraping, uses no API, requires no login, fetches no images and does not touch DRM.
- It never reads, modifies or redistributes work files.
- The only contact point is a link built from a store code, opened by a user tap after a confirmation. It is hidden by default in discreet mode.
- No DLsite name, logo or trade dress appears in the app's branding. The about screen and every exported kit carry 「DLsiteとは無関係の非公式ツールです」.
- Circles must check DLsite's work-registration rules before mentioning the app or showing URLs or QR codes in a work. The mechanism works with a plain code string and no URL at all.

**Copyright and content**
- The contents of `shiori.json` are written by the rights holder (the circle) or by the player for personal use. The app hosts, indexes and distributes nothing.
- Player-made files show 「作成者の申告：プレイヤー」. Sharing third-party files is the user's responsibility.
- The app, its UI copy and the bundled demos are fully SFW and fictional. v1 payloads are text only (no images or binaries), and everything renders as plain text.
- The age gate is a self-declared check of intent, and the help pages say so.

**Crypto honesty**
- The sealing is **spoiler protection, not DRM**. A leaked code exposes only that one extra, and allOf extras need every code.
- Circles are told never to put paid main content in sealed extras.
- Hints and teasers are public by design, and the editor says so.
- Codes are 40 bits and PBKDF2 uses at least 100k iterations (default 200k), which puts brute force at days to months of GPU time per work.
- Regenerating codes after release breaks players' existing extras, so the editor warns about it.

**Privacy**
- No accounts, analytics, telemetry or third-party requests, enforced by the CSP and `check-dist`. Data lives in IndexedDB on the device only. A few tab-scoped `sessionStorage` entries (the code hand-off, a stashed deep link, the library filter/sort, the camouflage flag) vanish when the tab closes, and the help and README say so.
- The PIN is presented honestly as a screen lock. Data at rest is not encrypted, to avoid unrecoverable data loss.
- Backups can reveal titles. They use neutral filenames and offer optional passphrase encryption (PBKDF2 at 600k iterations with AES-GCM).
- Browser history may keep `#/u/<work id>/<code>` entries, and the app calls `replaceState` right away. The code means nothing without the file. The work id is the creator's `work.id`: the editor proposes an opaque one and recommends keeping it unrelated to the content, but a creator can choose a readable slug, so the help text does not call it meaningless.
- `noindex` and `no-referrer` are set.

**Platform**
- On iOS, Safari and home-screen PWAs have separate storage and data can be evicted. Mitigations: pending codes plus the copy/paste fallback, `storage.persist()`, backup reminders, and install guidance.
- WebCrypto needs HTTPS, which GitHub Pages provides.
- PBKDF2 at 200k iterations takes about 0.1–1 s per attempt on phones. The checksum and word list reject typos before the KDF runs, and the code is tried against the hinted work first.

**Security**
- XSS: `innerHTML` is banned, and the CSP applies.
- Malicious manifests: size, count and length limits, zod stripping, rejection of control and bidi characters, schema validation of decrypted payloads, and AAD binding against box swapping.
- Author claims are never presented as verified; signatures are "Later".

**Adoption**
- A cold start (no circle has shipped a file yet) is mitigated by player-alone value: sessions, resume, quick shiori and discretion.
- The demo plus `#/demo-pc` show the whole loop on one device.
- A kit export aims for about 15 minutes of work, with ready engine snippets and a store-description line.

**Naming**
- Search for existing trademarks or apps named 「しおり帳」 before public launch. After install, the PWA name is fixed. The name is not centralized: besides `APP_NAME_JA` in `src/core/constants.ts` and the web manifest in `vite.config.ts`, it appears in `index.html`, in many inline UI strings (`src/ui/**`), in the creator-kit texts (`src/core/kit.ts`, `src/app/studio.ts`), in the demo projects and their built manifests (`src/demo/`), in `scripts/gen-licenses.ts` and in the README. A rename before the first release needs a repo-wide search for 「しおり帳」, followed by `npm run demo:build` and `npx tsx scripts/gen-licenses.ts`.