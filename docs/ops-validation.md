# 工作台驗收紀錄

日期：2026-10-25（Asia/Taipei）。

## 已完成

| 項目 | 結果 |
| --- | --- |
| 後端自動測試 | 59 項通過，包含真實本機 libSQL 持久化與 HTTP 身分／排程驗證；外部供應服務使用模擬回應。 |
| 前端資料處理測試 | 本輪重跑 6 項全部通過，包含 CSV 引號、換行、中文欄位、示範角色、去重及匯出公式防護。 |
| 同網域 gateway 測試 | 22 項通過，包含路由／方法、原始及 rewrite URL、固定 origin、請求與回應大小、OIDC 來源、憑證回顯防護、重新導向阻擋與逾時不重試；全部使用模擬上游，未發送外部請求。 |
| 正式前端建置 | 本輪以 `VITE_OPS_API_URL=/api` 建置通過；工作台採用獨立載入，瀏覽器 assets 未見 OIDC／server-only env 字串。此結果不代表 gateway 已部署或後端已連通。 |
| 獨立交叉檢查 | 已修正已發布內容遭舊工作覆寫、專案贊助要求漏帶、跨負責人活動關聯及展示模式判斷問題。 |
| GitHub 自動檢查 | 初版提交 `5d5facffa7fe20c628af3d5387e5f7962716f68f` 的 Operations checks 通過。後續提交以 PR 最新檢查為準。 |
| Vercel Preview | 前端與後端初版均回報部署完成。其後前端重新部署 `CTczcExgoUK7qP4Atw3U2frAH9jk` 為 Ready；部署完成不代表工作台 API 已連通。 |
| Firebase 授權網域 | 使用者明確批准後，已新增前端穩定分支網域 `nsysu-itrc-git-feature-it-9eeefc-zhongshantouyan-4688s-projects.vercel.app`。 |

## 桌面瀏覽器展示流程

使用者完成 Vercel 登入後，已在受保護 Preview 的 `/ops-demo` 驗證以下操作，對應提交為 `23a49b10aa8d5693229de52ce8e9fea242cf9163`。測試使用虛構資料與示範角色，資料只留在瀏覽器；未呼叫真實 AI、Canva 或社群發布服務，也未變更或繞過 Preview 保護設定。

| 檢查 | 實際結果 |
| --- | --- |
| 文案草稿 | 產生規則草稿 v2，包含 3 頁輪播文字。 |
| 單位確認與終審權限 | 活動角色送交並完成單位確認；終審按鈕保持停用，顯示「由指定終審帳號核准」。切換指定示範終審角色後，可核准 v2，建立 1 項設計工作。 |
| 設計交件 | 切換示範設計角色，登錄測試用 Canva 網址，完成設計校對。 |
| 贊助審稿與發布證據 | 贊助要求在明確登錄測試同意證據前持續阻擋下一階段；完成後登錄測試發布網址與日期，狀態顯示「已發布」。 |
| 宣傳總表下載 | 實際下載 CSV，解析為 1 筆資料、40 欄；多行文案保留在同一格，版本、Canva 與發布證據欄位符合畫面紀錄。 |
| 瀏覽器本機保存 | 重新載入後仍保留示範設計角色，宣傳 01 保持「已發布」，流程總覽顯示已發布 1 則。此結果僅驗證展示資料的瀏覽器本機保存。 |
| 展示稽核紀錄 | 頁面依序列出產生草稿、送單位確認、單位通過、終審通過、登錄設計、設計通過、贊助同意證據及發布等 8 項操作，包含操作者、時間及記錄版本由 v1 至 v9 的遞增。 |

## 真實環境檢查與已授權設定變更

同日檢查分支 Preview 與專案設定，並完成使用者已批准的 Firebase 授權網域設定。以下區分登入、部署及後端連通的證據。

| 檢查 | 實際結果與範圍 |
| --- | --- |
| 後端 HTTP 健康端點 | 直接開啟後端分支 Preview 的 `/api/health`，於 `2026-10-25T09:39:13Z` 取得 JSON `status: ok`。此結果只證明該 HTTP 健康端點可回應，未驗證工作台 API 或資料庫持久化。首次伺服器冷啟動可能建表／遷移；若 `OPS_WORKER_ENABLED=true`，程序也可能自動執行既有工作，因此不能宣稱這次 HTTP 檢查完全零寫入。 |
| 真實帳號登入 | 初次出現 `auth/unauthorized-domain`；完成上述網域授權後，既有 Google 帳號已成功登入 `/ops`，可見登出與後台入口。這些前端訊號尚未證明後端角色或終審權限。 |
| 後端變數清單 | Vercel 後端專案在 All Types／All Variables 篩選下顯示 8 個既有變數，包含 `FIREBASE_SERVICE_ACCOUNT`、`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`；該清單未顯示 `OPS_`、`CANVA_`、`OPENAI_`、`GOOGLE_SHEETS_` 前綴的變數。未據此判定所有共用或繼承設定均不存在。 |
| 最初 API 404 | Vercel request logs 證實前端仍呼叫舊正式位置 `https://itrc-eight.vercel.app/api/ops/bootstrap`，未連到本輪後端 Preview。 |
| 改址與重新部署 | 前端分支專用 `VITE_API_URL` 改為 `https://itrc-git-feature-itrc-int-159353-zhongshantouyan-4688s-projects.vercel.app/api`，重新部署 `CTczcExgoUK7qP4Atw3U2frAH9jk` 為 Ready；畫面仍顯示 Network Error，後端 request logs 未見新的應用請求。尚不能據此判定工作台 API 已接通。 |
| 後端 Deployment Protection | 實際設定為 Standard Protection／Require Log In 開啟、OPTIONS Allowlist 關閉、Trusted Sources 僅自身專案。尚未修改保護設定；前端登入不會自動授權跨專案服務呼叫。 |
| 同網域 gateway | 已完成 `client/api/ops.js` 與 helper：只代理 bootstrap、actions、Canva 狀態及啟動授權的 JSON 請求；用 `@vercel/oidc@4.0.3` 取得伺服器短期 OIDC，仍保留後端 Firebase 身分／角色驗證。22 項模擬測試通過；實際部署與連通仍待驗收。 |
| 工作台專用前端設定 | 已儲存 `VITE_OPS_API_URL=/api`，以及 `OPS_BACKEND_ORIGIN=https://itrc-git-feature-itrc-int-159353-zhongshantouyan-4688s-projects.vercel.app`；兩者僅適用 `feature/itrc-integrated-ops-20261025` 分支，仍待包含 gateway 的部署驗收。前端 OIDC 安全頁原已顯示 Team issuer，本輪未改動。 |
| 待確認的信任規則 | 僅準備 `nsysu-itrc` 的 Preview → `itrc` 的 Preview，等待使用者確認，尚未提交。不得把這項準備記為已授權或已連通。 |
| 正式部署分支 | Vercel 後端 Production Branch 顯示 `feat/vercel-serverless-migration`，本輪未改動。合併 `main` 不等於後端正式部署；上線前須核對前後端各自的部署分支與版本。 |

工作台將獨立使用 `VITE_OPS_API_URL=/api`，由前端伺服器的 `OPS_BACKEND_ORIGIN` 固定指向對應後端 origin；未設定專用值時才回退到 `VITE_API_URL`。其他 CMS 的程式仍沿用 `VITE_API_URL`，但本輪暫設的分支覆寫仍指向受保護後端，尚未移除／恢復；Vercel Edit 要求電子郵件重新驗證，Rotate 可能影響其他適用範圍，已取消。待處理項目是僅移除此輪新增的分支專用覆寫，回到原 All Environments 設定，尚未執行。信任規則與 OIDC 用法參考 [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)。

本輪沒有匯入真實業務資料；這不等於保證伺服器啟動或既有背景工作完全沒有資料庫寫入。

## 尚不能標記完成

手機畫面與操作仍待驗證。真實 Firebase 登入已成功，但後端角色權限、同網域 gateway、Preview 信任規則、前後端環境配對、工作台 API 及真實資料庫持久化仍待實際驗收。示範角色切換不能取代這些驗收。

正式帳號權限、Canva OAuth 與母版欄位、選用 AI／Sheets 憑證及工作排程，仍需完成部署設定與實際驗收。gateway 不代理 Canva callback 或 cron；Canva 的後端 `CANVA_REDIRECT_URI` 與 `OPS_FRONTEND_ORIGIN` 仍須配對，OIDC 代理通過不代表 OAuth 回跳可用。展示流程與自動測試通過不代表外部服務已連接，測試網址也不代表已產生真實設計或對外發布。

## 重現

```bash
npm --prefix server test
node client/src/ops/model.test.js
node --test --test-isolation=none client/server/ops-proxy.test.mjs
VITE_OPS_API_URL=/api npm --prefix client run build
```

完整啟用流程見 [ops-runbook.md](ops-runbook.md)。變更與最新自動檢查見 [PR #2](https://github.com/zhongshantouyan-cmyk/ITRC/pull/2)。
