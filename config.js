/**
 * 漂屿前端配置文件
 *
 * 本地开发：无需修改，前端自动请求同源 /api
 * 部署上线：已配置 Render 后端地址
 *
 * 获取 Render 地址：部署完成后，在 Render Dashboard 找到 drift-island-api
 * 服务，复制其 URL，格式通常为 https://drift-island-api-xxxx.onrender.com
 */

// Render 后端地址（已部署）
window.DRIFT_API_BASE = 'https://drift-island-api.onrender.com/api';
window.DRIFT_WS_HOST = 'drift-island-api.onrender.com';
