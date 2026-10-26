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
- 以下二選一：CANVA_TEMPLATE_DESIGN_ID 或 CANVA_BRAND_TEMPLATE_ID。
- CANVA_FIELD_MAP_JSON：精確的母版欄位對照。

暫時測試也可使用 CANVA_ACCESS_TOKEN，並選填 CANVA_ACCESS_TOKEN_EXPIRES_AT（ISO 日期）；正式自動流程應使用可持續更新的 OAuth 連線。

canva-oauth.js 提供 PKCE 授權、授權碼交換及 refresh token 交換。createAuthorizationRequest() 回傳的 codeVerifier 與 state 必須存放於伺服器；前端只接收 authorizationUrl。伺服器需綁定發起連線的登入身分、檢查有效期限並一次性消耗 state。

**Canva refresh token 每個只能使用一次。** 呼叫端必須序列化更新、將新 accessToken／refreshToken 加密保存，原子取代舊值成功後才能繼續使用。若更新結果不明，重新連線；不可盲目重送舊 refresh token。提供給建立／查詢設計函式的 getCanvaAccessToken callback 負責從這個保存層取出有效的 token。

最低權限為 design:content:read、design:content:write、design:meta:read。使用品牌範本時另外要求 brandtemplate:meta:read、brandtemplate:content:read。此版不含圖片上傳功能，圖片欄位使用已上傳的 Canva asset ID。

### 欄位對照範例

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

永遠使用 create_from_design 或 create_from_brand_template；沒有 update_design 路徑，因此不覆蓋行銷負責人手動調整過的成品。每次請求也會確認 approvedVersion 等於 copyVersion。

API 建立作業回傳 in_progress、success 或 failed。寫入逾時、5xx 或無效回應會拋出 UNCERTAIN_RESULT，標記 uncertain=true；工作佇列應進入待核對狀態，不可自動新增第二份設計。讀取 dataset 失敗屬於安全的前置檢查失敗。

## Google Sheets

兩種身分來源二選一：

- GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON：僅供後端使用的服務帳戶 JSON。將指定來源工作表分享給該服務帳戶，使用 spreadsheets.readonly 範圍。程式不設定使用者 impersonation，也不要求全網域委派。
- GOOGLE_SHEETS_ACCESS_TOKEN：供短期測試的 OAuth access token。

來源以伺服器設定 OPS_SHEET_SOURCES_JSON 控制，例如：

    [
      {
        "id":"semester-events",
        "name":"學期活動來源",
        "spreadsheetId":"REPLACE_WITH_SHEET_ID",
        "range":"活動!A1:J200",
        "kind":"events",
        "columns":{"title":"活動名稱","date":"日期","speaker":"講者","venue":"地點"}
      }
    ]

服務端只接受設定中完全吻合的 spreadsheetId 與 range。單次最多 500 列、52 欄且合計 10,000 格。不接受整欄或未設上限的範圍。低階測試也可用 OPS_SHEET_SOURCE_IDS 逗號分隔允許的 ID；正式畫面以具名來源設定為準。

回傳 {spreadsheetId,range,values,sourceUrl,fetchedAt,readOnly:true}；values 第一列為來源欄名。呼叫端需先呈現匯入預覽，再將確認的資料寫入新系統。此模組完全沒有寫回工作表的 API。

## 測試

在 server 目錄執行：

    node ops/provider-adapters.test.js

測試全部使用假的 HTTP 回應；不使用部署金鑰、不建立真實設計、不呼叫付費模型。涵蓋未設定阻擋、規則草稿標記、AI 異常、Canva 版本與欄位檢查、未知寫入結果、Google 來源與範圍限制、服務帳戶簽章、PKCE／state，以及單次 refresh token 更新。

## 主要規格來源

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Canva Autofill API](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/)
- [Canva Autofill job result](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/get-design-autofill-job/)
- [Canva OAuth PKCE](https://www.canva.dev/docs/apps/rest-apis/authentication/)
- [Canva access/refresh token endpoint](https://www.canva.dev/docs/apps/rest-apis/reference/authentication/generate-access-token/)
- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google service account authorization](https://developers.google.com/identity/protocols/oauth2/service-account)
