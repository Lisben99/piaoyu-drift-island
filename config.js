/**
 * 漂屿前端配置文件
 *
 * 本地开发：无需修改，前端自动请求同源 /api
 * 部署上线：已配置 Render 后端地址
 *
 * 获取 Render 地址：部署完成后，在 Render Dashboard 找到 drift-island-api
 * 服务，复制其 URL，格式通常为 https://drift-island-api-xxxx.onrender.com
 *
 * 自定义域名说明：
 * - 若前端使用自己的域名（如 www.piaoyuisland.xyz），API 仍默认走 Render。
 * - 若后续把 Render 后端也绑了自定义域名（如 api.piaoyuisland.xyz），
 *   请把下面 DRIFT_API_BASE / DRIFT_WS_HOST 改成你的域名即可。
 */

(function () {
  const renderApi = 'https://drift-island-api.onrender.com/api';
  const renderWs = 'drift-island-api.onrender.com';

  // 如果当前页面是自己的域名，并且你已为 Render 后端配置了 api.域名，
  // 可以取消下面注释让前端自动走 api.piaoyuisland.xyz / wss://api.piaoyuisland.xyz
  // const host = location.hostname;
  // if (host.includes('piaoyuisland.xyz')) {
  //   window.DRIFT_API_BASE = 'https://api.piaoyuisland.xyz/api';
  //   window.DRIFT_WS_HOST = 'api.piaoyuisland.xyz';
  //   return;
  // }

  window.DRIFT_API_BASE = renderApi;
  window.DRIFT_WS_HOST = renderWs;
})();
