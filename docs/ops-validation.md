# 工作台驗收紀錄

日期：2026-10-25。

## 已完成

| 項目 | 結果 |
| --- | --- |
| 後端自動測試 | 59 項通過，包含真實本機 libSQL 持久化與 HTTP 身分／排程驗證；外部供應服務使用模擬回應。 |
| 前端資料處理測試 | 6 項通過，包含 CSV 引號、換行、中文欄位、示範角色、去重及匯出公式防護。 |
| 正式前端建置 | 通過；新增工作台採用獨立載入。 |
| 獨立交叉檢查 | 已修正已發布內容遭舊工作覆寫、專案贊助要求漏帶、跨負責人活動關聯及展示模式判斷問題。 |
| GitHub 自動檢查 | 初版提交 `5d5facffa7fe20c628af3d5387e5f7962716f68f` 的 Operations checks 通過。後續提交以 PR 最新檢查為準。 |
| Vercel Preview | 前端與後端初版均回報部署完成。 |

## 尚不能標記完成

前後端 Preview 均受 Vercel 登入保護。瀏覽器抵達「Log in to Vercel」頁；唯讀 HTTP 檢查也被導向登入頁。因此目前沒有宣稱桌面／手機畫面、真實後端健康端點或完整登入後操作已通過驗收。沒有變更或繞過保護設定。

正式帳號權限、Canva OAuth 與母版欄位、選用 AI／Sheets 憑證、前後端環境配對及排程，仍需完成一次部署設定與實際驗收。測試通過不代表這些外部服務已連接。

## 重現

```bash
npm --prefix server test
node client/src/ops/model.test.js
npm --prefix client run build
```

完整啟用流程見 [ops-runbook.md](ops-runbook.md)。變更與最新自動檢查見 [PR #2](https://github.com/zhongshantouyan-cmyk/ITRC/pull/2)。
