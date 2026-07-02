// Vercel serverless entry point.
// 匯入 ../index.js 匯出的 Express app 當作 handler。所有進來的請求都由 vercel.json
// 的 rewrite 導到這個函式，原始路徑（如 /api/sections）會原樣保留給 Express 路由。
module.exports = require('../index.js');
