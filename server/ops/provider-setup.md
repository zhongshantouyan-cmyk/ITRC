# 外部服務設定

本模組將「程式已具備連線功能」、「已填設定」與「實際授權成功」分開。未填金鑰時，文案可使用標記為 rules 的規則草稿；Canva 與 Sheets 則回傳可辨識的設定阻擋，不會聲稱已產生設計或已同步。

## 文案

伺服器環境變數：

- OPENAI_API_KEY：在部署平台的秘密設定中保存。
- OPENAI_MODEL：管理者明確選定且帳戶可用的模型 ID。程式沒有預設模型。
- OPS_PROVIDER_TIMEOUT_MS：選填，預設 20 秒，限制在 1 至 45 秒。

有 key 與 model 才呼叫 Responses API；使用 JSON Schema 產生 caption 與三張可編輯圖卡文字。未設定時使用規則草稿，缺少的資料保留待確認標記。服務拒絕、逾時、未完整完成、拒答、格式錯誤都回報失敗，不會偷偷改成規則草稿後顯示 AI 成功。

輸入只包含活動公開欄位、宣傳目的與贊助呈現需求；不傳負責人 email、內部備註或整份工作表。store 設為 false。產生結果先作為草稿；現任幹部看過後按一次「文案 OK」，即可確認目前版本，修改文案後需重新確認。

若有效的 CANVA_FIELD_MAP_JSON 為 post.slides.0／1／2.heading 或 body 設有 maxLength，草稿會依各頁欄位的字數限制產生；同一來源被映射至多個欄位時，採用其中最小上限。只讀取這些圖卡文字限制，不猜測母版 ID，也不因此改動日期、活動全名等其他來源欄位。

規則草稿只縮短圖卡文字，超長處加上「…」，保留完整 caption；縮短時保留 Unicode 字元群集，避免切斷 emoji 或組合字元。AI 則把每頁的限制放入提示與 JSON Schema，回傳後再逐頁檢查。為了明確限制每頁不同長度，內部 Schema 使用 page_1／page_2／page_3 物件，介接回傳值仍為既有 slides 陣列。AI 超過限制會失敗，不會自動裁切，更不會在審核後修改已核准內容。未設定有效圖卡限制時維持既有草稿行為。

## Canva

建議透過 OAuth 完成一次帳戶連線。伺服器設定：

- CANVA_CLIENT_ID
- CANVA_CLIENT_SECRET
- CANVA_REDIRECT_URI：必須與 Canva 開發者後台完全相符。正式環境使用 HTTPS。
- OPS_TOKEN_ENCRYPTION_KEY：32 位元組隨機值的標準 Base64，供伺服器加密保存 OAuth 憑證；只能放在部署平台的秘密設定。
- OPS_FRONTEND_ORIGIN：OAuth 成功後返回的前端 origin。
- CANVA_GENERATION_MODE：選填 `autofill`（預設）或 `editable_import`；不會在失敗時自動切換。
- Autofill 模式以下二選一：CANVA_TEMPLATE_DESIGN_ID 或 CANVA_BRAND_TEMPLATE_ID。
- CANVA_FIELD_MAP_JSON：Autofill 模式的精確母版欄位對照。

目前 ITRC 正式回呼路徑為 `https://itrc-eight.vercel.app/api/ops/connections/canva/callback`，前端 origin 為 `https://nsysu-itrc.vercel.app`。前端的 ChatGPT Canva connector 不會提供這個網站的 OAuth 憑證；網站仍需管理者在自己的 Canva 帳戶完成授權。

依 2026-11-11 查閱的官方 Autofill 文件，此功能可用於 Canva Pro（含 Education、Nonprofits）、Teams 或 Enterprise。帳戶實際權益仍需以網站 OAuth 使用者的 API 結果確認；不能以 ChatGPT connector 可用推定網站已取得權益，也不能自動升級或開始付費。母版必須有 Autofill dataset 欄位；一般可編輯設計回傳空 dataset 時，還需要在授權的母版複本上配置欄位。

暫時測試也可使用 CANVA_ACCESS_TOKEN，並選填 CANVA_ACCESS_TOKEN_EXPIRES_AT（ISO 日期）；正式自動流程應使用可持續更新的 OAuth 連線。

canva-oauth.js 提供 PKCE 授權、授權碼交換及 refresh token 交換。createAuthorizationRequest() 回傳的 codeVerifier 與 state 必須存放於伺服器；前端只接收 authorizationUrl。伺服器需綁定發起連線的登入身分、檢查有效期限並一次性消耗 state。

**Canva refresh token 每個只能使用一次。** 呼叫端必須序列化更新、將新 accessToken／refreshToken 加密保存，原子取代舊值成功後才能繼續使用。若更新結果不明，重新連線；不可盲目重送舊 refresh token。提供給建立／查詢設計函式的 getCanvaAccessToken callback 負責從這個保存層取出有效的 token。

最低權限為 design:content:read、design:content:write、design:meta:read。使用品牌範本時另外要求 brandtemplate:meta:read、brandtemplate:content:read。此版不含圖片上傳功能，圖片欄位使用已上傳的 Canva asset ID。

### 可編輯匯入模式

`editable_import` 將已確認的三頁 `post.slides` 產生為含原生文字及形狀的 4:5 PPTX，以二進位 `POST /rest/v1/imports` 上傳；不使用母版或欄位對照，不需新增 OAuth scopes，也不修改原設計。標題每頁最多 8 字，內文依頁最多 42／84／84 字，過長或無法容納的換行在上傳前拒絕。已確認文字不截斷、不正規化；草稿產生則採用這組版面限制。完整 caption 仍另外保存。

工作保存固定 generationMode；匯入的 providerJobId 帶 `import:` 前綴。後續 `GET /imports/{id}` 必須只回傳一個設計，再 `GET /designs/{id}` 驗證同一 ID、有效 edit URL 與明確頁數為三頁。外部 ID 已保存時重試只讀取；未知建立結果及 `duplicate_import` 一律先核對。舊工作不自動轉換；已明確拒絕且沒有外部 ID 的 Autofill 工作，可在切換設定後由同一已確認版本明確要求新的匯入，原失敗紀錄保留。

匯入成功不能稱為 Autofill 成功，設定完成不能稱為此帳戶已驗證免費使用；仍需實際 API 與成品編輯驗收。程式不升級方案或付款。完整操作與防重複邊界見 [ops-runbook.md](../../docs/ops-runbook.md#5-canva連線與可編輯設計)，官方規格為 [Design Import](https://www.canva.dev/docs/apps/rest-apis/reference/design-imports/create-design-import-job/)。

### Autofill 欄位對照範例

以下是示意值，不能直接當正式母版設定：

    {
      "TITLE": {"type":"text","path":"post.title","maxLength":40},
      "DATE": {"type":"text","path":"event.date"},
      "PAGE_1_HEADING": {"type":"text","path":"post.slides.0.heading","maxLength":40},
      "PAGE_1_BODY": {"type":"text","path":"post.slides.0.body","maxLength":180},
      "LOGO": {"type":"image","assetId":"MExampleLogo"}
    }

文字欄位使用 path 或固定 value 二選一；來源只允許活動、文案與贊助需求的公開欄位。預設空白會擋住產生，只有明確設定 allowEmpty:true 才會用空字串清除欄位。圖片欄位只接受已上傳 assetId，不接受任意外部圖片 URL。

每次建立前會讀取當前 dataset，要求欄位名稱集合與類型全部吻合；漏掉、改名、增加欄位或文字過長都在外部寫入前停止。如此可避免 Canva 默默略過不存在的欄位，或留著母版的舊日期與舊講者資訊。

Autofill 模式只使用 create_from_design 或 create_from_brand_template；沒有 update_design 路徑，因此不覆蓋行銷負責人手動調整過的成品。兩種模式每次請求都會確認 approvedVersion 等於 copyVersion。

API 建立作業回傳 in_progress、success 或 failed。寫入逾時、5xx 或無效回應會拋出 UNCERTAIN_RESULT，標記 uncertain=true；工作佇列應進入待核對狀態，不可自動新增第二份設計。讀取 dataset 失敗屬於安全的前置檢查失敗。

即使建立請求立即回傳 success，也先保存 providerJobId；下一次輪詢成功後，會再呼叫 `GET /rest/v1/designs/{designId}` 讀回同一設計，確認設計 ID 與有效的編輯連結後才記錄成功。若讀回失敗，重試既有 job 的查詢，不重發建立請求。優先採用 `urls.edit_url`；一般 `url` 僅在明確指向同一設計的 `/edit` 路徑時接受，不能用檢視連結充當編輯連結。API 編輯連結可能有期限且僅供發起 OAuth 的 Canva 使用者使用，跨幹部協作仍需在 Canva 內確認共享權限。

讀回 metadata 並不等於已驗證每個圖層。正式驗收必須以明確標示的測試活動完成「文案 OK → 處理工作 → 產生新設計 → 讀回 → 打開編輯連結」，在 Canva 編輯器確認文字與圖層可獨立選取、修改；未執行此步只能記為程式測試通過。

## Google Sheets

身分來源依下列順序選用；前一項存在但無效時直接失敗，不自動切換身分：

- GOOGLE_SHEETS_ACCESS_TOKEN：供短期測試的 OAuth access token。
- GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON：僅供後端使用的服務帳戶 JSON。將指定來源工作表分享給該服務帳戶，使用 spreadsheets.readonly 範圍。程式不設定使用者 impersonation，也不要求全網域委派。
- GOOGLE_SHEETS_USE_FIREBASE_SERVICE_ACCOUNT=true：只有上述兩項均未設定，且值完全等於 `true` 時，才沿用 runtime 已有的 FIREBASE_SERVICE_ACCOUNT JSON。預設停用；不複製金鑰、不建立新帳號、不改變 Firebase 設定，也不自動分享試算表。仍只向固定 Google token endpoint 取得 spreadsheets.readonly token。

`GET /api/ops/connections/google-sheets/metadata` 為現任社長／顧問專用端點。只回傳 `client_email`、`project_id`、`credentialSource` 與 `missing`；不回傳私鑰、token、client ID 或原始 JSON。信箱須符合服務帳號格式，專案 ID 須符合標準 Google Cloud project ID 格式；缺少或無效的專案 ID 回傳 null 與缺項，不反射原值。暫用 access token 不含可顯示的服務帳號身分，兩個欄位均為 null。資料不加入一般 bootstrap 或公開 health。

管理設定頁的「試算表共用對象」卡片透過此端點顯示可複製的信箱與專案 ID；同源 gateway 只新增這個 GET 路徑，仍由後端決定角色權限。顯示身分只代表設定可解析，不能據此宣稱 Viewer 權限、Sheets API 啟用或實際讀取已通過。使用者核對分享對象後，僅將指定的獨立來源表授予 Viewer；不因啟用選項而自動改原表分享設定。

來源以伺服器設定 OPS_SHEET_SOURCES_JSON 控制，例如：

    [
      {
        "id":"semester-events",
        "name":"學期活動來源",
        "spreadsheetId":"REPLACE_WITH_SHEET_ID",
        "range":"活動!A1:J200",
        "kind":"events",
        "columns":{"sourceKey":"固定來源識別碼","title":"活動名稱","date":"日期","speaker":"講者","venue":"地點"}
      }
    ]

服務端只接受設定中完全吻合的 spreadsheetId 與 range。單次最多 500 列、52 欄且合計 10,000 格。不接受整欄或未設上限的範圍。低階測試也可用 OPS_SHEET_SOURCE_IDS 逗號分隔允許的 ID；正式畫面以具名來源設定為準。

設定頁會驗證具名來源不是空陣列、來源 ID 不重複、範圍有界限、類型為 events／posts／tasks，且至少對應 `title` 與 `sourceKey` 欄。`sourceKey` 必須沿用來源現有的永久且唯一識別碼；不能用資料列號、標題或日期臨時當永久 ID。來源沒有可用的固定識別欄時，先停止該來源的自動匯入，不改寫原表。原始識別碼若已有系統來源鍵，必須原樣保留，避免把已匯入資料另建一份。

只有 OPS_SHEET_SOURCE_IDS、壞 JSON、空來源或無效服務帳戶不會顯示為設定完成。檢查設定仍不代表 Google 已授權；要在正式環境成功讀取指定來源、預覽、匯入，再次讀取與匯入得到零新增，才能記為串接驗收完成。

回傳 {spreadsheetId,range,values,sourceUrl,fetchedAt,readOnly:true}；values 第一列為來源欄名。呼叫端需先呈現匯入預覽，再將確認的資料寫入新系統。此模組完全沒有寫回工作表的 API。

## 測試

在 server 目錄執行：

    node ops/provider-adapters.test.js

測試全部使用假的 HTTP 回應；不使用部署金鑰、不建立真實設計、不呼叫付費模型。涵蓋未設定／無效設定阻擋、規則草稿標記、AI 異常、Canva 版本與欄位檢查、未知寫入結果、成功後讀回及同一作業重試、編輯／檢視連結辨識、Google 來源與範圍限制、服務帳戶簽章、PKCE／state，以及單次 refresh token 更新。這些隔離測試不能取代正式外部服務驗收。

## 主要規格來源

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Canva Autofill API](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/)
- [Canva Autofill job result](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/get-design-autofill-job/)
- [Canva design readback](https://www.canva.dev/docs/apps/rest-apis/reference/designs/get-design/)
- [Canva OAuth PKCE](https://www.canva.dev/docs/apps/rest-apis/authentication/)
- [Canva access/refresh token endpoint](https://www.canva.dev/docs/apps/rest-apis/reference/authentication/generate-access-token/)
- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google service account authorization](https://developers.google.com/identity/protocols/oauth2/service-account)
