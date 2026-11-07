import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const root = process.cwd();
let pendingAssistantOutput = null;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try { send(res, 200, await readFile(join(root, 'index.html'), 'utf8'), 'text/html; charset=utf-8'); }
    catch { send(res, 500, { error: '网页文件读取失败。' }); }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/assistant-output') {
    const output = pendingAssistantOutput || {};
    pendingAssistantOutput = null;
    send(res, 200, output);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/assistant-output') {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const result = JSON.parse(raw);
      if (!result || typeof result.resumeText !== 'string' || !result.resumeText.trim()) {
        send(res, 400, { error: '简历正文不能为空。' });
        return;
      }
      pendingAssistantOutput = { analysis: String(result.analysis || ''), resumeText: result.resumeText };
      send(res, 200, { ok: true });
    } catch {
      send(res, 400, { error: '接收的内容格式无效。' });
    }
    return;
  }  if (req.method !== 'POST' || req.url !== '/api/optimize') {
    send(res, 404, { error: '页面不存在。' });
    return;
  }
  if (!apiKey) {
    send(res, 503, { error: '尚未配置 AI_API_KEY。请设置所选服务商的 API 密钥。' });
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('提交内容过大，请精简资料后重试。');
    }
    const profile = JSON.parse(raw);
    const instructions = `你是简历分析与改写助手。必须先完整分析个人教育、工作 / 实习及项目 / 校园经历，从行动、场景、本人职责、交付物与结果中归纳能力画像并关联证据来源；再解析岗位职责和任职要求，将其归纳为能力类别，最后把能力类别逐项对应到画像和经历证据，指出优势与缺口。禁止依据关键词重合数或文本覆盖率判定能力匹配。公司品牌文化用于理解组织关注点和选择表达重点，不得把口号写成个人能力。使用与目标职能相关的专业用词，避免空泛形容词。每条经历按“动词开头 + 具体行动 / 事件 +（有资料依据时）目标用户和真实问题 + 解决方案 / 交付 + 可核实结果”改写。动作动词要丰富且准确，避免相邻要点反复使用同一开头或全篇重复“参与、负责、完成、设计”等词；可按实际职责选择“调研、识别、拆解、统筹、建模、梳理、沉淀、跟进、推动、落地”等动词，不得夸大职责。全篇使用专业、书面的简历表达，避免口语化叙述和聊天式连接词。产品类经历优先写明做了什么、面向谁、解决什么需求、达成什么结果。资料没有写用户或问题时，不得补造，直接写目标、任务和行动。量化结果只能使用原始资料提供的数字或可从来源直接复核计算的数据；不得编造或把估算写成事实。可在分析中提出估算方法并标为“估算 / 待本人核实”，经用户确认后才可加入简历。设计主题、竞赛命题或作品目标不是问题，保留具体事件与方案落地事实。简历语言专业、简练、与岗位匹配；不得虚构职责、工具熟练度、客户结果或公司文化。简短匹配分析与简历正文分开。只返回 JSON 对象，格式为 {"analysis":"岗位核心要求、公司文化关注点、经历匹配证据、能力缺口及待核实数据","resumeText":"完整可投递简历纯文本，含姓名、求职方向、核心优势、教育经历、工作/实习经历、项目/校园经历、技能；缺少的模块省略"}。`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: instructions + '\n\n经历与项目改写顺序：每条按具体问题或项目要求 → 具体解决方案/行动 → 可核实结果撰写。行动要用动词开头，写清具体事件和做法；结果尽量使用资料已有的数量、排名、时长、金额或比例，没有量化数据时只写有依据的奖项、交付或结果，不得估算或编造。不要把解决方案误写成问题，例如将“亭”主题构想落地为实体作品作为行动方案，放在项目要求之后。若资料没有写明实际问题，不要杜撰问题，直接以项目目标或任务开头。' }, { role: 'user', content: JSON.stringify({
          personalProfile: { name: profile.name, level: profile.level, contact: profile.contact, city: profile.city, travel: profile.travel, skills: profile.skills, education: profile.education, work: profile.work, projects: profile.project },
          targetRole: profile.target,
          jobDescription: profile.jd,
          company: profile.company,
          companyBrandAndCulture: profile.brandText
        }) } ]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `AI 服务返回错误（${response.status}）。`;
      send(res, response.status, { error: message });
      return;
    }
    const output = data.choices?.[0]?.message?.content;
    if (!output) throw new Error('AI 没有返回可读内容，请稍后重试。');
    const result = JSON.parse(output);
    send(res, 200, { analysis: String(result.analysis || ''), resumeText: String(result.resumeText || '') });
  } catch (error) {
    send(res, 500, { error: error.message || '生成失败，请重试。' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`简历工作台已启动：http://127.0.0.1:${port}`);
});
