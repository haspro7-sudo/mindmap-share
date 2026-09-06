# 棒人間ファイト RE

間合いと読み合いの、同時選択制 2D 格闘ゲーム。毎拍「打撃・投げ・ガード・前進・後退（＋必殺）」から同時に1手を選び、**移動後の間合いで届いた技だけが当たる**。

- 設計書: [docs/DESIGN.md](docs/DESIGN.md)
- バランス検証（均衡ソルバー出力）: [docs/BALANCE.md](docs/BALANCE.md)
- 外部レビュー依頼文: [docs/REVIEW_BRIEF.md](docs/REVIEW_BRIEF.md)

## 遊び方

| | 後退 | 必殺 | 前進 | 打撃 | 投げ | ガード |
|---|---|---|---|---|---|---|
| 1P | Q | W | E | A | S | D |
| 2P | O | I | U | J | K | L |

画面下のボタンをクリック／タップしても選べる。`M` でミュート。

- 密着：打撃 > 投げ > ガード > 打撃 の三すくみ
- 近距離：投げは踏み込んで掴む。前進は打撃・投げに刺さると痛い
- 中距離：打撃は空振り。前進・踏み込みへの差し返しだけが打撃の仕事
- 遠距離：前進するしかない。5拍ごとにリングが狭まる
- ゲージ 5 で必殺（ガード不能 3 ダメ）。密着の投げにだけ負ける

## 開発

```bash
npm install
npm run dev        # 開発サーバ
npm test           # ルール・LP ソルバーの単体テスト
npm run solve      # 全状態の均衡ソルバー → docs/BALANCE.md（約2分）
npm run sim        # CPU 同士の対戦表
npm run build      # dist/
npm run singlefile # dist-single/index.html（1ファイル配布用）
node tools/screenshot.mjs   # Playwright でスクリーンショット
```

## 構成

```
src/engine/  ルール・均衡ソルバー・CPU（DOM 非依存）
src/render/  Canvas 描画（プロシージャル棒人間・HUD・演出）
src/scenes/  タイトル / 試合 / 結果
tests/       vitest
tools/       solve / sim / singlefile / screenshot
docs/        DESIGN / BALANCE / REVIEW_BRIEF
```
