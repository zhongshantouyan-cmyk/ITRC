// One catalog drives the workspace, bundled tool pages and old-link redirects.
// Keep the ids stable: existing links and personal bookmarks use them.
export const WORKSPACE_ORIGIN = 'https://nsysu-itrc.vercel.app';

export const CLUB_TOOLS = [
  { id: 'finance', title: '財務', group: '財務', description: '收支、核銷申請、簽核與入帳。', file: 'ITRC財務站.html' },
  { id: 'speakers', title: '講師與排程', group: '活動', description: '維護講師邀約、學期課程與活動安排。', file: 'ITRC活動組-講師池排程.html' },
  { id: 'sponsors', title: '合作與贊助', group: '公關', description: '追蹤合作案件、贊助進度與交付紀錄。', file: 'ITRC公關拉贊助小幫手.html' },
  { id: 'marketing', title: '圖文工具', group: '行銷', description: '整理貼文、圖卡文字、發文排程與素材。', file: 'ITRC圖文小幫手.html' },
  { id: 'certificates', title: '證書製作', group: '活動', description: '使用名單、背景模板與疊字設定產出證書。', file: 'ITRC證書產生器.html' },
  { id: 'permissions', title: '幹部權限', group: '管理', description: '維護登入角色、名單匯入與離任紀錄。', file: 'ITRC管理組-幹部與權限.html' },
  { id: 'maintenance', title: '維護手冊', group: '資訊', description: '查看維運、資料保存與交接說明。', file: 'ITRC資訊組維護手冊.html' },
  { id: 'help', title: '操作說明', group: '共用', description: '查看各工具的使用方式與日常操作。', file: '使用說明.html' },
  { id: 'board', title: '歷史任務看板', group: '管理', description: '保留原看板的歷史資料；日常派工使用工作台任務。', file: 'ITRC管理組-任務看板.html', hidden: true, workspacePath: '/ops?view=tasks&source=legacy' },
].map(tool => Object.freeze({ ...tool, path: `/tools/${tool.id}.html`, workspacePath: tool.workspacePath || `/ops?tool=${tool.id}` }));

export function findClubTool(id) {
  return CLUB_TOOLS.find(tool => tool.id === id) || null;
}

export function legacyToolRoutes() {
  const routes = { '': { path: '/ops' }, 'index.html': { path: '/ops' } };
  for (const tool of CLUB_TOOLS) {
    const route = { path: tool.workspacePath, toolId: tool.hidden ? null : tool.id };
    routes[tool.file] = route;
    routes[`${tool.id}.html`] = route;
  }
  return routes;
}
