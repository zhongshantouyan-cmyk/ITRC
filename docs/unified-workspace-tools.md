# 社務工作台與原工具整合

正式入口統一為 `https://nsysu-itrc.vercel.app/ops`。財務、講師、公關、圖文、證書、幹部權限與維護說明在同一個側欄下開啟；原工具站只保留舊網址轉址。日常派工使用工作台任務，原看板保留歷史資料。

## 單一來源與部署

- 原 HTML、CSS、JavaScript 的唯一維護來源為 repository 的 `legacy-tools/`。它們由已發布的 `5257316bd9d77a30156bac9c5e5d62efa6ace7ef` 版本帶入，財務、名單及 Firebase 商業邏輯沒有因搬移重寫。
- `scripts/legacy-tools.mjs` 由 Vite 掛載，將來源打包到前端部署的 `/tools/`。不在 `client/public` 保存第二份可編輯的財務原碼。
- `client/src/ops/club-tools-catalog.js` 管理穩定 id、來源檔、顯示名稱及舊網址對照。新增 HTML 未加入目錄會使建置失敗，避免漏掉未知頁。
- `client/src/ops/ClubTools.jsx` 提供 `ToolFrame({ toolId, demo, onOpen })` 與 `ToolDirectory({ onOpen, demo })`，供工作台側欄使用。`/ops?tool={id}` 承接工具連結；舊看板連結固定導向 `/ops?view=tasks&source=legacy`，在同一任務表篩選舊看板來源。
- 舊網址的明確轉址由 `node scripts/build-tools-redirects.mjs` 產生到 `legacy-tools/vercel.json` 與 `client/vercel.json`。使用暫時轉址，便於回滾。

## 登入、資料與預覽

工具和主站使用相同 Firebase 專案、API key 與預設 app，透過同網域的 Firebase 持久登入恢復身分。嵌入訊息只處理工具 id 與導覽，沒有傳遞 token、角色或權限。各工具原有 Google 登入、現任名單核對、財務簽核規則、登出清除及資料庫規則仍有效。

RTDB 路徑沿用，沒有複製或清除雲端資料。財務仍使用 `finance/ledger` 與 `finance/reimbursements`；原看板仍保存 `boards/itrc` 歷史資料。原網域的個人瀏覽器偏好（SOP 勾選、公關寄件人）留在原瀏覽器，不視為已搬移的雲端資料。

`VERCEL_ENV=preview` 建置的工具頁只含停用說明，不包含 Firebase 或業務腳本，React 工具元件亦不載入 iframe。`demo=true` 同樣不載入正式工具。正式部署保留所有表單、財務分頁、雲端狀態、匯出及列印功能。

## 發布順序與驗收

1. 將主站前端、工具來源、建置 plugin 及目錄一併發布。Vercel 前端仍以 `client` 為 root，建置需能讀取同 repository 的 `../legacy-tools` 及 `../scripts`。
2. 在正式主站確認同一 Google 身分可讀取既有財務帳目及其他被授權資料，切換工具仍留在工作台；登出後子頁同步失去權限。不要為測試製造真實核銷或帳目。
3. 確認 `/ops-demo` 及 Preview 不載入正式工具腳本。
4. 主站成功後，將原工具站的明確轉址設定發布到其現有正式分支。核對既有財務、名單及看板舊網址的目的地。

`node --test scripts/test-unified-tools.mjs` 驗證來源涵蓋、原財務邏輯保存、Preview 無正式腳本、轉址、API gateway 保留及 Firebase 設定一致。這項測試不取代既有財務商規測試，也不會寫入正式資料。
