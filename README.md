# FH6 Goliath Coach

## 日本語

FH6 Goliath Coach は、Forza Horizon 6 の Goliath コースを、記録済みテレメトリと 3D コースビューで分析するためのツールです。

現時点では、完成済みのドライビングコーチではありません。まずは、基準走行パスと実走行データを同じコース距離上に重ね、区間ごとのタイムや走行ラインの違いを確認できる分析ビューアとして実装しています。

### 現在の実装状況

現在の実装には次の機能が含まれます。

- Goliath の 1 m 間隔の基準走行パスの 3D 表示（ラップ未読込み時の表示フォールバック）
- S1-S6 の 6 区間表示
- P1-P5 の区間境界マーカー
- Overview モードでの全コース表示、S1-S6 の均等強調、低速 3D 自動回転
- 手動の回転、ズーム、パンによる Overview 自動回転の停止
- OS またはブラウザの reduced-motion 設定に応じた自動回転の無効化
- Section Focus モードでの選択区間強調と区間別の決定的な 3D カメラフレーミング
- Japanese UI Phase 1 による日本語ファーストの画面表示
- 3D 視点の回転、ズーム、パン
- 通常UIは 3D 表示に固定
- 高さ倍率の変更
- 実走行テレメトリ CSV とセッション JSON の処理
- 完走ラップの抽出
- 5 個の手動ハンドブレーキマーカーの検出
- 実走行データの基準パスへの投影
- 有効ラップ読込み後は、通常ビューのコース表示を実走行ラインへ自動切り替え
- 総合タイムと S1-S6 区間タイム
- 選択区間の強調と非選択区間のグレーアウト
- 車両情報と Forza 順のチューニング値の保存、読み込み

Section Focus は、選択区間の強調表示と、その区間ごとの決定的な 3D カメラフレーミングを適用する表示モードです。右側の S1-S6 セクションをクリックした場合と、別区間のテレメトリチャート上の点をクリックしてピン留めした場合に、その区間の canonical focus pose へ移動します。同じ区間内でチャートを再度ピン留めした場合は、ユーザーが調整したカメラ構図を維持します。チャートの hover や Full lap / Selected section の範囲切り替えは map display mode を変更しません。Reset camera は mode-aware で、Overview では全コース構図、Section Focus では現在の選択区間の canonical focus pose を復元します。Corner Focus はまだ実装していません。

UI は日本語ファーストです。`Speed` / `Throttle` / `Brake` / `Steering`、`2D` / `3D`、`PI`、`FWD` / `RWD` / `AWD` は、ゲーム内表記やテレメトリ文脈との対応を保つため意図的に英語のまま表示します。車両・チューニングの表示単位は `PS`、`NM`、`KG`、`KGF/MM`、`cm` を使用します。この単位表記変更は表示ラベルのみで、数値変換は行わず、`power_ps`、`torque_nm`、`weight_kg`、`springs`、`ride_height` などの保存キーやバックエンド契約も変更しません。言語切り替えや本格的な i18n フレームワークは今後の作業です。

通常ビューでは、Reference / Actual のレイヤー切り替えチェックボックスは表示しません。有効なラップがまだ読込まれていない場合は、分析用の基準パスをコース表示のフォールバックとして描画します。有効なラップを読込んだ後は、実走行トレースを通常の可視コースとして描画し、基準パスは距離、区間、マーカー、投影、カメラ安定化などの内部解析用バックボーンとして保持します。基準パスは理想ラインや公式中心線ではなく、将来の診断用参照オーバーレイは別作業です。

チューニングフォームでは、Forza のゲーム内数値として扱うギア比、アライメント、スタビライザー、ダンピングには人工的な `game` や `deg` の単位 suffix を表示しません。新規フォームの駆動方式は `未設定` で始まり、保存JSONでは `vehicle.drivetrain: null` と `tune.differential: null` として明示します。FWD/RWD/AWD を選択した場合だけ、対応するデフ設定欄を表示します。新規保存は `goliath-vehicle-tune-v2` を使用し、既存の `goliath-vehicle-tune-v1` の FWD/RWD/AWD JSON は値を保ったまま読込めます。ローカルセッションを正常に読込んだ場合だけ、空の車両名と年式をセッションの車両表示名から初期入力します。セッションカードを選択しただけでは変更されません。同じ車両の別セッションを読込んだ場合は入力済みのチューニングを保持し、別車両を読込んだ場合は新しい空の v2 ドキュメントへ切り替えます。ただし手入力済みまたはJSONから読込んだ保護対象データがある場合は確認ダイアログを表示し、保持を選んだ場合は車両不一致の警告を出します。車両同一性は `car_ordinal` を優先し、使えない場合は正規化した表示名で比較します。比較不能な場合は破壊的な自動リセットを行いません。駆動方式は未検証のため自動入力せず、PIなど他の車両項目もまだ自動入力しません。

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
- 有効ラップ読込み後の通常ビューでは、実走行トレースが可視コース表示になります。
- ローカルの生テレメトリと生成済み処理データは Git 管理外です。
- 旧 2D/3D 切り替えは通常UIから外しており、将来の top-down 分析ビューは必要性が明確になった場合に別途検討します。
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

Current capabilities include a 1 m sampled reference path, S1-S6 sections and P1-P5 boundary markers, continuity-constrained telemetry projection, completed-lap extraction, automatic actual-trace course display after a valid lap is loaded, section timing, selected-section emphasis, Overview map mode, Japanese-first UI Phase 1, and vehicle/tune metadata save/load.

The viewer opens in **Overview** mode. Overview frames the full Goliath course, renders S1-S6 with equal emphasis, and slowly auto-rotates in 3D unless `prefers-reduced-motion: reduce` is active. Manual camera interaction stops that rotation. Clicking an explicit S1-S6 section control enters **Section Focus** and applies that section's deterministic canonical camera framing. Pinning a telemetry chart point enters Section Focus and applies the canonical pose when it changes sections; repeated pins inside the already focused section keep the user's manual camera composition. Chart hover and chart range controls do not change the map display mode. Reset camera is mode-aware: Overview restores the full-course pose, while Section Focus restores the selected section's canonical pose. Corner Focus remains future work.

The displayed UI is Japanese-first. `Speed`, `Throttle`, `Brake`, `Steering`, `2D`, `3D`, `PI`, and drivetrain abbreviations remain English intentionally. Display units use `PS`, `NM`, `KG`, `KGF/MM`, and `cm` exactly; this does not convert numeric values or rename persisted JSON keys or backend/API fields. A full language switcher or i18n framework is still future work.

Unitless game values in the tune form no longer show artificial `game` or `deg` suffixes. Fresh tune forms start with drivetrain unset, serialized as `vehicle.drivetrain: null` and `tune.differential: null`; differential controls appear only after choosing FWD, RWD, or AWD. New saves use `goliath-vehicle-tune-v2`, while existing `goliath-vehicle-tune-v1` FWD/RWD/AWD files remain readable without losing values. A successfully loaded Local Session can initialize blank tune vehicle name/year fields from its vehicle display name. Same-vehicle sessions preserve all tune input; different vehicles reset to a fresh tune document unless current user/JSON-owned data requires confirmation. Keeping the current settings leaves a visible vehicle-mismatch warning. Vehicle identity uses `car_ordinal` first and normalized display name as fallback; indeterminate identity never triggers a destructive automatic reset. Drivetrain telemetry interpretation is still unverified and remains manual; PI and other vehicle fields are not auto-populated yet.

The reference path is not official road geometry, not an official road centerline, and not an ideal racing line. It is an internal analytical backbone generated from recorded driving coordinates. Before a valid lap is loaded, the viewer shows it as the fallback course representation. After a valid lap is loaded, the normal visible course becomes the loaded actual driving trace; the reference path remains available internally for course distance, sections, markers, projection, and camera stability. The normal UI no longer exposes Reference / Actual layer checkboxes. A future diagnostic reference overlay is out of scope for the normal viewer.

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

## Recording Contract for Completed-Lap Extraction

採用したい走行の前に録画を開始してください。ポーズ、巻き戻し、任意地点からのリスタートは許容されます。採用する完走は1録画につき1回だけとし、フィニッシュ後にラップタイマーがリセットされてから録画を停止してください。複数の完走や、完走後の再走行は現在サポートしていません。

Current processing is restart-aware:

- Hard timer resets split the raw recording into attempt candidates.
- The final session-end range is retained as a session-end candidate.
- Rewind normalization runs independently inside each attempt candidate.
- Plausible candidates are projected and evaluated with full-lap validation.
- Exactly one unique valid candidate is selected.
- A valid session-end candidate may be accepted when no finish reset follows that completed lap.
- Restart boundaries and the final finish reset are not counted as ordinary rewinds.
- Recordings with no detectable hard timer reset remain unsupported.
- Zero valid candidates are rejected with diagnostics.
- Multiple valid candidates, including multiple completed laps, are rejected as ambiguous.
- Ambiguous or incomplete recordings are rejected instead of producing a misleading lap.

This keeps invalid short post-finish tails from replacing the actual completed lap.
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

Use the Local Sessions panel to load telemetry through the supported local web service. **Load** fetches an already processed projected-lap CSV, and **Process & Load** explicitly processes an eligible local session before loading it. After a valid processed session is loaded, the actual driven path becomes the normal visible course representation.

## Frontend Tests

```powershell
cd viewer
pnpm run test
```

The frontend smoke test checks generated reference data, camera transforms, vehicle/tune metadata constraints, Local Session projected-lap loading, and legacy projected-lap CSV parser compatibility.

## Production Build

```powershell
cd viewer
pnpm run build
```


## Local Web Session Browser

The React viewer can still run as a static Vite app, but browser security prevents it from scanning or processing local session folders by itself. The local web service keeps those operations on `127.0.0.1` and exposes only the session list, processing action, and processed projected-lap CSVs.

Build the viewer, then serve the built app and API from the repository root:

```powershell
Set-Location G:\github\fh6-goliath-coach\viewer
pnpm run build

Set-Location G:\github\fh6-goliath-coach
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m goliath.cli serve --open
```

Development mode keeps Vite separate and proxies `/api` to the Python service:

```powershell
Set-Location G:\github\fh6-goliath-coach
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m goliath.cli serve --api-only
```

In another PowerShell:

```powershell
Set-Location G:\github\fh6-goliath-coach\viewer
pnpm run dev
```

The service is loopback-only by default. `localhost`, `127.0.0.1`, and `::1` are accepted. Non-loopback binding requires explicit `--allow-remote`, which is intended only for trusted networks.

Useful endpoints:

```text
GET  /api/health
GET  /api/sessions
POST /api/sessions/<session_id>/process
POST /api/sessions/<session_id>/trash
GET  /api/sessions/<session_id>/projected-lap
```

The browser UI never force-processes a session and never processes automatically. Selecting a session only selects it; **Process & Load** explicitly processes an eligible unprocessed session, then loads the generated projected-lap CSV. **Load** fetches an already processed projected-lap CSV. Ignored, incomplete, invalid, and partial sessions are shown as disabled browser actions. Source telemetry CSV, session JSON, and `.fh6raw` files are not served over HTTP.

Eligible unprocessed or ignored source sessions can be moved to the Windows Recycle Bin from the selected-session action panel after an explicit confirmation dialog. This is not permanent deletion. Processed and partial sessions are refused, the currently loaded session is refused, and the action never moves or deletes processed output. The trash endpoint requires a JSON body with a matching `confirm_session_id`:

```json
{
  "confirm_session_id": "20260630_200504"
}
```

Successful responses use `schema_version: "goliath-session-action-v1"`, `status: "trashed"`, and a `trashed_items` list containing `session` and, when an ignored-state file existed, `state`.

For read-only smoke testing with a custom processed root:

```powershell
Set-Location G:\github\fh6-goliath-coach
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m goliath.cli serve --processed-root data\local\processed-cli-smoke
```

Then check:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/health
Invoke-RestMethod "http://127.0.0.1:8765/api/sessions?include_ignored=true"
Invoke-WebRequest http://127.0.0.1:8765/api/sessions/20260630_005550/projected-lap -OutFile data\local\api-smoke-projected-lap.csv
```

## Telemetry Charts MVP

Loaded projected laps now show four distance-based Canvas telemetry tracks:

- Speed, in `km/h`;
- Throttle, from projected-lap `accel_pct`, in percent;
- Brake, from `brake_pct`, in percent;
- Steering, from `steer_norm`, displayed as raw normalized input from `-1` to `+1` without left/right interpretation.

The shared x-axis is `course_distance_m`, displayed in kilometres. Use **Full lap** to inspect the complete lap or **Selected section** to focus on the currently selected S1-S6 section. The charts draw subtle S1-S6 background bands, P1-P5 reference marker lines, and rewind event markers.

Hovering a chart shows one synchronized crosshair across the chart stack, updates the DOM cursor readout, and places a lightweight cursor marker on the 3D/2D course. Clicking pins the nearest effective telemetry point and updates the selected section; **Clear cursor** removes the pinned point. Cursor interaction does not reset, reframe, pan, rotate, or zoom the camera.

Older processed projected-lap CSVs remain supported. They can still render the course path and Speed chart; Throttle, Brake, and Steering show an unavailable message until the session is reprocessed. No automatic migration, overwrite, or force-processing is performed from the browser.

To generate a new charts-capable output without touching existing processed data, use a separate ignored root:

```powershell
Set-Location G:\github\fh6-goliath-coach
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m goliath.cli process-session-id 20260630_005550 --processed-root data\local\processed-charts-smoke
```

Chart decimation is display-only. It preserves bucket first/last samples and channel extrema so short brake pulses, throttle lifts, and steering extremes remain visible without changing analysis data.
## Managed Local Sessions

FH6_telemetry can finalize recordings into the local Goliath Coach handoff area:

```text
G:\github\fh6-goliath-coach\data\local\sessions\<session_id>\
```

Goliath Coach treats this folder as read-only source input. Active logger recordings under `data\local\recording` are not discovered, and sessions are never processed automatically.

Useful PowerShell commands:

```powershell
Set-Location G:\github\fh6-goliath-coach
$env:PYTHONPATH="$PWD\backend"

.\.venv\Scripts\python.exe -m goliath.cli list-sessions
.\.venv\Scripts\python.exe -m goliath.cli list-sessions --json
.\.venv\Scripts\python.exe -m goliath.cli process-session-id 20260630_005550
.\.venv\Scripts\python.exe -m goliath.cli ignore-session 20260630_200504 --reason "FH6_telemetry save smoke test; not a Goliath run"
.\.venv\Scripts\python.exe -m goliath.cli unignore-session 20260630_200504
```

Managed defaults:

```text
sessions root:      data\local\sessions
processed root:     data\local\processed
session state root: data\local\session-state
vehicle catalog:    data\local\vehicle-catalog
reference path:     data\reference\goliath_reference_1m.csv
```

`list-sessions` inspects only direct child directories of `data\local\sessions`. A modern FH6_telemetry session is ready when `recording_complete` is `true` and `recording_state` is `completed`. Older legacy sessions without those fields remain discoverable as `legacy-ready` when they contain exactly one telemetry CSV and one session JSON with the expected CSV headers. Incomplete, invalid, and ignored sessions are hidden unless `--include-incomplete`, `--include-invalid`, or `--include-ignored` is provided.

`process-session-id` is a managed wrapper around the existing path-based `process-session` command. It stages output under `data\local\processed\.staging`, validates the generated session summary and required projected/rewind outputs, then moves the result into `data\local\processed\<session_id>`. It refuses ignored, incomplete, invalid, partial, or already processed sessions unless the documented `--force` path is used. Source session folders are not moved, modified, or deleted.

Ignore state is local user intent stored separately under `data\local\session-state\<session_id>.json`; it does not modify FH6_telemetry session JSON. `data\local\` is Git-ignored, so raw sessions, processed managed output, and ignore-state files are not tracked.
