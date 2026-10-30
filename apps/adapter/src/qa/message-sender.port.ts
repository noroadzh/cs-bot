/**
 * IMessageSender
 * QaOrchestrator 与下游企微客户端之间的抽象端口。
 * 打破 QaModule → WecomModule 的直接类依赖，消除 Qa → Wecom → Qa 循环。
 */
export const IMessageSender = Symbol('IMessageSender');

export interface IMessageSender {
  sendText(chatId: string, content: string, atUser?: string, clientMsgId?: string): Promise<void>;
  /**
   * 素材外发：link 传 URL，file/video 传落盘文件绝对路径；title 为素材展示名。
   */
  sendAsset(chatId: string, target: string, type: 'link' | 'file' | 'video', title?: string): Promise<void>;
}
