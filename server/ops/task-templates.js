'use strict';

const LESSON_TEMPLATE_ID = 'itrc-lesson-v1';
const LESSON_TASKS = [
  ['speaker',-21,'活動組｜確認講師與時程','講師同意、聯絡窗口、日期與完整時段均有可核對紀錄。'],
  ['venue',-14,'活動組｜確認場地、車證與鑰匙','依校方流程取得場地核准；車證、鑰匙與進出方式已確認。不適用項目寫明原因。'],
  ['promotion',-7,'行銷／公關｜完成宣傳與合作確認','當前文案完成單位確認及終審，Canva 可分層編輯；需合作方審稿時留存同意證據。'],
  ['equipment',-3,'資訊組｜測試設備與錄影','投影、音訊、網路及錄影依實際需求完成測試，測試清單與備援方式可查。'],
  ['attendance',0,'管理／活動｜完成現場簽到','簽到來源與活動一致，現場名單、個資存放與後續核對負責人已確認。'],
  ['media',1,'活動／公關｜整理照片、感謝狀與交付','照片、講師感謝狀與合作交付放入指定位置；不適用項目有說明。'],
  ['finance',3,'財務／活動｜交付核銷佐證','費用及簽收佐證回到既有財務站，保留原單連結；沒有支出時明確記錄。不在工作台另建帳。'],
  ['closeout',7,'管理組｜核對活動結案資料','宣傳網址、活動紀錄、出席來源、合作交付及財務原單均可追溯，必要任務完成驗收。'],
];
function lessonTasks(event) {
  const date = Date.parse(`${event.date}T00:00:00Z`);
  return LESSON_TASKS.map(([key,offset,title,acceptanceCriteria]) => ({key,title,acceptanceCriteria,dayOffset:offset,dueDate:new Date(date + offset * 86400000).toISOString().slice(0,10)}));
}
module.exports = {LESSON_TEMPLATE_ID,lessonTasks};
