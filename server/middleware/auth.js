const jwt = require('jsonwebtoken');
const { verifyFirebaseToken, resolveRole, isSuperAdmin } = require('../firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'itrc-secret-key-change-in-production';
// 過渡期預設接受舊密碼 JWT；cutover 後在 Render 設 ALLOW_LEGACY_JWT='false' 即關閉。
// 先 trim + 轉小寫再比對，讓 'FALSE'/' false ' 等變體也能確實關閉（避免打錯字時 fail-open）。
const ALLOW_LEGACY_JWT = String(process.env.ALLOW_LEGACY_JWT ?? '').trim().toLowerCase() !== 'false';

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
        const role = resolveRole(email);
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
