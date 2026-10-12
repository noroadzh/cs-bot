/**
 * IMessageSender
 * QaOrchestrator 与下游企微客户端之间的抽象端口。
 * 打破 QaModule → WecomModule 的直接类依赖，消除 Qa → Wecom → Qa 循环。
 */
export const IMessageSender = Symbol('IMessageSender');

export interface IMessageSender {
  sendText(chatId: string, content: string, atUser?: string): Promise<void>;
  sendAsset(chatId: string, assetId: string, type: 'link' | 'file' | 'video'): Promise<void>;
}
