# 官網、舊工具站與資料權限修補

本文件描述 2026-10-26 的程式變更及驗收界線。程式通過測試不代表正式環境已部署；部署、分享權限及 Firebase 規則的現場狀態須另行讀回確認。

本次最新發布候選及部署分支見 [release-20261026.md](release-20261026.md)。下文明確區分先前已讀回的現場修正、當前應採用的名單，以及已完成程式／模擬驗證但仍待正式發布的財務第二階段。不得以階段一的相容規則代替新版財務發布。

## 本輪已完成的現場修正

- 官網 CMS 的 `course_info` 已移除舊社員回覆表網址，改為已核對的 115-1 入社表單；重新載入首頁已確認出現「入社報名」、舊 MEMBERS 欄消失。正式前端目前呈現網址文字；可點擊標籤屬本輪 Preview 程式。
- 前次幹部主表依官網核對為 17 筆，當時是 15 位在任、2 位非當期名單。使用者其後明確確認許筠采、謝政韋、王方勳離任；目前主表為 **14 位現任、3 位已卸任**，原 17 個固定 ID、16 筆既有 MAIL 及歷史保留。工作台人員更新、官網封存與舊角色撤權，須在正式套用後各自回讀，不以主表更新推定全站已同步。
- 幹部主表從任何人可編輯改為限現有社團擁有者；114-2 回覆表從任何人可讀改為 Restricted，保留原明確讀取者。兩者已讀回分享中繼資料，沒有 `anyone` 權限。
- Firebase 第一階段限制規則已發布；重新載入後完整 JSON 與審閱草稿一致，沒有未發布橫幅。當時 20 個 Rules Playground 案例確認名單外／匿名／未驗證拒絕、角色與帳冊管理分工、根層拒絕、大小寫正規化，以及階段一仍允許的核銷整陣列寫入。這是階段一的歷史證據，不代表新版逐筆財務規則已正式發布；第二階段見下文。
- 社團帳號在規則發布後重新載入舊幹部權限頁，仍可讀取既有雲端資料。
- 舊工具站已啟用 Standard Protection，沒有例外網域與有效分享連結。對已觀察的舊 generated deployment URL 發出無憑證 HEAD，回傳 302 至驗證入口；未跟隨重新導向。此項不代表當時的公開 production domain 已替換乾淨版本，亦未刪除不可變歷史部署。

完整個人 allowlist 不放入 Git。規則變更限制既有存取，沒有因網站職稱而新增角色或提高權限。舊工具站的實際新版本部署另見獨立修正 PR 與部署驗收。

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

本次另有系統資料備份，涵蓋 14 個 SQL 表與 11 個 RTDB 路徑，並提供隔離還原 CLI；範圍、權限、外部檔案／設定排除項與保管方式見 [system-backup-runbook.md](system-backup-runbook.md)。這不改變上述 CMS 快照的用途。實際備份下載、受限保存與正式資料包的隔離還原，仍須分別取得證據。

## 測試環境辨識

`node server/maintenance-check.js` 不載入資料庫模組、不開連線，不輸出 URL 或權杖。它產生資料庫連線身分雜湊；在 Preview 必須與另行核對的 `ITRC_PRODUCTION_DB_FINGERPRINT` 不同，否則 exit code 2。

雜湊不同只證明連線字串指向的身分不同，仍要確認資料庫歸屬、別名和備份／還原。這個檢查不會自動改部署設定，也不應把「環境名稱是 Preview」當成已隔離。

## 舊工具站可重現修補

第一輪 `legacy-tools/` 從原工具站公開靜態來源復原 13 個檔案；後續財務／名單第二階段另新增 `itrc-finance.js` 與 `itrc-roster.js`，正式發布時必須一起包含。沒有重建另一套資料庫。

已移除：

- 公開 HTML 的真實幹部聯絡資料 seed。
- 公開財務頁的歷史收支 seed，以及財務頁註解／使用說明內的歷史金額摘要。
- 空名單、空帳冊自動寫回預置資料的行為。
- 匿名讀取 Google Sheet CSV 的依賴。
- 個人救援信箱的公開硬編碼；保留社團公開帳號作 bootstrap，個人顧問資料角色維持在原權限名單。

名單使用已授權試算表複製／下載的 CSV，再貼上或選檔預覽。新版改為合併更新，沿用固定幹部 ID 與既有帳號對照；未列入匯入的人保留，不因職稱更新升權，新人預設無權限。離任者標記 `retired`、`active:false`、`disabled:true` 並清空角色，後續匯入不自動復權。預覽綁定原名單，儲存用 transaction；來源已改時需重新預覽，失敗不顯示成功。這些是新版行為，正式名單與角色仍要回讀驗收。

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

本節記錄先前已發布過的第一階段保護。表內財務整份讀寫是該階段的相容限制；本次新版應依下一節的逐筆財務規則發布，不可把這個歷史表格當成最新財務驗收標準。

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

這一階段封堵名單外的登入者及部分角色越權，**當時未解決幹部之間的核銷資料／狀態隔離**，保留整份陣列寫入與帳本／核銷分開寫入。下節第二階段已完成逐筆身分／狀態檢查與多路徑原子入帳的程式及模擬驗證；必須等新版工具站及相符規則都發布並回讀，才能稱正式財務授權已更新。

### 階段一 Firebase Rules Playground 驗證紀錄

1. 匿名：`roles`／`finance` 讀寫均拒絕。
2. 已登入但不在名單：已知路徑與根節點均拒絕。
3. 名單內但 Email 未驗證：拒絕。
4. 社團帳號：可讀 `roles`、可寫名單與帳本；根節點直接讀寫拒絕。
5. 一般幹部：可讀既有業務資料與操作任務；不可寫 `roles`、`roles_archive` 或帳本。
6. 社長：可維護名單；未列入帳務寫入者時不能寫帳本。
7. 財務：可寫帳本；不能改角色。
8. 顧問：依本次明確名單可維護角色與帳本；不從官網職稱自動新增帳號。
9. 階段一保留的核銷整份寫入允許例屬當時限制，不能誤當新版拒絕例通過；第二階段應拒絕整份覆蓋。

離線測試只驗證產生器與條件邏輯，不是 Firebase 規則引擎或正式發布驗收。官方依據：[規則條件](https://firebase.google.com/docs/database/security/rules-conditions)、[規則語法與上層授權](https://firebase.google.com/docs/database/security/core-syntax)。

## Firebase 財務第二階段：程式與規則已驗證，正式發布另核對

第二階段沿用 `finance/ledger` 與 `finance/reimbursements` 原路徑，保留既有數字 key，不搬移或重寫原有明細。新版工具站與財務規則必須配對發布：

- 一般幹部按 Firebase UID 查詢自己的核銷；簽核／財務處理者才讀取完整核銷清單。帳本讀取仍沿用現任 allowlist，寫入限原帳務權責。
- 本人建立申請，不能預核准、代填他人 UID，或修改已送出的金額、收款帳戶及收據。申請人不能核准／退回自己的核銷，共用社團帳號同樣受限，需另一位有簽核權限者使用自己的帳號。
- 入帳以固定 `reimb_<claimKey>` 單號，同一次多路徑原子更新寫入帳本及核銷 `posted` 狀態；只寫一邊或重送既有分錄會被拒絕。
- 核銷及其證據不永久刪除；手動分錄可填理由作廢，保留原紀錄。成功訊息等待雲端確認，失敗保留表單；登出或撤權時解除訂閱並清除敏感記憶體資料。

程式已通過 30 項 Node 測試；官方 Firebase Database Emulator 4.11.2 另通過 34 個規則情境，包括查詢隔離、禁止自簽、單邊入帳拒絕、原子入帳、重送拒絕，以及 47 筆虛構歷史保留。模擬使用 `demo-itrc-finance`，正式連線為 0，不是拿真實帳目試寫。

正式發布順序為：先發布包含兩個新增 JS 模組的完整工具站，再以原核准名單產生並只替換 `rules.finance`，保留根層拒絕與其他路徑；發布後回讀規則，重新整理舊分頁，唯讀核對原財務資料仍完整。待發布維護者記錄上述證據前，本文件不聲稱第二階段已在正式資料層生效。完整實作及模擬結果由同一倉庫的舊工具站發布包 `docs/finance-and-roster-release-20261026.md` 說明；該文件不代表它已合併到每個部署分支。
