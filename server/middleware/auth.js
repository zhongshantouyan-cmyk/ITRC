const jwt = require('jsonwebtoken');
const { verifyFirebaseToken, resolveRole, isSuperAdmin } = require('../firebase');

const JWT_SECRET = process.env.JWT_SECRET;
// 過渡期預設接受舊密碼 JWT；cutover 後在部署平台設 ALLOW_LEGACY_JWT='false' 即關閉。
// 先 trim + 轉小寫再比對，讓 'FALSE'/' false ' 等變體也能確實關閉（避免打錯字時 fail-open）。
const ALLOW_LEGACY_JWT = String(process.env.ALLOW_LEGACY_JWT ?? '').trim().toLowerCase() !== 'false';
// 防呆：舊密碼 JWT 路徑開啟時一定要有真的 JWT_SECRET，否則寧可大聲崩，也不要靜默用可被偽造的預設值。
if (!JWT_SECRET && ALLOW_LEGACY_JWT) {
    throw new Error('[FATAL] JWT_SECRET is required when ALLOW_LEGACY_JWT is enabled (unset = enabled). Set JWT_SECRET, or set ALLOW_LEGACY_JWT=false to disable the legacy password-login path.');
}

async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未提供驗證 token' });
    }
    const token = authHeader.split(' ')[1];

    // 1) 先當作 Firebase Google ID token 驗證（新的統一登入）
    try {
        const decoded = await verifyFirebaseToken(token);
        const email = decoded.email || '';
        const role = await resolveRole(email);
        if (!role) {
            return res.status(403).json({ error: '此帳號尚未被授權存取管理後台', email });
        }
        req.user = {
            uid: decoded.uid,
            email,
            name: decoded.name || decoded.email,
            role,
            superAdmin: isSuperAdmin(email),
        };
        return next();
    } catch (fbErr) {
        // 不是有效的 Firebase token → 落到舊 JWT 流程
    }

    // 2) 舊密碼登入的 JWT（過渡期相容，cutover 後關閉）
    if (ALLOW_LEGACY_JWT) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (jwtErr) {
            // 落到最後的 401
        }
    }

    return res.status(401).json({ error: 'Token 無效或已過期' });
}

module.exports = { authMiddleware, JWT_SECRET };
