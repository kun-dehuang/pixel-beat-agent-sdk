import * as express from 'express';
import { ToolHandlers, MemorySelectAddInput, MemorySelectSelectWithAnswerInput } from './tools';
import * as cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;
const toolHandlers = new ToolHandlers();

app.use(cors());
app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Memory Select API 端点
app.post('/api/memory/add', async (req, res) => {
  try {
    const result = await toolHandlers.memorySelectAdd(req.body as MemorySelectAddInput);
    res.json(JSON.parse(result.content[0].text));
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/memory/select-with-answer', async (req, res) => {
  try {
    const result = await toolHandlers.memorySelectSelectWithAnswer(req.body as MemorySelectSelectWithAnswerInput);
    res.json(JSON.parse(result.content[0].text));
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// 根路径信息
app.get('/', (req, res) => {
  res.json({
    name: 'Pixel Beat API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      memoryAdd: 'POST /api/memory/add',
      memorySelectWithAnswer: 'POST /api/memory/select-with-answer'
    }
  });
});

app.listen(port, () => {
  console.log(`Pixel Beat API running on port ${port}`);
});
