import prisma from '../../config/db';
import { MaxKBService } from './maxkb.service';

/**
 * MaxKB 嵌入问答服务
 *
 * 目标：让本项目通过 iframe 嵌入 MaxKB 原生聊天界面，
 *      并通过 ?token=<chatUserToken> 钩子覆盖 MaxKB localStorage 里的匿名用户标识，
 *      实现"按本项目 userId 隔离对话历史"。
 *
 * 隔离机制：
 * 1. 本项目为每个 (userId, applicationId) 持有一条 UserChatSession 记录。
 * 2. chatUserToken 由 MaxKB 的 /chat/api/auth/anonymous 签发（粘性匿名用户），
 *    每个 userId + applicationId 第一次请求时签发并落库。
 * 3. 嵌入 URL 形如：
 *      ${FRONTEND_PUBLIC_URL}/chat/${accessToken}?mode=embed&token=${chatUserToken}
 *    MaxKB 路由守卫读到 ?token= 后会 setToken 覆盖浏览器 localStorage 的值，
 *    使本次 iframe 加载使用本项目持有的 chatUserToken。
 * 4. 登出 / 显式清理时删记录，下次进入会从 MaxKB 重新签发新 token。
 */
export class MaxKBEmbedService {
  /**
   * 获取嵌入问答 URL（按 (userId, applicationId) 缓存 chatUserToken）。
   */
  static async getEmbedUrl(userId: string, applicationId: string): Promise<{
    embedUrl: string;
    applicationId: string;
  }> {
    if (!userId) throw new Error('userId 不能为空');
    if (!applicationId) throw new Error('applicationId 不能为空');

    // 1. 看本项目 DB 是否已存 token
    let session = await prisma.userChatSession.findUnique({
      where: { userId_applicationId: { userId, applicationId } },
    });

    // 2. 拿 access_token（无论是否已有 session，都要先拿到 URL 拼的第一段）
    const accessToken = await MaxKBService.getApplicationAccessToken(applicationId);

    // 2.5 自动设置 access_num=0（不限访问次数），幂等操作
    try {
      const config = await MaxKBService.getConfig();
      const tokenData: any = await (MaxKBService as any).adminRequest(
        'GET', `/workspace/default/application/${applicationId}/access_token`
      );
      const tokenId = tokenData?.id;
      if (tokenId) {
        await fetch(`${config.baseUrl}/admin/api/workspace/default/application/${applicationId}/access_token/${tokenId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await MaxKBService.getAdminToken()}`,
          },
          body: JSON.stringify({ access_num: 0 }),
        });
      }
    } catch (e: any) {
      // 设置失败不影响主流程
      console.warn('[MaxKB] 自动设置 access_num=0 失败:', e.message);
    }

    // 3. 没记录 → 调 MaxKB /chat/api/auth/anonymous 签发新 token
    if (!session) {
      const chatUserToken = await this.fetchAnonymousChatUserToken(accessToken);
      session = await prisma.userChatSession.create({
        data: { userId, applicationId, accessToken, chatUserToken },
      });
    } else if (session.accessToken !== accessToken) {
      // access_token 在 MaxKB 侧被重置过，更新本地记录
      session = await prisma.userChatSession.update({
        where: { id: session.id },
        data: { accessToken },
      });
    }

    // 4. 拼嵌入 URL —— 永远带 ?token=...，让 MaxKB 路由守卫强制覆盖
    // 嵌入 URL 需要指向 MaxKB 的聊天页面，格式: {maxkbUrl}/chat/{accessToken}?mode=embed&token=...
    const maxkbConfig = await MaxKBService.getConfig();
    const publicBaseUrl = process.env.MAXKB_PUBLIC_URL || maxkbConfig.baseUrl;
    const embedUrl = `${publicBaseUrl}/chat/${accessToken}?mode=embed&token=${encodeURIComponent(session.chatUserToken)}`;

    return { embedUrl, applicationId };
  }

  /**
   * 清理某用户某个 application 的会话记录。下次进入会重新签发 chatUserToken。
   */
  static async clearSession(userId: string, applicationId: string): Promise<void> {
    await prisma.userChatSession.deleteMany({
      where: { userId, applicationId },
    });
  }

  /**
   * 清理某用户所有 application 的会话记录（登出时调用）。
   */
  static async clearAllSessions(userId: string): Promise<{ count: number }> {
    const result = await prisma.userChatSession.deleteMany({
      where: { userId },
    });
    return { count: result.count };
  }

  /**
   * 调 MaxKB /chat/api/auth/anonymous 签发粘性匿名用户 token。
   * 不带旧 Authorization header → MaxKB 会生成新 chat_user_id；
   * 想粘性复用历史需在调用方先调 ensureStickyToken。
   */
  private static async fetchAnonymousChatUserToken(accessToken: string): Promise<string> {
    const config = await MaxKBService.getConfig();
    const response = await fetch(`${config.baseUrl}/chat/api/auth/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const data: any = await response.json();
    const chatUserToken = data?.data;
    if (!chatUserToken) {
      throw new Error('MaxKB 匿名认证失败: ' + JSON.stringify(data));
    }
    return chatUserToken;
  }
}

export default MaxKBEmbedService;
