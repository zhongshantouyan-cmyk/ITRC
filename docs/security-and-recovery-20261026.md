# 官網、舊工具站與資料權限修補

本文件描述 2026-10-26 的程式變更及驗收界線。程式通過測試不代表正式環境已部署；部署、分享權限及 Firebase 規則的現場狀態須另行讀回確認。

## 官網公開資料

Google／Firebase 登入維持既有流程。舊 JWT 只有在設定自訂 `JWT_SECRET` 且未明確停用時才接受；缺少 secret 或仍使用公開範例字串時不允許舊登入。這項修正不讀取或更換正式 secret。

- `course_info` 只公開時間、地點、幹部公開介紹、社團聯絡、Instagram、指導老師及報名入口。
- `入社報名` 是 `registrationFormUrl` 的相容名稱。網址須為 HTTPS Google Forms 填寫入口；編輯頁、回覆試算表及非 Google 域名均拒絕。
- 區塊讀取、搜尋結果與前端各有保護。已知舊社員回覆表不能經其他一般區塊重新公開。
- `members` API 明列公開欄位。MAIL、LINE、內部人員 ID 與授權資料應保存在獨立內部來源。
- 這些防護不能代替移除正式 CMS 中錯誤網址、限制 Google Sheet 分享權限，以及檢查歷史部署。

## 官網內容快照

快照現在涵蓋 `sections`、`achievements`、`members`、`activities`、`experiences`、`online_resources`、`offline_resources`。不含使用者憑證、ops 資料、Firebase RTDB、圖片檔案內容、Drive 或 Canva；以上需要各自備份與還原計畫。

修改前先驗證登入，再等待快照寫入成功；失敗時停止該次內容修改。保留最近 50 份快照。還原前備份及所有資料表刪除／重建在同一交易內完成，任一插入失敗就回滾。舊快照未包含的資料表保持原狀。還原限社長、副社長、顧問或既有後台管理者；一般幹部和財務不具整批還原權限。

若提交結果因連線中斷無法確認，回應會要求重新讀取內容與版本紀錄，不宣稱已成功或保證原狀。測試以獨立暫存 SQLite 驗證後段 INSERT 失敗不留下前段 DELETE，不連接正式資料庫。

## 測試環境辨識

`node server/maintenance-check.js` 不載入資料庫模組、不開連線，不輸出 URL 或權杖。它產生資料庫連線身分雜湊；在 Preview 必須與另行核對的 `ITRC_PRODUCTION_DB_FINGERPRINT` 不同，否則 exit code 2。

雜湊不同只證明連線字串指向的身分不同，仍要確認資料庫歸屬、別名和備份／還原。這個檢查不會自動改部署設定，也不應把「環境名稱是 Preview」當成已隔離。

## 舊工具站可重現修補

`legacy-tools/` 是從原工具站公開靜態來源復原的 13 個檔案；所有本地 HTML／CSS／JS 引用已核對齊全。沒有重建另一套資料庫。

已移除：

- 公開 HTML 的真實幹部聯絡資料 seed。
- 公開財務頁的歷史收支 seed，以及財務頁註解／使用說明內的歷史金額摘要。
- 空名單、空帳冊自動寫回預置資料的行為。
- 匿名讀取 Google Sheet CSV 的依賴。
- 個人救援信箱的公開硬編碼；保留社團公開帳號作 bootstrap，個人顧問資料角色維持在原權限名單。

名單改成在已授權試算表複製／下載 CSV，再貼上或選檔預覽。沒有權限欄時依 Email 保留既有角色與 ID，新人無權限；職稱更新不自動升權。匯入仍是整份取代，管理者須檢查預覽。

復原腳本：

```bash
python3 scripts/prepare-legacy-tools-hardening.py VERIFIED_SOURCE_DIR NEW_OUTPUT_DIR --club-only-bootstrap
```

原始下載檔可能含私人資料，不得加入 Git。腳本不存取 Firebase、不部署。部署前確認個人救援者仍在原角色名單；社團帳號可登入維護。私人信箱／手機樣式／已知歷史金額摘要掃描未發現殘留，範例信箱使用 `example.invalid`；這不是所有文字內容的完整個資分類證明。

### 部署與驗收

既有 `itrc-tools` Vercel 專案可指向此倉庫的 `legacy-tools` 根目錄，使用純靜態設定；不影響官網／後端的原 Production Branch。部署版本與分支由保管人核對，不建立新 Firebase 專案。

驗收需檢查首頁與各 HTML、Google 登入、現有 roles／帳務仍讀得到、空資料不觸發回灌、匯入預覽不更改正式資料、角色修改由受權管理者處理。講師／公關／證書頁的既有登入 SDK 與雲端連線仍須實測；靜態語法檢查不能證明 Firebase 寫入成功。

更新主網址不會清除舊 immutable deployment URL 中的原始碼；含舊 seed 的歷史部署需另行保護或移除，並確認正式主網址仍指向新版本。

## Firebase 階段一：限制現任帳號與既有路徑

生成器：`scripts/build-rtdb-containment-rules.cjs`。私有輸入只放在 Git 外，格式如下（全部為虛構範例）：

```json
{
  "members": ["club@example.invalid", "chair@example.invalid", "advisor@example.invalid", "treasurer@example.invalid", "officer@example.invalid"],
  "superAdmins": ["club@example.invalid"],
  "rosterManagers": ["chair@example.invalid", "advisor@example.invalid"],
  "ledgerWriters": ["advisor@example.invalid", "treasurer@example.invalid"]
}
```

```bash
node scripts/build-rtdb-containment-rules.cjs /tmp/private-policy.json /tmp/private-rules.json
```

輸出權限為 0600，程式只回雜湊，不回傳信箱，也不發布規則。所有列出的帳號必須為 `members` 子集；以已核對的 Google token Email 字串填寫，規則還要求 `email_verified === true`。

| 路徑 | 讀取 | 寫入 |
| --- | --- | --- |
| 根節點、其他未列路徑 | 拒絕 | 拒絕 |
| `roles` | 現任允許帳號 | 名單管理者＋社團救援帳號 |
| `roles_archive` | 名單管理者＋社團救援帳號 | 同左 |
| `finance/ledger` | 現任允許帳號 | 帳務寫入者＋社團救援帳號 |
| `finance/reimbursements` | 現任允許帳號 | 現任允許帳號，保留既有整份陣列相容性 |
| `boards/itrc`、`activities/state` | 現任允許帳號 | 同左 |
| `sponsors/records`、`sponsors/pipeline`、`sponsors/cands` | 現任允許帳號 | 同左 |
| `certs/positions`、`certs/template` | 現任允許帳號 | 同左 |

這一階段封堵名單外的登入者及部分角色越權，**未解決幹部之間的核銷資料／狀態隔離**。核銷現在是整份陣列寫入，入帳分成帳本與核銷兩次寫入；下一階段需受控業務端點、逐筆身分／狀態檢查和原子入帳。不得把此階段稱為完整財務授權。

### Firebase Rules Playground 必測

1. 匿名：`roles`／`finance` 讀寫均拒絕。
2. 已登入但不在名單：已知路徑與根節點均拒絕。
3. 名單內但 Email 未驗證：拒絕。
4. 社團帳號：可讀 `roles`、可寫名單與帳本；根節點直接讀寫拒絕。
5. 一般幹部：可讀既有業務資料與操作任務；不可寫 `roles`、`roles_archive` 或帳本。
6. 社長：可維護名單；未列入帳務寫入者時不能寫帳本。
7. 財務：可寫帳本；不能改角色。
8. 顧問：依本次明確名單可維護角色與帳本；不從官網職稱自動新增帳號。
9. 目前保留的核銷整份寫入允許例要標成待改善，不能誤當拒絕例通過。

離線測試只驗證產生器與條件邏輯，不是 Firebase 規則引擎或正式發布驗收。官方依據：[規則條件](https://firebase.google.com/docs/database/security/rules-conditions)、[規則語法與上層授權](https://firebase.google.com/docs/database/security/core-syntax)。
