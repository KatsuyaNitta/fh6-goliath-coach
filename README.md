# FH6 Goliath Coach

## 日本語

FH6 Goliath Coach は、Forza Horizon 6 の Goliath コースを、記録済みテレメトリと 3D コースビューで分析するためのツールです。

現時点では、完成済みのドライビングコーチではありません。まずは、基準走行パスと実走行データを同じコース距離上に重ね、区間ごとのタイムや走行ラインの違いを確認できる分析ビューアとして実装しています。

### 現在の実装状況

現在の実装には次の機能が含まれます。

- Goliath の 1 m 間隔の基準走行パスの 3D 表示
- S1-S6 の 6 区間表示
- P1-P5 の区間境界マーカー
- 3D 視点の回転、ズーム、パン
- 2D/3D 表示切り替え
- 高さ倍率の変更
- 実走行テレメトリ CSV とセッション JSON の処理
- 完走ラップの抽出
- 5 個の手動ハンドブレーキマーカーの検出
- 実走行データの基準パスへの投影
- 実走行ラインと基準ラインの重ね合わせ
- 総合タイムと S1-S6 区間タイム
- 選択区間の強調と非選択区間のグレーアウト
- 車両情報と Forza 順のチューニング値の保存、読み込み

Milestone B1 は完了しています。

検証済みの統合結果:

- Completed lap: `28:06.859`
- Detected markers: `5`
- Mean projection error: `2.015 m`
- Median projection error: `1.600 m`
- Maximum projection error: `14.795 m`
- Uncertain mappings: `0`

最大投影誤差は S4 で発生しており、誤った分岐へのマッチではなく、実際の走行ラインと基準パスの正当なオフセットとして確認済みです。

S1-S6 の区間タイム合計はラップタイムと約 `0.044 s` 異なります。これは、現時点では区間境界をまたぐサンプル時刻を補間していないためです。

### 重要な注意

- 表示しているパスは、ゲーム公式の道路中心線ではありません。
- 理想的なレーシングラインでもありません。
- 道幅、道路端、縁石、ガードレール、チェックポイント、地形は表現していません。
- 記録された走行座標から生成した、分析用の基準パスです。
- ローカルの生テレメトリと生成済み処理データは Git 管理外です。
- 現在の 2D 表示は、別途修正作業が必要です。
- リプレイ、テレメトリチャート、走行品質分析はまだ実装していません。
- 現在のブラウザ入力は大きな処理済み CSV を使っており、将来的には軽量な表示用データ形式が必要です。

### 今後の予定

- コース最低地点を `0 m` とする相対高度表示
- `0 m` 基準面と縦方向の高さガイド
- 軽量なブラウザ表示用ラップデータ
- セクション境界時刻の補間
- 2D 地図表示の修正
- テレメトリチャート
- 3D リプレイ
- 運転改善ポイントの検出
- 根拠付きの日本語改善提案

## English

FH6 Goliath Coach is a browser-based telemetry-analysis and reference-path visualization tool for the Goliath course in Forza Horizon 6.

Current capabilities include a 1 m sampled reference path, S1-S6 sections and P1-P5 boundary markers, continuity-constrained telemetry projection, completed-lap extraction, actual-path overlay, section timing, selected-section emphasis, and vehicle/tune metadata save/load.

The displayed path is not official road geometry, not an official road centerline, and not an ideal racing line. It is an analysis reference path generated from recorded driving coordinates.

## Reference CSV

Source file:

```text
data/reference/goliath_reference_1m.csv
```

Required columns:

```text
current_lap_time,course_distance_m,course_distance_km,position_x,position_y,position_z,speed_kmh
```

Coordinate interpretation:

- `position_x`: horizontal world axis
- `position_z`: horizontal world axis
- `position_y`: height/elevation

Display coordinates:

```text
display_x = position_x - start_x
display_y = position_y - start_y
display_z = position_z - start_z
```

## Section Boundaries

| Section | Start m | End m |
|---|---:|---:|
| S1 | 0.000 | 17,630.242 |
| S2 | 17,630.242 | 31,659.142 |
| S3 | 31,659.142 | 42,581.232 |
| S4 | 42,581.232 | 60,737.384 |
| S5 | 60,737.384 | 74,188.316 |
| S6 | 74,188.316 | reference finish |

## Python Setup

From the repository root in Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .
```

## Generate Viewer Data

```powershell
.\.venv\Scripts\Activate.ps1
python -m goliath.cli build-reference data\reference\goliath_reference_1m.csv --output viewer\public\reference\goliath_reference.json
```

## Process a Local Telemetry Session

Raw local telemetry stays outside Git. Place session files under:

```text
data\local\sessions\<session_id>\
```

For the first integration session:

```powershell
.\.venv\Scripts\Activate.ps1
python -m goliath.cli process-session data\local\sessions\20260629_184938 --reference data\reference\goliath_reference_1m.csv --output-root data\processed
```

The command writes generated artifacts under:

```text
data\processed\20260629_184938\
```

Large processed outputs are generated locally and ignored by Git.

## Backend Tests

```powershell
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests
```

## Frontend Setup

```powershell
cd viewer
corepack enable
corepack pnpm install
```

If `pnpm` is already installed:

```powershell
cd viewer
pnpm install
```

## Start Development Server

```powershell
cd viewer
pnpm run dev
```

Open the local URL printed by Vite. The app loads:

```text
/reference/goliath_reference.json
```

Use the **Load projected lap** control to select a generated `projected-lap.csv` and overlay the actual driven path.

## Frontend Tests

```powershell
cd viewer
pnpm run test
```

The frontend smoke test checks generated reference data, camera transforms, vehicle/tune metadata constraints, and projected-lap CSV loading.

## Production Build

```powershell
cd viewer
pnpm run build
```
