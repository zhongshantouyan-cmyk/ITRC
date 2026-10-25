# 工作台驗收紀錄

更新日期：2026-10-26（Asia/Taipei）。本文件保留前次 Preview 連通與 17 筆人員匯入的歷史證據，另列本次發布候選的程式驗證及待現場核對項目。使用者後續確認三人離任，當前主表為 **14 位現任、3 位已卸任**；前次 15／2 的回讀紀錄不能再當作現行名單。程式存在、候選提交、部署 Ready 與真實業務驗收分別判定。

## 1. 程式驗證：分輪次保留

本輪使用 Node.js **22.20.0**，後端測試採獨立暫存 SQLite／libSQL、短暫 localhost HTTP 伺服器及模擬外部服務。前端與 gateway 測試不會發送真實 Canva、AI 或社群請求。

以下是前次版本的 135 項測試紀錄；本次新增功能的候選驗證另列在表後。

| 測試範圍 | 前次結果 | 驗證內容 |
| --- | --- | --- |
| 後端全部測試 | **94／94 通過** | 身分、持久化、版本、交件驗收、來源匯入、OAuth、排程、公開資料、交易式快照還原及安全設定。 |
| 前端工作台資料／流程 | **16／16 通過** | 人員對照、CSV 中文及空白標題、待指派、角色／父任務管理、交件、示範流程與匯出。 |
| 前端公開課程資訊 | **2／2 通過** | 舊 API 回傳的內部欄位／回覆表不會顯示，報名連結必須是 Google Forms 填寫入口。 |
| 同網域 gateway | **23／23 通過** | 路由、固定目標、OIDC、請求及回應大小、憑證／header 邊界、逾時與錯誤契約。 |
| 合計 | **135 項通過** | 這是程式測試總數，不是正式系統完成百分比。 |

本環境的預設 Node 24 在既有 libSQL 原生模組中發生 assertion crash；改用官方 Node 22.20.0，並核對官方 SHA-256 後，完整測試已通過。CI 已固定 Node 22.20.0。最新提交的 CI／前端建置及部署仍以 [PR #2](https://github.com/zhongshantouyan-cmyk/ITRC/pull/2) 的檢查結果為準。

本次發布候選已另完成 **169／169 項本機測試與 Vite production build**，涵蓋離任與角色、Preview 業務唯讀、來源回寫版本鏈、GitHub OIDC 排程驗證、系統備份與隔離還原等新增程式；詳見 [release-20261026.md](release-20261026.md)。上述數字是本機候選驗證，不是 GitHub CI、正式部署或服務授權的替代證據。舊工具站財務／名單發布包另有 30 項 Node 測試及 34 個真正 Firebase Emulator 情境，全用隔離虛構資料；不要把不同輪次數字相加當成系統完成度。

### 新增能力與驗收邊界

| 項目 | 已驗證的程式行為 | 尚未以本機測試取代的工作 |
| --- | --- | --- |
| 私有人員對照與離任 | 固定幹部 ID、預覽再套用、過期預覽拒絕、MAIL 保留、身分衝突拒絕；`retired`／`inactive` 不可新指派或使用工作台，不自動新增登入角色。 | 前次 17 筆回讀曾為 15 在任／2 非當期；使用者後續確認許、謝、王離任，主表已改 14 現任／3 已卸任。工作台、舊角色與官網封存須各自回讀，不以主表更新代替。 |
| 待指派與改派權限 | 空白承辦人保持待指派；建立者只在未指派時保有整理權；改派後不能靠 createdBy 繼續更新、交件或重開。 | 幹部以實際帳號／共用帳號操作的跨裝置驗收。 |
| 交件與獨立驗收 | 需要承辦人、不同驗收人、標準與成果連結；不可直接 done；代登錄須確認與證據，明確區分個人帳號和代登錄。 | 真實成果由指定驗收人確認，不能以測試中的虛構證據代替。 |
| 結案與拆分任務 | 必要前置／子任務／專案任務未驗收即阻擋；一般承辦人不能移除專案／上層關係繞過結案。 | 實際專案的必要成果及驗收人需由管理者確認。 |
| 完整文案歷史 | 保存文案、輪播、來源活動快照、核准／設計關聯；回復產生新草稿且舊核准失效；SQLite 重連後仍可讀取。 | 啟用前已遺失的舊版內容不能由此功能重建。 |
| 公開資料防護 | 官網課程資訊採允許欄位及填寫網址；搜尋不回傳舊回覆表；公開幹部資料不因新增內部欄位而洩漏聯絡資料。 | 已另行更新正式 CMS，移除回覆表網址並改為 115-1 入社填寫入口；幹部主表與舊 114-2 回覆表均已限制分享並讀回確認。新版程式防護目前在 Preview，不能視為 Production 已部署。 |
| CMS 快照 | 納入線上／線下資源表、欄位允許清單、行政角色限制及交易式還原；失敗會整筆回滾。 | 仍非全系統備份，不涵蓋 ops、RTDB、Cloudinary 檔案或外部 Drive／Canva；真實還原須在隔離環境測試。 |
| Legacy JWT | 未設定或仍使用公開範例金鑰時不啟用；明確停用設定優先；工作台仍只接受 Firebase 身分。 | 新程式與實際部署設定須配對，不能把本機通過當成正式環境已更新。 |
| RTDB 與財務逐筆權限 | 第一階段限制之外，舊工具站發布包已完成本人核銷查詢、禁止自簽、逐筆狀態檢查、固定單號與原子入帳；30 項 Node／34 個 Emulator 情境通過。 | 第一階段規則已發布並回讀，20 個 Playground 案例及社團帳號讀取已有證據。第二階段需新版工具站與相符 `rules.finance` 都正式發布、回讀及核對原資料，不能把本機模擬當成正式財務已驗收。 |
| 測試環境防護 | 連線身分指紋比較不輸出秘密；Preview 預設禁止業務寫入、OAuth callback 與背景 worker。 | 唯讀防護不等於獨立雲端測試資料庫；仍須核實資料庫歸屬。隔離未確認前不在雲端 Preview 寫入虛構業務資料。 |
| 來源回寫與 canonical queue | 提案保存來源／工作版本；管理核准、版本鏈、匯出包及人工回讀證據有檢查。 | 可在原因欄記錄原 FileOS 收件匣對照，仍須實際人工銜接；沒有自動寫 Sheet，不以提案核准當成主檔已更新。 |
| 系統資料備份 | 完整匯出 14 SQL 表／11 RTDB 路徑，失敗停止；隔離還原校驗內容、限制及安全停用連線。 | 真實資料包下載、受限保存與隔離還原仍須現場證據；外部檔案、平台設定、規則與金鑰不在資料包內。 |
| GitHub OIDC 排程 | 固定 repository／main／workflow／audience，短效簽章驗證；每次最多處理 3 個既有工作。 | 不需新增永久排程 secret。須真正 main workflow_dispatch 成功；空佇列成功只證明通路，不證明 Canva 工作已完成。 |

## 2. 前次已完成的 Preview 連通與設定

以下保留前次已取得的連通設定、當時 Preview 部署及真實名單匯入證據。舊文件中「Trusted Sources 等待批准」「暫時 VITE_API_URL 尚未清理」的敘述已過期；同樣不能把本節當成本次 Production 已部署的證據。

| 項目 | 已確認狀態 |
| --- | --- |
| Firebase 授權網域 | 使用者已批准並加入穩定前端分支網域 `nsysu-itrc-git-feature-it-9eeefc-zhongshantouyan-4688s-projects.vercel.app`。 |
| Google 登入及後端身分 | 實際 `/ops` 已成功使用 Google 帳號登入並讀取後端資料及角色；目前共用社團帳號顯示文案終審與設計能力。這不是僅憑前端登入按鈕推測。 |
| Trusted Sources | 使用者已批准並完成 `nsysu-itrc` Preview → `itrc` Preview 信任規則；後端部署保護保持開啟。 |
| 同網域 gateway | 實際工作台已經由 `/api/ops/*` 讀到相符後端。早期上游 401／Network Error 不能再描述成現行阻塞。 |
| 工作台專用設定 | 前端分支使用 `VITE_OPS_API_URL=/api`，伺服器的 `OPS_BACKEND_ORIGIN` 指向既有對應後端 Preview。 |
| 既有 CMS 設定清理 | 本輪早期加入的分支專用 `VITE_API_URL` 暫時覆寫已刪除；既有 CMS 回到原 All Environments 設定。沒有輪替其他共用設定。 |
| 真實資料與外部服務 | 前次已匯入並回讀 17 筆人員對照，當時未建立任務、宣傳或財務資料。本次另準備 18 筆真實活動／宣傳需求草稿，僅離線預覽／格式驗證完成；是否正式匯入須另記現場證據。AI／Canva／Sheets 的伺服器能力仍需對應設定。 |
| 前後端部署分支 | 後端 Production Branch 曾實際確認為 `feat/vercel-serverless-migration`，前端為 `main`；合併 `main` 不等於後端正式上線。正式發布時仍須重新核對兩者提交。 |

前輪成功讀取的基礎版本為 `21a3261e0d950ed2f1301dc84fca3785f4edc5a2`。前次功能提交 `ab1c5a1b7549dab5401f7153755dc195ece1a486` 已通過 GitHub Actions Operations checks #16（run `40219850343`）的全部測試及建置步驟；[前端部署](https://vercel.com/zhongshantouyan-4688s-projects/nsysu-itrc/HSW6bSR6thB1UBtW9pP33YDhA5s8)與[後端部署](https://vercel.com/zhongshantouyan-4688s-projects/itrc/2XvppVPoop8KemrXS2NpFwrhVXQi)當時均回報成功。本次又新增離任、任務協作、來源回寫、備份及排程等程式，不能沿用上述部署連結宣稱新候選也已正式發布。

### 前次真實人員匯入與後續離任確認

在前次 `/ops` 的「系統連線」，已預覽全部人員差異、勾選官網核對確認，再套用更新；介面回報「已完成：更新幹部對照」。整頁重新載入後，17 個固定幹部 ID 與姓名仍完整存在，當時是 15 筆在任、2 筆非當期名單；16 筆既有 MAIL 以不區分大小寫方式比對一致，許筠采 MAIL 留白。其後使用者明確確認許筠采（ITRC-P0017）、謝政韋（ITRC-P0013）、王方勳（ITRC-P0015）離任，已據此把主表改為 14 現任／3 已卸任，保留歷史。正式工作台／角色／官網的後續套用與拒絕存取仍需另外回讀記錄。

前次匯入記錄保存官網 `sourceUrl`、115-1 學期、2026-10-26 官網核對的來源版本，以及幹部主表的 `contactSourceUrl`。這是已核對來源的人員快照，沒有改變 Firebase 登入角色，也沒有把聯絡資料寫入公開 `members`。當時沒有建立任務、宣傳或財務記錄，未用虛構業務資料測試尚未確認隔離的後端。

Preview 的授權範圍不包含 Production。gateway 只代理四條 JSON API，不代理 Canva callback 或 cron。OIDC 用於通過部署保護，Firebase Bearer 仍由後端驗證身分；OAuth 回跳、排程與外部服務仍需各自驗收。原理參考 [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)。

## 3. 先前展示頁證據

先前在受保護 Preview 的 `/ops-demo`，已用虛構資料完成規則文案、單位確認、指定終審、測試 Canva 連結、設計校對、贊助同意證據與測試發布紀錄。重新載入後仍保留示範狀態；下載的 CSV 保留多行文案、版本、來源與證據欄位。

這些展示操作對應較早提交 `23a49b10aa8d5693229de52ce8e9fea242cf9163`，資料只存在該瀏覽器。它們驗證展示流程，不證明真實 Canva 產圖、社群發布、真實業務持久化或本輪新交件流程已實際驗收。

## 4. 正式交付前仍需完成

- 本次候選的 Production 發布與前後端配對、正式登入與權限回讀；前次受保護 Preview 不能等同這次正式啟用。
- 14 現任／3 已卸任的工作台更新、舊角色撤權、官網封存及重新載入；18 筆真實來源草稿的正式預覽、套用、回讀與去重。不得把離線格式驗證當成已匯入。
- 保持 Preview 業務唯讀，另完成真實系統資料包的下載、受限保管及隔離還原證據。獨立雲端測試資料庫仍未確認；本機測試不受此影響。
- 一個活動的來源核對、指定版本審核、可編輯 Canva、羽蓉校對及發布證據；另用一個持續專案驗證交件、退回與驗收。
- FileOS 單一正式來源、共用更新佇列、來源版本檢查與核准回寫。現行匯入是來源快照，不能當成原表已同步。
- 真實 AI／Canva／Sheets 憑證及能力、Canva 母版／欄位、OAuth callback 與返回 origin 的配對。
- GitHub OIDC 排程的真正 main workflow_dispatch 與執行紀錄；不需另收永久排程 secret。不同幹部裝置／實際帳號仍需真人操作驗收；通知管道與收件人只在要啟用對外通知時再確認。
- 舊財務第二階段工具及規則正式發布、回讀與原資料保留核對。CRM、講師、社員／出席及證書工具已存在，後續資料接合可分階段辦理。
- 內部介紹影片需依實際發布結果定稿、產製及交付；腳本或展示畫面不等於最終 MP4 已完成。

截至這份修訂，可核對的現場證據仍是前次 Preview、17 人原始匯入及後續主表離任更新。本次候選的 Production、18 筆業務匯入、完整備份／隔離還原、OIDC 排程及影片交付，須由發布維護者補上各自的實際結果。沒有為測試而簽核／入帳真實帳目或發布社群內容；外部授權與真人核准仍按原權責處理。

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
