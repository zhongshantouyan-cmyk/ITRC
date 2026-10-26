# 社務工作台：啟用與維護手冊

這一版採學生社團的簡單流程：一般任務只有待辦、進行中、完成；活動與宣傳放在同一畫面，文案只確認一次。財務核銷維持原有嚴謹簽核。幹部姓名、職稱與當期名單依官網核對，內部 MAIL、固定幹部 ID 和歷史任務保留在私有來源及工作台。更新日期：2026-10-26（Asia/Taipei）。

前一輪正式前後端、Google 登入與舊工具已完成發布驗收；14 位現任／3 位已卸任、18 筆真實來源草稿、財務 47 筆原帳與完整備份還原已有實際證據。本輪簡化流程與同源工具整合是新的發布候選，須另外確認部署，不沿用舊畫面或影片宣稱新版已上線。最新分界見 [ops-validation.md](ops-validation.md)。

## 1. 入口與已提供的功能

| 入口／區塊 | 用途 |
| --- | --- |
| `/ops-demo` | 虛構資料的互動展示；資料只存在目前瀏覽器，可切換示範角色與重設；不呼叫正式後端、AI 或 Canva。 |
| `/ops` | 連接真實後端的工作台；需要既有 Google／Firebase 登入與角色授權。正式發布版本及環境以驗收紀錄為準，不能僅依頁面名稱判斷。 |
| 總覽、活動與宣傳 | 同畫面整理活動資料、相關文案與 Canva 連結；活動可直接標完成或改回待辦。 |
| 宣傳 | 草稿、一次文案確認、完成／發布紀錄；可取消確認、手動附 Canva 連結。 |
| 任務 | 待辦／進行中／完成；負責人、期限、備註與連結都可選填，現任授權幹部可協作更新。 |
| 設定與紀錄 | 查看操作歷史、自動工作結果、連線狀態、資料匯入與進階來源回寫。 |
| 各組工具 | 財務、講師、合作、圖文、證書等以同網站 `/ops?tool=<id>` 開啟；財務權限與原資料保留。 |
| 來源回寫 | 提出固定工作版本、管理核對來源版本、匯出核准回寫包，再登錄原檔寫回證據；不自動改寫外部檔案。 |

後端沿用既有 Express、Firebase 與 Turso／libSQL。工作台使用獨立的 `ops_*` 資料表保存流程草稿、版本、佇列與人員對照，不會把私有聯絡資料寫進官網公開的 `members` 表。既有 FileOS／指定主表仍是正式業務來源；工作台修改尚未自動回寫來源表，不可把匯入快照當成另一套正式主檔。新增「來源回寫」作為工作台與 AI API 的同一個更新提案入口；會核對工作版本及人工回報的來源版本。既有 FileOS 收件匣已可人工對照提案；外部 Drive 自動讀寫並未因此完成，不可宣稱全體入口已自動同步。既有 API 與資料欄位見 [ops-contract.md](ops-contract.md)，本輪人員及交付操作補充見下文。

## 2. 日常流程

1. 新增活動，選講座／社課或一般活動。日期、地點與講者未填時會提示；一般活動不要求講師，不妨礙先整理工作與文案。活動進度可直接設待辦、進行中、完成，與事實是否完整分開。
2. 在同一活動畫面新增宣傳需求，填寫或產生文案；也可將提示帶到自己的 AI，再貼回草稿。缺漏事實保留「待確認」，不要猜日期或講者。
3. 有效登入的現任幹部看過目前文案後按一次確認。可取消確認；改文案或實質活動事實會使舊確認失效。無須逐層單位審、終審或第二人驗收。
4. 可手動附 Canva 編輯連結。要請伺服器產生分層設計時，須已有當前文案確認與可用 Canva 連線／母版，再按建立設計；確認文案本身不會自動呼叫外部服務。
5. 做完即可標記完成；實際發布後可記錄網址與時間，網址不是完成的必填欄位。系統不會代為發布社群貼文。涉及合作約定仍由負責人核對；財務核銷另走財務規則。

「管理與設定 → 操作紀錄與資料匯出」中的「匯出宣傳資料」會下載 UTF-8 CSV，一列一則宣傳，完整文案保留在同一格，並包含各頁短文、版本、核准、Canva 連結、發布證據及來源。Excel 可直接開啟；需要 `.xlsx` 時再另存。匯出不會改動正式資料。

修改文案、活動事實或實質贊助要求，會使相關未發布內容的先前核准失效。已發布記錄保留原始證據，另產生修正任務。系統不會自行同意文案、寄信給合作方或發布社群貼文。

### 人員對照與任務交付

「幹部名單」的人員對照接受幹部主表的姓名、職稱、MAIL、LINE 名稱、組別、固定幹部 ID、任期及在任狀態。先預覽差異，再明確套用；預覽後來源或既有人員資料改變時，必須重新預覽。固定 ID 沿用 `ITRC-P0001` 格式，不能按職稱、姓名或新排序換發。沒有 MAIL 的人可以先保留空白；未列入當期官網的人保留歷史，不能據此推斷已離任。名單更新不會授予 Firebase 登入角色。`retired`／「已卸任」明確表示已確認離任，與 `inactive`／「非當期名單」分開；兩者均不能新增指派，對應 MAIL 無法再讀寫工作台，包含舊操作的重送。歷史資料保留，其他平台角色仍需同步撤銷。

前次依官網匯入 17 筆人員時，狀態為 15 筆在任、2 筆非當期名單；這是當時的驗收紀錄。使用者後續明確確認許筠采（ITRC-P0017）、謝政韋（ITRC-P0013）、王方勳（ITRC-P0015）已離任，因此目前主表為 **14 位現任、3 位已卸任**，原 17 個固定 ID 與歷史保留。16 筆既有 MAIL 不重收，許筠采的空白 MAIL 不需為離任操作補造。本輪前次正式驗收已回讀工作台 14 現任／3 歷史、撤銷謝與王的舊角色、封存許的官網紀錄；許原無舊登入帳號。後續名單變動仍須逐平台核對。人員匯入不建立任務、宣傳或財務記錄，也不授予新登入角色。

任務標題必填，其餘負責人、期限、備註與成果連結均可選填。未指派不阻擋開始或完成；不自動把共用帳號當承辦人。現任授權幹部可直接切換待辦、進行中、完成，也可將完成改回待辦，不需要不同驗收人、交付標準、退回理由或所有子任務先通過。舊交件／驗收資料與操作歷史繼續保留；這項簡化不適用財務申請、簽核與入帳。

文案完整歷史保存在 `post.history`，含文案、各頁文字、來源活動快照、核准與設計關聯。回復歷史內容會建立新草稿，先前核准不會復活。新功能無法重建啟用前已遺失的版本。

一般進度使用 `task.set-status`、`event.set-status`，文案使用 `post.confirm`／`post.unconfirm`／`post.complete`；資料版本與操作識別檢查保留。人員更新仍使用 `people.import-preview`／`people.import-apply`，套用需要相同 `previewToken`。

## 3. 整學期資料匯入

在「活動與宣傳 → 匯入學期表」或「管理與設定」選擇活動、宣傳需求或任務，可下載 CSV 範本、上傳 CSV／TSV／JSON，或直接貼上含標題列的表格。Excel 請先另存為 UTF-8 CSV，或複製儲存格貼上；此版不直接解析 `.xlsx`。

每次總計最多 200 筆，後端請求上限為 256 KB；過大時分批處理。前端檔案選擇上限為 500 KB，不代表轉換後的請求一定小於後端上限。

| 資料 | 最少需準備 | 來源與關聯 |
| --- | --- | --- |
| 活動 | `title`；`eventType` 可選 `lecture`／`activity`，其他事實可稍後補 | 建議填固定 `sourceKey`，如 `course-001`。 |
| 宣傳需求 | `title`、活動關聯；可另填 `purpose`、`audience`、`highlights`、`cta`、`channel`、`scheduledAt` | 使用既有 `eventId`，或以 `eventSourceKey` 對應活動的 `sourceKey`。每則宣傳有自己的 `sourceKey`。 |
| 任務 | `title`；選填 `ownerPersonId`、`dueDate`、`notes`、`status` | 可連結既有專案、活動或貼文。空白承辦人保持空白；`todo`／`doing`／`done` 匯入時保留。 |

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
| `OPS_APPROVER_EMAILS` | 最終文案審核者的登入信箱，逗號分隔；保留舊版能力資訊；新版一般文案確認不依賴此名單。 |
| `OPS_DESIGNER_EMAILS` | 指定行銷／設計負責人的登入信箱，逗號分隔。保留舊版能力資訊；新版一般設計連結與完成操作不依賴此名單。 |
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
4. 社長／顧問在工作台「管理與設定」按 Canva 連線，登入持有母版權限的帳戶並授權。

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

啟用前先決定模型與帳戶用量／預算控管，再以少量需求驗收。此版沒有自行實作金額預算上限；目前介面逐則產生草稿，請在服務帳戶另外控管用量。請勿把 API key 放進前端。`OPS_PROVIDER_TIMEOUT_MS` 可調整服務等候時間，程式限制在 1–45 秒，預設 20 秒。實作參考 [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)。

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

### 本次 Vercel 正式部署：GitHub 短效 OIDC

[.github/workflows/ops-queue.yml](../.github/workflows/ops-queue.yml) 使用 GitHub Actions 臨時簽發的 OIDC token，呼叫固定正式端點 `https://itrc-eight.vercel.app/api/ops/jobs/tick`。**本次不需要新增 `OPS_CRON_SECRET` 或 `OPS_WORKER_URL`，也不保存新的長期排程 API key。** 後端保留 Bearer secret 相容路徑，僅供另有需求的部署使用，不是本次啟用前置條件。

後端驗證 GitHub 簽章、issuer、audience、repository／owner ID、`main`、這份 workflow 路徑、GitHub hosted runner，以及 `schedule`／`workflow_dispatch` 事件。只有後端 `VERCEL_ENV=production` 且 `OPS_GITHUB_CRON_ENABLED` 不為 `false` 時啟用這條 OIDC 路徑；Preview 預設不執行工作。每次固定最多處理 3 項既有工作，請求不能增加上限、選操作者、建立提案或替內容核准。

工作流程排在每小時 UTC 的 7、22、37、52 分鐘，GitHub 觸發可能延遲。已取得兩次真正 `schedule` 成功紀錄：[40238075994](https://github.com/zhongshantouyan-cmyk/ITRC/actions/runs/40238075994)、[40247606052](https://github.com/zhongshantouyan-cmyk/ITRC/actions/runs/40247606052)。不需要為驗收另強制手動 dispatch；後續發布仍須核對 main 與後端相容。成功且 `processed:0` 只證明排程通路連通；外部設計工作完成仍需有實際工作結果。排程啟用與執行紀錄須以 GitHub Actions 驗收，不以程式存在判斷完成。

暫停觸發可設 repository variable `OPS_DISABLE_QUEUE=true`；停用後端 GitHub 身分路徑可設 `OPS_GITHUB_CRON_ENABLED=false`。工作失敗或外部結果不明時，先查看工作台紀錄，不盲目重送設計。

### 常駐 Node 主機

可改用 `OPS_WORKER_ENABLED=true`，以及 `OPS_WORKER_INTERVAL_SECONDS`（30–3600 秒，預設 60 秒）。每輪最多 3 項工作；啟動程序後可能自動執行既有工作，不需要另按操作按鈕。這個 `setInterval` 模式需要常駐程序，不適合依賴 Vercel 函式在請求結束後繼續執行。沒有排程時，社長／顧問仍可從工作台手動處理待辦工作。

## 8. 部署與驗收順序

此程式庫目前可觀察到前端 `client` 與後端 `server` 的 Vercel 部署設定／檢查，另保留歷史 `render.yaml`；請以實際主機設定確認目前部署位置，不要只依舊設定檔判斷。

2026-10-25 實際 UI 顯示後端 Production Branch 為 `feat/vercel-serverless-migration`，本輪未變更。**合併 `main` 不等於後端正式部署**；正式發布前，須核對前後端各自的 Production Branch、部署提交及環境配對。

首次啟動伺服器可能建立／遷移資料表；在允許執行工作的環境，`OPS_WORKER_ENABLED=true` 也可能啟動工作處理。因此即使只呼叫 `/api/health`，也不能把整個程序啟動宣稱為完全零寫入。前次提交 `ab1c5a1b7549dab5401f7153755dc195ece1a486` 的 Preview／CI 與 17 筆人員回讀是歷史證據。本次候選預設阻擋 Preview 業務寫入、OAuth callback 及背景 worker；這是隔離未確認時的保護，不等於已有獨立雲端測試資料庫。

1. **核對 Preview 與資料庫。** 前後端必須使用相容版本。未證明 Preview 資料庫與正式分離時，維持業務唯讀；虛構寫入、重試與還原在隔離的本機／測試環境驗證。真正建立並核對獨立測試資料庫後，才能另外啟用 Preview 寫入測試。
2. **設定該環境的 API 與身分。** 本次 Production 沿用官網既有 `VITE_API_URL`，直接連正式後端 `itrc-eight.vercel.app/api`。Preview 保留 `VITE_OPS_API_URL=/api` 與對應 `OPS_BACKEND_ORIGIN` 的 gateway。只有使用 gateway 的環境才需配對該環境的 Trusted Sources；分別驗收 Google 登入與後端角色，不把 Preview 的信任規則當成 Production 已授權。
3. **核對登入與離任。** 現任授權幹部可協作修改一般任務、活動與文案；未授權／離任帳號不可進入。財務與正式來源回寫管理權限維持原限制。
4. **先驗收內部流程。** 在已隔離的測試環境用虛構資料驗證匯入、任務／活動直接完成與重開、一次文案確認及改版失效。正式環境只套用已預覽的真實來源草稿並重新載入回讀；不得把示範核准、測試設計連結或虛構發布證據寫成真實成果。
5. **再接外部服務。** 設定 Canva OAuth、資料欄位與母版，完成一次實際套版，核對圖層仍可編輯；需要 AI 或 Sheets 時再啟用對應設定。來源表分享與外部帳戶權限也須驗收。
6. **驗收排程。** 依上節驗證真正 `main` workflow 的短效 OIDC 請求與正式後端結果。排程成功不等於 Canva 已連線；有已授權的真實工作時，再核對其外部結果。設定缺漏、失敗與未知結果須留在工作紀錄。
7. **正式啟用。** 核對前後端 Production Branch／部署版本、資料庫、API、所使用的 gateway／信任規則、OAuth redirect／返回 origin、責任人與排程固定端點。正式資料移轉須預覽及回讀，離任狀態與舊角色須逐處核對；另完成系統資料備份的受限保管及隔離還原。上線、備份還原和排程證據分別記錄，不以其中一項代表全部完成。

部署新版時保留資料庫與加密金鑰；復原程式版本前先確認 `ops_*` 資料仍可讀取。連線問題看「管理與設定」，工作問題看工作紀錄；`blocked_configuration` 先補設定，`failed` 修正後可重試，`needs_reconciliation` 先核對外部結果。

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

目前提供活動與宣傳同畫面、一般任務三態及同源各組工具入口。財務申請／簽核／入帳、公關 CRM、講師、幹部權限與證書沿用既有資料及規則；同網站不代表所有主表已自動雙向同步。社員／出席等資料仍依指定主來源管理。舊版教育影片已有成品，但其多層審核畫面不代表本次簡化版操作，交付時應標明版本。

人像／活動照片仍需人員選定；缺少外部服務設定時，使用手動文案與 Canva 連結，不將設定存在當成設計已產生。完整系統備份已實際包含 14 SQL 表／11 RTDB 路徑並完成隔離還原；Cloudinary／Drive／Canva 檔案及平台設定、規則、金鑰不包含在這份資料包。詳見 [system-backup-runbook.md](system-backup-runbook.md)。

## 10. 本輪交付補充：離任、任務協作與正式來源回寫

### 離任與任務協作

人員表預設只顯示在任／待確認，勾選「顯示已卸任／非當期的歷史人員」可查原紀錄。更新任職狀態不刪除任務承辦 ID、文案核稿或操作歷史；未完成任務可由現任授權幹部明確改派。任務可按組別（含兼任）篩選，現任授權幹部可追加留言與補充連結，並直接標完成。舊交付快照保留當時附件清單，後續補充不改寫歷史證據。

保留的進階 `event.preview-checklist`／`event.apply-checklist` API 可列出八項常用任務及建議日期：講師 D-21、場地／車證／鑰匙 D-14、宣傳與合作 D-7、設備 D-3、簽到 D、照片／感謝狀 D+1、核銷佐證 D+3、結案 D+7。確認後才建立，保持未指派及待辦；同一活動重按會略過既有模板項目。這些是可編輯的建議期限，不取代學校規定或各組正式 SOP。活動日期之後變更時，需另行核對已建立任務的期限；不適用任務按實際需要整理，不作一般活動完成的先決條件。

### 正式來源回寫的界線

1. 先更新工作區資料，再於「來源回寫」選擇該活動、宣傳或任務，指定原主表／FileOS 檔案網址、固定來源鍵、來源版本與本次差異。提案保存目前工作版本及明確欄位快照，不另建正式主表。
2. 社長／顧問開啟原始檔，核對原始內容與版本，勾選確認並填入剛才看到的版本。版本不同時停止；需先核對並更新工作區的來源版本，再重提。
3. 核准後可下載 `itrc.fileos-change.v1` JSON 回寫包，含來源鍵、預期來源版本、值、核准紀錄與校驗雜湊。這只表示「已核准，待回寫」，不代表原始檔已更新。
4. 在原始檔只更新對應固定 ID，保留其他欄列。寫入前再次核對版本，寫入後回讀完整內容，再於工作台登錄新來源版本及回寫證據。
5. 工作紀錄在提案後改版，或同一來源已由另一提案回寫時，舊提案無法繼續匯出／登錄；可退回後重新提出。回寫完成標示 `human_recorded`，明確保留人工核對界線。

此版本沒有背景自動讀取 Drive 現況，也不會把核准包直接寫入 Google Sheets／Excel／Markdown。原收件匣已可人工連結，服務憑證與自動差異比對仍需獨立驗收，不能以本頁的存在宣稱已全自動雙向同步。財務在同網站 `/ops?tool=finance` 使用原財務規則，官網發布仍走 CMS，不由這份來源提案繞過原權責。

現有 UI 可人工銜接原 FileOS 收件匣：在「這次要回寫的原因與差異」貼上管理者保管的原收件匣連結、對應列及來源訊息 ID，並在原收件匣建立同一提案的對照記錄。「正式來源網址」仍保留真正的 Excel／Markdown／指定主表；已存在來源的工作不能改填成收件匣 URL。這段文字不會自動建立收件匣列，也不提供獨立 queue 設定欄。原檔尚未寫入及回讀時，保持待核對／已核准待回寫，不以收件匣已收到提案就登錄回寫完成。
