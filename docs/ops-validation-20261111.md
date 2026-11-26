# 2026-11-11 接續修補與驗收

本紀錄區分程式修補、隔離測試、公開網站觀察與登入後的正式業務驗收。**本輪未完成整套系統正式驗收。** 不把測試通過、GitHub/Vercel 狀態成功或畫面可開啟當成外部整合與資料搬移已完成。

## 基線與正式現況

- 從 GitHub 重新取得乾淨 checkout，修補前與提交前的 `main` 均為 `31fde05bec5ffd23e30a87eeb19df4685e48e2cf`。保留先前其他人的提交與舊工作目錄。
- 正式網站為 `https://nsysu-itrc.vercel.app/ops`；API 為 `https://itrc-eight.vercel.app/api`。本輪匿名讀取 `/api/health` 成功，但原回應沒有提交版號，因此不能從健康狀態確認目前正式部署 SHA。
- 使用者本日的已登入檢查：工作台可開啟、操作紀錄 30 筆由新至舊且有操作者 email、財務共用帳本可讀、指導教授封之遠及 115-1 課表已更新。這些成果保留；本輪操作環境未共享該登入狀態，未將使用者的證據寫成自己重新驗收。
- 本輪開啟正式 `/ops` 進入登入頁；Google 帳號選擇畫面顯示尚未登入。沒有擷取瀏覽器憑證或略過 Firebase 身分驗證。
- 指定 Vercel 團隊的 connector 讀取回傳 403，要求團隊存取授權。因此未能讀取最新正式專案設定、環境變數清單、部署別名與提交配對；沒有改用其他團隊部署。
- 從既有發布紀錄找回原工具網域 `https://itrc-tools.vercel.app`。本輪 HTTP 實測根路徑 `/ITRC管理組-任務看板.html` 回傳 200 舊 HTML，`/tools/ITRC管理組-任務看板.html` 回傳 404；兩者均未證明已導向工作台。

歷史平台設定記錄後端 Production branch 為 `feat/vercel-serverless-migration`，舊工具為 `fix/legacy-tools-hardening-20261026` 且手動提升正式網域。本輪 GitHub 可見分支仍存在，但分支存在不等於平台設定未變。未核對正式部署前不得宣稱已使用修補版；舊工具提升必須等正式搬移驗收完成。

## 實際修改

### 1. 可重現且保留證據的舊看板搬移

新增 `scripts/migrate-legacy-board.cjs` 與離線證據驗證器 `scripts/verify-legacy-board-migration.cjs`。CLI 使用既有正式 API 和已授權的使用者身分，不讀伺服器環境檔、Firebase service account 或瀏覽器儲存區。

執行流程包括當前完整來源與目標備份、bootstrap 一致性核對、當前人員映射、伺服器逐欄預覽、隔離還原、apply 前再次備份與版本比對、單次 apply、完整回讀，以及使用**新的 idempotency key** 再次預覽及 apply。證據資料夾為私人權限且被 git 忽略；不將真實任務、幹部名單、資料庫備份或 token 提交至公開 repo。

驗證會保留所有既有任務、活動、宣傳與人員，核對沒有額外新增或變更。既有同來源鍵資料不覆寫：報告分開列出「回讀存在」、「本輪新建且逐欄吻合」、「保留的既有資料」及來源差異欄位，不能把資料存在寫成內容完全吻合。寫入回應不明時停止重送，改保留只讀核對證據與回復清單。

來源與 SQLite 目標沒有跨系統全域鎖；此工具以 apply 前後快照核對偵測變化，不宣稱原子鎖定舊 Firebase 看板。備份可隔離還原，但沒有自動在正式環境刪除記錄或回灌全部資料。

### 2. 匯入畫面與示範行為

- 顯示伺服器正規化後的全部預覽列、狀態、完整備註、負責人及來源追溯；不再只列前 10 筆。
- 新增筆數與重複略過分開，正式完成訊息依 apply 的回應計數；全為重複時停用新增按鈕。
- 變更來源清除舊預覽；請求進行中停用相關輸入，並用請求版次拒收過期回應。
- 示範匯入同樣以來源鍵去重，且要求示範顧問角色；仍只用虛構資料，不能呼叫正式外部服務。

### 3. 外部服務驗證

- Canva 建立後先保存 provider job ID。作業成功須再 GET 讀回同一設計，核對 ID 與可編輯網址；讀回失敗重試同一作業，避免多建設計。另一設計的永久網址、檢視網址、錯誤 host 或不合格式網址都拒絕。
- Google Sheets 必須配置有效且有界限的具名來源、唯讀身分、標題與永久 `sourceKey` 欄位。空設定、壞 JSON 或只有來源 ID 清單不再被判為可用。
- Sheets 預覽拒絕空白／重複來源鍵及重複欄名，保留原有固定鍵；追溯包含來源工作表、A1 列範圍與擷取時間。標題改名或列順序調整不會新增副本。不同來源的同類型記錄也須使用全域唯一固定鍵。
- 補齊 `server/ops/provider-setup.md` 與六欄 Canva 範例映射 `docs/canva-field-map.three-page.json`。未增加一般任務審核層級，文案仍只確認一次。

### 4. 舊入口與版本辨識

- 舊工具轉址產生器與測試補齊根路徑、`/tools/` 兩種別名；`client/vercel.json` 未改動。
- 前端建置產生 `/release.json`，API `/api/health` 增加 component、release、revision，供真正發布後核對兩個獨立部署。資料只含公開程式版號，不含環境設定值。
- 未提交的本機工作目錄以 `revision:null`、`provenance:uncommitted-worktree` 表示，不冒報 Git HEAD 就是建置內容。
- CI 增加搬移與重複匯入保護測試。沒有將搬移 CLI 掛入啟動、建置或排程，也沒有修改 investment-game。

## 真正執行的測試

環境為 Node.js **22.20.0**。下列群組分別記錄，包含子集時不相加成完成率。

| 群組 | 結果 | 證據範圍 |
| --- | --- | --- |
| 後端全部測試 | **145/145，0 skipped** | 隔離 libSQL、身分、權限、一般流程、版本、來源、備份、OAuth、工作佇列及模擬 provider HTTP。 |
| 前端 model/demo 與課表 | **29/29** | 任務三態、活動與宣傳、匯入 17 筆及重跑、來源鍵、示範邊界與既有課表。 |
| 搬移工具與來源轉換 | **19/19** | 17 筆搬移、兩筆一般任務保留、全新請求鍵重跑 0 新增/17 重複；來源／人員／目標變化、未知寫入結果與逐筆回讀失敗。 |
| 舊財務、雲端規則與統一入口 | **35/35** | 財務與角色規則 30 項、統一入口與兩種路徑 5 項；與上列搬移測試同輪執行共 54 項。 |
| 工作台 proxy | **23/23** | 模擬上游、固定目標、認證/header 邊界及失敗不重試。 |
| Firebase Database Emulator | **42/42** | 官方 Emulator 4.11.2、獨立 namespace、虛構申請／簽核／拒絕／入帳／角色；47 筆虛構歷史列保留，正式連線 0。 |
| Vite production build | **通過** | 建置完成，保留原有 bundle 大小提示。建置通過不代表正式網域切換。 |
| 公開網站練習版 UI | **通過所列情境** | `/ops-demo` 中只填標題建立明確標示的虛構任務，待辦→進行中→打勾完成→回到待辦，各步重新載入仍保存；不等於正式 API 寫入驗收。 |

後端的實際 DB 測試包括每步關閉並重新連線後讀回一般任務，以及一次文案確認、設計工作與活動／宣傳／相關任務關係。外部 AI、Canva、Google 的 HTTP 為模擬回應，不能當作正式串接成功。

財務 Emulator 覆蓋本人／他人申請讀取、自簽拒絕、駁回原因、禁止跳過狀態重新核准、憑證與稽核保留、原子入帳及重複入帳拒絕。未新增真實核銷、簽核、帳目、付款或通知；尚未重新讀取正式規則與在任角色對照。

## 資料與外部整合完成界線

| 項目 | 狀態 | 已做與剩餘 |
| --- | --- | --- |
| 17 筆舊任務 | **受阻，正式 apply 未執行** | 找回 2026-10-26 備份與離線轉換檔：15 待辦、1 進行中、1 完成；歷史映射 7 筆在任指派、10 筆未指派。仍須登入取得最新正式備份並重新核對。現有兩筆一般任務不是這 17 筆。 |
| Canva | **受阻，網站端到端未完成** | 找到既有可編輯母版但 dataset 為空；另建測試副本與三頁六個可編輯文字欄位草稿，尚未提交。工具要求先展示預覽並取得明確同意後才能 commit。網站 OAuth、權益與真正 autofill 仍待驗證。 |
| AI 文案 | **受阻，真實模型未呼叫** | 一次確認流程與錯誤處理已測；未取得網站後端的可用 key/model 設定，不把 rules 草稿算成 AI。 |
| Google Sheets | **受阻，網站串接未完成** | 透過既有 Google connector 唯讀核對真正排程表；所讀活動組與發文總覽沒有固定來源識別欄，日期不是完整 ISO 日期。原表未改動，需保留既有來源鍵的對照／獨立正規化來源，再以網站身分驗收。 |
| 舊工具入口 | **未完成** | 真實舊網域已找回並測到 200/404；修補路由已準備。正式搬移完整性確認前不提升舊工具部署。 |
| 功能驗收 | **隔離測試完成，正式驗收未完成** | 一般任務 UI 練習版與持久化後端測試、活動宣傳關係、財務及角色規則均有隔離證據；登入後的修補版 UI、三項外部服務與正式版本配對尚待驗證。 |

## 憑證與使用者操作界線

具體設定名稱、回呼與最低權限見 [provider-setup.md](../server/ops/provider-setup.md)。需要的是網站後端自己的連線，不是 ChatGPT connector token。既有 Vercel 存取恢復後，先核對當前設定，只補確實缺少的項目，不覆寫其他人的更新。機密只放平台秘密設定，不貼入聊天或 repo。

Canva 要求網站 OAuth client/secret、精確 callback、32-byte Base64 加密金鑰、前端 origin、母版與匹配的欄位設定；AI 要求明確的 API key/model；Sheets 要求唯讀服務身分、來源分享及具名欄位設定。帳戶現有權益不明時不得自行升級付費。

本輪尚需本人完成的集中事項為：指定 Vercel 團隊存取授權、此操作環境中的正式網站登入、Canva 草稿的明確儲存同意，以及缺少時提供網站整合所需的既有服務憑證／OAuth。沒有要求逐個技術步驟重新批准。

## 重現命令

```bash
npm --prefix server test
node --test --experimental-test-isolation=none client/src/ops/*.test.js client/src/utils/courseInfo.test.js
node --test --experimental-test-isolation=none client/server/ops-proxy.test.mjs
node --test scripts/prepare-legacy-board-import.test.cjs scripts/migrate-legacy-board.test.cjs scripts/test-legacy-finance.cjs scripts/test-legacy-cloud.cjs scripts/test-unified-tools.mjs
npm --prefix client run build
```

官方 Emulator 的執行要求及本輪新增案例見 `scripts/test-finance-emulator.cjs`。正式資料搬移的可執行命令與保管要求見 [ops-runbook.md](ops-runbook.md#10-舊看板正式搬移與回讀2026-11-11)。本文件不包含私人來源內容或憑證。
