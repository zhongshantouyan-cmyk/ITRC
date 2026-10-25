# 系統資料備份與隔離復原

本功能匯出一份有 SHA-256 完整性檢查的 JSON 資料包，提供資訊維護與災難復原演練。它不會建立第二套正式業務資料，也不會從瀏覽器直接覆蓋正式資料庫。

## 誰可以匯出

`GET /api/system-backup/export` 要求現有 Firebase 登入，且後端判定為 `advisor` 或既有 `superAdmin`。社長、財務長與一般幹部不會因可進 CMS 就取得完整備份權限。

備份包含內部名單、帳務、舊帳號密碼雜湊與已加密的 Canva 連線資料，**JSON 檔本身未另加密**。只應保存在社團既有受限備份位置，勿放公開官網、公開 Git、一般群組或教學影片。下載成功不等於已保存到另一個受限位置；下載後須實際完成保管。

## 包含與不包含的資料

| 範圍 | 內容 |
| --- | --- |
| 官網 | sections、achievements、members（含已卸任標記）、activities、experiences、online_resources、offline_resources |
| 官網維運 | users（含 password_hash）、content_snapshots |
| 工作台 | ops_records、ops_audit、ops_idempotency、ops_credentials（只有已保存密文）、ops_connection_audit |
| Firebase RTDB | roles、roles_archive、boards/itrc、finance/ledger、finance/reimbursements、sponsors/records、sponsors/pipeline、sponsors/cands、activities/state、certs/positions、certs/template |
| 明確排除 | 環境變數、服務金鑰、解密金鑰、Firebase Authentication 憑證、短效 ops_oauth_states／ops_connection_intent、Drive／Canva／Cloudinary 檔案內容、Firebase 規則及部署設定 |

SQL 表必須全部存在並成功讀取；Firebase adapter 必須可用，且每個指定路徑都要讀取成功。個別不存在的可選 Firebase 路徑會記成 `exists: false`；應存在的角色來源缺失會停止整份匯出。任何讀取失敗都不會回傳「部分成功」備份。

SQL 在同一個讀取交易內擷取。Firebase 的路徑分別讀取，整份資料包**不是跨 SQL 與 Firebase 的同一時間點交易**；有 `captureStartedAt` 與 `createdAt` 可追溯擷取時間。大量變更前宜暫停業務操作再下載。SHA-256 能發現損壞或內容變動，不是數位簽章，也不能證明檔案來源；必須保管原檔與可信來源。

網頁下載會依瀏覽器能力使用 gzip 傳輸，下載內容仍是 JSON。傳輸內容超過 4 MiB 時會明確拒絕單次網頁下載，不截斷；此時需由資訊保管人另行安排受控離線匯出。資料包與隔離還原的本機上限為 64 MiB。

## 後端接線

```js
const { createSystemBackupRouter } = require('./routes/system-backup');
app.use('/api/system-backup', createSystemBackupRouter({
  db,
  authMiddleware,
  ready: Promise.all([db.ready, opsRouter.service.ready, canvaConnection.ready]),
  readRTDB: async location => {
    if (!firebaseAdmin.apps.length) throw new Error('Firebase is not initialized');
    return (await firebaseAdmin.database().ref(location).once('value')).val();
  },
}));
```

不得把 Firebase 資料、服務憑證或備份本文寫入日誌。路由只回傳泛用失敗說明。前端應以已登入 API client 下載 JSON，不得把 Bearer token 放入 URL。

## 隔離還原演練

使用專案已驗證的 Node 22，先安裝本專案 server 依賴。指定的輸出資料夾**必須不存在**，工具不接受遠端資料庫 URL，不會使用 `TURSO_DATABASE_URL`，也不會連 Firebase。

```bash
node scripts/restore-system-backup.cjs /absolute/ITRC-system-data-backup.json /absolute/new-isolated-restore
```

成功後產出：

- `itrc.sqlite`：本機復原資料庫。
- `firebase-rtdb.json`：指定 RTDB 路徑重建出的本機 JSON。
- `restore-verification.json`：來源摘要、資料列數、校驗結果與還原時間，不含業務本文。

資料夾權限為 0700，資料檔為 0600。CLI 先驗證整包與逐表／逐路徑摘要，使用受限欄位、主鍵、NOT NULL、預設值與唯一索引 metadata 建表；不接受原始 SQL 指令。每張表寫入後會重讀並比對逐列摘要。`activities.type` 的既有 CHECK 限制與自增序號會重建。

所有 SQL 資料完成核對後，還原工具會將 `ops_credentials` 改成 `needs_reconnect` 並清空續期 lease；短效 OAuth state／intent 建成空表。這是刻意的安全差異，會記錄在驗證檔，避免還原的連線憑證在新環境直接續用。

演練成功只證明這份資料包能復原為隔離資料。**不要直接把演練產物指回正式服務**。正式復原仍須先停寫、保存當前資料、核對各平台權限與版本，復原 RTDB 規則和外部檔案，重新授權 Canva，檢查尚未完成的外部工作，最後再驗證登入、業務資料與回滾路徑。

## 本輪驗證界線

自動測試使用全新暫存 SQLite 與虛構 RTDB adapter，驗證完整 round trip、已卸任標記、主鍵／唯一／必填／CHECK 限制、密文保留且暫停、短效授權丟棄、缺表／路徑讀取失敗、摘要損壞、惡意 SQL metadata、遠端或既有路徑拒絕，以及下載權限。未以測試改動正式業務資料；正式備份與實際檔案保管／還原演練需另外記錄完成證據。
