# 社務工作台：啟用與維護手冊

這一版把活動事實、學期宣傳需求、文案版本、人工審核、Canva 交件與跨組任務放進既有網站。幹部姓名、職稱與當期名單依官網核對，內部 MAIL、固定幹部 ID 和歷史任務保留在私有來源及工作台。更新日期：2026-10-26（Asia/Taipei）。

受保護 Preview 的 Google 登入、後端讀取、角色判斷及同網域 gateway 已完成實際連通驗證；本輪新增程式、正式部署及真實人員匯入仍需按各自的驗收結果判定。詳見 [ops-validation.md](ops-validation.md)。

## 1. 入口與已提供的功能

| 入口／區塊 | 用途 |
| --- | --- |
| `/ops-demo` | 虛構資料的互動展示；資料只存在目前瀏覽器，可切換示範角色與重設；不呼叫正式後端、AI 或 Canva。 |
| `/ops` | 連接真實後端的工作台；目前在受保護 Preview 驗收，需要既有 Google／Firebase 登入與角色授權。 |
| 工作總覽、活動與專案 | 建立負責人、目標、活動資料及贊助要求，查看尚待確認或交付的工作。 |
| 宣傳製作 | 一列需求對應一則宣傳；產生文案與輪播短文、單位確認、終審、設計與發布證據。 |
| 我的任務 | 固定幹部 ID 指派承辦人及驗收人、期限、上層／前置任務、交件、驗收、退回與交付證據。 |
| 審核與紀錄、系統連線 | 查看審核歷程、自動工作結果、連線狀態與資料匯入。 |

後端沿用既有 Express、Firebase 與 Turso／libSQL。工作台使用獨立的 `ops_*` 資料表保存流程草稿、版本、佇列與人員對照，不會把私有聯絡資料寫進官網公開的 `members` 表。既有 FileOS／指定主表仍是正式業務來源；工作台修改尚未自動回寫來源表，不可把匯入快照當成另一套正式主檔。共用更新佇列、來源版本檢查與核准回寫仍待完整接合。既有 API 與資料欄位見 [ops-contract.md](ops-contract.md)，本輪人員及交付操作補充見下文。

## 2. 日常流程

1. 活動組整理活動日期、講者、地點、宣傳對象與重點。活動負責人確認事實後，活動才可進入文案審核。
2. 匯入整學期宣傳需求，或在工作台新增。每則宣傳連結一個活動，可分別安排預告、提醒、限時動態等用途。
3. 產生草稿後由人員檢查。宣傳頁的批次功能每次處理最多 20 則尚無文案的需求，依序產生，不改寫既有文案；保持頁面開啟直到完成。
4. 活動負責人完成單位確認，再由指定終審者核准**目前版本**。核准會建立設計工作；有 Canva 連線與母版設定時可產生新的分層設計，亦可人工附上設計連結。
5. 行銷微調並校對；需要贊助方審稿時，另登錄同意證據。實際發布後填入公開網址與時間，完成追蹤。

宣傳頁的「匯出宣傳總表」會下載 UTF-8 CSV，一列一則宣傳，完整文案保留在同一格，並包含各頁短文、版本、核准、Canva 連結、發布證據及來源。Excel 可直接開啟；需要 `.xlsx` 時再另存。匯出不會改動正式資料。

修改文案、活動事實或實質贊助要求，會使相關未發布內容的先前核准失效。已發布記錄保留原始證據，另產生修正任務。系統不會自行同意文案、寄信給合作方或發布社群貼文。

### 人員對照與任務交付

「系統連線」的人員對照接受幹部主表的姓名、職稱、MAIL、LINE 名稱、組別、固定幹部 ID、任期及在任狀態。先預覽差異，再明確套用；預覽後來源或既有人員資料改變時，必須重新預覽。固定 ID 沿用 `ITRC-P0001` 格式，不能按職稱、姓名或新排序換發。沒有 MAIL 的人可以先保留空白；未列入當期官網的人保留歷史，不能據此推斷已離任。名單更新不會自動改變 Firebase 登入角色或終審權限。

任務沒有實際承辦人時保持「待指派」。建立者只在仍未指派時保有整理權限；管理者改派後，原建立者不因建立紀錄而永久保有操作權。有幹部 ID 時以人員對照授權；不接受同時指向另一人的舊負責信箱。

1. 指定承辦人、不同於承辦人的驗收人，填寫驗收標準。
2. 承辦人附成果連結並「交件」，狀態變為待驗收。
3. 指定驗收人通過或附原因退回。使用共用社團帳號代登錄時，社長／顧問須確認外部驗收並附證據，紀錄明確標為代登錄。
4. 必要前置／子任務未驗收時不能完成交付；專案必要任務全部通過且有結案標準，才可結案。承辦人不能自行清除專案／上層關聯繞過結案要求。
5. 修改待驗收任務需要重新交件；已驗收任務須附原因重新開啟。交付與驗收證據保留在 `deliveryHistory`。

文案完整歷史保存在 `post.history`，含文案、各頁文字、來源活動快照、核准與設計關聯。回復歷史內容會建立新草稿，先前核准不會復活。新功能無法重建啟用前已遺失的版本。

後端操作為 `people.import-preview`／`people.import-apply`（套用需相同 `previewToken`）、`task.deliver`、`task.accept-delivery`、`task.return-delivery`、`task.reopen`、`post.restore-version`。交件、驗收及回復都沿用資料版本與操作識別檢查。

## 3. 整學期資料匯入

在「系統連線」選擇活動、宣傳需求或任務，可下載 CSV 範本、上傳 CSV／TSV／JSON，或直接貼上含標題列的表格。Excel 請先另存為 UTF-8 CSV，或複製儲存格貼上；此版不直接解析 `.xlsx`。

每次總計最多 200 筆，後端請求上限為 256 KB；過大時分批處理。前端檔案選擇上限為 500 KB，不代表轉換後的請求一定小於後端上限。

| 資料 | 最少需準備 | 來源與關聯 |
| --- | --- | --- |
| 活動 | `title`；送審前另補齊 `date`、`speaker`、`venue` | 建議填固定 `sourceKey`，如 `course-001`。 |
| 宣傳需求 | `title`、活動關聯；可另填 `purpose`、`audience`、`highlights`、`cta`、`channel`、`scheduledAt` | 使用既有 `eventId`，或以 `eventSourceKey` 對應活動的 `sourceKey`。每則宣傳有自己的 `sourceKey`。 |
| 任務 | `title`；建議填 `ownerPersonId`、`reviewerPersonId`、`dueDate`、`acceptanceCriteria` | 可連結既有專案、活動或貼文。空白承辦人保持待指派；交件與驗收分開。 |

每列需保留 `sourceUrl` 或 `sourceLabel`；上傳本機檔案時，介面會保留原始檔名，不需要把私有檔案公開。可另填 `sourceDate`、`sourceRevision`。相同來源鍵再次匯入會略過，不會覆寫已修改或已核准的記錄。未填來源鍵時，系統依來源及內容計算識別；為避免改標題後被視為另一筆，建議一開始就訂固定鍵。

下列虛構 JSON 可一次建立活動與兩則宣傳，活動先匯入，再依來源鍵連結：

```json
{
  "events": [{
    "title": "示範課程", "sourceKey": "course-001",
    "sourceLabel": "學期宣傳需求.csv",
    "date": "2030-03-01", "speaker": "示範講者", "venue": "示範教室"
  }],
  "posts": [{
    "title": "課程預告", "sourceKey": "post-001",
    "eventSourceKey": "course-001", "sourceLabel": "學期宣傳需求.csv",
    "highlights": "課程重點", "cta": "完成報名", "channel": "instagram"
  }, {
    "title": "報名提醒", "sourceKey": "post-002",
    "eventSourceKey": "course-001", "sourceLabel": "學期宣傳需求.csv",
    "channel": "story"
  }],
  "tasks": []
}
```

先預覽，確認後才寫入。正式匯入限社長／顧問執行。匯入的活動與宣傳一律未審核，不能從檔案帶入「已核准」狀態。中文欄名如「宣傳名稱、活動來源鍵、宣傳重點、希望採取行動、發布管道、來源鍵」可直接使用。

## 4. 登入、資料庫與職責設定

以下表格標明設定所屬的部署環境。瀏覽器只讀公開 API 位置；前端專案的伺服器函式另外持有 gateway 目標及短期 OIDC 身分。真實憑證、信箱名單及來源識別碼不要提交到公開程式庫。

| 設定 | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | 沿用既有 Firebase Admin 服務帳戶 JSON，驗證 Google 身分及既有角色名單。 |
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | 後端持久化資料庫。未設定時會使用本機 SQLite；正式無狀態部署需使用持久化資料庫。 |
| `OPS_APPROVER_EMAILS` | 最終文案審核者的登入信箱，逗號分隔；空白時無人可終審。 |
| `OPS_DESIGNER_EMAILS` | 指定行銷／設計負責人的登入信箱，逗號分隔。社長／顧問也可執行設計交件與校對。 |
| `VITE_OPS_API_URL`（前端建置） | 工作台專用 API 基址；使用同網域 gateway 時設為 `/api`。未設定時才回退到 `VITE_API_URL`。Vite 變數在建置時讀取，改動後須重新部署。 |
| `OPS_BACKEND_ORIGIN`（前端伺服器） | gateway 固定的後端 origin，例如 `https://backend-preview.vercel.app`；只接受單一 HTTPS `*.vercel.app` origin，不含 `/api`、query、帳密或非預設連接埠。不可加 `VITE_` 前綴。 |
| `VITE_API_URL`（既有前端 CMS） | 保留原既有值；使用工作台專用基址時，不需為工作台改動其他 CMS 的 API 位置。 |

角色與核准權限由伺服器核對，不接受瀏覽器傳來的角色或核准旗標。工作台只接受已驗證 Firebase 身分；既有官網若仍接受舊密碼 JWT，也不能用它進入工作台 API。新程式在 `JWT_SECRET` 缺少或仍是公開範例值時停用 legacy JWT；`ALLOW_LEGACY_JWT=false` 可明確停用。示範頁的角色切換不會取得正式權限。

### 受保護 Preview 的同網域 gateway

既有 gateway 已部署，且已完成 Preview 的授權與實際讀取驗收：瀏覽器透過同網域 `/api/ops/*` 呼叫前端伺服器函式，再由函式呼叫固定後端。gateway 僅允許 `GET bootstrap`、`POST actions`、`GET connections/canva`、`POST connections/canva/start`；不代理 callback 或 cron，不跟隨上游重新導向，也不轉送 Cookie。

函式使用 `@vercel/oidc@4.0.3` 的 `getVercelOidcToken()`，每次取得短期 OIDC 並放入 `x-vercel-trusted-oidc-idp-token`。前端專案的 Secure Backend Access with OIDC Federation 須開啟；後端 Trusted Sources 須允許相符的呼叫專案及環境。OIDC 處理部署保護，原本的 Firebase Bearer 仍交後端驗證身分與角色。參考 [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)。

使用者已批准並完成 `nsysu-itrc` Preview → `itrc` Preview 的 Trusted Sources 規則；Standard Protection／Require Log In 仍開啟。Firebase 穩定 Preview 網域、Google 登入、後端讀取及角色能力已實際驗證。前端分支專用 `VITE_API_URL` 的暫時覆寫也已移除，既有 CMS 回到原設定；工作台使用獨立 `VITE_OPS_API_URL=/api` 與固定 `OPS_BACKEND_ORIGIN`。早期的 Network Error／上游 401 已被後續成功連通證據取代，不是目前尚待批准的事項。此 Preview 授權不涵蓋 Production，詳見 [ops-validation.md](ops-validation.md)。

## 5. Canva：連線與分層母版

### 帳戶連線

1. 在 Canva Developer Portal 建立供工作台使用的整合，取得 Client ID、Client Secret。
2. 把該環境的回呼網址登錄為 `https://backend.example.org/api/ops/connections/canva/callback`，並將**完全相同**網址設為 `CANVA_REDIRECT_URI`。
3. 後端設定 `CANVA_CLIENT_ID`、`CANVA_CLIENT_SECRET`、`CANVA_REDIRECT_URI`、`OPS_TOKEN_ENCRYPTION_KEY`；另以 `OPS_FRONTEND_ORIGIN` 指定返回的前端 origin，例如 `https://frontend.example.org`。
4. 社長／顧問在工作台「系統連線」按 Canva 連線，登入持有母版權限的帳戶並授權。

同網域 gateway 只處理連線狀態與啟動授權。Canva callback 仍直接返回上述後端網址，`OPS_FRONTEND_ORIGIN` 再決定返回哪個前端；兩者必須屬於同一套環境。後端部署保護是否允許此回跳須另行驗收，不能以 OIDC gateway 連通代替 OAuth 回跳測試。

加密金鑰需為 **32 位元組的標準 Base64**。在可信任的本機終端執行以下命令，將輸出直接存入部署平台的秘密設定，不貼到聊天室、PR 或程式碼：

```bash
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
```

程式使用 PKCE、一次性 state 與 AES-256-GCM 保存／更新授權資料。更換加密金鑰後，舊資料可能無法解密，需要重新連線；維護時保留正確金鑰。`CANVA_ACCESS_TOKEN` 與可選的 `CANVA_ACCESS_TOKEN_EXPIRES_AT` 是暫用設定，不能取代可續期的 OAuth 連線。

程式請求的基本 scopes 為 `design:content:read`、`design:content:write`、`design:meta:read`；使用品牌範本時另加入 `brandtemplate:meta:read`、`brandtemplate:content:read`。帳戶及來源資產需具備對應 API 權限，實際以 Canva 授權結果為準。參考 [Canva Authentication](https://www.canva.dev/docs/apps/rest-apis/authentication/)。

### 母版與欄位

`CANVA_TEMPLATE_DESIGN_ID` 或 `CANVA_BRAND_TEMPLATE_ID` **擇一**設定。母版需有可編輯文字、圖片等圖層，並替要自動填入的元素設定資料欄位；只有一般文字圖層、但沒有 Autofill 欄位的設計無法自動套版。

`CANVA_FIELD_MAP_JSON` 的鍵必須與母版資料欄位完全一致，型別也需相同。以下只示範格式，正式值依實際母版調整：

```json
{
  "course_title": {"type":"text","path":"event.title","maxLength":40},
  "speaker": {"type":"text","path":"event.speaker","maxLength":20},
  "slide_1_heading": {"type":"text","path":"post.slides.0.heading","maxLength":32},
  "slide_1_body": {"type":"text","path":"post.slides.0.body","maxLength":240}
}
```

可用文字來源包含活動欄位、宣傳欄位、`post.slides.0` 至 `.9` 的 `heading/body`、`obligationsText`，或固定 `value`。圖片欄位需提供已存在的 Canva `assetId`，不能直接填外部圖片網址。每次建立前會驗證完整欄位與字數；不完整時停止，避免留下母版舊文字。

系統只建立**新的設計**，不覆寫行銷人員改好的設計。建立結果不明時標記 `needs_reconciliation`，需先到 Canva 核對，再附上正確設計連結，不能直接重試。參考 [Canva Autofill](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/)。

## 6. 選用 AI 與 Google Sheets

### AI 文案

同時設定 `OPENAI_API_KEY` 與明確指定的 `OPENAI_MODEL` 才會呼叫 AI；程式不會自選模型。未設定時可使用有標記的規則草稿。已設定但服務失敗時會留下失敗工作，不會假裝產生成功。

啟用前先決定模型與帳戶用量／預算控管，再以少量需求驗收。此版沒有自行實作金額預算上限；一次批次最多 20 則，可能分別呼叫服務。請勿把 API key 放進前端。`OPS_PROVIDER_TIMEOUT_MS` 可調整服務等候時間，程式限制在 1–45 秒，預設 20 秒。實作參考 [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)。

### Google Sheets 唯讀來源

設定 `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`，並把指定試算表以「檢視者」分享給該服務帳戶；讀取範圍是 `spreadsheets.readonly`。也支援暫用的 `GOOGLE_SHEETS_ACCESS_TOKEN`。來源仍需另列入 `OPS_SHEET_SOURCES_JSON`：

```json
[{
  "id":"semester-posts",
  "name":"學期宣傳需求",
  "spreadsheetId":"REPLACE_WITH_SPREADSHEET_ID",
  "range":"宣傳需求!A1:F201",
  "kind":"posts",
  "columns":{
    "title":"宣傳名稱",
    "eventSourceKey":"活動來源鍵",
    "sourceKey":"來源鍵",
    "highlights":"宣傳重點",
    "cta":"希望採取行動",
    "channel":"發布管道"
  }
}]
```

第一列須是對應標題列。`kind` 可為 `events`、`posts` 或 `tasks`，每次來源預覽最多 200 筆資料。瀏覽器只能選已設定的 `sourceId`，不能自行指定任意試算表與範圍。讀取後仍先預覽，再由人員確認匯入；此版沒有來源表自動同步或寫回。

## 7. 讓已核准工作繼續自動執行

`OPS_AUTO_RUN_JOBS=true` 會在人工核准、要求設計或允許的重試之後，立即處理對應的一項工作。Canva 可能回傳「處理中」，之後仍需再查詢結果，因此無狀態服務需要外部排程。

### Vercel 等無狀態部署

後端設定 `OPS_CRON_SECRET`，以 Bearer 驗證以下端點；秘密需 32–512 個非空白字元，可另外產生隨機值：

```bash
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
```

```http
POST https://backend.example.org/api/ops/jobs/tick
Authorization: Bearer <OPS_CRON_SECRET>
```

也接受 GET。每次固定最多處理 3 項既有工作，請求內容不能增加上限或替內容核准。缺少有效秘密時端點不執行工作。

選用排程定義在 [.github/workflows/ops-queue.yml](../.github/workflows/ops-queue.yml)。合併到預設分支後，在 GitHub repository 設定：

- **Variable `OPS_WORKER_URL`**：完整的 HTTPS tick URL。
- **Secret `OPS_CRON_SECRET`**：與後端相同的排程秘密。

工作流程排在每小時 UTC 的 7、22、37、52 分鐘。尚未設定 URL 時略過；有 URL 但缺少秘密時回報設定錯誤，不發送 HTTP 請求。排程啟用與執行紀錄須在 GitHub Actions 驗收，不能只以環境變數存在判斷完成。

### 常駐 Node 主機

可改用 `OPS_WORKER_ENABLED=true`，以及 `OPS_WORKER_INTERVAL_SECONDS`（30–3600 秒，預設 60 秒）。每輪最多 3 項工作；啟動程序後可能自動執行既有工作，不需要另按操作按鈕。這個 `setInterval` 模式需要常駐程序，不適合依賴 Vercel 函式在請求結束後繼續執行。沒有排程時，社長／顧問仍可從工作台手動處理待辦工作。

## 8. 部署與驗收順序

此程式庫目前可觀察到前端 `client` 與後端 `server` 的 Vercel 部署設定／檢查，另保留歷史 `render.yaml`；請以實際主機設定確認目前部署位置，不要只依舊設定檔判斷。

2026-10-25 實際 UI 顯示後端 Production Branch 為 `feat/vercel-serverless-migration`，本輪未變更。**合併 `main` 不等於後端正式部署**；正式發布前，須核對前後端各自的 Production Branch、部署提交及環境配對。

首次啟動伺服器可能建立／遷移資料表；`OPS_WORKER_ENABLED=true` 也可能啟動工作處理。因此即使只呼叫 `/api/health`，也不能把整個程序啟動宣稱為完全零寫入。測試前確認資料庫及工作執行設定。本輪新版部署與真實 17 筆人員匯入尚須以部署後回讀確認，本文件不將準備工作記為完成。

1. **先建立 Preview。** 前端與後端必須包含相容且已核對的程式版本，並確認各自部署分支。Preview 指向測試資料庫；正式環境才使用既有正式資料庫，避免測試記錄進入正式流程。
2. **設定該環境的 API 與身分。** 使用 gateway 時，前端設 `VITE_OPS_API_URL=/api`，前端伺服器的 `OPS_BACKEND_ORIGIN` 指向對應後端 origin，保留其他 CMS 的 `VITE_API_URL`。核對所需的 Trusted Sources 環境規則；後端配置 Firebase 與 Turso。確認穩定 Preview 網域已列入 Firebase 授權網域，並分別驗收 Google 登入與後端角色。
3. **設定責任人。** 寫入終審與設計登入信箱名單。實測一般幹部不能冒用終審者，指定終審者可核准當前版本。
4. **先驗收內部流程。** 用虛構活動匯入、產生草稿、送單位確認、終審、人工附上 Canva 連結與成果證據。重新載入後資料應仍存在；修改活動或文案後應要求重新審核。
5. **再接外部服務。** 設定 Canva OAuth、資料欄位與母版，完成一次實際套版，核對圖層仍可編輯；需要 AI 或 Sheets 時再啟用對應設定。來源表分享與外部帳戶權限也須驗收。
6. **驗收排程。** 設定 tick URL 與秘密，以已核准的測試工作確認「處理中」最終轉為設計交件。失敗與未知結果應留在工作紀錄，不應冒充完成。
7. **正式啟用。** 核對前後端 Production Branch／部署版本、資料庫、工作台 API 與 gateway 目標、信任規則、OAuth redirect／返回 origin、秘密、責任人名單與排程 URL；Preview → Preview 授權不包含 Production。正式資料移轉仍需預覽及確認，不把 Preview 測試資料直接當成正式資料。

部署新版時保留資料庫與加密金鑰；復原程式版本前先確認 `ops_*` 資料仍可讀取。連線問題看「系統連線」，工作問題看工作紀錄；`blocked_configuration` 先補設定，`failed` 修正後可重試，`needs_reconciliation` 先核對外部結果。

## 9. 本機驗證與目前範圍

使用 **Node.js 22.20.0**，在程式庫根目錄執行；CI 已固定同一版本。本環境的 Node 24 曾在 libSQL 原生模組崩潰，因此不以該 runtime 的崩潰判斷業務測試失敗。

```bash
npm --prefix server ci --ignore-scripts --no-audit --no-fund
npm --prefix server test
npm --prefix client ci --ignore-scripts --no-audit --no-fund
node --test --experimental-test-isolation=none client/src/ops/*.test.js
node --test --experimental-test-isolation=none client/src/utils/courseInfo.test.js
node --test --experimental-test-isolation=none client/server/ops-proxy.test.mjs
npm --prefix client run build
```

後端測試使用隔離的測試資料庫與模擬供應服務，不需真實服務憑證；包括身分、版本、匯入、審核、保存、重試、OAuth 與排程邊界。gateway 測試另使用模擬上游，驗證路由、固定目標、憑證／header 邊界及失敗不重試。部分受限執行環境需允許測試綁定本機連接埠。實際通過結果以 CI／測試輸出為準。

本機啟動可分別執行 `npm --prefix server start` 與 `npm --prefix client run dev`。只看 `/ops-demo` 時可單獨啟動前端；正式 `/ops` 仍需有效身分及後端設定。

目前提供活動、宣傳、審核與跨組交付的共同流程。**舊工具站已具備財務申請／審批／入帳、公關 CRM、講師排程、幹部權限與批次證書；Google 表單／試算表也已有社員、繳費與簽到來源，新工作台尚未完成這些工具的資料接合。** 後續以指定主來源及固定 ID 整合，不重建另一套財務或社員主檔。教育訓練內容由使用者自行處理。

人像／活動照片仍需由人員選定並放入 Canva 資產或設計；這版不會自動尋人像、上傳照片或逐活動挑圖。Canva 文字與圖層仍需羽蓉及相關負責人校對，文案每一版仍需人工核准。CMS 快照已補資源表、欄位允許清單及交易式還原，但不包含整個工作台、RTDB、Cloudinary 圖片及外部 Drive／Canva；全系統備份與隔離還原仍須另行驗收。
