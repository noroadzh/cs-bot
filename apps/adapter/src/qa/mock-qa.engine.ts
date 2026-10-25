/** MockQaEngine */
import { readFileSync, existsSync } from 'fs';
import { Injectable } from '@nestjs/common';
import { Ok, type IQAEngine, type AskReq, type AskResult, type AskResp } from '@cs-bot/shared';
import { AppLogger } from '../common/logger.js';
import { ApprovedQaService } from './approved-qa.service.js';

interface MockPair { question: string; answer: string; keywords: string[]; score: number; }

@Injectable()
export class MockQaEngine implements IQAEngine {
  readonly mode: 'mock' = 'mock';
  private readonly logger = new AppLogger('MockQaEngine');
  private pairs: MockPair[] = [];
  private readonly file: string;
  private readonly approvedQa: ApprovedQaService;

  constructor(file?: string, approvedQaService?: ApprovedQaService) {
    this.file = file ?? process.env.MOCK_QA_FILE ?? 'config/mock-qa.json';
    this.approvedQa = approvedQaService ?? new ApprovedQaService();
    this.load();
  }

  load(): void {
    try {
      if (existsSync(this.file)) {
        this.pairs = JSON.parse(readFileSync(this.file, 'utf8')) as MockPair[];
        this.logger.log({ detail: 'loaded', count: this.pairs.length });
      } else {
        this.pairs = this.defaultPairs();
        this.logger.warn({ detail: 'using-defaults' });
      }
    } catch {
      this.pairs = this.defaultPairs();
    }
  }

  async ask(req: AskReq): Promise<AskResult> {
    // 优先级 1: approved_qa（已审核 QA 始终优先于 mock 数据）
    const approved = await this.approvedQa.search(req.question);
    if (approved) {
      this.logger.log({ detail: 'approved-qa-hit', question: req.question.slice(0, 50) });
      return new Ok({ answer: approved.answer, quotes: [], score: 1.0, source: 'primary' });
    }

    const q = req.question.trim();
    let best: MockPair | null = null;
    let bestScore = 0;
    for (const pair of this.pairs) {
      const keywordHit = pair.keywords.some((kw) => q.includes(kw));
      const overlap = keywordHit ? 1.0 : this.jaccard(q, pair.keywords.join(' '));
      if (overlap > bestScore) { bestScore = overlap; best = pair; }
    }
    if (!best || bestScore < 0.3) {
      return new Ok({ answer: '抱歉，暂未找到匹配答案。', quotes: [], score: 0 });
    }
    const resp: AskResp = { answer: best.answer, quotes: [{ id: 'mock-1', content: best.answer, score: best.score }], score: best.score };
    return new Ok(resp);
  }

  private jaccard(a: string, b: string): number {
    const setA = new Set(a.toLowerCase()); const setB = new Set(b.toLowerCase());
    const intersection = [...setA].filter((c) => setB.has(c)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private defaultPairs(): MockPair[] {
    return [
      { question: '退换货政策', answer: '您好！我们的退换货政策如下：收到商品后7天内可申请退货，15天内可申请换货。退货时请保持商品完好，附带发票。客服热线：400-xxx-xxxx。', keywords: ['退', '换', '退货', '换货', '售后'], score: 0.95 },
      { question: '发货时间', answer: '您好！订单付款后，我们将在1-2个工作日内发货。偏远地区可能延迟1-2天。如有紧急需求，请联系客服。', keywords: ['发货', '快递', '物流', '几天', '多久'], score: 0.9 },
      { question: '价格优惠', answer: '您好！我们定期有促销活动，关注公众号可第一时间获取优惠信息。会员可享受积分抵扣，新用户首单享9折优惠。', keywords: ['价格', '优惠', '折扣', '便宜', '活动'], score: 0.88 },
      { question: '营业时间', answer: '您好！我们的营业时间为周一至周五 9:00-18:00，周六 10:00-16:00。周日及法定节假日休息。在线客服24小时接收留言。', keywords: ['营业', '上班', '时间', '几点'], score: 0.92 },
      { question: '联系方式', answer: '您好！联系方式如下：客服电话 400-xxx-xxxx（工作日9-18点），邮箱 support@example.com，微信公众号【XX客服】。', keywords: ['联系', '电话', '邮箱', '微信', '客服'], score: 0.93 },
      { question: '如何下单', answer: '您好！下单流程：1. 浏览商品 → 2. 加入购物车 → 3. 确认订单 → 4. 选择支付方式 → 5. 完成付款。如有疑问随时联系我们。', keywords: ['下单', '购买', '怎么买', '流程'], score: 0.85 },
      { question: '支付方式', answer: '您好！我们支持以下支付方式：微信支付、支付宝、银行卡转账、对公转账。企业客户可申请月结。', keywords: ['支付', '付款', '微信', '支付宝'], score: 0.87 },
      { question: '发票开具', answer: '您好！发票可在订单完成后申请，普通发票或增值税专用发票均可开具。请提供开票信息，3个工作日内开具并发送。', keywords: ['发票', '开票', '税'], score: 0.86 },
      { question: '会员积分', answer: '您好！每消费1元累积1积分，积分可在下次购物时抵扣（100积分=1元）。生日当月双倍积分，还有专属会员活动。', keywords: ['积分', '会员', '福利'], score: 0.89 },
      { question: '产品参数', answer: '您好！您可以点击商品详情页查看详细参数表。如需进一步说明，请提供具体商品名称或型号，我将为您详细解答。', keywords: ['参数', '规格', '型号', '详情'], score: 0.84 },
    ];
  }
}
