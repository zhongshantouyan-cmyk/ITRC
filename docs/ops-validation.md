# 工作台驗收紀錄

更新日期：2026-10-26（Asia/Taipei）。本文件分開記錄已確認的部署基礎、本輪程式驗證，以及仍待實際交付的項目。前輪可用的 Preview 不代表本輪新程式已部署；人員匯入也需以實際套用後回讀為準。

## 1. 本輪程式驗證

本輪使用 Node.js **22.20.0**，後端測試採獨立暫存 SQLite／libSQL、短暫 localhost HTTP 伺服器及模擬外部服務。前端與 gateway 測試不會發送真實 Canva、AI 或社群請求。

| 測試範圍 | 最新結果 | 驗證內容 |
| --- | --- | --- |
| 後端全部測試 | **94／94 通過** | 身分、持久化、版本、交件驗收、來源匯入、OAuth、排程、公開資料、交易式快照還原及安全設定。 |
| 前端工作台資料／流程 | **16／16 通過** | 人員對照、CSV 中文及空白標題、待指派、角色／父任務管理、交件、示範流程與匯出。 |
| 前端公開課程資訊 | **2／2 通過** | 舊 API 回傳的內部欄位／回覆表不會顯示，報名連結必須是 Google Forms 填寫入口。 |
| 同網域 gateway | **23／23 通過** | 路由、固定目標、OIDC、請求及回應大小、憑證／header 邊界、逾時與錯誤契約。 |
| 合計 | **135 項通過** | 這是程式測試總數，不是正式系統完成百分比。 |

本環境的預設 Node 24 在既有 libSQL 原生模組中發生 assertion crash；改用官方 Node 22.20.0，並核對官方 SHA-256 後，完整測試已通過。CI 已固定 Node 22.20.0。最新提交的 CI／前端建置及部署仍以 [PR #2](https://github.com/zhongshantouyan-cmyk/ITRC/pull/2) 的檢查結果為準。

### 新增能力與驗收邊界

| 項目 | 已驗證的程式行為 | 尚未以本機測試取代的工作 |
| --- | --- | --- |
| 私有人員對照 | 固定幹部 ID、預覽再套用、過期預覽拒絕、MAIL 保留、身份衝突拒絕、不自動變更登入角色。 | 真實 17 筆人員資料的部署後匯入與回讀，由本輪實作流程接續完成。 |
| 待指派與改派權限 | 空白承辦人保持待指派；建立者只在未指派時保有整理權；改派後不能靠 createdBy 繼續更新、交件或重開。 | 幹部以實際帳號／共用帳號操作的跨裝置驗收。 |
| 交件與獨立驗收 | 需要承辦人、不同驗收人、標準與成果連結；不可直接 done；代登錄須確認與證據，明確區分個人帳號和代登錄。 | 真實成果由指定驗收人確認，不能以測試中的虛構證據代替。 |
| 結案與拆分任務 | 必要前置／子任務／專案任務未驗收即阻擋；一般承辦人不能移除專案／上層關係繞過結案。 | 實際專案的必要成果及驗收人需由管理者確認。 |
| 完整文案歷史 | 保存文案、輪播、來源活動快照、核准／設計關聯；回復產生新草稿且舊核准失效；SQLite 重連後仍可讀取。 | 啟用前已遺失的舊版內容不能由此功能重建。 |
| 公開資料防護 | 官網課程資訊採允許欄位及填寫網址；搜尋不回傳舊回覆表；公開幹部資料不因新增內部欄位而洩漏聯絡資料。 | 正式 CMS 原值與 Google 分享設定須另外修改、讀回確認。 |
| CMS 快照 | 納入線上／線下資源表、欄位允許清單、行政角色限制及交易式還原；失敗會整筆回滾。 | 仍非全系統備份，不涵蓋 ops、RTDB、Cloudinary 檔案或外部 Drive／Canva；真實還原須在隔離環境測試。 |
| Legacy JWT | 未設定或仍使用公開範例金鑰時不啟用；明確停用設定優先；工作台仍只接受 Firebase 身分。 | 新程式與實際部署設定須配對，不能把本機通過當成正式環境已更新。 |
| RTDB 規則準備 | 規則產生器與相容性單元測試覆蓋根層拒絕、未知／未驗證帳號及既有管理／財務邊界。 | 規則發布、Firebase 端驗證與既有工具功能回歸另行確認；單元測試不是正式資料庫部署證據。 |
| 測試資料庫檢查 | 新增連線身分指紋比較，不輸出金鑰或原始連線網址。 | 此檢查不會自動建立隔離資料庫；仍須核實實際資料庫歸屬及備份還原。 |

## 2. 已完成的 Preview 連通與設定

以下是上一輪已取得、並在全盤盤點時重新確認的環境證據。舊文件中「Trusted Sources 等待批准」「暫時 VITE_API_URL 尚未清理」的敘述已過期。

| 項目 | 已確認狀態 |
| --- | --- |
| Firebase 授權網域 | 使用者已批准並加入穩定前端分支網域 `nsysu-itrc-git-feature-it-9eeefc-zhongshantouyan-4688s-projects.vercel.app`。 |
| Google 登入及後端身分 | 實際 `/ops` 已成功使用 Google 帳號登入並讀取後端資料及角色；目前共用社團帳號顯示文案終審與設計能力。這不是僅憑前端登入按鈕推測。 |
| Trusted Sources | 使用者已批准並完成 `nsysu-itrc` Preview → `itrc` Preview 信任規則；後端部署保護保持開啟。 |
| 同網域 gateway | 實際工作台已經由 `/api/ops/*` 讀到相符後端。早期上游 401／Network Error 不能再描述成現行阻塞。 |
| 工作台專用設定 | 前端分支使用 `VITE_OPS_API_URL=/api`，伺服器的 `OPS_BACKEND_ORIGIN` 指向既有對應後端 Preview。 |
| 既有 CMS 設定清理 | 本輪早期加入的分支專用 `VITE_API_URL` 暫時覆寫已刪除；既有 CMS 回到原 All Environments 設定。沒有輪替其他共用設定。 |
| 真實資料與外部服務 | 前輪實際工作區仍是空的，AI／Canva／Sheets 顯示等待設定。畫面「正式資料」僅表示連接真實後端，不表示正式 Production 上線。 |
| 前後端部署分支 | 後端 Production Branch 曾實際確認為 `feat/vercel-serverless-migration`，前端為 `main`；合併 `main` 不等於後端正式上線。正式發布時仍須重新核對兩者提交。 |

既有成功讀取的工作台基礎版本為 `21a3261e0d950ed2f1301dc84fca3785f4edc5a2`。本輪人員、交件、歷史與安全改動需以新的部署提交驗收，不能沿用舊 SHA 的成功結果。

Preview 的授權範圍不包含 Production。gateway 只代理四條 JSON API，不代理 Canva callback 或 cron。OIDC 用於通過部署保護，Firebase Bearer 仍由後端驗證身分；OAuth 回跳、排程與外部服務仍需各自驗收。原理參考 [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)。

## 3. 先前展示頁證據

先前在受保護 Preview 的 `/ops-demo`，已用虛構資料完成規則文案、單位確認、指定終審、測試 Canva 連結、設計校對、贊助同意證據與測試發布紀錄。重新載入後仍保留示範狀態；下載的 CSV 保留多行文案、版本、來源與證據欄位。

這些展示操作對應較早提交 `23a49b10aa8d5693229de52ce8e9fea242cf9163`，資料只存在該瀏覽器。它們驗證展示流程，不證明真實 Canva 產圖、社群發布、真實業務持久化或本輪新交件流程已實際驗收。

## 4. 正式交付前仍需完成

- 本輪新版的前後端部署、相容版本與實際畫面確認。
- 官網為準的 17 筆人員來源資料預覽、套用、回讀；當期人員與保留歷史的標記需正確，不能新增公開聯絡資料。
- 明確的測試資料庫隔離、完整備份範圍與隔離還原驗證。
- 一個活動的來源核對、指定版本審核、可編輯 Canva、羽蓉校對及發布證據；另用一個持續專案驗證交件、退回與驗收。
- FileOS 單一正式來源、共用更新佇列、來源版本檢查與核准回寫。現行匯入是來源快照，不能當成原表已同步。
- 真實 AI／Canva／Sheets 憑證及能力、Canva 母版／欄位、OAuth callback 與返回 origin 的配對。
- 背景排程的實際啟用及執行紀錄、通知收件人與不同幹部裝置操作。
- 現有財務、CRM、講師、社員／出席及證書工具的資料接合。這些既有工具並非尚未建置；新工作台還未把它們整合完成。

截至這份修訂，正式部署與真實 17 人匯入仍由本輪實作流程接續執行，尚未在此列為完成。真實財務審批／入帳、對外社群發布及整套還原沒有在本機測試中執行。

## 5. 重現

使用 Node.js 22.20.0，在程式庫根目錄執行：

```bash
npm --prefix server test
node --test --experimental-test-isolation=none client/src/ops/*.test.js
node --test --experimental-test-isolation=none client/src/utils/courseInfo.test.js
node --test --experimental-test-isolation=none client/server/ops-proxy.test.mjs
VITE_OPS_API_URL=/api npm --prefix client run build
```

本機 HTTP 測試需要允許綁定 localhost；資料庫使用獨立暫存檔，外部供應服務用模擬回應。伺服器實際啟動則可能建表／遷移，且啟用 `OPS_WORKER_ENABLED` 時可能自動處理既有工作，因此不能把呼叫 `/api/health` 視為整個程序完全零寫入。

完整啟用流程見 [ops-runbook.md](ops-runbook.md)。最新程式提交、CI 與部署檢查見 [PR #2](https://github.com/zhongshantouyan-cmyk/ITRC/pull/2)。
