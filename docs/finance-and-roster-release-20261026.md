# 財務逐筆授權、離任封存與整合入口

## 本次可發布內容

- 工具站首頁新增正式社務工作台入口 `https://nsysu-itrc.vercel.app/ops`，保留各組工具。
- 角色即時監聽：`retired`、`inactive`、`已卸任`、停用旗標或空角色都不授權；離任即清空角色，既有 ID 與工作歷史保留。個人身分不再只於登入時查一次。
- 幹部匯入改為合併更新，辨識主表固定幹部 ID、LINE 名稱、組別、任期、在任狀態；不在匯入中的人員保留。職稱不授權、新人預設無權限；離任者不因下一次主表匯入而復權。
- 幹部寫入使用交易，預覽匯入綁定當時名單；衝突需重新預覽。拒絕或連線錯誤不改成本機資料、不顯示成功。換屆快照保留全部欄位並以新 key 保存。
- 核銷逐筆寫入，保留舊數字 key；新申請採固定唯一 key。一般幹部以 `byUid` 查詢自己的核銷；簽核／財務人員才讀取整份清單。
- 申請人不能核准或退回自己的核銷，共用社團帳號亦同。審核只能改狀態與審核證據，不能改原金額、收款帳戶或收據。
- 核銷入帳用一次多路徑原子更新，同時建立 `finance/ledger/reimb_<claimKey>` 與核銷 `posted` 狀態。只寫一邊會被規則拒絕。固定單號、資料規則與失敗後核對避免重複入帳。
- 手動分錄可填原因作廢，保留原金額與證據；作廢不計入總額。核銷分錄保留原單，改由調整分錄更正。已入帳／退回的核銷與收據不再提供批次永久清除。
- 財務長可下載 JSON 財務快照，內含兩份財務資料及收據。這是財務快照，不是全系統備份；還原仍須先在隔離環境核對。
- 所有成功訊息等待雲端確認；失敗保留表單。登出或讀取權限被撤銷會清除財務記憶體資料並卸除訂閱。
- 使用說明同步更新，不再指示整份覆蓋名單、清除核銷證據或把共用帳號當成不同真人簽核。

## 不需資料遷移

現有 `finance/ledger`、`finance/reimbursements` 原址保留；既有陣列的數字子鍵原封不動，新資料以唯一字串子鍵追加。讀取支援陣列或鍵值物件，不會轉寫 47 筆既有明細。正式測試不要新增、簽核、作廢、入帳或刪除任何真實帳目。

## 發布順序

1. 發布完整新版靜態 `legacy-tools/`（新增 `itrc-finance.js`、`itrc-roster.js` 必須一起發布）。
2. 以原有核准的名單建立 finance 規則，僅置換現有規則 `rules.finance`，保留根層 `.read:false`、`.write:false` 與其他路徑。
3. Firebase 規則編輯器解析成功後發布並回讀。若規則尚未發布，不得宣稱資料層已完成財務分權。
4. 舊分頁請重新整理。舊版財務 UI 會嘗試 parent 整份讀／寫；新規則會拒絕，不能誤寫或回退狀態。可先顯示權限錯誤，重新整理後新版使用自己的查詢或逐筆寫入。
5. 以現有社團身分唯讀確認收支仍有原 47 筆、角色／名單可讀。登入憑證與私人信箱不記錄到公開文件。
6. 在「幹部與權限」對確認離任的人按「離任封存」，確認現任計數及歷史列；再核對根 allowlist 未包含這些帳號。這次既有 allowlist 已排除三名離任者，無需擴增帳號。

## 規則產生器

`scripts/build-finance-rules.cjs` 匯出：

- `buildFinanceRules({members, superAdmins, financeApprovers, ledgerWriters})`：只建立 finance 子樹。
- `mergeFinanceRules({...上列欄位, existingRules})`：根層有任何廣泛讀寫授權會拒絕；保持其他路徑原樣。
- `buildFinanceRuleTemplate()`：輸出無私人資料的三個條件佔位符版本，結果另存 `docs/finance-rules-template.json`。此佔位符版本不可直接發布。

各能力帳號必須已在 members 中，函式拒絕藉財務設定增加新帳號。每個條件都要求已驗證 Email，採小寫比對。批准人應為既有正副社長與社團保管帳號；帳務寫入者沿用原 ledger allowlist。

### 在既有瀏覽器記憶體套用模板

先將 `docs/finance-rules-template.json` 的完整公開 JSON 賦值給 `actFinanceTemplate`。只在已核對仍為本屆三位管理者與兩位帳務寫入者的前提下，以下差集才代表正副社長；未核對時需提供明確批准人清單。這段不列印、不寫出私人名單。

```js
var actFoldEmail = x => String(x).trim().toLowerCase();
var actClub = ['zhongshantouyan@gmail.com'];
var actFinanceApprovers = actManagers.filter(x =>
  !actLedgerWriters.some(y => actFoldEmail(x) === actFoldEmail(y)));
var actFinanceConditions = {
  '__ITRC_MEMBER__': '(' + actCondition(actPrivateMembers) + ')',
  '__ITRC_REVIEW__': '(' + actCondition([...actFinanceApprovers, ...actClub]) + ')',
  '__ITRC_TREASURY__': '(' + actCondition([...actLedgerWriters, ...actClub]) + ')'
};
function actResolveFinanceTemplate(value) {
  if (typeof value === 'string') {
    for (var marker of Object.keys(actFinanceConditions))
      value = value.split(marker).join(actFinanceConditions[marker]);
    return value;
  }
  if (Array.isArray(value)) return value.map(actResolveFinanceTemplate);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, actResolveFinanceTemplate(item)]));
  return value;
}
var actFinanceRuleDraft = typeof actRulesDraft === 'string'
  ? JSON.parse(actRulesDraft) : JSON.parse(JSON.stringify(actRulesDraft));
if (actFinanceRuleDraft.rules['.read'] !== false || actFinanceRuleDraft.rules['.write'] !== false)
  throw new Error('Root rule grants must remain denied');
actFinanceRuleDraft.rules.finance = actResolveFinanceTemplate(actFinanceTemplate);
var actFinanceRuleText = JSON.stringify(actFinanceRuleDraft, null, 2);
if (actFinanceRuleText.includes('__ITRC_')) throw new Error('Unresolved template');
// 將 actFinanceRuleText 填入現有規則編輯器，使用原 UI 發布、回讀比對。
```

## 驗證結果

Node 22.20.0：`node --test --experimental-test-isolation=none scripts/test-legacy-cloud.cjs scripts/test-legacy-finance.cjs`，**30 項通過**。涵蓋原登入回歸、財務失敗不報成功、合併名單、離任停權、不可復權、固定 ID 衝突、金額及附圖、舊數字 key、固定單號、資料條件、事件參數防注入。

使用官方 Firebase Database Emulator **4.11.2**，下載 SHA-256 與 firebase-tools 官方資訊相符：`b70d99344caf17c98b6f910fa8f6edf32a7c016cb1035e8915f70d38901eb97f`。在 `127.0.0.1:9900` 與 `demo-itrc-finance` 跑 `scripts/test-finance-emulator.cjs`，**34 項情境通過**，正式連線 0。

實際 Emulator 已驗證規則編譯、匿名／非名單／未驗證信箱拒絕、本人建立申請、拒絕代填 UID／預核准、普通幹部整份讀取拒絕、自己的查詢允許、他人的查詢拒絕、拒絕修改已送出金額、禁止自簽、非財務不能入帳、兩種單邊入帳均拒絕、原子多路徑入帳成功、重送拒絕、保留 47 筆虛構歷史、禁止刪除／全資料覆蓋、合法手動新增、拒絕無效金額及帶原因作廢。

參考來源：Firebase 官方 [條件及查詢規則](https://firebase.google.com/docs/database/security/rules-conditions)、[規則層級及原子性](https://firebase.google.com/docs/database/security/core-syntax)、[firebase-tools 模擬器版本資訊](https://github.com/firebase/firebase-tools/blob/master/src/emulator/downloadableEmulatorInfo.json)。本文件不把本機模擬結果描述成正式財務業務已經操作。
